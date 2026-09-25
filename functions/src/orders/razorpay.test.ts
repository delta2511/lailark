/**
 * The Razorpay Orders call, with `fetch` stubbed.
 *
 * CLAUDE.md section 8: every function has a unit test. This one exists
 * because the emulator path short-circuits `fetch` entirely, so until now
 * nothing in the tree had ever looked at the request body, and
 * `notes.lailark_order_id` is the field M3.6's webhook uses to find the hold
 * a payment belongs to. A typo there would not fail anywhere until money had
 * moved.
 *
 * Nothing here reaches the network: `globalThis.fetch` is replaced for each
 * test and restored afterwards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRazorpayOrder,
  RAZORPAY_TIMEOUT_MS,
  razorpayKeyIdForClient,
  RazorpayFailed,
  RazorpayNotConfigured,
} from "./razorpay";

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(reply: { status: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

function body(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body));
}

const ARGS = {
  amountPaise: 64_900,
  orderId: "o-abc123",
  notes: { lailark_order_id: "o-abc123", lailark_batch_ref: "b-1", lailark_jars: "1" },
};

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_keyid";
  process.env.RAZORPAY_KEY_SECRET = "not-a-real-secret";
  // The emulator branch must not swallow these tests.
  delete process.env.FUNCTIONS_EMULATOR;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...realEnv };
  vi.restoreAllMocks();
});

describe("creating the Razorpay order, brief 9.2", () => {
  it("posts the amount in whole paise, the receipt and prepaid capture", async () => {
    const calls = stubFetch({ status: 200, body: { id: "order_X1", amount: 64_900, currency: "INR" } });
    const out = await createRazorpayOrder(ARGS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.razorpay.com/v1/orders");
    expect(calls[0].init.method).toBe("POST");

    const sent = body(calls[0]);
    expect(sent.amount).toBe(64_900);
    expect(Number.isInteger(sent.amount)).toBe(true);
    expect(sent.currency).toBe("INR");
    expect(sent.receipt).toBe("o-abc123");
    // Brief 4.3: prepaid only. An authorised-but-uncaptured payment would
    // leave a jar held against money we have not taken.
    expect(sent.payment_capture).toBe(1);

    expect(out).toEqual({
      id: "order_X1",
      amount: 64_900,
      currency: "INR",
      keyId: "rzp_test_keyid",
    });
  });

  it("carries our own order id in notes, which is what the webhook reads back", async () => {
    const calls = stubFetch({ status: 200, body: { id: "order_X2" } });
    await createRazorpayOrder(ARGS);

    const notes = body(calls[0]).notes as Record<string, string>;
    expect(notes.lailark_order_id).toBe("o-abc123");
    expect(notes.lailark_batch_ref).toBe("b-1");
    expect(notes.lailark_jars).toBe("1");
  });

  it("authenticates with Basic auth and never puts the secret in the body or the answer", async () => {
    const calls = stubFetch({ status: 200, body: { id: "order_X3" } });
    const out = await createRazorpayOrder(ARGS);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    expect(headers["Content-Type"]).toBe("application/json");
    // The header's value is never asserted, only its shape; and the secret
    // must appear nowhere else at all.
    expect(String(calls[0].init.body)).not.toContain("not-a-real-secret");
    expect(JSON.stringify(out)).not.toContain("not-a-real-secret");
  });

  it("trims a note past Razorpay's own 512 character ceiling", async () => {
    const calls = stubFetch({ status: 200, body: { id: "order_X4" } });
    await createRazorpayOrder({ ...ARGS, notes: { long: "x".repeat(900) } });
    expect((body(calls[0]).notes as Record<string, string>).long).toHaveLength(512);
  });

  it("sends an AbortSignal, so a hang cannot ride to the function timeout", async () => {
    const calls = stubFetch({ status: 200, body: { id: "order_X5" } });
    await createRazorpayOrder(ARGS);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(RAZORPAY_TIMEOUT_MS).toBeLessThan(60_000);
  });
});

describe("when Razorpay will not play", () => {
  it("turns a gateway refusal into one sentence, with the detail kept off it", async () => {
    stubFetch({ status: 400, body: { error: { description: "amount must be at least INR 1.00" } } });
    await expect(createRazorpayOrder(ARGS)).rejects.toThrow(RazorpayFailed);

    const failure = await createRazorpayOrder(ARGS).catch((e) => e as RazorpayFailed);
    expect(failure.status).toBe(400);
    // What the customer reads, and what only the log reads.
    expect(failure.message).toBe("We could not start the payment just now. Please try again in a minute.");
    expect(failure.message).not.toContain("amount must be");
    expect(failure.detail).toContain("amount must be");
  });

  it("refuses a 200 that carries no order id, rather than inventing one", async () => {
    stubFetch({ status: 200, body: { nothing: "useful" } });
    await expect(createRazorpayOrder(ARGS)).rejects.toThrow(RazorpayFailed);
  });

  it("gives up when the gateway simply hangs, inside the invocation", async () => {
    // A stub that answers only when the signal aborts, which is exactly what
    // a hanging gateway looks like from here.
    globalThis.fetch = vi.fn(
      (_url: unknown, init: unknown) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal as AbortSignal;
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "TimeoutError";
            reject(error);
          });
        }),
    ) as unknown as typeof fetch;

    const started = Date.now();
    const failure = await createRazorpayOrder({ ...ARGS, timeoutMs: 40 }).catch(
      (e) => e as RazorpayFailed,
    );
    expect(failure).toBeInstanceOf(RazorpayFailed);
    // The customer reads the same sentence as any other gateway failure, and
    // `createCheckout` catches the same class, so the hold is released.
    expect(failure.message).toBe("We could not start the payment just now. Please try again in a minute.");
    expect(failure.detail).toContain("no answer in 40ms");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("turns any other network error into the same refusal", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.razorpay.com");
    }) as unknown as typeof fetch;

    const failure = await createRazorpayOrder(ARGS).catch((e) => e as RazorpayFailed);
    expect(failure).toBeInstanceOf(RazorpayFailed);
    expect(failure.detail).toContain("ENOTFOUND");
  });

  it("refuses an amount below Razorpay's own floor without calling out at all", async () => {
    const calls = stubFetch({ status: 200, body: { id: "order_X6" } });
    await expect(createRazorpayOrder({ ...ARGS, amountPaise: 50 })).rejects.toThrow(RazorpayFailed);
    await expect(createRazorpayOrder({ ...ARGS, amountPaise: 1.5 })).rejects.toThrow(RazorpayFailed);
    expect(calls).toHaveLength(0);
  });
});

describe("when no key is configured", () => {
  it("refuses cleanly in a deployed project, and creates nothing", async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const calls = stubFetch({ status: 200, body: { id: "order_X7" } });

    const failure = await createRazorpayOrder(ARGS).catch((e) => e as Error);
    expect(failure).toBeInstanceOf(RazorpayNotConfigured);
    // A customer is pointed at WhatsApp, not at a stack trace.
    expect(failure.message).toContain("WhatsApp");
    expect(calls).toHaveLength(0);
  });

  it("hands back a plainly fake order in the emulator, and still calls nothing", async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    process.env.FUNCTIONS_EMULATOR = "true";
    const calls = stubFetch({ status: 200, body: { id: "order_X8" } });

    const out = await createRazorpayOrder(ARGS);
    expect(out.id).toBe("order_emulator_o-abc123");
    expect(out.keyId).toBe("rzp_test_emulator");
    expect(calls).toHaveLength(0);
  });

  it("treats a blank key exactly as a missing one", async () => {
    process.env.RAZORPAY_KEY_ID = "   ";
    process.env.RAZORPAY_KEY_SECRET = "";
    stubFetch({ status: 200, body: { id: "order_X9" } });
    await expect(createRazorpayOrder(ARGS)).rejects.toThrow(RazorpayNotConfigured);
  });
});

/**
 * The key id on its own, for the resume path: `createCheckout` hands a
 * started checkout back to the browser without creating a gateway order, so
 * it needs the key without going through `createRazorpayOrder`.
 */
