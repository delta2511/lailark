/**
 * What recording a refund decides, with no Firebase in it. Brief §12.3, M4.5.
 *
 * `recordRefund.ts` does the Firestore work; every judgement it makes is made
 * here, so each one can be tested directly and read in one place. The shape
 * is `orders/sale.ts`'s: a pure `plan...` function that answers either a
 * `Failure` carrying an `HttpsError` code and a sentence, or a plan the
 * caller writes.
 *
 * ## Decision D31: recorded, not started
 *
 * Nothing here calls Razorpay. A refund happens in the Razorpay dashboard, by
 * UPI, or in cash, and then the Owner records it so the ledger stays true.
 * There is no 6-month guard at launch either, which is M4.5b's, because there
 * is no button here that could fail on an old payment.
 *
 * ## Decision D65: what a refund unwinds
 *
 * A **full** refund reverses both halves of a sale: the jar goes back on the
 * batch's paid count if it has not been packed, and the order stops counting
 * toward that customer's per-person limit for the batch, so they may buy
 * again. There is no loop to abuse, because every refund is the Owner's own
 * manual act on a screen.
 *
 * The exception Shefin asked for: a refund **marked as a refusal** keeps the
 * allowance spent, while the jar still goes back on sale. Refusing a person
 * is not a reason to lose a jar out of a 15-to-40 jar batch. The mark lives on
 * the order (`refund.refusal`), it may be set here and it may be added or
 * changed afterwards, and `orders/paid.ts`'s `orderSpentAllowance` reads it.
 *
 * ## A partial refund is not a reversal. ASSUMED, M4.5
 *
 * The brief has one order state for "Refunded, part or full" (§9.1) and two
 * payment statuses (§9.2, `refunded` and `partlyRefunded`). Recording half of
 * a jar's price back is not evidence that the jar came back, so a partial
 * refund here:
 *
 *  - leaves the order's own state exactly where it was, because the order is
 *    still being fulfilled and moving it to `refunded` would take it out of
 *    the Kitchen's To pack pile for a jar the customer is still owed;
 *  - writes `payment.status: "partlyRefunded"` and adds to
 *    `payment.refundedAmount`, so the money is recorded to the paise;
 *  - moves **no** count and frees **no** allowance.
 *
 * The conservative direction is deliberate (CLAUDE.md §3: never oversell).
 * Handing a jar back on a part refund would put a jar on sale that somebody
 * may still be holding; refusing to hand it back only means the Owner returns
 * the rest of the money, or puts the jar back by a full refund, when he
 * actually means the sale to be undone.
 */

import {
  type DocumentKind,
  ORDER_STATES_PACKED_OR_BEYOND,
  type Paise,
  PAYMENT_METHODS_ONLINE,
  type RefundMethod,
  REFUND_METHODS,
} from "@lailark/shared";

import { jarsOnLine, orderHoldsJarsFrom } from "../orders/paid";
import { refundLineWord } from "./copy";
import type { DocumentSourceLine } from "./plan";

/** The subset of HttpsError codes this callable ever raises. */
export type ErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "failed-precondition"
  | "not-found";

export interface Failure {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly message: string;
}

function fail(code: ErrorCode, message: string): Failure {
  return { ok: false, code, message };
}

/* -------------------------------------------------------------------------- */
/* The request                                                                */
/* -------------------------------------------------------------------------- */

/** The longest a UPI reference or a cash note may be. */
export const MAX_REFERENCE = 64;
export const MAX_NOTE = 300;
export const MAX_REFUSAL_REASON = 300;

/**
 * An id is safe as a Firestore document id: no slash, no dot-only name, and
 * nothing that would let a typed reference address a different collection.
 */
const SAFE_ID_PART = /^[A-Za-z0-9_-]{1,80}$/;

