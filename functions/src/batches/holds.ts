/**
 * The stock transaction: the one place a jar stops being free.
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
 * `canHold` / `withinPerPersonLimit`, never repeated here. `heldJars` and
 * `paidCount` are protected fields (A40) and this module is the only code
 * path in the system that may move them.
 *
 * **M2.8 split this file in two halves, and why.** A web checkout holds a jar
 * and nothing else, so `takeHold` can own its whole transaction. A counter
 * sale (brief 7A.1) has to move the count, write the order, create or update
 * the customer and append the audit trail, and all of that must commit
 * together or not at all: a sale whose jar left the batch but whose order
 * never landed is a jar nobody can account for. A nested transaction is not a
 * thing, so the count move is split into a **read** half (`readStockClaim`,
 * which does every read and every check) and a **write** half
 * (`writeStockClaim`), and the caller runs both inside the transaction it
 * already owns. `takeHold` is now a three-line wrapper over the same two
 * halves, so there is still exactly one place the arithmetic lives and
 * exactly one set of checks a jar has to pass.
 *
 * The Node SDK refuses a read after a write in one transaction, which is why
 * the halves are in this order and why a caller must finish every read it
 * needs before it calls `writeStockClaim`.
 */

import {
  type DocumentSnapshot,
  FieldValue,
  type Firestore,
  getFirestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
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
import {
  BATCHES,
  batchViewFrom,
  heldJarsFrom,
  heldJarsWithCustomerFrom,
  ordersInBatch,
} from "./store";

/** `settings/holds`: 15 minutes at launch. */
export const HOLD_MINUTES = 15;

/**
 * `settings/holds.paymentLinkHoldMinutes`: brief 7A.1 step 5, "Jars held
 * until the link expires (default 24 hours, editable)". The link itself is
 * M3; the hold it implies is taken here from M2.8 on, so an Awaiting payment
 * counter sale is a jar that is really out of the count for a day rather
 * than a promise nothing is keeping.
 */
export const PAYMENT_LINK_HOLD_MINUTES = 24 * 60;

/**
 * E.164, which is what section 18.1 makes the `customers/{phoneE164}`
 * document id. The limit is counted per customer, and "one customer per
 * number" is only true by construction if the number is always written the
 * same way, so a claim refuses a number in any other shape rather than
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
      | "invalid-customer"
      | "invalid-qty",
    message: string,
  ) {
    super(message);
    this.name = "HoldRefused";
  }
}

/**
 * How a jar leaves the free count.
 *
 *  - `hold`: reserved for one order, with an expiry. It frees itself when the
 *    expiry passes, with no clean-up job (brief 9.3). This is a web checkout,
 *    and a counter sale paid by link (7A.1 step 5).
 *  - `paid`: the money is in and the jar is gone. This is cash and UPI at the
 *    counter, where the jar physically leaves the kitchen as the sale is
 *    saved, and it moves `paidCount`.
 */
export type StockMode = "hold" | "paid";

export interface StockClaimRequest {
  readonly batchRef: string;
  /** E.164. The `customers/{phoneE164}` document id of section 18.1. */
  readonly customerPhone: string;
  readonly orderId: string;
  readonly qty: number;
  readonly mode: StockMode;
  /** Only for `hold`. Defaults to {@link HOLD_MINUTES}. */
  readonly holdMinutes?: number;
  /**
   * Brief 7A.6: "Override the per-person limit" is the Owner's row and the
   * Owner's alone. Whoever sets this has already checked the caller's role;
   * this module only records that it was set. It is never read off a request.
   */
  readonly overrideLimit?: boolean;
}

/**
 * Everything the read half worked out, and the two patches the write half
 * and the audit trail need. Holding both means the caller never recomputes a
 * count, and the `audit/{id}` entry carries the real number the batch went to
 * rather than a sentinel.
 */
export interface StockClaim {
  readonly request: StockClaimRequest;
  /** The batch as this transaction read it. `writeAudit`'s `before`. */
  readonly batchSnap: DocumentSnapshot;
  readonly batchNo: string | null;
  readonly availabilityBefore: BatchAvailability;
  /** Jars this customer already had in this batch, live holds plus paid. */
  readonly customerJarsBefore: number;
  /** What is left of their allowance after this claim. */
  readonly remainingAllowance: number;
  /** Non-null only in `hold` mode. */
  readonly expiresAtMillis: number | null;
  /** The whole `paidCount` or `heldJars` value this claim writes. */
  readonly auditPatch: Readonly<Record<string, unknown>>;
  /** Whether the limit was waived, for the trail (7A.6). */
  readonly limitOverridden: boolean;
}

/**
 * The read half. Reads the batch and every order in it, checks the state, the
 * per-person limit and the count, and works out exactly what the write would
 * be. Throws {@link HoldRefused} with a line a person can act on, never a
 * code: brief 7A.1 step 7 asks for "someone bought the last one online", not
 * an error number.
 *
 * Every read this needs happens here, so a caller can do the rest of its own
 * reads either side of it and still write afterwards.
 *
 * Never oversells: the count is read and checked inside the caller's
 * transaction, and the check is `paid + live holds + requested <= capacity`
 * on the value that transaction read, so the loser of a race is retried
 * against the winner's write and then fails the check honestly.
 */
export async function readStockClaim(
  tx: Transaction,
  db: Firestore,
  request: StockClaimRequest,
): Promise<StockClaim> {
  const { batchRef, customerPhone, orderId, qty, mode } = request;

  if (typeof customerPhone !== "string" || !E164.test(customerPhone)) {
    throw new HoldRefused(
      "invalid-customer",
      "A jar needs the customer's number in international form, for example +919446587027.",
    );
  }
  if (!Number.isInteger(qty) || qty < 1) {
    throw new HoldRefused("invalid-qty", "A sale needs a whole number of jars, one or more.");
  }

  const doc = db.collection(BATCHES).doc(batchRef);
  const snap = await tx.get(doc);
  if (!snap.exists) {
    throw new HoldRefused("no-such-batch", `There is no batch ${batchRef}.`);
  }

  const batch = batchViewFrom(snap);
  const heldJars = heldJarsFrom(snap);
  const heldWithCustomer = heldJarsWithCustomerFrom(snap);
  // Every read happens before any write: the Node SDK refuses a read after a
  // write in the same transaction.
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
  } else if (state === "soldOut") {
    // Not the same thing as "not on sale". A sold-out batch is a batch whose
    // jars have gone, and that is the sentence brief 7A.1 step 7 asks for:
    // the person at the counter needs to know somebody got there first, not
    // that a switch is off somewhere. The batch reaches this state on its own
    // (the automatic row in 8.2) the moment the last jar goes, so this is the
    // line the loser of a race usually reads.
    throw new HoldRefused(
      "sold-out",
      `${batchLabelCapitalised(batch.batchNo, batchRef, state)} is sold out: someone took the last jar.`,
    );
  } else {
    throw new HoldRefused(
      "not-on-sale",
      `${batchLabelCapitalised(batch.batchNo, batchRef, state)} is not on sale.`,
    );
  }

  /* ---- the per-person limit, brief 7.2 step 3 and 7A.6 --------------- */

  // "Across all their orders in this batch": the jars they are holding right
  // now, plus the jars they have already paid for. A lapsed hold counts for
  // nothing here for the same reason it counts for nothing in the
  // availability: the jar is free again. The hold being replaced is this same
  // order's own, so it is not counted against itself; `heldJars` is keyed by
  // order id and this write overwrites that key.
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
  const limitOverridden = request.overrideLimit === true;
  if (!limitOverridden && !withinPerPersonLimit(customerJars, qty, limit)) {
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

  /* ---- the last jar, brief 9.3 and 7A.1 step 7 ----------------------- */

  if (!canHold(availability, qty)) {
    // Brief 9.3: a jar that is held is not a jar that has gone. Both lines
    // are written for the person reading them, not for a log.
    if (availability.heldOutByOthers) {
      throw new HoldRefused(
        "held-by-someone-else",
        "Someone is paying for the last jar, check back in 15 minutes.",
      );
    }
    // M2.8: brief 7A.1 step 7 asks for "someone bought the last one", so the
    // loser of a race is told that, in those words, rather than being handed
    // an arithmetic fact about a count. And a count that is short but not
    // empty says so, through the same pluralising helper the limit uses: the
    // old line read "This batch has 1 jars free", which is the sort of
    // sentence that makes a person distrust the rest of the screen.
    throw new HoldRefused(
      "sold-out",
      availability.available === 0
        ? "Someone just bought the last one, so there are no jars free on this batch."
        : `There ${availability.available === 1 ? "is" : "are"} only ${jars(availability.available)} free on this batch.`,
    );
  }

  /* ---- what the write will be ---------------------------------------- */

  if (mode === "paid") {
    return {
      request,
      batchSnap: snap,
      batchNo: batch.batchNo,
      availabilityBefore: availability,
      customerJarsBefore: customerJars,
      remainingAllowance: remainingPerPersonAllowance(customerJars + qty, limit),
      expiresAtMillis: null,
      // The value, not an increment sentinel: the document is already in this
      // transaction's read set, so the arithmetic is safe here, and the audit
      // entry then carries the number the batch actually went to.
      auditPatch: { paidCount: batch.paidCount + qty },
      limitOverridden,
    };
  }

  const expiresAtMillis = now + (request.holdMinutes ?? HOLD_MINUTES) * 60_000;
  // The whole map, so `before`/`after` on the audit entry are two states of
  // one field rather than a partial merge nobody can read back.
  const nextHeldJars: Record<string, { qty: number; expiresAt: Timestamp; customerPhone: string }> = {};
  for (const [heldOrderId, hold] of Object.entries(heldWithCustomer)) {
    if (heldOrderId === orderId) continue;
    nextHeldJars[heldOrderId] = {
      qty: hold.qty,
      expiresAt: Timestamp.fromMillis(hold.expiresAt),
      customerPhone: hold.customerPhone ?? "",
    };
  }
  nextHeldJars[orderId] = {
    qty,
    expiresAt: Timestamp.fromMillis(expiresAtMillis),
    customerPhone,
  };

  return {
    request,
    batchSnap: snap,
    batchNo: batch.batchNo,
    availabilityBefore: availability,
    customerJarsBefore: customerJars,
    remainingAllowance: remainingPerPersonAllowance(customerJars + qty, limit),
    expiresAtMillis,
    auditPatch: { heldJars: nextHeldJars },
    limitOverridden,
  };
}

/**
 * The write half. Applies the claim the read half worked out, in the caller's
 * transaction, so the count moves in the same commit as whatever else that
 * caller is writing.
 */
export function writeStockClaim(
  tx: Transaction,
  db: Firestore,
  claim: StockClaim,
  actor: string,
): void {
  tx.set(
    db.collection(BATCHES).doc(claim.request.batchRef),
    {
      ...claim.auditPatch,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );
}

/* -------------------------------------------------------------------------- */
/* Putting a jar back: the void of brief 7A.6                                 */
/* -------------------------------------------------------------------------- */

export class ReleaseRefused extends Error {
  constructor(
    readonly reason: "no-such-batch" | "count-would-go-negative",
    message: string,
  ) {
    super(message);
    this.name = "ReleaseRefused";
  }
}

export interface StockRelease {
  readonly batchRef: string;
  readonly batchSnap: DocumentSnapshot;
  readonly auditPatch: Readonly<Record<string, unknown>>;
  /** Jars put back. Zero when the claim had already lapsed or gone. */
  readonly qtyReturned: number;
}

/**
 * The read half of putting jars back on a batch: a voided counter sale (brief
 * 7A.6) and, later, an expired hold.
 *
 * "A voided sale must put the jar back." It goes back through the same
 * document and the same transaction discipline it left by, and it can never
 * take a count below zero: if the arithmetic says it would, the release is
 * refused rather than silently clamped, because a count that is already wrong
 * is a thing to look at, not a thing to round.
 */
export async function readStockRelease(
  tx: Transaction,
  db: Firestore,
  args: {
    readonly batchRef: string;
    readonly orderId: string;
    readonly qty: number;
    readonly mode: StockMode;
  },
): Promise<StockRelease> {
  const doc = db.collection(BATCHES).doc(args.batchRef);
  const snap = await tx.get(doc);
  if (!snap.exists) {
    throw new ReleaseRefused("no-such-batch", `There is no batch ${args.batchRef}.`);
  }

  if (args.mode === "paid") {
    const paidCount = batchViewFrom(snap).paidCount;
    const next = paidCount - args.qty;
    if (next < 0) {
      throw new ReleaseRefused(
        "count-would-go-negative",
        `Putting ${jars(args.qty)} back would take this batch's paid count below zero. Tell Shefin before anything else is sold from it.`,
      );
    }
    return { batchRef: args.batchRef, batchSnap: snap, auditPatch: { paidCount: next }, qtyReturned: args.qty };
  }

  const held = heldJarsWithCustomerFrom(snap);
  const mine = held[args.orderId];
  const nextHeldJars: Record<string, { qty: number; expiresAt: Timestamp; customerPhone: string }> = {};
  for (const [heldOrderId, hold] of Object.entries(held)) {
    if (heldOrderId === args.orderId) continue;
    nextHeldJars[heldOrderId] = {
      qty: hold.qty,
      expiresAt: Timestamp.fromMillis(hold.expiresAt),
      customerPhone: hold.customerPhone ?? "",
    };
  }
  return {
    batchRef: args.batchRef,
    batchSnap: snap,
    auditPatch: { heldJars: nextHeldJars },
    qtyReturned: mine?.qty ?? 0,
  };
}

/** The write half of {@link readStockRelease}. */
export function writeStockRelease(
  tx: Transaction,
  db: Firestore,
  release: StockRelease,
  actor: string,
): void {
  tx.set(
    db.collection(BATCHES).doc(release.batchRef),
    {
      ...release.auditPatch,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );
}

/* -------------------------------------------------------------------------- */
/* The web checkout's own transaction (M3)                                    */
/* -------------------------------------------------------------------------- */

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
  readonly customerJarsBefore: number;
  readonly remainingAllowance: number;
}

/**
 * Holds `qty` jars of `batchRef` for `orderId`, on behalf of `customerPhone`,
 * or refuses. A transaction of its own, for a caller that has nothing else to
 * write.
 *
 * D21c: the batch is addressed by its internal reference. A hold is taken
 * while the batch is open, long before it has a printed number, and the same
 * reference still names it after bottling, so the order that took this hold
 * resolves to the same batch either side of that moment.
 */
export async function takeHold(args: {
  readonly batchRef: string;
  readonly customerPhone: string;
  readonly orderId: string;
  readonly qty: number;
  readonly holdMinutes?: number;
}): Promise<HoldResult> {
  const db = getFirestore(getAdminApp());

  return db.runTransaction(async (tx) => {
    const claim = await readStockClaim(tx, db, { ...args, mode: "hold" });
    writeStockClaim(tx, db, claim, "system");
    return {
      batchRef: args.batchRef,
      batchNo: claim.batchNo,
      customerPhone: args.customerPhone,
      orderId: args.orderId,
      qty: args.qty,
      expiresAtMillis: claim.expiresAtMillis ?? 0,
      availabilityBefore: claim.availabilityBefore,
      customerJarsBefore: claim.customerJarsBefore,
      remainingAllowance: claim.remainingAllowance,
    };
  });
}

function jars(n: number): string {
  return `${n} jar${n === 1 ? "" : "s"}`;
}
