/**
 * The hold transaction: the one place a jar stops being free.
 *
 * Brief section 9.3: "Holds are taken inside a Firestore transaction on the
 * batch document, so two people can never hold the same last jar. A hold
 * counts only while its expiry is in the future, so a lapsed hold frees the
 * jar even if the clean-up job is late."
 *
 * Brief section 7.2 step 3: "Limit checked against the number, across all
 * their orders in this batch." The customer is therefore an argument of this
 * function, not an afterthought of the screen that calls it, and the limit is
 * checked inside the same transaction that moves the count. A limit checked
 * anywhere else is a limit two browser tabs can walk straight past.
 *
 * The arithmetic is the shared `batchAvailability` / `inStockAvailability` /
 * `canHold` / `withinPerPersonLimit`, never repeated here. Checkout (M3) and
 * the counter sale (M2.8) call this rather than writing `heldJars`
 * themselves: `heldJars` and `paidCount` are protected fields (A40) and this
 * transaction is the only code path that may move them.
 */

import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  type BatchAvailability,
  batchAvailability,
  batchLabelCapitalised,
  BATCH_STATES_IN_STOCK,
  BATCH_STATES_OPEN_FOR_BOOKING,
  canHold,
  inStockAvailability,
  remainingPerPersonAllowance,
  withinPerPersonLimit,
} from "@lailark/shared";

import { getAdminApp } from "../lib/admin";
import { BATCHES, batchViewFrom, heldJarsFrom, heldJarsWithCustomerFrom, ordersInBatch } from "./store";

/** `settings/holds`: 15 minutes at launch. */
export const HOLD_MINUTES = 15;

/**
 * E.164, which is what section 18.1 makes the `customers/{phoneE164}`
 * document id. The limit is counted per customer, and "one customer per
 * number" is only true by construction if the number is always written the
 * same way, so a hold refuses a number in any other shape rather than
 * quietly opening a second allowance under a second spelling.
 */
const E164 = /^\+[1-9]\d{7,14}$/;

export class HoldRefused extends Error {
  constructor(
    readonly reason:
      | "no-such-batch"
      | "not-on-sale"
      | "held-by-someone-else"
      | "sold-out"
      | "over-limit"
      | "invalid-customer",
    message: string,
  ) {
    super(message);
    this.name = "HoldRefused";
  }
}

export interface HoldResult {
  /** The batch's internal reference, `"b-7f3a2c"`. D21c: never the number. */
  readonly batchRef: string;
  /** The printed number, or null while the batch is still open (D21c). */
  readonly batchNo: string | null;
  readonly customerPhone: string;
  readonly orderId: string;
  readonly qty: number;
  readonly expiresAtMillis: number;
  readonly availabilityBefore: BatchAvailability;
  /** Jars this customer already had in this batch, live holds plus paid. */
  readonly customerJarsBefore: number;
  /** What is left of their allowance after this hold. */
  readonly remainingAllowance: number;
}

/**
 * Holds `qty` jars of `batchRef` for `orderId`, on behalf of `customerPhone`,
 * or refuses.
 *
 * D21c: the batch is addressed by its internal reference. A hold is taken
 * while the batch is open, long before it has a printed number, and the same
 * reference still names it after bottling, so the order that took this hold
 * resolves to the same batch either side of that moment.
 *
 * Never oversells: the count is read and written inside one transaction, and
 * the check is `paid + live holds + requested <= capacity` on the value the
 * transaction read, so the loser of a race is retried against the winner's
 * write.
 *
 * Never lets one person past the per-person limit either: their live holds in
 * this batch plus their paid jars across every order in it are counted in the
 * same transaction, against the batch's own `perPersonLimit`. Because the
 * count is read from, and the hold written to, the one batch document, two
 * simultaneous holds from the same customer contend on that document and the
 * second is retried against the first.
 */
