/**
 * The web checkout of brief §6 (flow A, a jar in stock) and §7 (flow B,
 * booking an open batch), with no Firebase in it.
 *
 * Same split as `sale.ts`: every decision `createCheckout` makes lives here,
 * so the whole of §6.1 and §7.2 is unit-testable without an emulator, and the
 * callable is left doing only Firestore work. The arithmetic is never
 * repeated: `saleTotals`, `shippingFeeFor` and `checkDeliverable` all come
 * from `@lailark/shared`, so the checkout page and this planner cannot
 * disagree about what the customer is about to be charged.
 *
 * Three things this file refuses, and why each one is here rather than on
 * the page:
 *
 *  - **The total.** The request carries what the page showed
 *    (`expectedTotalPaise`) and the sale stops if the server's own sum
 *    differs, rather than charging the difference. "No surprise charges at
 *    payment" (CLAUDE.md §3) has to be a check, not an intention.
 *  - **Where it is going.** Brief §6.1 step 3: the pincode is checked against
 *    the serviceable list and the product's own shipping rule.
 *  - **The shelf-life stop.** Brief §6.2: online in-stock sale stops about
 *    120 days after packing. The page hides Buy after it (M3.3's
 *    `canBuyToday`); a page is not a gate.
 */

import {
  BATCH_STATES_IN_STOCK,
  BATCH_STATES_OPEN_FOR_BOOKING,
  checkCustomerText,
  checkDeliverable,
  effectiveShippingSwitch,
  formatINR,
  IN_STOCK_PER_PERSON_LIMIT,
  isSellablePrice,
  isShareCode,
  MAX_WEB_JARS,
  type Paise,
  parseIndianMobile,
  type PincodeList,
  ORDER_STATES_TERMINAL,
  type ProductShippingRestriction,
  type SaleTotals,
  saleTotals,
  type ShippingRule,
  type ShippingSwitch,
  shippingFeeFor,
} from "@lailark/shared";

import type { SaleBatchView, SaleCustomerView, SaleProductView } from "./sale";

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

export type ErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "failed-precondition"
  | "not-found"
  | "aborted";

export type Failure = { readonly ok: false; readonly code: ErrorCode; readonly message: string };

function fail(code: ErrorCode, message: string): Failure {
  return { ok: false, code, message };
}

function invalid(message: string): Failure {
  return fail("invalid-argument", message);
}

/* -------------------------------------------------------------------------- */
/* The request, brief §5                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Brief §5: "Online checkout asks for: name, WhatsApp number, delivery
 * address in India, pincode. Email optional." And the two ticks: order
 * updates on WhatsApp, which the order needs to be fulfilled at all, and a
 * separate, unticked box for new batches.
 */
export interface CheckoutConsents {
  /** "Order updates on WhatsApp." Required: §5 calls it needed to fulfil. */
  readonly updates: boolean;
  /** "Tell me when a new batch opens." Starts unticked and stays optional. */
  readonly marketing: boolean;
}

export interface CheckoutAddress {
  readonly lines: readonly string[];
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
}

export interface CheckoutRequest {
  readonly productSlug: string;
  /** D21c: the internal reference. Null lets the server pick the batch. */
  readonly batchRef: string | null;
  readonly qty: number;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly email: string | null;
  readonly address: CheckoutAddress;
  readonly consents: CheckoutConsents;
  /** What the page told the customer this comes to, in whole paise. */
  readonly expectedTotalPaise: Paise;
  /**
   * An id the page mints once for this attempt. The same checkout arriving
   * twice takes one hold and creates one Razorpay order, rather than putting
   * two jars out of the count for one customer who tapped twice. The counter
   * sale uses the same trick (A94).
   */
  readonly clientRef: string | null;
  /** M3.8 records the share link a booking came through. Null until then. */
  readonly shareCode: string | null;
}

const MAX_NAME = 80;
const MAX_EMAIL = 120;
const MAX_ADDRESS_LINES = 4;
const MAX_ADDRESS_LINE = 100;
const MAX_CITY = 60;
const MAX_STATE = 60;
const MAX_CLIENT_REF = 64;
const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
/** Deliberately loose: an address is not the place to argue about an email. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Turns the callable's `data` into a {@link CheckoutRequest} or says plainly
 * what is wrong with it, in the box's own words. Nothing here touches
 * Firestore, so a malformed request costs one invocation, no reads, and no
 * transaction.
 *
 * Every message here is read by a customer, so every one of them is a
 * sentence and none of them carries an em dash (CLAUDE.md §3).
 */
