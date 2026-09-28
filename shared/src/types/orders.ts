/** `orders`. Brief sections 9 and 18.1. */

import type { Paise } from "../money.js";
import type {
  FulfilmentMode,
  OrderChannel,
  OrderState,
  PaymentMethod,
  PaymentStatus,
  RefundMethod,
} from "../states.js";
import type { ActorId, BaseDoc, PhoneE164, Timestamp } from "./base.js";

export interface DeliveryContact {
  readonly name: string;
  readonly phone: PhoneE164;
  readonly lines: readonly string[];
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
}

export interface OrderLine {
  readonly productSlug: string;
  /**
   * The batch's internal reference, `"b-7f3a2c"`. Null on a counter line with
   * no batch. D21c: a line is written while the batch is still open and has no
   * printed number, and it keeps pointing at the same batch once bottling
   * stamps one, because the reference never changes.
   */
  readonly batchRef: string | null;
  readonly qty: number;
  readonly unitPrice: Paise;
  readonly customDescription: string | null;
  /** Written at packing: which jars of the batch went in this box. */
  readonly jarNumbers: readonly number[];
}

export interface OrderDiscount {
  readonly amount: Paise;
  readonly reason: string;
  readonly by: ActorId;
}

export interface RazorpayIds {
  readonly orderId?: string;
  readonly paymentId?: string;
  readonly paymentLinkId?: string;
  readonly qrCodeId?: string;
}

export interface OrderPayment {
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly razorpayIds: RazorpayIds;
  /** Who marked a cash or UPI-to-account payment paid. Null for online. */
  readonly markedPaidBy: ActorId | null;
  readonly upiRef: string | null;
  readonly amount: Paise;
  readonly refundedAmount: Paise;
}

/**
 * **D65.** The Owner's mark that this refund was a refusal: he sent the money
 * back because he chose not to serve this person, not because anything went
 * wrong with the sale.
 *
 * The jar still goes back on sale either way ("refusing a person is not a
 * reason to lose a jar out of a 15-to-40 jar batch"), but a refusal keeps
 * that person's per-person allowance for the batch **spent**, so they cannot
 * simply buy the same jar again. It may be set when the refund is recorded
 * and it may be added or changed afterwards, because an order refunded first
 * and understood later must still be markable.
 */
export interface OrderRefusal {
  readonly reason: string;
  readonly at: Timestamp;
  readonly by: ActorId;
}

/**
 * What the gateway told us before anyone recorded it: a `refund.processed`
 * webhook that M3.6 matched to this order (`functions/src/webhooks/refund.ts`).
 *
 * It is a **to-do marker, not money**: nothing on `payment` is touched by the
 * webhook, because the refund is not recorded until the Owner records it on
 * the order screen (brief 12.3). `recordRefund` clears this when it records
 * the refund with the same `razorpayRefundId`.
 */
export interface GatewayRefundPending {
  readonly razorpayRefundId: string;
  readonly razorpayPaymentId: string;
  readonly amount: Paise;
  readonly seenAt: Timestamp;
}

/**
 * `orders/{id}.refund`: everything a recorded refund leaves on the order.
 * Brief 12.3, M4.5. Written only by functions, like every other money field.
 *
 * `totalPaise` deliberately repeats `payment.refundedAmount`, which is the
 * field the Orders screen has always read. Both are written in the same
 * commit by the same function; this one exists so that the questions
 * `orders/paid.ts` asks (have the jars come back, has the whole thing been
 * returned, and was it a refusal) can be answered off one map without also
 * needing the order's total.
 */
export interface OrderRefundRecord {
  /** Cumulative paise returned across every refund recorded on this order. */
  readonly totalPaise: Paise;
  /**
   * True once the whole of `payment.amount` has been returned. Only a full
   * refund moves the order to `refunded`, puts jars back, and frees the
   * per-person allowance (D65).
   */
  readonly fullyRefunded: boolean;
  /** Jars this order's refunds have put back on their batch's paid count. */
  readonly jarsReturned: number;
  /**
   * Brief 12.3: "The gateway fee on the original payment is not returned. The
   * P&L records it." Null means nobody has told us what it was, which is a
   * different fact from zero and must not be added up as zero.
   */
  readonly gatewayFeeUnreturned: Paise | null;
  /** D65. Null unless the Owner marked this refund a refusal. */
  readonly refusal: OrderRefusal | null;
  /** The refund note or credit note numbers issued against this order. */
  readonly documentNumbers: readonly string[];
  readonly lastMethod: RefundMethod;
  readonly lastRecordedAt: Timestamp;
  readonly lastRecordedBy: ActorId;
  /** A gateway refund seen but not yet recorded, or null. */
  readonly gatewayPending: GatewayRefundPending | null;
}

/** `orders/{id}`. Money fields on this document are written only by functions. */
export interface Order extends BaseDoc {
  /** The human order number. Not the bill number. */
  readonly number: string;
  readonly channel: OrderChannel;
  readonly customerPhone: PhoneE164;
  readonly deliveryContact: DeliveryContact | null;
  /** State code for GST, carried from day one. */
  readonly placeOfSupply: string;
  readonly state: OrderState;
  readonly lines: readonly OrderLine[];
  /**
   * Every batch reference this order touches, flat, because Firestore cannot
   * filter on a field inside an array of maps. `array-contains` on this is how
   * the server finds the orders in a batch. D21c: references, never printed
   * numbers, so an order placed while the batch was open still resolves to the
   * same batch after bottling.
   */
  readonly batchRefs: readonly string[];
  readonly shippingFee: Paise;
  readonly discount: OrderDiscount | null;
  readonly total: Paise;
  readonly fulfilment: FulfilmentMode;
  readonly payment: OrderPayment;
  readonly shareCodeUsed: string | null;
  readonly policyVersion: string;
  readonly kitchenNote: string | null;
  readonly draft: boolean;
  readonly soldBy: ActorId | null;
  readonly holdExpiresAt: Timestamp | null;
  /**
   * The private order page's token (M3.8). Brief §5: "'Where is my order' is
   * answered by the agent on WhatsApp, or by a private order link sent with
   * the bill (`lailark.in/o/<long random token>`). No login page."
   *
   * 32 hex characters, minted by the server in the same transaction that
   * creates the order and never changed afterwards, so a link that has been
   * sent to a customer keeps working. Null only on an order written before
   * M3.8.
   */
  readonly token: string | null;
  /**
   * M4.5, brief 12.3: what the refunds recorded on this order came to. Absent
   * on every order that has never been refunded, which is almost all of them.
   */
  readonly refund?: OrderRefundRecord | null;
}