export interface RecordRefundRequest {
  readonly orderId: string;
  readonly method: RefundMethod;
  readonly amountPaise: Paise;
  /** The gateway's own refund id, for a refund made in the Razorpay dashboard. */
  readonly razorpayRefundId: string | null;
  /** The UPI reference. Required for `upi`, null otherwise. */
  readonly reference: string | null;
  /** The note. Required for `cash` (brief §12.3's "Amount, note"). */
  readonly note: string | null;
  /**
   * Brief §12.3: "The gateway fee on the original payment is not returned. The
   * P&L records it." Null when nobody has said what it was.
   */
  readonly gatewayFeeUnreturnedPaise: Paise | null;
  /** D65: set the refusal mark in the same commit as the refund. */
  readonly refusalReason: string | null;
}

/**
 * Reads the callable's `data` into a request, or refuses it.
 *
 * **Money is integers in paise** (CLAUDE.md §3), so a non-integer amount is
 * refused here rather than rounded: a float that reached the ledger would be
 * a number nobody could reconcile against a bank statement.
 */
export function parseRecordRefundRequest(raw: unknown): { ok: true; value: RecordRefundRequest } | Failure {
  if (typeof raw !== "object" || raw === null) {
    return fail("invalid-argument", "Nothing was sent to record.");
  }
  const data = raw as Record<string, unknown>;

  const orderId = typeof data.orderId === "string" ? data.orderId.trim() : "";
  if (orderId === "") return fail("invalid-argument", "Which order is this refund on?");

  const method = typeof data.method === "string" ? data.method : "";
  if (!(REFUND_METHODS as readonly string[]).includes(method)) {
    return fail("invalid-argument", `How the refund was paid must be one of ${REFUND_METHODS.join(", ")}.`);
  }

  const amountPaise = data.amountPaise;
  if (typeof amountPaise !== "number" || !Number.isInteger(amountPaise) || amountPaise <= 0) {
    return fail("invalid-argument", "The refund amount must be a whole number of paise, above zero.");
  }

  const razorpayRefundId = trimmedOrNull(data.razorpayRefundId);
  const reference = trimmedOrNull(data.reference);
  const note = trimmedOrNull(data.note);
  const refusalReason = trimmedOrNull(data.refusalReason);

  if (method === "razorpay") {
    if (razorpayRefundId === null) {
      return fail(
        "invalid-argument",
        "A refund made in the Razorpay dashboard needs its refund id, so the same one is never recorded twice.",
      );
    }
    if (!SAFE_ID_PART.test(razorpayRefundId)) {
      return fail("invalid-argument", "That does not look like a Razorpay refund id.");
    }
  }
  if (method === "upi") {
    if (reference === null) return fail("invalid-argument", "A UPI refund needs its reference.");
    if (reference.length > MAX_REFERENCE) {
      return fail("invalid-argument", `A UPI reference must be ${MAX_REFERENCE} characters or fewer.`);
    }
    if (!SAFE_ID_PART.test(reference)) {
      return fail("invalid-argument", "A UPI reference is letters, digits, hyphens and underscores.");
    }
  }
  if (method === "cash") {
    if (note === null) return fail("invalid-argument", "Cash handed back needs a note saying what happened.");
  }
  if (note !== null && note.length > MAX_NOTE) {
    return fail("invalid-argument", `A note must be ${MAX_NOTE} characters or fewer.`);
  }
  if (refusalReason !== null && refusalReason.length > MAX_REFUSAL_REASON) {
    return fail("invalid-argument", `A refusal reason must be ${MAX_REFUSAL_REASON} characters or fewer.`);
  }

  const feeRaw = data.gatewayFeeUnreturnedPaise;
  let gatewayFeeUnreturnedPaise: number | null = null;
  if (feeRaw !== undefined && feeRaw !== null) {
    if (typeof feeRaw !== "number" || !Number.isInteger(feeRaw) || feeRaw < 0) {
      return fail("invalid-argument", "The gateway fee must be a whole number of paise, zero or above.");
    }
    gatewayFeeUnreturnedPaise = feeRaw;
  }

  return {
    ok: true,
    value: {
      orderId,
      method: method as RefundMethod,
      amountPaise,
      razorpayRefundId,
      reference,
      note,
      gatewayFeeUnreturnedPaise,
      refusalReason,
    },
  };
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/* -------------------------------------------------------------------------- */
/* The order, as the planner reads it                                         */
/* -------------------------------------------------------------------------- */

/** One line of the order, reduced to what a refund needs from it. */
export interface RefundableLine {
  readonly batchRef: string | null;
  readonly qty: number;
  /** Written at packing. A line with any jar number has left the shelf. */
  readonly jarNumbers: readonly number[];
  readonly productSlug: string;
  readonly customDescription: string | null;
  readonly unitPrice: Paise;
}

export interface RefundableOrder {
  readonly id: string;
  readonly state: string;
  readonly customerPhone: string;
  readonly lines: readonly RefundableLine[];
  /** What the customer actually paid, in paise. Never the order total. */
  readonly paidAmount: Paise;
  readonly refundedSoFar: Paise;
  readonly paymentMethod: string;
  /** Whether `paidAt` is set. Half of `orderHoldsJars`. */
  readonly paidAt: unknown;
  /** The refund block already on the order, if any. */
  readonly refund: unknown;
  /** The bill or receipt number the order carries, or null. */
  readonly documentNumber: string | null;
  /** What kind of document that number is, read from `documents`. */
  readonly documentKind: DocumentKind | null;
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                   */
/* -------------------------------------------------------------------------- */

/** Jars to put back on one batch. Empty when the refund returns none. */
export interface JarReturn {
  readonly batchRef: string;
  readonly qty: number;
}

export interface RefundPlan {
  readonly orderId: string;
  readonly method: RefundMethod;
  readonly amount: Paise;
  /** Cumulative, after this refund. */
  readonly refundedTotal: Paise;
  readonly fullyRefunded: boolean;
  /** `refunded` or `partlyRefunded`, brief §9.2. */
  readonly paymentStatus: "refunded" | "partlyRefunded";
  /**
   * The order's next state, or null to leave it where it is. Brief §9.1's
   * "Refunded, part or full" is one state, `refunded`, and only a full refund
   * reaches it (see the file comment).
   */
  readonly nextOrderState: "refunded" | null;
  readonly jarReturns: readonly JarReturn[];
  readonly jarsReturned: number;
  /** Why no jar came back, for the trail and for the screen. */
  readonly jarsHeldBackBecause: "partial-refund" | "already-packed" | "took-no-jars" | null;
  readonly gatewayFeeUnreturned: Paise | null;
  readonly refusalReason: string | null;
  /** Brief §13.1: a credit note after a bill, a refund note before one. */
  readonly documentKind: DocumentKind;
  /** The document number this one is against, or null when there is none. */
  readonly voids: string | null;
  /** The `refunds/{id}` this refund is written as. Must not already exist. */
  readonly refundId: string;
  /** True when this refund is the gateway refund the order was waiting on. */
  readonly clearsGatewayPending: boolean;
}

export interface RefundPlanContext {
  /** Cash refunds already recorded on this order, for a fresh, unused id. */
  readonly cashRefundsSoFar: number;
  /** `razorpayRefundId` of `refund.gatewayPending`, or null. */
  readonly gatewayPendingRefundId: string | null;
}

/**
 * The whole decision. Refuses before it plans, so nothing half-decided ever
 * reaches the write phase.
 */
export function planRecordRefund(
  request: RecordRefundRequest,
  order: RefundableOrder,
  context: RefundPlanContext,
): { ok: true; value: RefundPlan } | Failure {
  /* ---- can this order be refunded at all ----------------------------- */

  // Brief §7A.6: a voided sale did not happen. Its jars are already back and
  // the money was handed over at the counter, so there is nothing to return.
  if (order.state === "voided") {
    return fail(
      "failed-precondition",
      "This sale was voided, so its jars are already back and there is nothing to refund.",
    );
  }

  if (order.paidAmount <= 0) {
    return fail(
      "failed-precondition",
      "No money has arrived on this order, so there is nothing to refund.",
    );
  }

  // Idempotency, and it is not optional on money: an order whose whole
  // payment has been returned cannot be refunded a second time.
  const alreadyFull = refundBlockOf(order.refund).fullyRefunded;
  if (alreadyFull) {
    return fail(
      "failed-precondition",
      "This order has already been refunded in full. Nothing more can be returned on it.",
    );
  }

  const refundedTotal = order.refundedSoFar + request.amountPaise;
  if (refundedTotal > order.paidAmount) {
    return fail(
      "failed-precondition",
      `Only ${rupees(order.paidAmount - order.refundedSoFar)} is left to refund on this order, out of the ${rupees(order.paidAmount)} that was paid.`,
    );
  }

  // A gateway fee only exists on a payment the gateway handled. Recording one
  // against cash or a UPI transfer would put a cost in the batch P&L that
  // nobody was ever charged.
  if (
    request.gatewayFeeUnreturnedPaise !== null &&
    request.gatewayFeeUnreturnedPaise > 0 &&
    !(PAYMENT_METHODS_ONLINE as readonly string[]).includes(order.paymentMethod)
  ) {
    return fail(
      "invalid-argument",
      "This order was not paid through Razorpay, so it has no gateway fee to record.",
    );
  }

  // One fat-fingered zero on a typed figure would otherwise put 50,000 rupees
  // of cost into a batch P&L built on 15-to-40 jars. The ceiling is **what was
  // paid**, not what is being refunded: the fee was charged on the payment, as
  // a percentage of it, so the payment is the figure it can be checked against,
  // and it stays a real ceiling on a part refund of a few rupees. A real fee is
  // two or three per cent, so anything at or under this is a typo the Owner can
  // still correct, and anything over it is one this refuses.
  if (
    request.gatewayFeeUnreturnedPaise !== null &&
    request.gatewayFeeUnreturnedPaise > order.paidAmount
  ) {
    return fail(
      "invalid-argument",
      `A gateway fee of ${rupees(request.gatewayFeeUnreturnedPaise)} is more than the ${rupees(order.paidAmount)} that was paid. Check the figure in the Razorpay dashboard.`,
    );
  }

  /* ---- what this refund reverses ------------------------------------- */

  const fullyRefunded = refundedTotal >= order.paidAmount;
  const holdsJars = orderHoldsJarsFrom(order.state, order.paidAt, order.refund);
  const packed = (ORDER_STATES_PACKED_OR_BEYOND as readonly string[]).includes(order.state);
  const anyJarNumbered = order.lines.some((line) => line.jarNumbers.length > 0);

  let jarReturns: JarReturn[] = [];
  let heldBack: RefundPlan["jarsHeldBackBecause"] = null;
  if (!fullyRefunded) {
    heldBack = "partial-refund";
  } else if (!holdsJars) {
    // §21.1's refused capture: the money arrived, no count ever moved
    // (A242), so there is no jar of this order's on `paidCount` to give
    // back. Taking one off would take somebody else's.
    heldBack = "took-no-jars";
  } else if (packed || anyJarNumbered) {
    // The task's words, brief §12.3: "jar returns to the count if not
    // packed". Both tests, not one: a hand-over counter sale is `delivered`
    // with no jar numbers on it, and a packed order that was then paused is
    // in a state the list does not name but carries its jar numbers.
    heldBack = "already-packed";
  } else {
    jarReturns = jarsByBatch(order.lines);
  }
  const jarsReturned = jarReturns.reduce((sum, r) => sum + r.qty, 0);

  /* ---- the document, brief §13.1 ------------------------------------- */

  // "Refund note: refund where no bill exists yet, against the receipt."
  // "Credit note: refund or cancellation after a bill, reverses the bill."
  const documentKind: DocumentKind = order.documentKind === "bill" ? "creditNote" : "refundNote";
  const voids = order.documentNumber;

  /* ---- the `refunds/{id}` id ----------------------------------------- */

  const refundId = refundDocumentId(request, order, context);

  return {
    ok: true,
    value: {
      orderId: order.id,
      method: request.method,
      amount: request.amountPaise,
      refundedTotal,
      fullyRefunded,
      paymentStatus: fullyRefunded ? "refunded" : "partlyRefunded",
      nextOrderState: fullyRefunded ? "refunded" : null,
      jarReturns,
      jarsReturned,
      jarsHeldBackBecause: heldBack,
      gatewayFeeUnreturned: request.gatewayFeeUnreturnedPaise,
      refusalReason: request.refusalReason,
      documentKind,
      voids,
      refundId,
      clearsGatewayPending:
        request.razorpayRefundId !== null &&
        context.gatewayPendingRefundId !== null &&
        request.razorpayRefundId === context.gatewayPendingRefundId,
    },
  };
}

/**
 * The id of the `refunds/{id}` document, which is created must-not-exist, so
 * the id **is** the idempotency key.
 *
 * A gateway refund and a UPI transfer each carry a reference that is unique by
 * nature, so recording the same one twice is refused by Firestore rather than
 * by a check somebody could forget. Cash has no such reference, so its id
 * counts the cash refunds already on the order: a second cash refund is a
 * second real event, and the hold-to-confirm button plus the amount check are
 * what stop a double tap from becoming one.
 */
export function refundDocumentId(
  request: RecordRefundRequest,
  order: RefundableOrder,
  context: RefundPlanContext,
): string {
  if (request.method === "razorpay") return `razorpay-${request.razorpayRefundId}`;
  if (request.method === "upi") return `upi-${request.reference}`;
  return `cash-${order.id}-${context.cashRefundsSoFar + 1}`;
}

/* -------------------------------------------------------------------------- */
/* The refusal mark, set later (D65)                                          */
/* -------------------------------------------------------------------------- */

export interface MarkRefusalRequest {
  readonly orderId: string;
  /** Null clears the mark, which hands the allowance back. */
  readonly reason: string | null;
}

export function parseMarkRefusalRequest(raw: unknown): { ok: true; value: MarkRefusalRequest } | Failure {
  if (typeof raw !== "object" || raw === null) {
    return fail("invalid-argument", "Nothing was sent to mark.");
  }
  const data = raw as Record<string, unknown>;
  const orderId = typeof data.orderId === "string" ? data.orderId.trim() : "";
  if (orderId === "") return fail("invalid-argument", "Which order is this about?");

  if (data.reason === null || data.reason === undefined) {
    return { ok: true, value: { orderId, reason: null } };
  }
  if (typeof data.reason !== "string") return fail("invalid-argument", "A reason is text.");
  const reason = data.reason.trim();
  if (reason === "") return { ok: true, value: { orderId, reason: null } };
  if (reason.length > MAX_REFUSAL_REASON) {
    return fail("invalid-argument", `A refusal reason must be ${MAX_REFUSAL_REASON} characters or fewer.`);
  }
  return { ok: true, value: { orderId, reason } };
}

/**
 * D65: "the refusal reason is recorded on the order, may be set when the
 * refund is recorded, and may be added afterwards". So the mark is not
 * write-once, and it can be taken off again, which matters because putting it
 * on is what keeps a customer's allowance spent: a mark made in error must be
 * removable or that person is locked out of the batch for its life.
 *
 * It only means anything on an order that has actually been refunded, so an
 * order with no refund on it is refused rather than quietly marked.
 */
export function planMarkRefusal(
  request: MarkRefusalRequest,
  order: { readonly refund: unknown },
): { ok: true; value: { readonly reason: string | null } } | Failure {
  const block = refundBlockOf(order.refund);
  if (block.totalPaise <= 0) {
    return fail(
      "failed-precondition",
      "Nothing has been refunded on this order, so there is no refund to mark as a refusal.",
    );
  }
  return { ok: true, value: { reason: request.reason } };
}

/* -------------------------------------------------------------------------- */
/* Reading the refund block back, defensively                                 */
/* -------------------------------------------------------------------------- */

export interface RefundBlockView {
  readonly totalPaise: number;
  readonly fullyRefunded: boolean;
  readonly jarsReturned: number;
  readonly documentNumbers: readonly string[];
  readonly hasRefusal: boolean;
  readonly gatewayPendingRefundId: string | null;
  /** What has been recorded so far, so a later refund never wipes it. */
  readonly gatewayFeeUnreturned: number | null;
}

/**
 * The `refund` map off an order, with every field defended: it comes straight
 * from Firestore, so nothing on it is trusted to be the type it should be.
 */
export function refundBlockOf(raw: unknown): RefundBlockView {
  const map = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const pending = typeof map.gatewayPending === "object" && map.gatewayPending !== null
    ? (map.gatewayPending as Record<string, unknown>)
    : {};
  const numbers = Array.isArray(map.documentNumbers)
    ? (map.documentNumbers as unknown[]).filter((n): n is string => typeof n === "string")
    : [];
  return {
    totalPaise: typeof map.totalPaise === "number" && Number.isFinite(map.totalPaise) ? map.totalPaise : 0,
    fullyRefunded: map.fullyRefunded === true,
    jarsReturned: typeof map.jarsReturned === "number" && Number.isFinite(map.jarsReturned) ? map.jarsReturned : 0,
    documentNumbers: numbers,
    hasRefusal: typeof map.refusal === "object" && map.refusal !== null,
    gatewayPendingRefundId:
      typeof pending.razorpayRefundId === "string" && pending.razorpayRefundId !== ""
        ? pending.razorpayRefundId
        : null,
    gatewayFeeUnreturned:
      typeof map.gatewayFeeUnreturned === "number" && Number.isFinite(map.gatewayFeeUnreturned)
        ? map.gatewayFeeUnreturned
        : null,
  };
}

/** The jars this order holds, per batch. A custom line with no batch has none. */
export function jarsByBatch(lines: readonly RefundableLine[]): JarReturn[] {
  const byBatch = new Map<string, number>();
  for (const line of lines) {
    if (line.batchRef === null || line.batchRef === "") continue;
    // The same test `batches/store.ts`'s `jarsInBatch` applies, from the same
    // place, so the two cannot drift. See `jarsOnLine`.
    const jars = jarsOnLine(line.qty);
    if (jars === 0) continue;
    byBatch.set(line.batchRef, (byBatch.get(line.batchRef) ?? 0) + jars);
  }
  return [...byBatch.entries()].map(([batchRef, qty]) => ({ batchRef, qty }));
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/* -------------------------------------------------------------------------- */
/* What the refund note or credit note lists                                  */
/* -------------------------------------------------------------------------- */

/**
 * The lines of a refund note or credit note, which **must add up to the amount
 * being returned**.
 *
 * A credit note reverses a bill. It is a statutory document, and a statutory
 * document whose goods column says one number and whose total says another is
 * not a document, it is a mistake with a permanent number on it. So the one
 * rule here is that the arithmetic closes: `sum(lines) + shipping - discount`
 * equals the refunded amount, for a full refund and for a partial one.
 *
 * Two shapes, and which one is used is decided by arithmetic rather than by
 * taste:
 *
 *  1. **Itemised**, when the order's own lines reconcile to exactly the amount
 *     being returned. That is the ordinary full refund: every line of the
 *     order, all of them and not just the first, each carrying its batch number
 *     and its jar numbers (brief 13.2's "batch number, jar numbers"), plus the
 *     shipping line if there was one and the discount that came off. The note
 *     then reverses the bill line for line, which is what a credit note is for.
 *  2. **One line**, for anything that does not reconcile, which in practice
 *     means every partial refund. **ASSUMED (M4.5 round 1):** a part of a
 *     jar's price is not a part of a jar, and there is no honest way to
 *     itemise 300 rupees off a 649 rupee jar as goods. So the line names the
 *     product and the batch it is against and carries the amount returned.
 *
 * D37: a document carries no sentence of its own, so the shape-2 line is a
 * description in the goods column, the way a custom line is, and not prose. Its
 * two words live in `money/copy.ts` (`refundLineWord`) with every other word a
 * customer reads on a document. No em dashes (CLAUDE.md section 3).
 */
export interface RefundDocumentBody {
  readonly lines: readonly DocumentSourceLine[];
  readonly shippingFee: Paise;
  readonly discount: Paise;
  readonly discountReason: string | null;
  /** True when shape 1 was used. For the trail and for the tests. */
  readonly itemised: boolean;
}

export function planRefundDocumentBody(args: {
  readonly lines: readonly RefundableLine[];
  readonly shippingFee: Paise;
  readonly discount: Paise;
  readonly discountReason: string | null;
  /** The paise actually being returned by this refund. */
  readonly amount: Paise;
  readonly fullyRefunded: boolean;
  /** `products/{slug}.name`, so a customer never reads a slug. */
  readonly productNames: ReadonlyMap<string, string>;
  readonly hsnBySlug: ReadonlyMap<string, string | null>;
  /** `batches/{ref}.batchNo`, null while a batch has no printed number (D21c). */
  readonly batchNos: ReadonlyMap<string, string | null>;
}): RefundDocumentBody {
  const goods = args.lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const reconciles = goods + args.shippingFee - args.discount === args.amount;

  if (reconciles && args.lines.length > 0) {
    return {
      lines: args.lines.map((line) => ({
        description: describeLine(line, args.productNames, args.batchNos),
        hsn: args.hsnBySlug.get(line.productSlug) ?? null,
        qty: line.qty,
        unitPrice: line.unitPrice,
        batchNo: line.batchRef === null ? null : (args.batchNos.get(line.batchRef) ?? null),
        jarNumbers: line.jarNumbers.map((n) => String(n)),
      })),
      shippingFee: args.shippingFee,
      discount: args.discount,
      discountReason: args.discountReason,
      itemised: true,
    };
  }

  const first = args.lines[0];
  const what = first === undefined ? "" : describeLine(first, args.productNames, args.batchNos);
  return {
    lines: [
      {
        description: what === "" ? refundLineWord(args.fullyRefunded) : `${refundLineWord(args.fullyRefunded)}, ${what}`,
        hsn: null,
        qty: 1,
        unitPrice: args.amount,
        batchNo: first?.batchRef == null ? null : (args.batchNos.get(first.batchRef) ?? null),
        jarNumbers: [],
      },
    ],
    // Folded into the one line, so the column still adds up to the total.
    shippingFee: 0,
    discount: 0,
    discountReason: null,
    itemised: false,
  };
}

/**
 * What a customer reads in the description column: the product's name and the
 * batch it came from, exactly as `webhooks/capture.ts` spells it on the bill,
 * so the credit note and the bill it reverses read the same way. A custom line
 * keeps the description that was typed for it.
 */
function describeLine(
  line: RefundableLine,
  productNames: ReadonlyMap<string, string>,
  batchNos: ReadonlyMap<string, string | null>,
): string {
  if (line.customDescription !== null && line.customDescription !== "") return line.customDescription;
  const name = productNames.get(line.productSlug) ?? line.productSlug;
  if (name === "") return "";
  const batchNo = line.batchRef === null ? null : (batchNos.get(line.batchRef) ?? null);
  if (line.batchRef === null) return name;
  return `${name}, ${batchNo === null ? "this batch" : `batch ${batchNo}`}`;
}

/**
 * The fee the gateway kept, across every refund on this order.
 *
 * **It accumulates, and a refund that names no fee never wipes one that did.**
 * The task's words are that the unreturned gateway fee is recorded on the order
 * for the batch P&L, and `OrderRefundRecord` says plainly that null is a
 * different fact from zero and must not be added up as zero. Writing this field
 * unconditionally meant a second refund that named no fee turned a recorded
 * 15.32 rupees into "nobody has said", and the P&L quietly lost a real cost.
 *
 * So: two known fees add up, because two Razorpay refunds really do cost two
 * fees; a new fee against no earlier one is the fee; and no new fee leaves
 * whatever was there alone, including leaving null as null.
 */
export function accumulatedGatewayFee(before: number | null, now: number | null): number | null {
  if (now === null) return before;
  if (before === null) return now;
  return before + now;
}