export function parseCheckoutRequest(
  raw: unknown,
): { readonly ok: true; readonly value: CheckoutRequest } | Failure {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid("Something went wrong with the form. Please reload the page and try again.");
  }
  const data = raw as Record<string, unknown>;

  const productSlug = text(data.productSlug);
  if (!SLUG.test(productSlug)) {
    return invalid("Please choose which pickle you are buying.");
  }

  let batchRef: string | null = null;
  if (text(data.batchRef) !== "") {
    const given = text(data.batchRef);
    if (!/^b-[0-9a-z]{4,12}$/.test(given)) {
      return invalid("Something went wrong with the form. Please reload the page and try again.");
    }
    batchRef = given;
  }

  const qty = data.qty;
  if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > MAX_WEB_JARS) {
    return invalid(`Please choose between 1 and ${MAX_WEB_JARS} jars.`);
  }

  const customerName = text(data.customerName);
  if (customerName === "") return invalid("Please give us your name.");
  if (customerName.length > MAX_NAME) {
    return invalid(`Please keep the name to ${MAX_NAME} characters or fewer.`);
  }

  const phone = parseIndianMobile(text(data.customerPhone));
  if (!phone.ok) {
    return invalid(
      phone.reason === "notIndian"
        ? "We ship inside India, so we need an Indian mobile number. Message us on WhatsApp if you are abroad."
        : "That does not look like a 10 digit Indian mobile number. Please check it.",
    );
  }

  let email: string | null = null;
  if (text(data.email) !== "") {
    const given = text(data.email);
    if (given.length > MAX_EMAIL || !EMAIL.test(given)) {
      return invalid("That email address does not look right. You can also leave it blank.");
    }
    email = given;
  }

  const parsedAddress = parseAddress(data.address);
  if (!parsedAddress.ok) return parsedAddress;

  const rawConsents = data.consents;
  if (typeof rawConsents !== "object" || rawConsents === null || Array.isArray(rawConsents)) {
    return invalid("Please tick the box about order updates on WhatsApp.");
  }
  const consentData = rawConsents as Record<string, unknown>;
  const consents: CheckoutConsents = {
    updates: consentData.updates === true,
    marketing: consentData.marketing === true,
  };
  if (!consents.updates) {
    // Brief §5: updates on WhatsApp are "needed to fulfil the order". The
    // bill, the jar number and the tracking all go that way, so an order
    // without it is an order we cannot tell anybody anything about.
    return invalid(
      "We send the bill, your jar number and the tracking on WhatsApp, so please tick that box to go ahead.",
    );
  }

  const expectedTotalPaise = data.expectedTotalPaise;
  if (
    typeof expectedTotalPaise !== "number" ||
    !Number.isSafeInteger(expectedTotalPaise) ||
    expectedTotalPaise < 1
  ) {
    return invalid("Something went wrong with the price. Please reload the page and try again.");
  }

  const clientRef = text(data.clientRef);
  if (clientRef.length > MAX_CLIENT_REF) {
    return invalid("Something went wrong with the form. Please reload the page and try again.");
  }

  // M3.8 (A205). `createCheckout` is public and unauthenticated until App
  // Check lands in M5.9, so `shareCode` is whatever a caller cares to send:
  // it arrives off `?s=` on a link a stranger wrote. It is checked against
  // `isShareCode` here, before it can reach `orders/{id}.shareCodeUsed`,
  // which M3.9 draws on the order screen and puts inside a `wa.me` link.
  //
  // **Dropped, not refused.** A share code is an attribution and nothing
  // else: it moves no price, no count and no total, here or anywhere. An
  // order that arrives with a mangled one is still a customer who wants a
  // jar, and refusing the sale over a URL parameter they never typed would
  // cost them the jar to protect a field nobody is paid from. So a code that
  // is not one becomes no code, the order is unattributed, and the checkout
  // carries on. Both doors read this one parsed value: the first attempt
  // (`planCheckout`) and the A194 (iv) resume (`planResumedContact`).
  const rawShareCode = text(data.shareCode);
  const shareCode = isShareCode(rawShareCode) ? rawShareCode : "";

  return {
    ok: true,
    value: {
      productSlug,
      batchRef,
      qty: qty as number,
      customerName,
      customerPhone: phone.e164,
      email,
      address: parsedAddress.value,
      consents,
      expectedTotalPaise,
      clientRef: clientRef === "" ? null : clientRef,
      shareCode: shareCode === "" ? null : shareCode,
    },
  };
}

function parseAddress(
  raw: unknown,
): { readonly ok: true; readonly value: CheckoutAddress } | Failure {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid("Please give us the address to send it to.");
  }
  const data = raw as Record<string, unknown>;

  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines = rawLines.map((line) => text(line)).filter((line) => line !== "");
  if (lines.length === 0) return invalid("Please give us the address to send it to.");
  if (lines.length > MAX_ADDRESS_LINES) {
    return invalid(`An address is at most ${MAX_ADDRESS_LINES} lines.`);
  }
  if (lines.some((line) => line.length > MAX_ADDRESS_LINE)) {
    return invalid(`Please keep each address line to ${MAX_ADDRESS_LINE} characters or fewer.`);
  }

  const city = text(data.city);
  if (city === "" || city.length > MAX_CITY) return invalid("Please give the town or city.");

  const state = text(data.state);
  if (state === "" || state.length > MAX_STATE) return invalid("Please give the state.");

  const pincode = text(data.pincode);
  if (!/^[1-9]\d{5}$/.test(pincode)) return invalid("Please give a six digit pincode.");

  return { ok: true, value: { lines, city, state, pincode } };
}

