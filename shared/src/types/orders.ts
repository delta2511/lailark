/** `orders`. Brief sections 9 and 18.1. */

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
}
