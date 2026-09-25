/**
 * A Razorpay webhook delivery, read and checked. No Firebase in this file.
 *
 * CLAUDE.md §3, verbatim: "Webhooks: verify signature, write
 * `webhookEvents/{source-eventId}` with a must-not-exist create, respond 200
 * fast, do the work off the request path." The first two of those four are
 * here, as pure functions over the raw bytes and the headers, so they have
 * ordinary unit tests and the HTTP function is left doing only Firestore and
 * Cloud Tasks work.
 *
 * **The raw bytes, never the parsed body.** Razorpay signs the exact octets
 * it sent. `JSON.parse` then `JSON.stringify` would reorder keys, drop
 * whitespace and change numbers, and the HMAC would no longer match; worse,
 * a handler that re-serialised would be verifying a body that is not the one
 * it later reads. So the signature is checked against `req.rawBody` and the
 * body is parsed only after that check has passed.
 *
 * **No dependency.** Razorpay's scheme is HMAC SHA256 in hex, which is three
 * lines of node's own `crypto` (CLAUDE.md §3: prefer the platform).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The header Razorpay puts the HMAC in. */
export const SIGNATURE_HEADER = "x-razorpay-signature";
/** The header Razorpay puts its own event id in. Absent on older deliveries. */
export const EVENT_ID_HEADER = "x-razorpay-event-id";

/** `webhookEvents/{source-eventId}`: the `source` half. Brief §18.1. */
export const WEBHOOK_SOURCE = "razorpay";

/**
 * The two events this handler acts on (M3.6). Anything else Razorpay sends
 * is stored and marked `ignored`: the record is worth keeping, and a webhook
 * subscription that picks up a new event type must never start failing
 * deliveries. `refund.processed` is matched to an order here; M4.5 records
 * the refund itself.
 */
export const HANDLED_EVENTS = ["payment.captured", "refund.processed"] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

/**
 * Verifies Razorpay's HMAC over the exact bytes delivered.
 *
 * Constant time, through `timingSafeEqual` on the decoded digests rather
 * than `===` on the hex, so a caller cannot learn the secret one character
 * at a time by measuring how long a refusal takes. Lengths are compared
 * first because `timingSafeEqual` throws on a mismatch, and a length is not
 * a secret.
 */
export function verifyRazorpaySignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (typeof signature !== "string" || signature === "") return false;
  if (secret === "") return false;
  const expected = createHmac("sha256", secret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/** The signature a correctly-signed body would carry. Used by the tests. */
export function razorpaySignatureFor(rawBody: Buffer | string, secret: string): string {
  return createHmac("sha256", secret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("hex");
}

/**
 * The `webhookEvents` document id for this delivery.
 *
 * Razorpay's own `x-razorpay-event-id` is the same value on every retry of
 * one event, which is exactly what deduplication needs. When it is missing
 * the id falls back to a SHA256 of the body, which is stable for the same
 * reason: a retry re-sends identical bytes. The id is prefixed with the
 * source so two gateways can never collide on one document, and it is
 * sanitised because a Firestore document id may not contain a slash.
 */
export function webhookEventDocId(
  eventIdHeader: string | undefined,
  rawBody: Buffer | string,
): { readonly docId: string; readonly eventId: string; readonly derived: boolean } {
  const header = typeof eventIdHeader === "string" ? eventIdHeader.trim() : "";
  if (header !== "") {
    return { docId: `${WEBHOOK_SOURCE}-${safeId(header)}`, eventId: header, derived: false };
  }
  const digest = createHash("sha256")
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("hex");
  return { docId: `${WEBHOOK_SOURCE}-body-${digest}`, eventId: `body-${digest}`, derived: true };
}

/** Firestore refuses `/` in a document id, and `.`/`..` on their own. */
function safeId(text: string): string {
  const cleaned = text.replace(/[/]/g, "_").slice(0, 200);
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "unnamed" : cleaned;
}

/* -------------------------------------------------------------------------- */
/* Reading the body                                                           */
/* -------------------------------------------------------------------------- */

/** A captured payment, as this system needs it. Money in integer paise. */
export interface CapturedPayment {
  readonly paymentId: string;
  /** The gateway order id, `order_...`. Our own id travels in `notes`. */
  readonly razorpayOrderId: string;
  /** Integer paise. Razorpay's `amount` is the smallest currency unit too. */
  readonly amountPaise: number;
  /** `notes.lailark_order_id`, the order this money belongs to. May be "". */
  readonly orderId: string;
  readonly method: string;
}

/** A processed refund, enough to match it to an order. M4.5 records it. */
export interface ProcessedRefund {
  readonly refundId: string;
  readonly paymentId: string;
  readonly amountPaise: number;
  readonly orderId: string;
}

export interface ParsedWebhook {
  readonly type: string;
  readonly capture: CapturedPayment | null;
  readonly refund: ProcessedRefund | null;
}

/**
 * Reads the delivery, trusting nothing about its shape.
 *
 * Every field is checked for its type rather than cast, because this body
 * arrived over the wire. An amount that is not a safe integer is not an
 * amount (CLAUDE.md §3: money is integers in paise, never floats), so it is
 * read as a refusal rather than rounded: the entity comes back with
 * `amountPaise: -1`, which every caller treats as a mismatch and puts in
 * front of the Owner.
 */
export function parseRazorpayWebhook(body: unknown): ParsedWebhook {
  const root = asRecord(body);
  const type = str(root.event);
  const payload = asRecord(root.payload);

  const paymentEntity = asRecord(asRecord(payload.payment).entity);
  const refundEntity = asRecord(asRecord(payload.refund).entity);

  const capture: CapturedPayment | null =
    type === "payment.captured" && str(paymentEntity.id) !== ""
      ? {
          paymentId: str(paymentEntity.id),
          razorpayOrderId: str(paymentEntity.order_id),
          amountPaise: paise(paymentEntity.amount),
          orderId: str(asRecord(paymentEntity.notes).lailark_order_id),
          method: str(paymentEntity.method),
        }
      : null;

  const refund: ProcessedRefund | null =
    type === "refund.processed" && str(refundEntity.id) !== ""
      ? {
          refundId: str(refundEntity.id),
          paymentId: str(refundEntity.payment_id) || str(paymentEntity.id),
          amountPaise: paise(refundEntity.amount),
          orderId:
            str(asRecord(refundEntity.notes).lailark_order_id) ||
            str(asRecord(paymentEntity.notes).lailark_order_id),
        }
      : null;

  return { type, capture, refund };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Integer paise or -1. Never a float, never a rounding. */
function paise(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}
