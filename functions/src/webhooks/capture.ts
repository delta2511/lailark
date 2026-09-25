/**
 * `payment.captured`: the money arrived, so the jar stops being held and
 * becomes sold.
 *
 * Brief §9.2: "**Webhooks are the source of truth,** not the browser
 * redirect." Nothing else in this system may move an order out of `held`,
 * and the browser's own "payment succeeded" is never read.
 *
 * ## One transaction, on the batch document
 *
 * CLAUDE.md §3: "Counts change only inside Firestore transactions on the
 * batch document, in functions. Never oversell. A jar is free, held, paid,
 * or gone." A capture is a count change: the hold's key leaves `heldJars`
 * and its jars land on `paidCount`. That move, the order, the bill or
 * receipt with its number, and the audit trail all commit together or none
 * of them does, exactly as the counter sale does it. The arithmetic itself
 * is `batches/holds.ts` (`readHoldToPaid`), the one module in the system
 * that may move a count.
 *
 * ## Idempotent, three times over
 *
 * A gateway retries. So the same capture may arrive twice, and the
 * reconciliation (`./reconcile.ts`) may find it a third time:
 *
 *  1. the `webhookEvents/{source-eventId}` create refuses the second
 *     delivery before this is ever called;
 *  2. this transaction reads the order first and does nothing at all when
 *     its payment has already moved;
 *  3. the count move itself is keyed on the hold, which is gone after the
 *     first commit, so a third path through would write no count either.
 *
 * ## What it refuses to do
 *
 * **It never sends anything.** D32: every customer message at launch is
 * manual, drafted and ticked by a person. A bill is issued here because
 * brief §13.1 says a bill exists at payment; putting it in front of the
 * customer is somebody's decision, not this function's.
 *
 * **It never guesses past a mismatch.** A captured amount that is not the
 * order's total, and a capture whose hold has gone (brief §9.3's rare case,
 * §21.1's first row), both stop short of moving the count: the payment is
 * recorded, because the money really is in, and a `concerns` document marked
 * `technicalFailure` puts it in front of the Owner. Brief §21.1: "Technical,
 * not a sale. Concern marked technical. Owner refunds or allocates a surplus
 * jar."
 */