describe("the key id the browser is given, with no order created", () => {
  it("hands back the configured key, trimmed", () => {
    process.env.RAZORPAY_KEY_ID = "  rzp_test_abc  ";
    expect(razorpayKeyIdForClient()).toBe("rzp_test_abc");
  });

  it("treats a set but empty key as no key at all", () => {
    // The whole reason this function exists. `.secret.local` declares both
    // keys empty on purpose, so `process.env.RAZORPAY_KEY_ID ?? fallback`
    // never fired: the page was handed `key: ""` and could only tell the
    // customer the payment window had failed.
    process.env.RAZORPAY_KEY_ID = "";
    process.env.FUNCTIONS_EMULATOR = "true";
    expect(razorpayKeyIdForClient()).toBe("rzp_test_emulator");

    process.env.RAZORPAY_KEY_ID = "   ";
    expect(razorpayKeyIdForClient()).toBe("rzp_test_emulator");
  });

  it("refuses in a deployed project rather than handing back an empty string", () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.FUNCTIONS_EMULATOR;
    expect(() => razorpayKeyIdForClient()).toThrow(RazorpayNotConfigured);
    // The customer meets the plain sentence, not an internal error.
    expect(() => razorpayKeyIdForClient()).toThrow(/WhatsApp/);
  });

  it("never hands back the secret", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc";
    process.env.RAZORPAY_KEY_SECRET = "shhh-not-this";
    expect(razorpayKeyIdForClient()).not.toContain("shhh");
  });
});
