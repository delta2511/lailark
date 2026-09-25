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
  IN_STOCK_PER_PERSON_LIMIT,
  remainingPerPersonAllowance,
  resolvePerPersonLimit,
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
  /**
   * The per-person cap to use **when the Owner has typed none on the batch**.
   *
   * **Decision D52.** The number typed in the admin governs the website too,
   * in both directions, so it is never narrowed by anything a caller passes:
   * typing 5 lets a web buyer take 5 and typing 1 lets them take 1. Only a
   * blank box falls through to this, and the web's fallback for an in-stock
   * batch is brief 4.1's two jars rather than the open-batch quarter.
   *
   * The counter passes nothing at all and keeps the quarter (4.1's next
   * column), which is exactly what it did before M3.5.
   *
   * M3.5 first built this as `maxJarsForCustomer`, a cap that only ever
   * narrowed. D52 replaced that shape: a cap on a cap cannot express "typing
   * 5 means 5", and it told a customer "limited to 2" when the Owner had
   * typed 5. `resolvePerPersonLimit` in `@lailark/shared` is the one place
   * the three-way answer lives, so this module and `/api/counts` cannot
   * drift apart about what the picker on the site may offer.
   */
  readonly perPersonLimitFallback?: number;
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

  // D44 and D52: the Owner's typed cap when there is one, whatever it is;
  // then the caller's fallback, for the web's two jars in stock; then the
  // computed quarter. Never `batch.perPersonLimit` on its own.
  const limit = resolvePerPersonLimit(batch, request.perPersonLimitFallback);
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

/**
 * The write half of {@link readStockRelease}.
 *
 * **`update`, not `set({ merge: true })`, and that is the whole point.**
 * Firestore merges a map field leaf by leaf, so a `heldJars` key this
 * release deliberately left out would be merged straight back in and the
 * hold would never go. `update` replaces the field as a whole, which is safe
 * because {@link readStockRelease} read the map inside this same
 * transaction, so nothing can have changed under it. `writeStockClaim`
 * stays a merging `set` because it omits no key: it copies every existing
 * hold and adds one.
 */
