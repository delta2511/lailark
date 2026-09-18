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
}

/**
 * `documents/{series-number}`. The document id is the number itself, dashed:
 * `"LK-26-27-0001"`, so a number can never be used twice.
 */
export interface DocumentRecord extends BaseDoc {
  readonly kind: DocumentKind;
  /** The human form: `"LK/26-27/0001"`. */
  readonly number: string;
  readonly orderId: string;
  readonly issuedAt: Timestamp;
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
}