export async function takeHold(args: {
  readonly batchRef: string;
  /** E.164. The `customers/{phoneE164}` document id of section 18.1. */
  readonly customerPhone: string;
  readonly orderId: string;
  readonly qty: number;
  readonly holdMinutes?: number;
}): Promise<HoldResult> {
  const { batchRef, customerPhone, orderId, qty } = args;

  if (typeof customerPhone !== "string" || !E164.test(customerPhone)) {
    throw new HoldRefused(
      "invalid-customer",
      "A hold needs the customer's number in international form, for example +919446587027.",
    );
  }

  const db = getFirestore(getAdminApp());
  const doc = db.collection(BATCHES).doc(batchRef);

  return db.runTransaction(async (tx) => {
    /* ---- read: the batch, then every order in it -------------------- */

    const snap = await tx.get(doc);
    if (!snap.exists) {
      throw new HoldRefused("no-such-batch", `There is no batch ${batchRef}.`);
    }

    const batch = batchViewFrom(snap);
    const heldJars = heldJarsFrom(snap);
    const heldWithCustomer = heldJarsWithCustomerFrom(snap);
    // Every read happens before the write below: the Node SDK refuses a read
    // after a write in the same transaction.
    const orders = await ordersInBatch(tx, db, batchRef);

    const now = Date.now();
    const state = batch.state ?? "";

    let availability: BatchAvailability;
    if ((BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(state)) {
      availability = batchAvailability({
        bookableJars: batch.bookableJars,
        paidCount: batch.paidCount,
        heldJars,
        now,
      });
    } else if ((BATCH_STATES_IN_STOCK as readonly string[]).includes(state)) {
      availability = inStockAvailability({
        bottledJars: batch.bottledJars,
        paidCount: batch.paidCount,
        heldJars,
        writtenOff: batch.writtenOff,
        now,
      });
    } else {
      throw new HoldRefused(
        "not-on-sale",
        `${batchLabelCapitalised(batch.batchNo, batchRef, state)} is not on sale.`,
      );
    }

    /* ---- the per-person limit, brief 7.2 step 3 --------------------- */

    // "Across all their orders in this batch": the jars they are holding
    // right now, plus the jars they have already paid for. A lapsed hold
    // counts for nothing here for the same reason it counts for nothing in
    // the availability: the jar is free again. The hold being replaced is
    // this same order's own, so it is not counted against itself; `heldJars`
    // is keyed by order id and this write overwrites that key.
    let customerJars = 0;
    for (const [heldOrderId, hold] of Object.entries(heldWithCustomer)) {
      if (heldOrderId === orderId) continue;
      if (hold.customerPhone !== customerPhone) continue;
      if (hold.expiresAt > now) customerJars += hold.qty;
    }
    for (const order of orders.paid) {
      if (order.id === orderId) continue;
      if (order.customerPhone !== customerPhone) continue;
      customerJars += order.jars;
    }

    const limit = batch.perPersonLimit;
    if (!withinPerPersonLimit(customerJars, qty, limit)) {
      const remaining = remainingPerPersonAllowance(customerJars, limit);
      // "This batch" rather than a name: before bottling the only name a batch
      // has is its internal reference (D21c), and `b-7f3a2c` is an admin's
      // string, not something to put in front of a customer.
      throw new HoldRefused(
        "over-limit",
        `This batch is limited to ${jars(limit)} per person and you already have ${customerJars}. ` +
          (remaining === 0
            ? "You cannot take any more from this batch."
            : `You may still take ${jars(remaining)}.`),
      );
    }

    /* ---- the last jar, brief 9.3 ------------------------------------ */

    if (!canHold(availability, qty)) {
      // Brief 9.3: a jar that is held is not a jar that has gone.
      throw availability.heldOutByOthers
        ? new HoldRefused(
            "held-by-someone-else",
            "Someone is paying for the last jar, check back in 15 minutes.",
          )
        : new HoldRefused(
            "sold-out",
            `This batch has ${availability.available} jars free.`,
          );
    }

    /* ---- write ------------------------------------------------------ */

    const expiresAtMillis = now + (args.holdMinutes ?? HOLD_MINUTES) * 60_000;
    tx.set(
      doc,
      {
        heldJars: {
          [orderId]: {
            qty,
            expiresAt: Timestamp.fromMillis(expiresAtMillis),
            customerPhone,
          },
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "system",
      },
      { merge: true },
    );

    return {
      batchRef,
      batchNo: batch.batchNo,
      customerPhone,
      orderId,
      qty,
      expiresAtMillis,
      availabilityBefore: availability,
      customerJarsBefore: customerJars,
      remainingAllowance: remainingPerPersonAllowance(customerJars + qty, limit),
    };
  });
}

function jars(n: number): string {
  return `${n} jar${n === 1 ? "" : "s"}`;
}
