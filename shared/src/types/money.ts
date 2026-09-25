/** `documents`, `counters`, `refunds`, `dayCloses`, `settlements`, `webhookEvents`. */

import type { Paise } from "../money.js";
import type { DocumentKind, PaymentMethod, RefundMethod, RefundStatus } from "../states.js";
import type { ActorId, BaseDoc, IsoDate, Timestamp } from "./base.js";

export interface DocumentLine {
  readonly description: string;
  readonly hsn: string | null;
  readonly qty: number;
  readonly unitPrice: Paise;
  readonly amount: Paise;
  /**
   * M2.9, brief 13.2: "Lines: product, **batch number, jar numbers**,
   * quantity, unit price, amount." Both are on the line rather than on the
   * document, because one bill can carry jars from more than one batch.
   * Null and empty on a shipping, discount or bare custom line.
   */
  readonly batchNo: string | null;
  readonly jarNumbers: readonly string[];
}

/**
 * Who the bill is from. Brief 13.2: "Always: Lailark Kitchen, address, FSSAI
 * number, customer support number."
 *
 * Frozen onto every document when it is issued, rather than read at the
 * moment a PDF is drawn. A bill is a record of what was true on the day it
 * was issued: when the kitchen moves, or the FSSAI licence is renewed under a
 * new number, last March's bill must still read the way it read last March.
 * `settings/seller` changes what the *next* document says, never this one.
 */
export interface SellerIdentity {
  readonly name: string;
  readonly addressLines: readonly string[];
  readonly supportPhone: string;
  readonly fssai: string;
  readonly website: string;
  /** Null while GST is off (D26, brief 4.5). Never invented. */
  readonly gstin: string | null;
  /**
   * **Decision D38.** Brief 13.2's "delivery address **or** 'handed over at
   * Kunnamangalam'". Shefin's words: "keep that field editable as a note", so
   * it lives in `settings/seller` beside the rest of the block rather than in
   * code, and changing where the door is is a settings change and not a
   * deploy. Frozen onto the document at issue like everything else here.
   */
  readonly handedOverText: string;
}

/** Who the bill is to, as it read on the day. */
export interface DocumentCustomer {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
}

/** How it was paid, for the "payment method and reference" line of 13.2. */
export interface DocumentPayment {
  readonly method: PaymentMethod | "";
  readonly status: string;
  /** A UPI reference, a Razorpay payment id, or null for cash. */
  readonly reference: string | null;
}

/**
 * A document that has been cancelled without losing its number. Brief 13.3:
 * "A counter sale voided the same day before its bill was sent keeps its
 * number, marked void." The number stays in the series, the document stays in
 * `documents`, and this says it is not to be collected on.
 */
export interface DocumentVoid {
  readonly at: Timestamp;
  readonly by: ActorId;
  readonly reason: string;
}

/**
 * `documents/{series-number}`. The document id is the number itself, dashed:
 * `"LK-26-27-0001"`, so a number can never be used twice.
 *
 * **Everything here is a snapshot.** M2.9 added the seller, the customer, the
 * delivery line, the payment and the money breakdown as stored fields rather
 * than as joins onto `orders` and `customers`, because a bill is a legal
 * record of one moment: a customer who later corrects the spelling of their
 * name has not changed the bill they were given, and re-rendering the PDF a
 * year later must produce the same page.
 */
export interface DocumentRecord extends BaseDoc {
  readonly kind: DocumentKind;
  /** The human form: `"LK/26-27/0001"`. */
  readonly number: string;
  readonly orderId: string;
  /** The order's own reference, `"o-7f3a2c"` (A90). Same as `orderId`. */
  readonly orderNumber: string;
  readonly issuedAt: Timestamp;
  /** The Asia/Kolkata calendar date it was issued on, `"YYYY-MM-DD"`. */
  readonly issuedOn: IsoDate;
  readonly lines: readonly DocumentLine[];
  readonly taxable: Paise;
  /** All zero until GST is on. */
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly igst: Paise;
  readonly total: Paise;
  readonly pdfPath: string | null;
  /** The document number this one cancels, for a credit note. */
  readonly voids: string | null;
  readonly cancelledBy: ActorId | null;

  /* ---- the snapshot, brief 13.2 ---- */
  readonly seller: SellerIdentity;
  readonly customer: DocumentCustomer;
  /** The delivery address, or "Handed over at Kunnamangalam". */
  readonly deliveryText: string;
  /** The state the supply happened in, two letters. */
  readonly placeOfSupply: string;
  readonly channel: string;
  readonly payment: DocumentPayment;
  readonly subtotal: Paise;
  readonly discount: Paise;
  readonly discountReason: string | null;
  readonly shippingFee: Paise;
  /**
   * False at launch (D26, brief 4.5). It is stored rather than read from
   * `settings/gst`, so a bill issued before the switch never starts calling
   * itself a tax invoice afterwards.
   */
  readonly gstEnabled: boolean;
  /** Null unless this document has been voided (13.3). */
  readonly voided: DocumentVoid | null;
}

/**
 * `counters/{series}`. The document id is the dashed series key, `"LK-26-27"`.
 * Changed only inside the server transaction that creates a document.
 */
export interface Counter extends BaseDoc {
  /** The next number to issue. Starts at 1 each 1 April. */
  readonly next: number;
  readonly kind: DocumentKind;
  readonly fyLabel: string;
}

/** `refunds/{id}`. */
export interface Refund extends BaseDoc {
  readonly orderId: string;
  readonly concernId: string | null;
  readonly amount: Paise;
  readonly method: RefundMethod;
  readonly razorpayRefundId: string | null;
  readonly reference: string | null;
  readonly status: RefundStatus;
  readonly recordedBy: ActorId;
}

/** `dayCloses/{date}`. The document id is `"YYYY-MM-DD"`. */
export interface DayClose extends BaseDoc {
  readonly date: IsoDate;
  readonly totalsByMethod: Readonly<Record<PaymentMethod, Paise>>;
  readonly jarsByBatch: Readonly<Record<string, number>>;
  readonly cashCounted: Paise;
  readonly difference: Paise;
  readonly note: string | null;
  readonly closedBy: ActorId;
}

/** `settlements/{razorpayId}`. */
export interface Settlement extends BaseDoc {
  readonly amount: Paise;
  readonly fees: Paise;
  readonly tax: Paise;
  readonly utr: string | null;
  readonly settledAt: Timestamp;
}

/**
 * `webhookEvents/{source-eventId}`. Created with a must-not-exist write, so a
 * repeated webhook fails harmlessly.
 */
export interface WebhookEvent extends BaseDoc {
  readonly source: string;
  readonly eventId: string;
  readonly type: string;
  readonly receivedAt: Timestamp;
  readonly processedAt: Timestamp | null;
  readonly payload: unknown;
  /**
   * What the work came to: `"applied"`, `"already"`, `"hold-gone"`,
   * `"ignored"` and the rest of M3.6's outcomes. Null until it is done.
   */
  readonly outcome?: string | null;
  /** The order this event turned out to be about, when it was about one. */
  readonly orderId?: string | null;
}