/* -------------------------------------------------------------------------- */
/* Choosing the batch                                                         */
/* -------------------------------------------------------------------------- */

/** One candidate batch, as the web chooser reads it. Plain values only. */
export interface CheckoutBatchCandidate {
  readonly ref: string;
  readonly batchNo: string | null;
  readonly state: string;
  readonly packedOn: string | null;
  /** Brief §6.2: after this date the jar is not sold online any more. */
  readonly saleStopOn: string | null;
  readonly createdAtMillis: number;
  readonly available: number;
}

export type CheckoutBatchChoice = { readonly ok: true; readonly ref: string } | Failure;

/**
 * Which batch a web order comes from, and it has to be the same one
 * `/api/counts` showed on the product page, or the customer is buying
 * something other than what they looked at.
 *
 * So the order is `counts`' own: in stock first, then open for booking, and
 * within each, the batch with the most jars free. It differs from the
 * counter's `chooseInStockBatch` in two ways, both on purpose. It will fall
 * through to an open batch, because on the web that is not a substitution: a
 * customer on a product page whose only live batch is open was shown the open
 * batch, its ₹599 and the promise in §7.4, and that is what the Buy control
 * said. And it refuses a batch past its sale stop outright (§6.2).
 */
export function chooseWebBatch(
  candidates: readonly CheckoutBatchCandidate[],
  productName: string,
  todayIso: string,
): CheckoutBatchChoice {
  const inStockAll = candidates.filter((c) =>
    (BATCH_STATES_IN_STOCK as readonly string[]).includes(c.state),
  );
  const inStock = inStockAll
    .filter((c) => c.saleStopOn !== null && todayIso <= c.saleStopOn)
    .sort(byMostFree);
  const open = candidates
    .filter((c) => (BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(c.state))
    .sort(byMostFree);

  const withJars = [...inStock, ...open].find((c) => c.available > 0);
  if (withJars) return { ok: true, ref: withJars.ref };

  // Nothing free anywhere. Rather than refusing here, hand back the batch
  // the customer was looking at and let the transaction say why: brief §9.3
  // distinguishes "someone is paying for the last jar, check back in 15
  // minutes" from "someone just bought the last one", and only the hold,
  // inside the transaction, knows which of the two is true. A second refusal
  // written here would eventually say something the count disagrees with.
  const anySellable = inStock[0] ?? open[0] ?? null;
  if (anySellable !== null) return { ok: true, ref: anySellable.ref };

  if (inStockAll.length > 0) {
    // Every batch there is has passed its shelf-life stop (brief §6.2).
    return fail(
      "failed-precondition",
      `This batch of ${productName} is no longer sold online. It is still sold at the door.`,
    );
  }
  return fail(
    "failed-precondition",
    `We have no ${productName} to send just now. Do check back when the next batch opens.`,
  );
}

function byMostFree(a: CheckoutBatchCandidate, b: CheckoutBatchCandidate): number {
  if (a.available !== b.available) return b.available - a.available;
  // Oldest packed first, so the jar nearest its best before moves first.
  if (a.packedOn !== null && b.packedOn !== null && a.packedOn !== b.packedOn) {
    return a.packedOn < b.packedOn ? -1 : 1;
  }
  if (a.createdAtMillis !== b.createdAtMillis) return a.createdAtMillis - b.createdAtMillis;
  return a.ref < b.ref ? -1 : 1;
}

/* -------------------------------------------------------------------------- */
/* Picking a started checkout back up                                         */
/* -------------------------------------------------------------------------- */

/** An order as the resume check reads it. Plain values, no Firestore. */
export interface StartedCheckout {
  readonly state: string;
  /** `orders.payment.status`. Empty when the order carries none. */
  readonly paymentStatus: string;
  /** `orders.payment.razorpayIds.orderId`. Empty until the gateway answered. */
  readonly razorpayOrderId: string;
  /** Null when the order holds nothing any more. */
  readonly holdExpiresAtMillis: number | null;
  /** What the stored order is actually for. All four are compared. */
  readonly productSlug: string;
  readonly qty: number;
  readonly totalPaise: number;
  readonly customerPhone: string;
  /**
   * Jars this order holds **on the batch right now**, live holds only, or
   * null when the batch no longer carries a hold under this order id. Read
   * from `batches/{ref}.heldJars` in the same transaction, never inferred
   * from the order.
   */
  readonly heldJarsForOrder: number | null;
  readonly nowMillis: number;
}

/** What the browser sent this time, as far as the resume check cares. */
export interface ResumeRequest {
  readonly productSlug: string;
  readonly qty: number;
  readonly expectedTotalPaise: number;
  readonly customerPhone: string;
}

/**
 * Why a started checkout could not be picked up, and what the page should do
 * about it. The page mints a fresh `clientRef` for every reason but
 * {@link RESUME_REASON_ALREADY_PAID}, so the customer's next tap is a new
 * checkout rather than the same refusal again.
 */
export const RESUME_LAPSED_REASON = "holdLapsed";
export const RESUME_REASON_CHANGED = "orderChanged";
export const RESUME_REASON_START_AGAIN = "startAgain";
export const RESUME_REASON_ALREADY_PAID = "alreadyPaid";

export type ResumeRefusal = Failure & {
  readonly reason: string;
  /**
   * True only when the stored hold should be handed back before the
   * customer starts again: they are the same customer, on the same batch,
   * and they have changed what they are buying.
   */
  readonly releaseStoredHold: boolean;
};

export type ResumeDecision = { readonly ok: true } | ResumeRefusal;

/**
 * Whether a checkout that has already been started may be handed back to the
 * browser to pay for, brief §6.1 step 4 and §9.3, **and whether it is still
 * the same checkout**.
 *
 * `clientRef` is minted once when the checkout page mounts and sent again by
 * every later tap of Pay, which is what makes a double tap take one hold
 * rather than two. Two things follow from that, and both were wrong.
 *
 * **A tap fifteen minutes later carries the same `clientRef` too.** The order
 * was handed straight back, with the Razorpay order id still on it and no
 * look at the jars at all, so the page opened a payment window for a hold
 * that had lapsed and a count that had already given the jars away.
 *
 * **A tap after the customer changed something carries it as well.** The
 * whole request was ignored on this path: the stored order was answered
 * whatever the browser had just asked for. Close the Razorpay window, change
 * the picker from one jar to two, tap Pay: the page said two jars and
 * ₹1,298, and the customer was charged ₹649 and sent one jar. The
 * `expectedTotalPaise` guard that exists for exactly this sits on the
 * planning path, which resume never reaches. So all four of the things that
 * decide what is being bought are compared here, the total included, and
 * anything that does not match is refused rather than answered.
 *
 * The comparison is also what stops one `clientRef` answering a different
 * customer: a guessed reference used to come back with the first customer's
 * name and phone on it. It cannot now, because the phone is compared before
 * anything is returned.
 *
 * So exactly one shape may be picked up again: the same customer, asking for
 * the same jars at the same price, on an order still **held**, with its
 * payment still `created`, a gateway order behind it, its expiry in the
 * future, **and the jars still on the batch under its own id**. Everything
 * else is a refusal.
 *
 * It refuses rather than quietly taking a fresh hold, and that is the whole
 * decision. A new hold would need a new order id, because the id is derived
 * from the `clientRef`, and once two ids can come from one `clientRef` the
 * ref has stopped deduplicating: two taps arriving together would take two
 * jars out of the count for one customer, which is the thing it was put
 * there to prevent. The page starts a fresh checkout instead.
 */
export function checkResumableCheckout(
  order: StartedCheckout,
  request: ResumeRequest,
  holdMinutes: number,
): ResumeDecision {
  // Money is on this order. Telling this customer to start again would ask
  // them to pay a second time, so this is the one refusal that does not
  // send the page off to mint a new reference. Every state here is a paid
  // order: §9.1's paid run, and the concern states, which are paid orders
  // something later went wrong with. An unrecognised state lands here too,
  // because a state this module does not know is not one it may declare
  // dead.
  if (
    MONEY_MOVED_PAYMENT_STATUSES.includes(order.paymentStatus) ||
    (!RESUMABLE_ORDER_STATES.includes(order.state) &&
      !(ORDER_STATES_TERMINAL as readonly string[]).includes(order.state))
  ) {
    return {
      ...fail(
        "failed-precondition",
        "This order is already paid for. Your bill and jar will come to you on WhatsApp.",
      ),
      reason: RESUME_REASON_ALREADY_PAID,
      releaseStoredHold: false,
    };
  }

  // Provably dead: the sweep expired it, the Owner voided it, or the gateway
  // call failed and `releaseHold` put the jars back.
  if (!RESUMABLE_ORDER_STATES.includes(order.state)) return lapsed(holdMinutes);
  // No gateway order to open: either Razorpay never answered, or this ran
  // between the hold and the write that records its id.
  if (order.razorpayOrderId === "") return lapsed(holdMinutes);
  if (order.holdExpiresAtMillis === null || order.holdExpiresAtMillis <= order.nowMillis) {
    return lapsed(holdMinutes);
  }
  // The batch itself, not the order's own word for it. Nothing in the system
  // empties `heldJars` without expiring the order, so this is a belt: if the
  // two ever disagree, the batch is the one that decides whether a jar is
  // really being held (CLAUDE.md §3, counts move only in the transaction).
  if (order.heldJarsForOrder === null || order.heldJarsForOrder < 1) return lapsed(holdMinutes);

  // Somebody else's checkout. Nothing about it is returned, not the name,
  // not the phone, not the total.
  if (order.customerPhone !== request.customerPhone) {
    return {
      ...fail("aborted", RESUME_START_AGAIN_MESSAGE),
      reason: RESUME_REASON_START_AGAIN,
      releaseStoredHold: false,
    };
  }

  // Same customer, different order. The jars they first asked for go back,
  // and their next tap buys what the page is showing now.
  if (
    order.productSlug !== request.productSlug ||
    order.qty !== request.qty ||
    order.totalPaise !== request.expectedTotalPaise ||
    order.heldJarsForOrder !== order.qty
  ) {
    return {
      ...fail("aborted", RESUME_CHANGED_MESSAGE),
      reason: RESUME_REASON_CHANGED,
      releaseStoredHold: true,
    };
  }

  return { ok: true };
}

/** The two states an order sits in while its jars are still held. Brief §9.1. */
const RESUMABLE_ORDER_STATES: readonly string[] = ["held", "awaitingPayment"];

/**
 * Payment statuses that mean money has moved. `refunded` is deliberately not
 * one of them: the money came back, so a fresh order is the right answer and
 * the page may start one.
 */
export const MONEY_MOVED_PAYMENT_STATUSES: readonly string[] = [
  "authorized",
  "captured",
  "partlyRefunded",
];

/**
 * ASSUMED (M3.5): the sentence. Nothing in the docs drafts it, and it says
 * the one thing the customer can act on. It is what a changed order reads
 * as, and a changed order is an ordinary thing to do, so it is not written
 * as an error: nothing has gone wrong, the first jars have gone back and the
 * next tap buys what the page is showing.
 */
const RESUME_CHANGED_MESSAGE =
  "You changed the order, so we put the first jars back. Please tap Pay once more.";

/**
 * ASSUMED (M3.5): the sentence for a started checkout this request cannot be
 * matched to at all. It says what to do and claims nothing about jars,
 * because in this branch nothing was released and nothing is known about
 * whose order it is.
 */
const RESUME_START_AGAIN_MESSAGE =
  "We could not pick up the payment you started. Please tap Pay once more.";

/**
 * D53 approved this sentence with "fifteen minutes" in it, which was the
 * hold at the time and is still `WEB_HOLD_MINUTES`. The hold is a setting
 * (`settings/holds.webHoldMinutes`), so the number is read in rather than
 * written down: the approved words stand exactly as approved while the
 * setting is fifteen, and stay true if Shefin ever moves it.
 */
function lapsed(holdMinutes: number): ResumeRefusal {
  return {
    ...fail(
      "aborted",
      `Your jars were kept for ${minutesInWords(holdMinutes)} and that time has passed. Please start again.`,
    ),
    reason: RESUME_LAPSED_REASON,
    releaseStoredHold: false,
  };
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;

/**
 * "fifteen minutes", "twenty five minutes", "1 minute". Spelled out because
 * the sentence D53 approved spells it out, and Lailark writes to a customer
 * in words rather than figures everywhere but a price.
 *
 * Anything that is not a whole number of minutes between 1 and 99 falls back
 * to the figure, which is worse English than the words and better English
 * than a wrong number.
 */
export function minutesInWords(minutes: number): string {
  const unit = minutes === 1 ? "minute" : "minutes";
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 99) {
    return `${minutes} ${unit}`;
  }
  if (minutes < 20) return `${ONES[minutes]} ${unit}`;
  const ten = TENS[Math.floor(minutes / 10)];
  const one = minutes % 10;
  return `${one === 0 ? ten : `${ten} ${ONES[one]}`} ${unit}`;
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

export interface CheckoutContext {
  readonly orderId: string;
  readonly batch: SaleBatchView & { readonly saleStopOn: string | null };
  readonly product: SaleProductView & {
    readonly shippingRule: ShippingRule | null;
    readonly restriction: ProductShippingRestriction;
  };
  /** Null when this number has never bought anything. */
  readonly customer: SaleCustomerView | null;
  readonly shipping: ShippingSwitch;
  readonly pincodes: PincodeList;
  /** The `policyVersions` id the checkout page showed. "" until M5.7. */
  readonly policyVersion: string;
  readonly holdMinutes: number;
  readonly nowMillis: number;
  /** `"YYYY-MM-DD"` in Asia/Kolkata, for the shelf-life stop. */
  readonly todayIso: string;
  /**
   * A freshly minted order token (M3.8), the `/o/<token>` page's whole
   * access control. Minted by the callable, never by anything a caller sends.
   */
  readonly orderToken: string;
  /**
   * A freshly minted share code, used **only** when this customer has none
   * yet. A customer who already has one keeps it: the code is what their own
   * share links carry, and a code that changed would orphan every link they
   * have already sent.
   */
  readonly freshShareCode: string;
}

export interface CheckoutPlan {
  readonly orderId: string;
  /** The `orders/{id}` body, plain values. Stamps are added by the callable. */
  readonly order: Readonly<Record<string, unknown>>;
  readonly stampFields: readonly string[];
  readonly customerPatch: Readonly<Record<string, unknown>>;
  readonly customerStampFields: readonly string[];
  readonly customerIsNew: boolean;
  readonly totals: SaleTotals;
  readonly unitPrice: Paise;
  readonly lineDescription: string;
  /** `openBatch` when the batch is still open, `product` when it is in stock. */
  readonly lineKind: "product" | "openBatch";
  /**
   * The per-person cap this order is measured against **when the Owner has
   * typed none on the batch**. D52: a typed limit governs the web in both
   * directions and is never narrowed by this. Brief §4.1 gives the blank
   * fallback: two jars on an in-stock batch, and on an open batch the
   * computed quarter, which is what the batch already answers, so nothing
   * is passed there at all.
   */
  readonly perPersonLimitFallback: number | null;
}

export type CheckoutPlanned = { readonly ok: true; readonly value: CheckoutPlan };

/**
 * Turns a parsed request and everything the transaction read into exactly
 * what will be written, or refuses with a sentence the customer can act on.
 *
 * The count itself is not touched here: the hold is
 * `batches/holds.ts`'s job, inside the transaction, and this only says what
 * cap that hold should be measured against.
 */
/**
 * Brief §6.1 step 3: "Pincode checked against serviceable list and the
 * product's shipping rule", and the three sentences a customer hears when it
 * does not pass.
 *
 * It lives on its own because a first attempt is not the only request that
 * carries an address. A resumed checkout (`planResumedContact`) carries one
 * too, and the address that lands on the order has to have been through this
 * whichever tap wrote it. Two copies of these three sentences would be two
 * copies to keep in step, and the day they drift the customer hears a
 * refusal for one reason on one tap and another on the next.
 *
 * `null` means it can go.
 */
export function checkCheckoutDelivery(args: {
  readonly address: CheckoutAddress;
  readonly productName: string;
  readonly restriction: ProductShippingRestriction;
  readonly pincodes: PincodeList;
}): Failure | null {
  const deliverable = checkDeliverable({
    pincode: args.address.pincode,
    state: args.address.state,
    list: args.pincodes,
    product: args.restriction,
  });
  if (deliverable.ok) return null;

  if (deliverable.reason === "malformed") return invalid("Please give a six digit pincode.");
  if (deliverable.reason === "notServiceable") {
    return fail(
      "failed-precondition",
      `We cannot get a parcel to ${args.address.pincode} yet. Message us on WhatsApp and we will see what we can do.`,
    );
  }
  return fail(
    "failed-precondition",
    `We cannot send ${args.productName} to ${args.address.pincode}. Message us on WhatsApp and we will see what we can do.`,
  );
}

/**
 * `orders/{id}.deliveryContact`.
 *
 * Brief §5 asks for one name and one number, so the person paying is the
 * person the parcel is addressed to. There is no second contact box on the
 * checkout to fill a different one from.
 *
 * Built in one place because both the first attempt and a resumed one write
 * it, and a parcel addressed by two slightly different builders is a parcel
 * that eventually goes to the wrong door.
 */
export function deliveryContactFrom(request: CheckoutRequest): Record<string, unknown> {
  return {
    name: request.customerName,
    phone: request.customerPhone,
    lines: request.address.lines,
    city: request.address.city,
    state: request.address.state,
    pincode: request.address.pincode,
  };
}

export function planCheckout(
  request: CheckoutRequest,
  context: CheckoutContext,
): CheckoutPlanned | Failure {
  const { batch, product } = context;

  /* ---- is this batch on sale to the web at all ----------------------- */

  const openForBooking = (BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(batch.state);
  const inStock = (BATCH_STATES_IN_STOCK as readonly string[]).includes(batch.state);
  if (!openForBooking && !inStock) {
    return fail("failed-precondition", `We have no ${product.name} to send just now.`);
  }

  if (batch.productSlug !== request.productSlug) {
    return fail("failed-precondition", "That batch is not this pickle. Please start again.");
  }

  // Brief §6.2, the shelf-life stop. The site hides Buy after it, and this
  // is the gate behind the page: a jar cannot leave here so close to its
  // best before that it arrives with less than FSSAI expects.
  if (inStock) {
    if (batch.saleStopOn === null || context.todayIso > batch.saleStopOn) {
      return fail(
        "failed-precondition",
        `This batch of ${product.name} is no longer sold online. It is still sold at the door.`,
      );
    }
  }

  /* ---- where it is going, brief §11.5 -------------------------------- */

  const refusal = checkCheckoutDelivery({
    address: request.address,
    productName: product.name,
    restriction: product.restriction,
    pincodes: context.pincodes,
  });
  if (refusal !== null) return refusal;

  /* ---- the price, brief §4.1 ----------------------------------------- */

  const lineKind: "product" | "openBatch" = openForBooking ? "openBatch" : "product";
  const unitPrice = openForBooking ? batch.priceOpen : batch.priceInStock;
  if (!isSellablePrice(lineKind, unitPrice)) {
    return fail(
      "failed-precondition",
      `We cannot take an order for ${product.name} just now. Please try again a little later.`,
    );
  }

  const ship = effectiveShippingSwitch(context.shipping, product.shippingRule);
  const totals = saleTotals({
    lines: [{ kind: lineKind, unitPrice, qty: request.qty, batchRef: batch.ref }],
    discount: 0,
    shippingFee: shippingFeeFor(ship, request.qty),
  });

  if (request.expectedTotalPaise !== totals.total) {
    // Brief §4.2 and CLAUDE.md §3: the figure the card showed is the figure
    // that is charged, or the order stops and the new one is said out loud.
    return fail(
      "aborted",
      `This now comes to ${formatINR(totals.total)}, not ${formatINR(request.expectedTotalPaise)}. Please check the page and try again.`,
    );
  }

  /* ---- the order, brief §18.1 ---------------------------------------- */

  const description = `${product.name}, ${batch.batchNo === null ? "this batch" : `batch ${batch.batchNo}`}`;
  const readable = checkCustomerText(description);
  if (!readable.ok) return invalid(readable.message);

  const order: Record<string, unknown> = {
    // The order's human name is its own reference, as a counter sale's is
    // (A94, D21c). The bill number is a different series entirely.
    number: context.orderId,
    channel: "web",
    customerPhone: request.customerPhone,
    deliveryContact: deliveryContactFrom(request),
    placeOfSupply: request.address.state,
    // Brief §9.1: the jars are held and nothing is paid yet.
    state: "held",
    lines: [
      {
        productSlug: request.productSlug,
        batchRef: batch.ref,
        qty: request.qty,
        unitPrice,
        customDescription: null,
        jarNumbers: [],
      },
    ],
    batchRefs: [batch.ref],
    shippingFee: totals.shippingFee,
    discount: null,
    total: totals.total,
    fulfilment: "ship",
    payment: {
      method: "razorpay",
      // §9.2: `created` until the webhook says otherwise. The browser's own
      // "payment succeeded" is never what moves this.
      status: "created",
      razorpayIds: {},
      markedPaidBy: null,
      upiRef: null,
      amount: 0,
      refundedAmount: 0,
    },
    shareCodeUsed: request.shareCode,
    policyVersion: context.policyVersion,
    kitchenNote: null,
    draft: false,
    soldBy: null,
    // Set by the callable from the claim it took, so the order and the
    // batch agree to the millisecond about when this jar comes back.
    holdExpiresAt: null,
    // M3.8, brief §5: the private order page, `/o/<token>`. Minted here and
    // never changed, so a link sent with the bill keeps working.
    token: context.orderToken,
    billNumber: null,
    billSentAt: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    limitOverridden: false,
    clientRef: request.clientRef,
    /** What the customer ticked, on the order as well as on the customer. */
    consents: { updates: request.consents.updates, marketing: request.consents.marketing },
  };

  const customerPatch = planCheckoutCustomerPatch(request, context);

  return {
    ok: true,
    value: {
      orderId: context.orderId,
      order,
      stampFields: ["createdAt", "updatedAt"],
      customerPatch: customerPatch.patch,
      customerStampFields: customerPatch.stampFields,
      customerIsNew: context.customer === null,
      totals,
      unitPrice,
      lineDescription: description,
      lineKind,
      // Brief §4.1 and D52: two jars per person online on an in-stock batch
      // when the Owner has typed nothing. An open batch's blank fallback is
      // the computed quarter, which the batch answers on its own.
      perPersonLimitFallback: inStock ? IN_STOCK_PER_PERSON_LIMIT : null,
    },
  };
}

/**
 * The `customers/{phone}` document this checkout writes.
 *
 * **Consent.** Both ticks come off a form the customer filled in themselves,
 * which is not the busy counter of A92: an unticked marketing box online is
 * a person who read the line and left it alone, and their answer today is
 * recorded as today's answer either way. The updates tick is always true
 * here, because `parseCheckoutRequest` refuses an order without it.
 *
 * **The jar counts are not moved here.** `stats.orders` and `stats.jars` are
 * what somebody has bought, and at this point nothing has been paid for: the
 * hold may lapse in fifteen minutes. M3.6's webhook moves them when the
 * payment is captured.
 */
function planCheckoutCustomerPatch(
  request: CheckoutRequest,
  context: CheckoutContext,
): { readonly patch: Record<string, unknown>; readonly stampFields: readonly string[] } {
  const existing = context.customer;
  const isNew = existing === null;
  const patch: Record<string, unknown> = {};
  const stampFields: string[] = ["updatedAt"];

  if (isNew) {
    patch.country = "IN";
    stampFields.push("createdAt");
  }
  // Brief §7.2 step 4: the receipt carries a share link, so the customer has
  // to have a code by the time it is written. Minted once and then left
  // alone: an existing code is what every link this person has already sent
  // carries, and replacing it would break all of them.
  if (!isShareCode(existing?.shareCode)) patch.shareCode = context.freshShareCode;
  // A name and an email typed into this checkout are the freshest the
  // customer has given us, so they correct the record. Neither ever blanks
  // it: an email left empty online is "not this time", not "delete it".
  patch.name = request.customerName;
  if (request.email !== null) patch.email = request.email;
  else if (isNew) patch.email = null;

  patch.consents = {
    updates: { given: true, atMillis: context.nowMillis, by: null },
    marketing: { given: request.consents.marketing, atMillis: context.nowMillis, by: null },
  };

  return { patch, stampFields };
}

/* -------------------------------------------------------------------------- */
/* The address on a resumed checkout (M3.5a)                                  */
/* -------------------------------------------------------------------------- */

/** The contact a started checkout already carries, as the resume path reads it. */
export interface StoredContact {
  readonly name: string;
  readonly phone: string;
  readonly lines: readonly string[];
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
  /** `orders/{id}.placeOfSupply`. */
  readonly placeOfSupply: string;
  /** `customers/{phone}.email`, which is the only place an email is kept. */
  readonly customerEmail: string | null;
  /**
   * `orders/{id}.shareCodeUsed` as the first attempt left it, or null when
   * the first tap carried no share link. M3.8, answering A194 (iv).
   */
  readonly shareCodeUsed: string | null;
}

/** What a resumed checkout changes, if anything. Empty patches mean nothing moved. */
export interface ResumedContactPlan {
  /** `orders/{id}`: the delivery contact and the place of supply, or nothing. */
  readonly orderPatch: Readonly<Record<string, unknown>>;
  /** `customers/{phone}`: the name and the email, or nothing. Never consents. */
  readonly customerPatch: Readonly<Record<string, unknown>>;
}

/**
 * M3.5a. **The address the customer typed last is the address the jar goes
 * to**, on a resumed checkout as much as on a first one.
 *
 * `clientRef` is minted once per page mount, so the tap that follows a
 * dismissed Razorpay window carries it again, and `checkResumableCheckout`
 * compares only what is being bought: the product, the jars, the total and
 * the phone. Everything else in that second request used to be dropped on
 * the floor and the stored order handed back. Close the window because the
 * house number is wrong, fix it, tap Pay: no error, and the jar went to the
 * first address. The email went the same way.
 *
 * So the contact is carried rather than refused. Correcting a typo in an
 * address is the likeliest reason anybody reopens that window, and making
 * them lose their jars and tap again for it is the worse read.
 *
 * **Carrying it cannot change what is charged.** `shippingFeeFor` never sees
 * a pincode, so no address moves the shipping line under any of the three
 * positions of the switch. `placeOfSupply` is a tax field, but `splitGst`
 * returns the total untaxed while GST is off and throws outright when it is
 * on, so no address can move a total today and none can quietly start to.
 * The total the page showed is still the total that was agreed, and this
 * writes neither it nor a count.
 *
 * **What is refused.** The new address goes through the same
 * {@link checkCheckoutDelivery} the first attempt went through, with the
 * same three sentences: a resume cannot be a way past the serviceable list
 * or a product's own shipping rule. A refusal here keeps the hold and keeps
 * the reference, because the customer's jars are not the problem and their
 * next tap, with the pincode fixed, is the same checkout going through.
 *
 * **Consents are not touched (D57).** A marketing box ticked on the second
 * attempt is not recorded here, and neither is one unticked. Consent gates
 * what may be sent to a customer later, so the record on the order stays the
 * one the customer gave on the attempt that took the hold. Nothing is
 * silently opted in, and they can tick it again later.
 */
export function planResumedContact(
  request: CheckoutRequest,
  stored: StoredContact,
  context: {
    readonly productName: string;
    readonly restriction: ProductShippingRestriction;
    readonly pincodes: PincodeList;
  },
): { readonly ok: true; readonly value: ResumedContactPlan } | Failure {
  const contact = deliveryContactFrom(request);

  const contactChanged =
    stored.name !== request.customerName ||
    stored.phone !== request.customerPhone ||
    stored.city !== request.address.city ||
    stored.state !== request.address.state ||
    stored.pincode !== request.address.pincode ||
    stored.placeOfSupply !== request.address.state ||
    !sameLines(stored.lines, request.address.lines);

  // An email left blank on the second attempt is "not this time", never
  // "delete the one you have", exactly as `planCheckoutCustomerPatch` reads
  // it on a first attempt.
  const emailChanged = request.email !== null && request.email !== stored.customerEmail;

  // M3.8, answering A194 (iv). A customer who arrived through somebody's
  // share link, dismissed the Razorpay window and tapped Pay again used to
  // have the link forgotten, because `checkResumableCheckout` compares only
  // what is being bought and everything else in the second request was
  // dropped. The code is recorded on the second tap too.
  //
  // It is written **only onto an order that carries none**. A share code is
  // an attribution, and the first one to arrive is the one that brought this
  // customer here; letting a later tap overwrite it would let a link pasted
  // over the top take the credit. It moves no total and no count: nothing in
  // the system prices an order from `shareCodeUsed`.
  const shareCodeAdded =
    stored.shareCodeUsed === null && request.shareCode !== null && request.shareCode !== "";

  const nothing = { orderPatch: {}, customerPatch: {} } as const;
  if (!contactChanged && !emailChanged && !shareCodeAdded) return { ok: true, value: nothing };

  if (contactChanged) {
    const refusal = checkCheckoutDelivery({
      address: request.address,
      productName: context.productName,
      restriction: context.restriction,
      pincodes: context.pincodes,
    });
    if (refusal !== null) return refusal;
  }

  const customerPatch: Record<string, unknown> = {};
  if (contactChanged) customerPatch.name = request.customerName;
  if (emailChanged) customerPatch.email = request.email;

  const orderPatch: Record<string, unknown> = {};
  if (contactChanged) {
    orderPatch.deliveryContact = contact;
    orderPatch.placeOfSupply = request.address.state;
  }
  if (shareCodeAdded) orderPatch.shareCodeUsed = request.shareCode;

  return { ok: true, value: { orderPatch, customerPatch } };
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, index) => line === b[index]);
}
