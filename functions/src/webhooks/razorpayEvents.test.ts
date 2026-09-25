/**
 * The signature check and the body reader, on their own. No emulator: these
 * are the two things that stand between a public function URL and the money,
 * so they are tested as arithmetic, exhaustively and fast.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { alreadyPaid, paidShapeFor, readableMoney } from "./capture";
import {
  parseRazorpayWebhook,
  razorpaySignatureFor,
  verifyRazorpaySignature,
  webhookEventDocId,
} from "./razorpayEvents";

const SECRET = "a-webhook-secret";

function capturedBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: "pay_ABC123",
          amount: 64900,
          currency: "INR",
          status: "captured",
          order_id: "order_XYZ",
          method: "upi",
          notes: { lailark_order_id: "o-7f3a2c", lailark_jars: "1" },
          ...over,
        },
      },
    },
    created_at: 1_790_000_000,
  });
}

describe("the Razorpay signature", () => {
  it("accepts the HMAC Razorpay would have sent", () => {
    const body = capturedBody();
    const signature = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyRazorpaySignature(Buffer.from(body), signature, SECRET)).toBe(true);
    expect(razorpaySignatureFor(body, SECRET)).toBe(signature);
  });

  it("refuses a body that was changed after it was signed", () => {
    const body = capturedBody();
    const signature = razorpaySignatureFor(body, SECRET);
    // One paise more. Money is the field an attacker would move.
    const tampered = body.replace('"amount":64900', '"amount":6490000');
    expect(tampered).not.toBe(body);
    expect(verifyRazorpaySignature(Buffer.from(tampered), signature, SECRET)).toBe(false);
  });

  it("refuses a signature made with another secret", () => {
    const body = capturedBody();
    expect(
      verifyRazorpaySignature(Buffer.from(body), razorpaySignatureFor(body, "wrong"), SECRET),
    ).toBe(false);
  });

  it("refuses a missing, empty, short, long or non-hex signature", () => {
    const body = Buffer.from(capturedBody());
    const good = razorpaySignatureFor(body, SECRET);
    for (const bad of [undefined, "", good.slice(0, -2), `${good}00`, "zz".repeat(32)]) {
      expect(verifyRazorpaySignature(body, bad, SECRET)).toBe(false);
    }
  });

  it("refuses everything when no secret is configured", () => {
    const body = Buffer.from(capturedBody());
    expect(verifyRazorpaySignature(body, razorpaySignatureFor(body, ""), "")).toBe(false);
  });

  it("signs the exact bytes, so whitespace changes the answer", () => {
    const body = capturedBody();
    const signature = razorpaySignatureFor(body, SECRET);
    const reserialised = JSON.stringify(JSON.parse(body));
    expect(verifyRazorpaySignature(Buffer.from(`${reserialised} `), signature, SECRET)).toBe(false);
  });
});

describe("the event id", () => {
  it("uses Razorpay's own event id, prefixed by the source", () => {
    const { docId, eventId, derived } = webhookEventDocId("evt_123", "{}");
    expect(docId).toBe("razorpay-evt_123");
    expect(eventId).toBe("evt_123");
    expect(derived).toBe(false);
  });

  it("is the same for a redelivery with no event id header", () => {
    const body = capturedBody();
    const first = webhookEventDocId(undefined, body);
    const second = webhookEventDocId(undefined, Buffer.from(body));
    expect(first.docId).toBe(second.docId);
    expect(first.derived).toBe(true);
    expect(first.docId.startsWith("razorpay-body-")).toBe(true);
  });

  it("differs for a different body", () => {
    expect(webhookEventDocId(undefined, capturedBody()).docId).not.toBe(
      webhookEventDocId(undefined, capturedBody({ amount: 59900 })).docId,
    );
  });

  it("never makes an id Firestore refuses", () => {
    expect(webhookEventDocId("a/b/c", "{}").docId).toBe("razorpay-a_b_c");
    expect(webhookEventDocId("  ", "{}").derived).toBe(true);
    expect(webhookEventDocId(".", "{}").docId).toBe("razorpay-unnamed");
  });
});

describe("reading a payment.captured", () => {
  it("reads the payment, its amount in paise and our own order id", () => {
    const parsed = parseRazorpayWebhook(JSON.parse(capturedBody()));
    expect(parsed.type).toBe("payment.captured");
    expect(parsed.refund).toBeNull();
    expect(parsed.capture).toEqual({
      paymentId: "pay_ABC123",
      razorpayOrderId: "order_XYZ",
      amountPaise: 64900,
      orderId: "o-7f3a2c",
      method: "upi",
    });
  });

  it("refuses a fractional or negative amount rather than rounding it", () => {
    for (const amount of [649.5, -100, "64900", null]) {
      const parsed = parseRazorpayWebhook(JSON.parse(capturedBody({ amount })));
      expect(parsed.capture?.amountPaise).toBe(-1);
    }
  });

  it("survives a body with nothing in it", () => {
    for (const body of [null, undefined, 7, "x", [], {}, { payload: 3 }]) {
      const parsed = parseRazorpayWebhook(body);
      expect(parsed.capture).toBeNull();
      expect(parsed.refund).toBeNull();
    }
  });

  it("carries no order id when the notes carry none", () => {
    const parsed = parseRazorpayWebhook(JSON.parse(capturedBody({ notes: {} })));
    expect(parsed.capture?.orderId).toBe("");
  });
});

describe("reading a refund.processed", () => {
  const body = {
    event: "refund.processed",
    payload: {
      refund: {
        entity: { id: "rfnd_1", payment_id: "pay_ABC123", amount: 64900, status: "processed" },
      },
      payment: { entity: { id: "pay_ABC123", notes: { lailark_order_id: "o-7f3a2c" } } },
    },
  };

  it("reads the refund and finds our order id on the payment beside it", () => {
    const parsed = parseRazorpayWebhook(body);
    expect(parsed.capture).toBeNull();
    expect(parsed.refund).toEqual({
      refundId: "rfnd_1",
      paymentId: "pay_ABC123",
      amountPaise: 64900,
      orderId: "o-7f3a2c",
    });
  });

  it("still reads the payment id when only the refund carries one", () => {
    const parsed = parseRazorpayWebhook({
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_2", payment_id: "pay_Z", amount: 100 } } },
    });
    expect(parsed.refund?.paymentId).toBe("pay_Z");
    expect(parsed.refund?.orderId).toBe("");
  });
});

describe("what a captured payment turns the order into", () => {
  it("gives an open batch a receipt and makes the order wait (brief 13.1, 9.1)", () => {
    for (const state of ["open", "halfReached", "sourcing"]) {
      expect(paidShapeFor(state)).toEqual({ kind: "receipt", orderState: "paidWaiting" });
    }
  });

  it("gives a jar that exists a bill and sends it to be packed", () => {
    for (const state of ["bottled", "inStock", "soldOut"]) {
      expect(paidShapeFor(state)).toEqual({ kind: "bill", orderState: "toPack" });
    }
  });
});

describe("what may touch a money field", () => {
  it("accepts a whole, non-negative number of paise", () => {
    for (const paise of [0, 1, 64_900, Number.MAX_SAFE_INTEGER]) {
      expect(readableMoney(paise)).toBe(true);
    }
  });

  it("refuses the unreadable-amount sentinel and everything like it", () => {
    // `parseRazorpayWebhook` reads a fractional, negative, string or missing
    // amount as -1 rather than rounding it. That sentinel must never reach
    // `orders.payment.amount` or a concern's `money.amount`: the money
    // screens and the batch P&L sum those fields.
    for (const paise of [-1, -100, 649.5, Number.NaN, Number.POSITIVE_INFINITY, 1e20]) {
      expect(readableMoney(paise)).toBe(false);
    }
  });

  it("is exactly what a parsed bad amount produces", () => {
    const parsed = parseRazorpayWebhook({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_x", amount: 649.5 } } },
    });
    expect(parsed.capture?.amountPaise).toBe(-1);
    expect(readableMoney(parsed.capture!.amountPaise)).toBe(false);
  });
});

describe("the already-paid refusal a replay meets", () => {
  it("is true for every payment status that means money moved", () => {
    for (const status of ["authorized", "captured", "partlyRefunded"]) {
      expect(alreadyPaid("held", status)).toBe(true);
    }
  });

  it("is true for every paid order state, whatever the payment says", () => {
    for (const state of ["paidWaiting", "toPack", "packed", "shipped", "delivered"]) {
      expect(alreadyPaid(state, "created")).toBe(true);
    }
  });

  it("is false for a held order nobody has paid for", () => {
    expect(alreadyPaid("held", "created")).toBe(false);
    expect(alreadyPaid("expired", "created")).toBe(false);
    // Refunded money came back, so a fresh capture is not a replay.
    expect(alreadyPaid("refunded", "refunded")).toBe(false);
  });
});