export function writeStockRelease(
  tx: Transaction,
  db: Firestore,
  release: StockRelease,
  actor: string,
): void {
  tx.update(db.collection(BATCHES).doc(release.batchRef), {
    ...release.auditPatch,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor,
  });
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

/* -------------------------------------------------------------------------- */
/* A held jar becoming a paid one (M3.6)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where the jars a capture is about to sell came from.
 *
 *  - `live-hold`: the order's own hold, still live. The ordinary path.
 *  - `reclaimed`: the hold had lapsed, but the batch still had a jar free, so
 *    one was claimed afresh inside this transaction.
 *  - `none`: the hold had lapsed and the batch has nothing to give. Brief
 *    §21.1: "Technical, not a sale."
 */
export type HoldConversionSource = "live-hold" | "reclaimed" | "none";

/**
 * Why a reclaim was not made. Non-null exactly when the source is `none`, and
 * it is what lets the caller put the right sentence in front of the Owner:
 * every one of these ends the same way (brief §21.1, the money recorded and
 * nothing sold), but they are four different things to go and fix.
 *
 *  - `no-jar`: the batch has nothing free, or is not in a state that sells.
 *  - `qty-mismatch`: the order's line does not add up to the total the
 *    captured amount matched, so nothing here knows how many jars the money
 *    bought. See {@link readHoldToPaid}.
 *  - `over-limit`: a jar was free, but a fresh claim would put this customer
 *    past the batch's per-person limit (D44, D52).
 *  - `no-customer`: the order carries no usable number, so the per-person
 *    limit cannot be counted at all, and a claim that cannot be checked is
 *    not made.
 */
export type HoldConversionRefusal = "no-jar" | "qty-mismatch" | "over-limit" | "no-customer";

export interface HoldConversion {
  readonly batchRef: string;
  /** The batch as this transaction read it. `writeAudit`'s `before`. */
  readonly batchSnap: DocumentSnapshot;
  /** The printed batch number, or null on a batch not yet bottled (D21c). */
  readonly batchNo: string | null;
  /** The batch's own state, which decides bill or receipt (brief 13.1). */
  readonly batchState: string;
  readonly source: HoldConversionSource;
  /**
   * False only when {@link source} is `none`: the hold had lapsed and the
   * batch cannot supply a jar. The caller must **not** write the conversion
   * in that case; it is a concern, not a sale.
   */
  readonly held: boolean;
  /** Why no jar was claimed. Non-null exactly when {@link held} is false. */
  readonly refusal: HoldConversionRefusal | null;
  /** Jars this sells. Zero when {@link held} is false. */
  readonly qty: number;
  /**
   * The per-person limit a reclaim was weighed against, and the jars this
   * customer already had in this batch, for the Owner's sentence. Non-null
   * only when the reclaim path got as far as asking (D44, D52).
   */
  readonly limitCheck: { readonly limit: number; readonly customerJars: number } | null;
  /** The batch as it stood before this conversion, for the caller's log. */
  readonly availabilityBefore: BatchAvailability;
  /** `{ heldJars, paidCount }`, the whole of both. */
  readonly auditPatch: Readonly<Record<string, unknown>>;
}

/**
 * The read half of turning this order's hold into paid jars, inside the
 * caller's transaction and on the batch document, which is the only place a
 * count may move (CLAUDE.md section 3).
 *
 * On the ordinary path it is arithmetic on the batch as *this* transaction
 * read it: the hold's key leaves `heldJars` and its jars are added to
 * `paidCount`, so the total of "not free" is unchanged and nothing can be
 * oversold by it.
 *
 * ## A hold counts only while it is live, here as everywhere else
 *
 * The first cut of this function decided a hold existed by asking whether
 * the `heldJars` key was **present**, and that was an oversell. Everything
 * else in this system counts a hold only while its expiry is in the future
 * (brief 9.3, and the header of this file): `liveHeldJars` skips a lapsed
 * entry, so `batchAvailability`, `/api/counts`, the site and
 * `readStockClaim` all treat that jar as free the moment the clock passes.
 * `sweepHolds` runs every five minutes and a hold is fifteen, so a dead key
 * outlives its expiry by up to five minutes. In that window the same jar was
 * free to a new checkout **and** convertible by a capture, and both could
 * have it: 23 jars sold from a batch of 22.
 *
 * So the expiry is read, not just the key. A lapsed hold is not a hold.
 *
 * ## What happens instead, when the hold has lapsed
 *
 * Refusing every lapsed capture would be safe and unkind: the customer has
 * paid, and most of the time the jar they were holding is still sitting
 * there. So the question becomes the one the batch can actually answer, and
 * it is asked the same way every other caller asks it (`batchAvailability` /
 * `inStockAvailability` over live holds):
 *
 *  - a jar is free, so one is **claimed afresh** and the sale completes;
 *  - nothing is free, so `source` is `none` and the caller raises brief
 *    21.1's concern instead: "Technical, not a sale. Owner refunds or
 *    allocates a surplus jar."
 *
 * The claim is safe precisely because it is made **inside the caller's
 * transaction on the batch document**, in the same commit as the check: two
 * lapsed captures racing for one last jar are retried against each other and
 * the loser's arithmetic honestly says no, exactly as in `readStockClaim`.
 *
 * ## How many jars a reclaim may claim
 *
 * A live hold sells `mine.qty`: the number that was actually reserved, and
 * which nothing can have changed since. A reclaim has no such anchor, so it
 * is given two, and it is made only when **both** agree with the jars the
 * order asks for:
 *
 *  - `qtyPaidFor`, the jars the captured money accounts for. The caller has
 *    already matched the captured amount against the order's stored `total`,
 *    but `total` is a *separate field* from the line, so a line saying five
 *    jars against a total of one jar's money would otherwise sail through
 *    and sell five jars, and bill for five, on one jar's payment;
 *  - `mine.qty`, when a lapsed key is still there. A reclaim replaces a
 *    reservation, and it may never grow it.
 *
 * Nothing in the admin or the site can make those disagree today (`orders`
 * is closed to every client in `firestore.rules`, and the M3.5a resume path
 * refuses a qty change), so this is an invariant rather than a hole being
 * plugged. It is held here because this is the only place a count moves.
 *
 * A disagreement is **not** sold down to the smaller number. A partial sale
 * would mean this function deciding, on its own, which of two numbers on a
 * paid order is the true one, and then issuing a bill for that guess. It
 * refuses instead, and the Owner gets §21.1's concern with the two numbers
 * in it.
 *
 * ## The per-person limit, re-asked on a reclaim only
 *
 * A **live** hold converts unconditionally. Those jars really were reserved,
 * the check they passed was against a world that still holds, and refusing
 * them would refuse a sale that was properly allowed.
 *
 * A **reclaim** is a new claim, made now, so it is checked now (Shefin, 25
 * Sep 2026, overruling A197, which left it unchecked). The cost of leaving
 * it unchecked was a loop: take a hold, let it lapse (a lapsed hold counts for
 * nothing, so the next check passes honestly), repeat, then pay every stale
 * Razorpay order. One person could take a batch capped at two each.
 *
 * The count is the same one `readStockClaim` makes, off the same two
 * sources: this customer's live holds, and their paid orders in this batch.
 * The cap is `resolvePerPersonLimit`, so the Owner's typed number governs in
 * both directions (D44, D52) and nothing here re-derives that rule.
 *
 * Over the limit is not a refusal of the money: it is §21.1's outcome, the
 * same as no jar at all. Nobody inside the limit is ever refused.
 *
 * It stays **idempotent**: run a second time on the committed result, the
 * key is gone and the order's payment has moved, so `capture.ts` returns at
 * its `alreadyPaid` branch and this is never reached again. A replayed
 * `payment.captured` costs one read and changes no count.
 */
export async function readHoldToPaid(
  tx: Transaction,
  db: Firestore,
  args: {
    readonly batchRef: string;
    readonly orderId: string;
    /** E.164, for the per-person limit a reclaim is checked against. */
    readonly customerPhone: string;
    /** The jars the order is for, used only when the hold has lapsed. */
    readonly qty: number;
    /**
     * The jars the captured money accounts for, or null when the order's
     * lines do not add up to the total that amount matched. A reclaim is
     * made only for a number both this and the order agree on.
     */
    readonly qtyPaidFor: number | null;
    readonly nowMillis: number;
  },
): Promise<HoldConversion> {
  const snap = await tx.get(db.collection(BATCHES).doc(args.batchRef));
  if (!snap.exists) {
    throw new ReleaseRefused("no-such-batch", `There is no batch ${args.batchRef}.`);
  }

  const batch = batchViewFrom(snap);
  const held = heldJarsWithCustomerFrom(snap);
  const mine = held[args.orderId];

  // This order's key leaves the map either way. A key whose expiry has
  // passed is counted by nothing in this system, so leaving it behind would
  // only be leaving litter for the sweep; and on the live path it is the
  // whole point of the conversion.
  const nextHeldJars: Record<
    string,
    { qty: number; expiresAt: Timestamp; customerPhone: string }
  > = {};
  for (const [heldOrderId, hold] of Object.entries(held)) {
    if (heldOrderId === args.orderId) continue;
    nextHeldJars[heldOrderId] = {
      qty: hold.qty,
      expiresAt: Timestamp.fromMillis(hold.expiresAt),
      customerPhone: hold.customerPhone ?? "",
    };
  }

  // The batch as everything else in the system reads it: live holds only,
  // and **this order's own hold is never one of them**, because either it
  // has lapsed (so nothing counts it) or it is live (so the jars it covers
  // are the jars being sold, and counting them against the sale would refuse
  // the very hold that reserved them).
  const availability = availabilityOf(batch, nextHeldJars, args.nowMillis);

  const live = mine !== undefined && mine.qty > 0 && mine.expiresAt > args.nowMillis;

  if (live) {
    const qty = mine.qty;
    return {
      batchRef: args.batchRef,
      batchSnap: snap,
      batchNo: batch.batchNo,
      batchState: batch.state ?? "",
      source: "live-hold",
      held: true,
      refusal: null,
      qty,
      limitCheck: null,
      availabilityBefore: availability,
      // The values, not increment sentinels: the document is in this
      // transaction's read set, so the arithmetic is safe here and the audit
      // entry carries the number the batch actually went to.
      auditPatch: { heldJars: nextHeldJars, paidCount: batch.paidCount + qty },
    };
  }

  // The hold has lapsed, or was never there. The money has arrived, so the
  // question is no longer "may this customer hold a jar" but "is there a jar
  // to give them". If there is, it is claimed here, inside the same
  // transaction that checked for it, which is what makes the claim safe: the
  // check and the write commit together, so two lapsed captures racing for
  // one jar cannot both win.
  const wanted = Number.isInteger(args.qty) && args.qty > 0 ? args.qty : 0;
  // The two bounds, above: the money's number, and the number the lapsed key
  // had reserved when there is still a key. A qty that is not a whole number
  // of jars was already flattened to zero, so it fails this too.
  const reserved =
    mine !== undefined && Number.isInteger(mine.qty) && mine.qty > 0 ? mine.qty : null;
  const bounded =
    wanted > 0 && args.qtyPaidFor === wanted && (reserved === null || reserved === wanted);

  let refusal: HoldConversionRefusal = "no-jar";
  let limitCheck: { readonly limit: number; readonly customerJars: number } | null = null;

  // "Is there a jar" is asked first, so a batch with nothing to give reads as
  // exactly that whatever else is wrong with the order.
  if (wanted > 0 && canHold(availability, wanted)) {
    if (!bounded) {
      refusal = "qty-mismatch";
    } else if (!E164.test(args.customerPhone)) {
      refusal = "no-customer";
    } else {
      // D44 and D52 through the one helper, with the web's blank-box
      // fallback: two jars in stock, the computed quarter on an open batch,
      // which is the same choice `createCheckout` and `/api/counts` make.
      const limit = resolvePerPersonLimit(batch, webLimitFallbackFor(batch.state ?? ""));
      const customerJars = await customerJarsInBatch(tx, db, {
        batchRef: args.batchRef,
        orderId: args.orderId,
        customerPhone: args.customerPhone,
        held,
        nowMillis: args.nowMillis,
      });
      limitCheck = { limit, customerJars };
      if (withinPerPersonLimit(customerJars, wanted, limit)) {
        return {
          batchRef: args.batchRef,
          batchSnap: snap,
          batchNo: batch.batchNo,
          batchState: batch.state ?? "",
          source: "reclaimed",
          held: true,
          refusal: null,
          qty: wanted,
          limitCheck,
          availabilityBefore: availability,
          auditPatch: { heldJars: nextHeldJars, paidCount: batch.paidCount + wanted },
        };
      }
      refusal = "over-limit";
    }
  }

  return {
    batchRef: args.batchRef,
    batchSnap: snap,
    batchNo: batch.batchNo,
    batchState: batch.state ?? "",
    source: "none",
    held: false,
    refusal,
    qty: 0,
    limitCheck,
    availabilityBefore: availability,
    auditPatch: { heldJars: nextHeldJars, paidCount: batch.paidCount },
  };
}

/**
 * Brief §7.2 step 3, "across all their orders in this batch", counted exactly
 * as `readStockClaim` counts it: live holds that are not this order's, plus
 * the jars on their paid orders. A lapsed hold counts for nothing here for
 * the same reason it counts for nothing in the availability.
 *
 * This order is excluded from both sides. Its own hold has lapsed (or it
 * would not be on this path) and its payment has not been written yet, so
 * neither could be counted anyway; excluding it by id says so out loud.
 */
async function customerJarsInBatch(
  tx: Transaction,
  db: Firestore,
  args: {
    readonly batchRef: string;
    readonly orderId: string;
    readonly customerPhone: string;
    readonly held: Record<string, { qty: number; expiresAt: number; customerPhone: string | null }>;
    readonly nowMillis: number;
  },
): Promise<number> {
  let jarsHeld = 0;
  for (const [heldOrderId, hold] of Object.entries(args.held)) {
    if (heldOrderId === args.orderId) continue;
    if (hold.customerPhone !== args.customerPhone) continue;
    if (hold.expiresAt > args.nowMillis) jarsHeld += hold.qty;
  }
  const orders = await ordersInBatch(tx, db, args.batchRef);
  for (const order of orders.paid) {
    if (order.id === args.orderId) continue;
    if (order.customerPhone !== args.customerPhone) continue;
    jarsHeld += order.jars;
  }
  return jarsHeld;
}

/**
 * What the per-person limit falls back to when the Owner has typed nothing,
 * for a jar bought on the website. D52 and brief §4.1: two on an in-stock
 * batch, and the batch's own computed quarter while it is open, which is
 * what `null` leaves `resolvePerPersonLimit` to answer.
 *
 * `createCheckout` makes the same choice in one line (`inStock ?
 * IN_STOCK_PER_PERSON_LIMIT : null`) and so does `/api/counts`. The rule
 * itself lives in `resolvePerPersonLimit` and is not repeated anywhere: this
 * only says which of its two doors a web sale comes through.
 */
function webLimitFallbackFor(state: string): number | null {
  return (BATCH_STATES_IN_STOCK as readonly string[]).includes(state)
    ? IN_STOCK_PER_PERSON_LIMIT
    : null;
}

/**
 * `capacity - paid - live holds`, through the same two shared functions
 * `readStockClaim` and `/api/counts` use, so a capture cannot disagree with
 * the site about how many jars exist.
 *
 * **Only a batch that is actually on sale can supply a jar.** The states are
 * the same two families `readStockClaim` accepts, and every other state
 * answers zero:
 *
 *  - `paused` is the one that matters. D23 put `inStock` on the pausable
 *    list precisely so sales can be frozen on jars that turn out to be bad,
 *    and a paused batch still has its `bottledJars`. Reclaiming from it
 *    would hand out exactly the jar somebody froze.
 *  - `soldOut` and `archived` answer zero too. A jar may briefly look free
 *    on a sold-out batch when a hold lapses, but "sold out" is the state the
 *    Owner and the site are both reading, and quietly selling out of it
 *    behind them is not this function's call to make. The concern is.
 *
 * A **live** hold is never affected by any of this: its jars were reserved
 * before the state moved, and its conversion asks no availability question.
 */
function availabilityOf(
  batch: ReturnType<typeof batchViewFrom>,
  heldJars: Record<string, { qty: number; expiresAt: Timestamp }>,
  nowMillis: number,
): BatchAvailability {
  const state = batch.state ?? "";
  if ((BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(state)) {
    return batchAvailability({
      bookableJars: batch.bookableJars,
      paidCount: batch.paidCount,
      heldJars,
      now: nowMillis,
    });
  }
  if ((BATCH_STATES_IN_STOCK as readonly string[]).includes(state)) {
    return inStockAvailability({
      bottledJars: batch.bottledJars,
      paidCount: batch.paidCount,
      heldJars,
      writtenOff: batch.writtenOff,
      now: nowMillis,
    });
  }
  return batchAvailability({
    bookableJars: 0,
    paidCount: batch.paidCount,
    heldJars,
    now: nowMillis,
  });
}

/**
 * The write half of {@link readHoldToPaid}.
 *
 * `update`, never `set({ merge: true })`, for the reason written out at
 * length above {@link writeStockRelease}: Firestore merges a map field leaf
 * by leaf, so the hold key this conversion deliberately leaves out of
 * `heldJars` would be merged straight back in and the jar would be counted
 * twice, once as held and once as paid.
 */
export function writeHoldToPaid(
  tx: Transaction,
  db: Firestore,
  conversion: HoldConversion,
  actor: string,
): void {
  tx.update(db.collection(BATCHES).doc(conversion.batchRef), {
    ...conversion.auditPatch,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor,
  });
}
