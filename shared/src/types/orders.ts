/** `orders` and its events. Brief sections 9 and 18.1. */

import type { Paise } from "../money.js";
import type {
  FulfilmentMode,
  OrderChannel,
  OrderState,
  PaymentMethod,
  PaymentStatus,
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
  /** The batch number, `"001"`. Null on a counter line with no batch. */
  readonly batchNo: string | null;
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
}

/** `orders/{id}/events/{id}`: the timeline. */
export interface OrderEvent extends BaseDoc {
  readonly type: string;
  readonly from: OrderState | null;
  readonly to: OrderState | null;
  readonly note: string | null;
  readonly by: ActorId;
  readonly at: Timestamp;
}
