/**
 * `refund.processed`: matched to the order it belongs to, and no further.
 *
 * **M4.5 records the refund.** Brief §12.3 is a whole screen: the method,
 * who recorded it, the refund note or credit note, the order's move to
 * `refunded` or `partlyRefunded`. None of that is built yet, and inventing
 * half of it here would put a number in the books that the screen would
 * later disagree with. So this does the two things M3.6 owes: it **finds the
 * order** the gateway's refund belongs to, and it leaves the hook M4.5 picks
 * up, which is the matched order id on the `webhookEvents` document plus an
 * `audit` entry saying a refund was processed and for how much.
 *
 * Nothing about money on the order is touched here: `payment.status` stays
 * where it is and `refundedAmount` is not written. A refund that matches no
 * order at all is money leaving with no record, so that one does not end as
 * a log line: it becomes a `concerns` document for the Owner.
 */

import { type Firestore } from "firebase-admin/firestore";

import { writeAudit } from "../audit/write";
import { ORDERS } from "../orders/store";
import { raiseCaptureConcern } from "./capture";
import type { ProcessedRefund } from "./razorpayEvents";

export const REFUND_ACTOR = "razorpay";

export interface RefundMatch {
  readonly orderId: string | null;
  readonly matchedBy: "notes" | "paymentId" | "none";
  readonly concernId: string | null;
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
    return { orderId: null, matchedBy: "none", concernId };
  }

  // The hook M4.5 reads. No money field on the order is written: recording
  // the refund is that task's, and this one only says it happened.
  const matched = orderId;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection(ORDERS).doc(matched));
    writeAudit(tx, db, {
      object: `${ORDERS}/${matched}`,
      action: "refundProcessedWebhook",
      patch: {
        razorpayRefundId: refund.refundId,
        razorpayPaymentId: refund.paymentId,
        amount: refund.amountPaise,
        matchedBy,
        // TODO(M4.5): record the refund itself here (brief §12.3).
        recorded: false,
      },
      beforeSnap: snap.exists ? snap : null,
      by,
    });
  });

  return { orderId: matched, matchedBy, concernId: null };
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}