import {
  FieldValue,
  type DocumentSnapshot,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import {
  BATCH_STATES_OPEN_FOR_BOOKING,
  type DocumentKind,
  ORDER_STATES_PAID,
} from "@lailark/shared";

import { writeAudit } from "../audit/write";
import { type HoldConversion, readHoldToPaid, writeHoldToPaid } from "../batches/holds";
import { BATCHES, PRODUCTS } from "../batches/store";
import { issueDocument, readDocumentContext, readIssue } from "../money/issue";
import { type DocumentSource } from "../money/plan";
import { CONCERNS } from "../money/store";
import { MONEY_MOVED_PAYMENT_STATUSES } from "../orders/checkout";
import { CUSTOMERS, ORDERS, saleProductViewFrom } from "../orders/store";
import type { CapturedPayment } from "./razorpayEvents";

/** Who the trail says did this. Not a uid: a gateway did it, not a person. */
export const CAPTURE_ACTOR = "razorpay";

/** Contention on the batch document is a retry, not a failure. */
const MAX_TRANSACTION_ATTEMPTS = 12;

export type CaptureOutcome =
  /** The hold became paid, the count moved, the document was issued. */
  | "applied"
  /** Paid and counted, but GST is on so no bill could be drawn (A103). */
  | "applied-no-document"
  /** Already paid. Nothing was read past the order, nothing was written. */
  | "already"
  /** The `notes` named an order that is not in the database. */
  | "no-such-order"
  /** Brief §9.3 and §21.1: the hold lapsed and the jar has gone. */
  | "hold-gone"
  /** Captured an amount that is not this order's total. */
  | "amount-mismatch"
  /** The order names no batch, so there is no count to move. */
  | "no-batch";

export interface CaptureResult {
  readonly outcome: CaptureOutcome;
  readonly orderId: string;
  readonly jars: number;
  readonly documentNumber: string | null;
  readonly concernId: string | null;
}

/* -------------------------------------------------------------------------- */
/* The decisions, with no Firestore in them                                   */
/* -------------------------------------------------------------------------- */

/**
 * Brief §13.1 and §9.1, in one place. Money into an **open** batch buys a
 * promise, so it gets a receipt and waits; money for a jar that exists buys
 * the jar, so it gets a bill and goes to the packing list.
 */
export function paidShapeFor(batchState: string): {
  readonly kind: DocumentKind;
  readonly orderState: string;
} {
  return (BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(batchState)
    ? { kind: "receipt", orderState: "paidWaiting" }
    : { kind: "bill", orderState: "toPack" };
}

/**
 * True when this order has already been paid for, whichever way it was
 * noticed: the payment status says money moved, or the order has walked on
 * into one of §9.1's paid states. Either is enough to make a second capture
 * do nothing.
 */
export function alreadyPaid(orderState: string, paymentStatus: string): boolean {
  return (
    MONEY_MOVED_PAYMENT_STATUSES.includes(paymentStatus) ||
    (ORDER_STATES_PAID as readonly string[]).includes(orderState)
  );
}

/* -------------------------------------------------------------------------- */
/* The transaction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Applies one captured payment. Safe to call twice; safe to call from the
 * webhook worker and from the reconciliation at the same moment.
 *
 * `by` names which of those two did it, so the trail distinguishes a webhook
 * that arrived from a payment the 15-minute job had to go and find.
 */
export async function applyCapturedPayment(
  db: Firestore,
  capture: CapturedPayment,
  by: string = CAPTURE_ACTOR,
): Promise<CaptureResult> {
  const orderId = capture.orderId;
  if (orderId === "") {
    return { outcome: "no-such-order", orderId, jars: 0, documentNumber: null, concernId: null };
  }

  return db.runTransaction(
    async (tx): Promise<CaptureResult> => {
      const nowMillis = Date.now();

      /* ---- read ---------------------------------------------------- */

      const orderRef = db.collection(ORDERS).doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) {
        // Money with no order behind it. Nothing can be written against an
        // order that does not exist, so this goes straight to the Owner.
        const concernId = raiseCaptureConcern(
          tx,
          db,
          {
            id: `capture-unknown-order-${capture.paymentId}`,
            orderId: null,
            customerPhone: null,
            batchRef: null,
            amount: capture.amountPaise,
            summary: `Razorpay captured ${rupees(capture.amountPaise)} on payment ${capture.paymentId}, and its notes name order ${orderId}, which is not in the database. Find the payment in the Razorpay dashboard before anything else.`,
          },
          by,
        );
        return { outcome: "no-such-order", orderId, jars: 0, documentNumber: null, concernId };
      }

      const order = (orderSnap.data() ?? {}) as Record<string, unknown>;
      const payment = asRecord(order.payment);
      const orderState = str(order.state);
      const paymentStatus = str(payment.status);

      // The cheapest branch, and the one a replay takes: one read, no write.
      if (alreadyPaid(orderState, paymentStatus)) {
        return { outcome: "already", orderId, jars: 0, documentNumber: null, concernId: null };
      }

      const line = asRecord(Array.isArray(order.lines) ? order.lines[0] : undefined);
      const batchRef = str(line.batchRef) || str(firstOf(order.batchRefs));
      const total = num(order.total);
      const customerPhone = str(order.customerPhone);

      // A mismatch is read before the batch, so a payment that is not this
      // order's total never touches a count at all.
      if (capture.amountPaise !== total) {
        const concernId = raiseCaptureConcern(
          tx,
          db,
          {
            id: `capture-amount-${orderId}`,
            orderId,
            customerPhone: customerPhone === "" ? null : customerPhone,
            batchRef: batchRef === "" ? null : batchRef,
            amount: capture.amountPaise,
            summary: `Razorpay captured ${rupees(capture.amountPaise)} on payment ${capture.paymentId} for order ${orderId}, which comes to ${rupees(total)}. The jars have not been sold and no bill has been issued. Decide whether to refund the difference or complete the sale by hand.`,
          },
          by,
        );
        writePaymentOnly(tx, db, orderRef, orderSnap, capture, by);
        return { outcome: "amount-mismatch", orderId, jars: 0, documentNumber: null, concernId };
      }

      if (batchRef === "") {
        // A web order always names a batch; this is here so a future channel
        // that does not cannot silently lose its payment.
        writePaymentOnly(tx, db, orderRef, orderSnap, capture, by);
        return { outcome: "no-batch", orderId, jars: 0, documentNumber: null, concernId: null };
      }

      // `nowMillis` is what makes a lapsed hold a lapsed hold. Without it
      // this read treats a key the sweep has not got to yet as a live hold,
      // and sells a jar the site has already given to somebody else.
      const conversion = await readHoldToPaid(tx, db, {
        batchRef,
        orderId,
        qty: num(line.qty),
        nowMillis,
      });

      if (!conversion.held) {
        // Brief §9.3's rare case, spelled out in §21.1: "Payment confirms
        // after the hold lapsed and the jar has gone. Technical, not a
        // sale." The count is not touched: taking a jar here would take one
        // somebody else may already have bought.
        const concernId = raiseCaptureConcern(
          tx,
          db,
          {
            id: `capture-hold-gone-${orderId}`,
            orderId,
            customerPhone: customerPhone === "" ? null : customerPhone,
            batchRef,
            amount: capture.amountPaise,
            summary: `Razorpay captured ${rupees(capture.amountPaise)} for order ${orderId}, but its hold on ${batchRef} had lapsed and that batch cannot give it another jar: it is ${conversion.batchState} with ${conversion.availabilityBefore.available} free. Refund it, or allocate a surplus jar.`,
          },
          by,
        );
        writePaymentOnly(tx, db, orderRef, orderSnap, capture, by);
        return { outcome: "hold-gone", orderId, jars: 0, documentNumber: null, concernId };
      }

      const shape = paidShapeFor(conversion.batchState);

      // The seller block, the prefixes and the GST switch, frozen onto the
      // document this capture is about to issue (M2.9, brief §13.2).
      const documents = await readDocumentContext(tx, db);
      // A103: GST cannot be worked out yet, so a document cannot be drawn
      // with it on. The counter sale refuses the sale outright; a capture
      // cannot refuse, because the money is already in. The jar is sold and
      // counted, and the missing document becomes the Owner's to sort out.
      const serial = documents.gst.enabled
        ? null
        : await readIssue(tx, db, shape.kind, nowMillis, documents);

      const productSlug = str(line.productSlug);
      const productSnap =
        productSlug === "" ? null : await tx.get(db.collection(PRODUCTS).doc(productSlug));
      const customerSnap =
        customerPhone === ""
          ? null
          : await tx.get(db.collection(CUSTOMERS).doc(customerPhone));

      /* ---- write --------------------------------------------------- */

      writeHoldToPaid(tx, db, conversion, by);
      writeAudit(tx, db, {
        object: `${BATCHES}/${batchRef}`,
        // The trail says which of the two it was, so a jar claimed afresh
        // after a lapsed hold is readable as that rather than as an ordinary
        // conversion.
        action: conversion.source === "reclaimed" ? "webSalePaidReclaimed" : "webSalePaid",
        patch: conversion.auditPatch,
        beforeSnap: conversion.batchSnap,
        by,
      });

      const orderPatch: Record<string, unknown> = {
        state: shape.orderState,
        holdExpiresAt: null,
        payment: {
          status: "captured",
          amount: capture.amountPaise,
          razorpayIds: { orderId: capture.razorpayOrderId, paymentId: capture.paymentId },
        },
        billNumber: serial?.number ?? null,
        paidAt: Timestamp.fromMillis(nowMillis),
      };
      tx.set(
        orderRef,
        { ...orderPatch, updatedAt: FieldValue.serverTimestamp(), updatedBy: by },
        { merge: true },
      );
      writeAudit(tx, db, {
        object: `${ORDERS}/${orderId}`,
        action: "paymentCaptured",
        patch: orderPatch,
        beforeSnap: orderSnap,
        by,
      });

      let concernId: string | null = null;
      if (serial !== null) {
        issueDocument(
          tx,
          db,
          serial,
          {
            source: documentSourceFor(order, line, capture, conversion, productSnap, customerSnap),
            context: documents,
            nowMillis,
          },
          by,
        );
      } else {
        concernId = raiseCaptureConcern(
          tx,
          db,
          {
            id: `capture-no-document-${orderId}`,
            orderId,
            customerPhone: customerPhone === "" ? null : customerPhone,
            batchRef,
            amount: capture.amountPaise,
            summary: `Order ${orderId} was paid for and its jars are sold, but GST is switched on and the ${shape.kind} could not be drawn, so this sale has no document. Turn GST off or raise the ${shape.kind} by hand.`,
          },
          by,
        );
      }

      return {
        outcome: serial === null ? "applied-no-document" : "applied",
        orderId,
        jars: conversion.qty,
        documentNumber: serial?.number ?? null,
        concernId,
      };
    },
    { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The money, recorded, and nothing else: no count moved, no state changed,
 * no document issued.
 *
 * Every branch that stops short of a sale still goes through here, because
 * the money really did arrive and a record that omits it is a lie. It also
 * has a second job: once `payment.status` is `captured`, `releaseHold` and
 * the hold sweep both refuse to touch this order (A184), so a payment that
 * landed in a mess cannot then be quietly expired on top of it.
 */
function writePaymentOnly(
  tx: Transaction,
  db: Firestore,
  orderRef: FirebaseFirestore.DocumentReference,
  orderSnap: DocumentSnapshot,
  capture: CapturedPayment,
  by: string,
): void {
  const payment: Record<string, unknown> = {
    status: "captured",
    razorpayIds: { orderId: capture.razorpayOrderId, paymentId: capture.paymentId },
  };
  // `parseRazorpayWebhook` reads an amount that is not a whole non-negative
  // number of paise as `-1` rather than rounding it (CLAUDE.md §3: money is
  // integers in paise). That sentinel means "unreadable", and it must not be
  // written to a money field: `orders.payment.amount` is summed by the
  // money screens and the batch P&L, and a `-1` in a sum is a wrong number
  // nobody would ever see. The field is left as it was, and the concern
  // beside this write is what says an amount arrived that we could not read.
  if (readableMoney(capture.amountPaise)) payment.amount = capture.amountPaise;
  const patch: Record<string, unknown> = { payment };
  tx.set(
    orderRef,
    { ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: by },
    { merge: true },
  );
  writeAudit(tx, db, {
    object: orderRef.path,
    action: "paymentCapturedUnsold",
    patch,
    beforeSnap: orderSnap,
    by,
  });
}

/**
 * A `concerns/{id}` marked `technicalFailure`, urgent, which is how anything
 * needing the Owner reaches him (brief §12.1). Nothing is drafted to a
 * customer and nothing is sent: `draftMessage` is null, and a concern waits
 * for the Owner by construction (CLAUDE.md §3, D32).
 *
 * The id is derived from the order or the payment, so a retried transaction,
 * a replayed webhook and the reconciliation finding the same thing all raise
 * one concern rather than a pile.
 */
export function raiseCaptureConcern(
  tx: Transaction,
  db: Firestore,
  input: {
    readonly id: string;
    readonly orderId: string | null;
    readonly customerPhone: string | null;
    readonly batchRef: string | null;
    readonly amount: number;
    readonly summary: string;
  },
  actor: string,
): string {
  const body = {
    type: "technicalFailure",
    customerPhone: input.customerPhone,
    orderId: input.orderId,
    batchRef: input.batchRef,
    summary: input.summary,
    proposal: null,
    draftMessage: null,
    answer: null,
    outcome: null,
    // Never the unreadable-amount sentinel on a money field: zero, with the
    // summary above saying what really arrived.
    money: { amount: readableMoney(input.amount) ? input.amount : 0, direction: "in" as const },
    dueAt: null,
    answeredAt: null,
    sentAt: null,
    urgent: true,
  };
  tx.set(
    db.collection(CONCERNS).doc(input.id),
    {
      ...body,
      raisedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );
  writeAudit(tx, db, {
    object: `${CONCERNS}/${input.id}`,
    action: "paymentConcern",
    patch: { orderId: input.orderId, amount: input.amount, summary: input.summary },
    beforeSnap: null,
    by: actor,
  });
  return input.id;
}

/** Brief §13.2, from what this transaction already has in hand. */
function documentSourceFor(
  order: Record<string, unknown>,
  line: Record<string, unknown>,
  capture: CapturedPayment,
  conversion: HoldConversion,
  productSnap: DocumentSnapshot | null,
  customerSnap: DocumentSnapshot | null,
): DocumentSource {
  const contact = asRecord(order.deliveryContact);
  const product = productSnap?.exists === true ? saleProductViewFrom(productSnap) : null;
  const productName = product?.name ?? str(line.productSlug);
  const email = customerSnap?.get("email");

  return {
    orderId: str(order.number) || str(line.orderId),
    channel: str(order.channel) || "web",
    customerName: str(contact.name),
    customerPhone: str(order.customerPhone),
    customerEmail: typeof email === "string" && email !== "" ? email : null,
    deliveryLines: Array.isArray(contact.lines) ? contact.lines.map((l) => str(l)) : [],
    placeOfSupply: str(order.placeOfSupply),
    lines: [
      {
        description: `${productName}, ${conversion.batchNo === null ? "this batch" : `batch ${conversion.batchNo}`}`,
        hsn: productSnap?.exists === true ? (str(productSnap.get("hsn")) || null) : null,
        qty: num(line.qty),
        unitPrice: num(line.unitPrice),
        batchNo: conversion.batchNo,
        // A jar takes its number when it is packed (M4.1).
        jarNumbers: [],
      },
    ],
    shippingFee: num(order.shippingFee),
    discount: 0,
    discountReason: null,
    paymentMethod: str(asRecord(order.payment).method) || "razorpay",
    paymentStatus: "captured",
    paymentReference: capture.paymentId,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

/** A whole, non-negative number of paise: a number that may touch the books. */
export function readableMoney(paise: number): boolean {
  return Number.isSafeInteger(paise) && paise >= 0;
}

/**
 * For an admin-facing sentence only. Paise in, rupees on the screen, and the
 * unreadable-amount sentinel said in words rather than printed as "₹-0.01".
 */
function rupees(paise: number): string {
  if (!readableMoney(paise)) return "an amount we could not read";
  return `₹${(paise / 100).toFixed(2)}`;
}
