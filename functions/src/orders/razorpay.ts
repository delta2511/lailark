/**
 * Razorpay, over plain `fetch`.
 *
 * Brief §4.3 and §9.2: the website uses the **Orders API** and Razorpay
 * Checkout, and the webhook (M3.6) is the source of truth for whether the
 * money arrived. All this module does is create the order and hand back what
 * Checkout needs to open.
 *
 * **No SDK.** Creating an order is one authenticated POST with a JSON body,
 * and `fetch` is on the platform from Node 18. The `razorpay` package would
 * add a dependency, its own transitive tree and its own retry behaviour to
 * this codebase for a single endpoint (CLAUDE.md §3: "Do not add dependencies
 * casually. Prefer the platform.").
 *
 * **The keys never enter the repo.** Both come from Secret Manager, bound to
 * the callable through `secrets: [...]`, and reach this module as ordinary
 * environment variables at runtime. The emulator reads them from
 * `functions/.secret.local`, which is gitignored. A project with no key
 * configured refuses the checkout with a sentence rather than half-creating
 * an order: see {@link RazorpayNotConfigured}.
 */

import { defineSecret } from "firebase-functions/params";

/** `rzp_test_...` / `rzp_live_...`. Public in the browser, secret in transit. */
export const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
/** The one that signs. Never leaves the server, never goes in a response. */
export const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

const ORDERS_URL = "https://api.razorpay.com/v1/orders";

/** Razorpay refuses a receipt longer than this, so it is checked here. */
const MAX_RECEIPT = 40;
/** Each note value is capped by Razorpay at 512 characters. */
const MAX_NOTE = 512;

/**
 * How long we wait for Razorpay before giving up, well inside the
 * callable's own 60 second ceiling.
 *
 * Without this, a gateway that simply hangs rides all the way to the
 * function timeout, the whole invocation is killed, and `createCheckout`'s
 * `releaseHold` never runs: the jar then sits out of the count until the
 * sweep picks it up, which is the one thing a customer watching the count
 * would notice. Ten seconds is long for a call that normally answers in
 * under one, and short enough that the refusal and the release both still
 * happen inside the invocation.
 */
export const RAZORPAY_TIMEOUT_MS = 10_000;

export class RazorpayNotConfigured extends Error {
  constructor() {
    super(
      "Online payment is not switched on yet. Please message us on WhatsApp and we will send you a payment link.",
    );
    this.name = "RazorpayNotConfigured";
  }
}

export class RazorpayFailed extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super("We could not start the payment just now. Please try again in a minute.");
    this.name = "RazorpayFailed";
  }
}

export interface RazorpayOrder {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  /** The key id the browser needs to open Checkout. Never the secret. */
  readonly keyId: string;
}

export interface CreateOrderArgs {
  /** Integer paise. Razorpay's `amount` is the smallest currency unit too. */
  readonly amountPaise: number;
  /** Our own order id. Goes in `receipt` and in `notes` (brief §9.2). */
  readonly orderId: string;
  readonly notes: Readonly<Record<string, string>>;
  /** Overridden only by the unit test. Defaults to {@link RAZORPAY_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

function keys(): { readonly id: string; readonly secret: string } | null {
  const id = (process.env.RAZORPAY_KEY_ID ?? "").trim();
  const secret = (process.env.RAZORPAY_KEY_SECRET ?? "").trim();
  return id !== "" && secret !== "" ? { id, secret } : null;
}

/** True only inside `firebase emulators:exec` / `emulators:start`. */
function inEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

/**
 * The key id the browser needs to open Checkout, for a caller that is not
 * creating an order (the resume path in `createCheckout`).
 *
 * It goes through the bound secret rather than reading the environment
 * variable raw, and it treats a **set but empty** key as no key at all,
 * which `process.env.RAZORPAY_KEY_ID ?? "rzp_test_emulator"` did not: the
 * emulator's own `.secret.local` declares both keys empty on purpose, so
 * that fallback never fired and the page was handed `key: ""` and could only
 * tell the customer the payment window had failed. Same two answers as
 * {@link createRazorpayOrder}: the fake key in the emulator, and a refusal
 * anywhere else, never a silent empty string.
 */
export function razorpayKeyIdForClient(): string {
  let id = "";
  try {
    id = (RAZORPAY_KEY_ID.value() ?? "").trim();
  } catch {
    // Not bound (a unit test, or a context without the secret): fall back to
    // the environment, which is where the binding puts it at runtime anyway.
    id = (process.env.RAZORPAY_KEY_ID ?? "").trim();
  }
  if (id === "") id = (process.env.RAZORPAY_KEY_ID ?? "").trim();
  if (id !== "") return id;
  if (inEmulator()) return "rzp_test_emulator";
  throw new RazorpayNotConfigured();
}

/**
 * Creates the Razorpay order for a checkout, or throws.
 *
 * `notes.lailark_order_id` is the whole point of this call: the webhook
 * (M3.6) reads it back off `payment.captured` to find the order whose hold it
 * is turning into a payment, without trusting anything the browser said.
 *
 * **In the emulator with no key configured** this returns a clearly fake
 * order id (`order_emulator_<our id>`) and makes no network call at all.
 * That is deliberate: ST1 allows the site no external request outside
 * Checkout, the test suite must not reach api.razorpay.com, and a developer
 * with no Razorpay account still has to be able to walk the flow. A deployed
 * project is never in this branch, because `FUNCTIONS_EMULATOR` is unset
 * there, so a missing key in staging or production is
 * {@link RazorpayNotConfigured} and nothing is created.
 */
export async function createRazorpayOrder(args: CreateOrderArgs): Promise<RazorpayOrder> {
  if (!Number.isSafeInteger(args.amountPaise) || args.amountPaise < 100) {
    // Razorpay's own floor is ₹1. A zero-rupee order is a bug upstream.
    throw new RazorpayFailed(0, `amount ${args.amountPaise} is not a usable paise total`);
  }

  const configured = keys();
  if (configured === null) {
    if (inEmulator()) {
      return {
        id: `order_emulator_${args.orderId}`,
        amount: args.amountPaise,
        currency: "INR",
        keyId: "rzp_test_emulator",
      };
    }
    throw new RazorpayNotConfigured();
  }

  const notes: Record<string, string> = {};
  for (const [key, value] of Object.entries(args.notes)) {
    notes[key] = String(value).slice(0, MAX_NOTE);
  }

  const auth = Buffer.from(`${configured.id}:${configured.secret}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(ORDERS_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: args.amountPaise,
        currency: "INR",
        receipt: args.orderId.slice(0, MAX_RECEIPT),
        // Brief §4.3: "Prepaid only." An authorised-but-uncaptured payment
        // would leave a jar held against money we have not taken.
        payment_capture: 1,
        notes,
      }),
      // A hang is a failure like any other, and has to become one *inside*
      // this invocation so the caller can put the jar back.
      signal: AbortSignal.timeout(args.timeoutMs ?? RAZORPAY_TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new RazorpayFailed(
      0,
      aborted
        ? `no answer in ${args.timeoutMs ?? RAZORPAY_TIMEOUT_MS}ms`
        : `network error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.id !== "string") {
    // The gateway's own words go to the log, never to the customer: the
    // message on RazorpayFailed is what they read.
    throw new RazorpayFailed(res.status, JSON.stringify(body).slice(0, 500));
  }

  return {
    id: body.id,
    amount: typeof body.amount === "number" ? body.amount : args.amountPaise,
    currency: typeof body.currency === "string" ? body.currency : "INR",
    keyId: configured.id,
  };
}
