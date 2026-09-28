/**
 * `refund.processed`: matched to the order it belongs to, and marked as
 * something for the Owner to record.
 *
 * **M4.5 records the refund** (`money/recordRefund.ts`). Brief §12.3 is a
 * whole screen: the method, who recorded it, the refund note or credit note,
 * the order's move to `refunded`. None of that happens here, because the
 * amount the gateway paid back is not by itself the Owner's decision about
 * what the sale now is, and brief §12.3 puts the recording on the order
 * screen. So this does two things:
 *
 *  1. it **finds the order** the gateway's refund belongs to, by our own
 *     `notes.lailark_order_id` or by the gateway payment id;
 *  2. it **says so where the Owner will see it**: the matched order id on the
 *     `webhookEvents` document, an `audit` entry, and
 *     `orders/{id}.refund.gatewayPending`, which the Orders screen draws as a
 *     line saying this refund is still to be recorded, with the amount and
 *     the refund id already filled in. Before M4.5 the match reached `audit`
 *     only, where nobody looks.
 *
 * **A marker is only written when there is still something to record.** If this
 * gateway refund is already in `refunds`, or the order has been refunded in
 * full by any route, nothing is written and the `audit` entry says `recorded:
 * true` with the reason. Otherwise a refund recorded as cash and then confirmed
 * by the gateway left a to-do on a settled order that no screen could clear.
 *
 * **Nothing about money on the order is touched here.** `payment.status`
 * stays where it is, `refundedAmount` is not written, no count moves and no
 * document is issued: `gatewayPending` is a to-do marker, and a to-do marker
 * is not a ledger entry. Only `recordRefund` writes the money, and it clears
 * this marker when it records the refund with the same id.
 *
 * A refund that matches no order at all is money leaving with no record, so
 * that one does not end as a log line: it becomes a `concerns` document.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { writeAudit } from "../audit/write";
import { REFUNDS } from "../money/recordRefund";
import { ORDERS } from "../orders/store";
import { raiseCaptureConcern } from "./capture";
import type { ProcessedRefund } from "./razorpayEvents";

export const REFUND_ACTOR = "razorpay";

export interface RefundMatch {
  readonly orderId: string | null;
  readonly matchedBy: "notes" | "paymentId" | "none";
  readonly concernId: string | null;
  /** True when the Owner had already recorded this refund himself (M4.5). */
  readonly recorded?: boolean;
}

/**
 * Finds the order a processed refund belongs to.
 *
 * Two ways in, in this order. `notes.lailark_order_id` is our own id,
 * carried on the payment we created, and is exact. Otherwise the gateway
 * payment id is looked up against `orders.payment.razorpayIds.paymentId`,
 * which the capture wrote. A refund raised in the Razorpay dashboard carries
 * no notes of ours, so the second path is the one that will usually run.
 */
export async function matchRefundToOrder(
  db: Firestore,
  refund: ProcessedRefund,
  by: string = REFUND_ACTOR,
): Promise<RefundMatch> {
  let orderId: string | null = null;
  let matchedBy: RefundMatch["matchedBy"] = "none";

  if (refund.orderId !== "") {
    const snap = await db.collection(ORDERS).doc(refund.orderId).get();
    if (snap.exists) {
      orderId = refund.orderId;
      matchedBy = "notes";
    }
  }

  if (orderId === null && refund.paymentId !== "") {
    const found = await db
      .collection(ORDERS)
      .where("payment.razorpayIds.paymentId", "==", refund.paymentId)
      .limit(2)
      .get();
    if (found.size === 1) {
      orderId = found.docs[0].id;
      matchedBy = "paymentId";
    } else if (found.size > 1) {
      // Two orders claiming one gateway payment is a database problem, not a
      // refund problem, and picking one of them would hide it.
      orderId = null;
    }
  }

  if (orderId === null) {
    const concernId = await db.runTransaction(async (tx) =>
      raiseCaptureConcern(
        tx,
        db,
        {
          id: `refund-unmatched-${refund.refundId}`,
          orderId: null,
          customerPhone: null,
          batchRef: null,
          amount: refund.amountPaise,
          summary: `Razorpay processed refund ${refund.refundId} of ${rupees(refund.amountPaise)} against payment ${refund.paymentId}, and it matches no order here. Find it in the Razorpay dashboard and record it against the right sale.`,
        },
        by,
      ),
    );
    return { orderId: null, matchedBy: "none", concernId, recorded: false };
  }

  // No money field on the order is written: recording the refund is
  // `recordRefund`'s, and this only says the gateway did it.
  const matched = orderId;
  const recorded = await db.runTransaction(async (tx) => {
    const orderDoc = db.collection(ORDERS).doc(matched);
    const snap = await tx.get(orderDoc);
    // The Owner may well have recorded it before the webhook landed, in which
    // case there is nothing to do and nothing to ask him for. `refunds/{id}`
    // is keyed on the gateway's own refund id, so this is an exact answer.
    const already = await tx.get(db.collection(REFUNDS).doc(`razorpay-${refund.refundId}`));
    // Two ways there is nothing to ask the Owner for. One: this exact gateway
    // refund is already in the books, keyed on the gateway's own refund id.
    // Two: the order has been refunded in full by some other route, usually
    // because he recorded it as cash or UPI before the webhook arrived, and no
    // further refund can be recorded on it at all. Without the second case a
    // permanent "Razorpay has already refunded this" sat on a settled order
    // with no form on screen to clear it.
    const fullyRefunded = snap.get("refund.fullyRefunded") === true;
    const recorded = already.exists || fullyRefunded;

    if (!recorded && snap.exists) {
      tx.set(
        orderDoc,
        {
          refund: {
            gatewayPending: {
              razorpayRefundId: refund.refundId,
              razorpayPaymentId: refund.paymentId,
              amount: refund.amountPaise,
              seenAt: FieldValue.serverTimestamp(),
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: by,
        },
        { merge: true },
      );
    }

    writeAudit(tx, db, {
      object: `${ORDERS}/${matched}`,
      action: "refundProcessedWebhook",
      patch: {
        razorpayRefundId: refund.refundId,
        razorpayPaymentId: refund.paymentId,
        amount: refund.amountPaise,
        matchedBy,
        recorded,
        recordedBecause: already.exists ? "sameRefundId" : fullyRefunded ? "orderFullyRefunded" : null,
      },
      beforeSnap: snap.exists ? snap : null,
      by,
    });
    return recorded;
  });

  return { orderId: matched, matchedBy, concernId: null, recorded };
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}
