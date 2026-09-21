/**
 * The counter sale of brief sections 7A.1 and 7A.6, with no Firebase in it.
 *
 * Every decision `createCounterSale` makes lives here: what a request has to
 * carry, who may ask for what, which batch a jar comes from, what the line is
 * worth, whether the discount is one this role may give, what state the order
 * lands in, and what the customer document becomes. The callable does the
 * Firestore work; this module decides what that work is, so the whole of
 * 7A.1 is unit-testable without an emulator. Same shape as
 * `batches/transitions.ts` and `auth/authorise.ts`.
 *
 * The money arithmetic is never done here by hand: `saleTotals`,
 * `discountRights`, `checkDiscount` and `isSellablePrice` come from
 * `@lailark/shared`, so the Sell screen and this planner cannot disagree
 * about what the person at the counter is about to be charged.
 */

import {
  type CustomLine,
  type DiscountRights,
  discountRights,
  type FulfilmentMode,
  FULFILMENT_MODES,
  formatINR,
  checkCustomerText,
  checkDiscount,
  isBatchRef,
  isSellablePrice,
  MAX_SALE_QTY,
  MRP_PAISE,
  type Paise,
  parseIndianMobile,
  type PaymentMethod,
  type Role,
  ROLES,
  type SaleLineKind,
  SALE_LINE_KINDS,
  type SaleTotals,
  saleTotals,
  batchLabel,
  batchLabelCapitalised,
  BATCH_STATES_IN_STOCK,
  BATCH_STATES_OPEN_FOR_BOOKING,
  inSameBusinessDay,
  ORDER_STATES_TERMINAL,
} from "@lailark/shared";

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

/**
 * The three ways a counter sale can be paid that M2.8 builds.
 *
 * Brief 7A.1 step 5 lists five. `razorpayQr` (a QR for the exact amount, the
 * sale closing itself when the webhook arrives) needs the Razorpay client and
 * the webhook handler, which are M3; and "part paid" needs a balance to
 * track, which no part of the money model carries yet. Neither is built here,
 * and neither is half-built: a request naming one is refused with a line
 * saying so, rather than quietly being treated as something else.
 */
export const COUNTER_PAYMENT_METHODS = ["cash", "upiToAccount", "paymentLink"] as const;
export type CounterPaymentMethod = (typeof COUNTER_PAYMENT_METHODS)[number];

/** Brief 7A.1 step 6: the two ticks, word for word off the screen. */
export interface SaleConsents {
  /** "Happy to get the bill and updates on WhatsApp." */
  readonly updates: boolean;
  /** "Wants to hear when a new batch opens." */
  readonly marketing: boolean;
}

export interface SaleLineRequest {
  readonly kind: SaleLineKind;
  /** Required for `product` and `openBatch`; optional on a custom line. */
  readonly productSlug: string | null;
  /** D21c: the internal reference. Null lets the server suggest the batch. */
  readonly batchRef: string | null;
  readonly qty: number;
  /** Custom lines only. What the bill will read. */
  readonly customDescription: string | null;
  /** Custom lines only: the agreed amount for one unit, in paise. */
  readonly amountPaise: Paise | null;
  /** Owner only (7A.6, "price change"). Null takes the batch's own price. */
  readonly unitPricePaise: Paise | null;
}

export interface DeliveryContactRequest {
  readonly name: string;
  readonly phone: string;
  readonly lines: readonly string[];
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
}

export interface CounterSaleRequest {
  readonly customerPhone: string;
  readonly customerName: string | null;
  /**
   * The person at the counter has read the near misses and says this really
   * is a new number. False on the first attempt, which is what gives the
   * server its one chance to ask (see {@link NearMiss}).
   */
  readonly confirmNewCustomer: boolean;
  readonly line: SaleLineRequest;
  readonly discountPaise: Paise;
  readonly discountReason: string;
  readonly fulfilment: FulfilmentMode;
  readonly deliveryContact: DeliveryContactRequest | null;
  readonly paymentMethod: CounterPaymentMethod;
  /** "Optionally types the last 4 of the UPI reference" (7A.1 step 5). */
  readonly upiRef: string | null;
  readonly consents: SaleConsents;
  /**
   * What the screen told the person the sale comes to. The server refuses the
   * sale when its own total disagrees, rather than charging the difference:
   * "no surprise charges at payment" (CLAUDE.md section 3) has to be a check,
   * not an intention.
   */
  readonly expectedTotalPaise: Paise;
  readonly kitchenNote: string | null;
  /** Owner only (7A.6, "override the per-person limit"). */
  readonly overrideLimit: boolean;
  /**
   * An id the screen mints once, when this sale is begun, and sends with
   * every attempt at it. The same sale arriving twice writes one order.
   *
   * It is what stands between a customer and a double charge when a tap is
   * delivered twice, when a response is lost on a slow connection after the
   * transaction has already committed, or when M2.10 finalises an offline
   * draft more than once. A disabled button catches a human double-tap and
   * nothing else.
   *
   * Null is accepted, so an older client still works, but then nothing is
   * idempotent for that call.
   */
  readonly clientRef: string | null;
}

/** As long as a uuid, and no longer: this is an opaque key, not a note. */
const MAX_CLIENT_REF = 64;

const MAX_NAME = 80;
const MAX_REASON = 200;
const MAX_DESCRIPTION = 140;
const MAX_NOTE = 500;
const MAX_ADDRESS_LINES = 4;
const MAX_ADDRESS_LINE = 100;
const PINCODE = /^[1-9]\d{5}$/;
/** The last four digits of a UPI reference, as 7A.1 step 5 asks for. */
const UPI_REF = /^\d{4,20}$/;

/* -------------------------------------------------------------------------- */
/* Parsing: the shape check, before anything is read from Firestore           */
/* -------------------------------------------------------------------------- */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Turns the callable's `data` into a {@link CounterSaleRequest} or says
 * plainly what is wrong with it. Nothing here touches Firestore, so a
 * malformed request costs one function invocation and no reads, and no
 * transaction is ever opened for it.
 */
export function parseCounterSaleRequest(
  raw: unknown,
): { readonly ok: true; readonly value: CounterSaleRequest } | Failure {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid("createCounterSale needs an object.");
  }
  const data = raw as Record<string, unknown>;

  /* ---- customer, 7A.1 step 1 ---------------------------------------- */

  const phone = parseIndianMobile(text(data.customerPhone));
  if (!phone.ok) {
    return invalid(
      phone.reason === "notIndian"
        ? "Lailark sells to Indian mobile numbers. Please use a +91 number."
        : "That does not look like a 10 digit Indian mobile number. Please check it.",
    );
  }

  const customerName = text(data.customerName);
  if (customerName.length > MAX_NAME) {
    return invalid(`A name must be ${MAX_NAME} characters or fewer.`);
  }

  /* ---- what, 7A.1 step 2 -------------------------------------------- */

  const rawLine = data.line;
  if (typeof rawLine !== "object" || rawLine === null || Array.isArray(rawLine)) {
    return invalid("A sale needs a line: what is being sold.");
  }
  const lineData = rawLine as Record<string, unknown>;

  const kind = lineData.kind;
  if (typeof kind !== "string" || !(SALE_LINE_KINDS as readonly string[]).includes(kind)) {
    return invalid(`The line must be one of ${SALE_LINE_KINDS.join(", ")}.`);
  }
  const lineKind = kind as SaleLineKind;

  const qty = lineData.qty;
  if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > MAX_SALE_QTY) {
    return invalid(`Quantity must be a whole number from 1 to ${MAX_SALE_QTY}.`);
  }

  const productSlug = text(lineData.productSlug);
  if (lineKind !== "custom" && productSlug === "") {
    return invalid("Please choose a product.");
  }

  let batchRef: string | null = null;
  if (lineData.batchRef !== undefined && lineData.batchRef !== null && text(lineData.batchRef) !== "") {
    const given = text(lineData.batchRef);
    if (!isBatchRef(given)) {
      return invalid('The batch must be given by its reference, for example "b-7f3a2c".');
    }
    batchRef = given;
  }
  if (lineKind === "openBatch" && batchRef === null) {
    return invalid("Please choose which open batch this is booked from.");
  }

  let customDescription: string | null = null;
  let amountPaise: Paise | null = null;
  if (lineKind === "custom") {
    customDescription = text(lineData.customDescription);
    if (customDescription === "") {
      return invalid("A custom line needs a description, so the bill says what was sold.");
    }
    if (customDescription.length > MAX_DESCRIPTION) {
      return invalid(`A custom line's description must be ${MAX_DESCRIPTION} characters or fewer.`);
    }
    // It goes on the bill, which the customer reads (CLAUDE.md section 3).
    const readable = checkCustomerText(customDescription);
    if (!readable.ok) return invalid(readable.message);

    const amount = lineData.amountPaise;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1) {
      return invalid("A custom line needs an amount in whole paise.");
    }
    amountPaise = amount;
  } else if (text(lineData.customDescription) !== "") {
    return invalid("Only a custom line carries a description.");
  }

  let unitPricePaise: Paise | null = null;
  if (lineData.unitPricePaise !== undefined && lineData.unitPricePaise !== null) {
    const price = lineData.unitPricePaise;
    if (typeof price !== "number" || !Number.isSafeInteger(price) || price < 1) {
      return invalid("A price must be a whole number of paise.");
    }
    if (lineKind === "custom") {
      return invalid("A custom line carries its amount, not a unit price.");
    }
    unitPricePaise = price;
  }

  /* ---- discount, 7A.1 step 3 ---------------------------------------- */

  const discountPaise = data.discountPaise ?? 0;
  if (typeof discountPaise !== "number" || !Number.isSafeInteger(discountPaise) || discountPaise < 0) {
    return invalid("A discount must be a whole number of paise, zero or more.");
  }
  const discountReason = text(data.discountReason);
  if (discountReason.length > MAX_REASON) {
    return invalid(`A discount reason must be ${MAX_REASON} characters or fewer.`);
  }
  if (discountReason !== "") {
    // It is printed on the bill beside the money it took off.
    const readable = checkCustomerText(discountReason);
    if (!readable.ok) return invalid(readable.message);
  }

  /* ---- fulfilment, 7A.1 step 4 -------------------------------------- */

  const fulfilment = data.fulfilment;
  if (typeof fulfilment !== "string" || !(FULFILMENT_MODES as readonly string[]).includes(fulfilment)) {
    return invalid(`Fulfilment must be one of ${FULFILMENT_MODES.join(", ")}.`);
  }

  let deliveryContact: DeliveryContactRequest | null = null;
  if (fulfilment === "ship") {
    const parsed = parseDeliveryContact(data.deliveryContact);
    if (!parsed.ok) return parsed;
    deliveryContact = parsed.value;
  } else if (data.deliveryContact !== undefined && data.deliveryContact !== null) {
    return invalid("An address belongs to a shipped order only.");
  }

  /* ---- payment, 7A.1 step 5 ----------------------------------------- */

  const paymentMethod = data.paymentMethod;
  if (typeof paymentMethod !== "string") {
    return invalid("Please choose how this was paid.");
  }
  if (paymentMethod === "razorpayQr" || paymentMethod === "razorpay") {
    return fail(
      "failed-precondition",
      "Razorpay at the counter is not switched on yet. Take cash, UPI to the account, or send a payment link.",
    );
  }
  if (!(COUNTER_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    return invalid(`Payment must be one of ${COUNTER_PAYMENT_METHODS.join(", ")}.`);
  }

  let upiRef: string | null = null;
  if (data.upiRef !== undefined && data.upiRef !== null && text(data.upiRef) !== "") {
    const given = text(data.upiRef);
    if (!UPI_REF.test(given)) {
      return invalid("A UPI reference is digits only, at least the last four.");
    }
    if (paymentMethod !== "upiToAccount") {
      return invalid("A UPI reference belongs to a UPI-to-account payment.");
    }
    upiRef = given;
  }

  /* ---- consent ticks, 7A.1 step 6 ----------------------------------- */

  const rawConsents = (data.consents ?? {}) as Record<string, unknown>;
  if (typeof rawConsents !== "object" || rawConsents === null || Array.isArray(rawConsents)) {
    return invalid("The consent ticks must be an object.");
  }
  const consents: SaleConsents = {
    updates: rawConsents.updates === true,
    marketing: rawConsents.marketing === true,
  };

  /* ---- the total the person was shown -------------------------------- */

  const expectedTotalPaise = data.expectedTotalPaise;
  if (typeof expectedTotalPaise !== "number" || !Number.isSafeInteger(expectedTotalPaise) || expectedTotalPaise < 0) {
    return invalid("The sale must carry the total the screen showed, in whole paise.");
  }

  const kitchenNote = text(data.kitchenNote);
  if (kitchenNote.length > MAX_NOTE) {
    return invalid(`A note must be ${MAX_NOTE} characters or fewer.`);
  }

  const clientRef = text(data.clientRef);
  if (clientRef.length > MAX_CLIENT_REF) {
    return invalid(`clientRef must be ${MAX_CLIENT_REF} characters or fewer.`);
  }

  return {
    ok: true,
    value: {
      customerPhone: phone.e164,
      customerName: customerName === "" ? null : customerName,
      confirmNewCustomer: data.confirmNewCustomer === true,
      line: {
        kind: lineKind,
        productSlug: productSlug === "" ? null : productSlug,
        batchRef,
        qty: qty as number,
        customDescription,
        amountPaise,
        unitPricePaise,
      },
      discountPaise,
      discountReason,
      fulfilment: fulfilment as FulfilmentMode,
      deliveryContact,
      paymentMethod: paymentMethod as CounterPaymentMethod,
      upiRef,
      consents,
      expectedTotalPaise,
      kitchenNote: kitchenNote === "" ? null : kitchenNote,
      overrideLimit: data.overrideLimit === true,
      clientRef: clientRef === "" ? null : clientRef,
    },
  };
}

function parseDeliveryContact(
  raw: unknown,
): { readonly ok: true; readonly value: DeliveryContactRequest } | Failure {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid("A shipped order needs an address to ship it to.");
  }
  const data = raw as Record<string, unknown>;

  const name = text(data.name);
  if (name === "" || name.length > MAX_NAME) return invalid("Please give the name on the address.");

  const phone = parseIndianMobile(text(data.phone));
  if (!phone.ok) return invalid("Please give a 10 digit Indian mobile number for the delivery.");

  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines = rawLines.map((line) => text(line)).filter((line) => line !== "");
  if (lines.length === 0) return invalid("Please give the address itself.");
  if (lines.length > MAX_ADDRESS_LINES) {
    return invalid(`An address is at most ${MAX_ADDRESS_LINES} lines.`);
  }
  if (lines.some((line) => line.length > MAX_ADDRESS_LINE)) {
    return invalid(`Each address line must be ${MAX_ADDRESS_LINE} characters or fewer.`);
  }

  const city = text(data.city);
  const state = text(data.state);
  if (city === "") return invalid("Please give the town or city.");
  if (state === "") return invalid("Please give the state.");

  const pincode = text(data.pincode);
  if (!PINCODE.test(pincode)) return invalid("Please give a six digit pincode.");

  return { ok: true, value: { name, phone: phone.e164, lines, city, state, pincode } };
}

/* -------------------------------------------------------------------------- */
/* Choosing the batch                                                         */
/* -------------------------------------------------------------------------- */

/** One candidate batch, as the chooser reads it. Plain values only. */
export interface BatchCandidate {
  readonly ref: string;
  readonly batchNo: string | null;
  readonly state: string;
  /** `"YYYY-MM-DD"`, or null on a batch that is not bottled yet. */
  readonly packedOn: string | null;
  readonly createdAtMillis: number;
  /** Jars a sale could still take, from the shared availability helpers. */
  readonly available: number;
}

export type BatchChoice =
  | { readonly ok: true; readonly ref: string }
  | Failure;

/**
 * Brief 7A.1 step 2: "Pick a product. The system suggests the batch: **oldest
 * in-stock batch first**."
 *
 * Oldest first is not an arbitrary tie-break. Every jar has a shelf life and a
 * sale stop (brief 6.2), so the jar nearest its best before is the one that
 * has to move; selling the newest batch first is how a kitchen ends up
 * writing off the old one.
 *
 * A batch with no free jar is never suggested, so the suggestion cannot be a
 * batch the save is about to refuse. If nothing is in stock, this says so and
 * names the open batch if there is one, but it never quietly books an open
 * batch instead: that is a different price and a customer who waits, and
 * swapping one for the other without being asked is exactly the surprise
 * CLAUDE.md section 3 forbids.
 */
export function chooseInStockBatch(
  candidates: readonly BatchCandidate[],
  productName: string,
): BatchChoice {
  const inStock = candidates
    .filter((c) => (BATCH_STATES_IN_STOCK as readonly string[]).includes(c.state))
    .filter((c) => c.available > 0)
    .sort(compareOldestFirst);

  if (inStock.length > 0) return { ok: true, ref: inStock[0].ref };

  const open = candidates
    .filter((c) => (BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(c.state))
    .filter((c) => c.available > 0)
    .sort(compareOldestFirst);

  if (open.length > 0) {
    return fail(
      "failed-precondition",
      `There is no ${productName} in stock. ${batchLabelCapitalised(open[0].batchNo, open[0].ref, open[0].state)} is open, so this can be booked at the open price instead.`,
    );
  }
  return fail("failed-precondition", `There is no ${productName} to sell right now.`);
}

/** Oldest packed first; a batch with no packing date falls back to its birth. */
function compareOldestFirst(a: BatchCandidate, b: BatchCandidate): number {
  if (a.packedOn !== null && b.packedOn !== null && a.packedOn !== b.packedOn) {
    return a.packedOn < b.packedOn ? -1 : 1;
  }
  if (a.packedOn !== null && b.packedOn === null) return -1;
  if (a.packedOn === null && b.packedOn !== null) return 1;
  if (a.createdAtMillis !== b.createdAtMillis) return a.createdAtMillis - b.createdAtMillis;
  return a.ref < b.ref ? -1 : 1;
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

/** The batch the jar is coming from, as the planner reads it. */
export interface SaleBatchView {
  readonly ref: string;
  readonly batchNo: string | null;
  readonly state: string;
  readonly productSlug: string;
  readonly priceOpen: Paise;
  readonly priceInStock: Paise;
}

/** `products/{slug}` as the planner reads it. */
export interface SaleProductView {
  readonly slug: string;
  readonly name: string;
  readonly priceInStock: Paise;
  readonly priceOpen: Paise;
  /** Brief 17.8: what the kitchen may sell at the counter, at a set amount. */
  readonly customLines: readonly CustomLine[];
}

/** `customers/{phone}` as the planner reads it, or null when it is new. */
export interface SaleCustomerView {
  readonly phone: string;
  readonly name: string;
  readonly orders: number;
  readonly jars: number;
  readonly consentUpdates: boolean;
  readonly consentMarketing: boolean;
}

export interface CounterSaleContext {
  readonly caller: { readonly uid: string | null; readonly role: unknown };
  readonly orderId: string;
  /** Null on a `custom` line with no batch behind it. */
  readonly batch: SaleBatchView | null;
  /** Null when the line names no product (a bare custom line). */
  readonly product: SaleProductView | null;
  /** Null when this number has never bought anything. */
  readonly customer: SaleCustomerView | null;
  /** `settings/discountCap.kitchenCap`, D17. Null means no kitchen discount. */
  readonly kitchenDiscountCap: Paise | null;
  /** `settings/gst.homeState`, the place of supply when nothing is shipped. */
  readonly homeState: string;
  /**
   * `settings/holds.paymentLinkHoldMinutes`: how long the jars stay out of
   * the count while a payment link is unpaid (7A.1 step 5, "default 24
   * hours, editable").
   */
  readonly paymentLinkHoldMinutes: number;
  readonly nowMillis: number;
}

export interface CounterSalePlan {
  readonly orderId: string;
  /** The `orders/{id}` body, plain values. Stamps are added by the callable. */
  readonly order: Readonly<Record<string, unknown>>;
  /** Fields the callable sets to the server timestamp. */
  readonly stampFields: readonly string[];
  /** What to merge onto `customers/{phone}`, plain values. */
  readonly customerPatch: Readonly<Record<string, unknown>>;
  readonly customerStampFields: readonly string[];
  readonly customerIsNew: boolean;
  readonly totals: SaleTotals;
  readonly rights: DiscountRights;
  /** `paid` for cash and UPI; `hold` for a payment link (7A.1 step 5). */
  readonly stockMode: "hold" | "paid";
  /** Minutes a payment-link hold lasts, null when the jar is paid for. */
  readonly holdMinutes: number | null;
  readonly batchRef: string | null;
  readonly unitPrice: Paise;
  readonly lineDescription: string;
}

export type Planned = { readonly ok: true; readonly value: CounterSalePlan };

/**
 * Turns a parsed request and everything the transaction read into exactly
 * what will be written, or refuses with a line a person can act on.
 *
 * The order of the checks is the order of the screen, so a refusal points at
 * the box it came from.
 */
export function planCounterSale(
  request: CounterSaleRequest,
  context: CounterSaleContext,
): Planned | Failure {
  const { caller } = context;

  /* ---- who is asking, brief 17.12 and 7A.6 --------------------------- */

  const seller = checkSeller(caller);
  if (!seller.ok) return seller;
  const role = seller.role;

  const rights = discountRights({ role, kitchenCap: context.kitchenDiscountCap });

  if (request.overrideLimit && !rights.mayOverrideLimit) {
    return fail("permission-denied", "Only Shefin can go past a batch's per-person limit.");
  }

  /* ---- the price, brief 7A.1 step 2 and 3 ---------------------------- */

  const priced = priceLine(request, context, rights);
  if (!priced.ok) return priced;
  const { unitPrice, description } = priced;

  const totals = saleTotals({
    // The batch travels with the line so `jars` counts a custom line tied to
    // one, exactly as the void counts it back.
    lines: [
      { kind: request.line.kind, unitPrice, qty: request.line.qty, batchRef: request.line.batchRef },
    ],
    discount: request.discountPaise,
  });

  /* ---- the discount, D17 and brief 7A.6 ------------------------------ */

  const discount = checkDiscount({
    discount: request.discountPaise,
    reason: request.discountReason,
    subtotal: totals.subtotal,
    rights,
  });
  if (!discount.ok) {
    return fail("permission-denied", discountRefusal(discount.reason, rights));
  }

  /* ---- what the person was told they would pay ----------------------- */

  if (request.expectedTotalPaise !== totals.total) {
    // "No surprise charges at payment" (CLAUDE.md section 3). The price on
    // the batch has moved, or the screen is stale. Either way, the sale stops
    // and the new figure is said out loud rather than taken quietly.
    return fail(
      "aborted",
      `This now comes to ${formatINR(totals.total)}, not ${formatINR(request.expectedTotalPaise)}. Check the price with the customer and save again.`,
    );
  }

  /* ---- payment and the state it lands in, brief 7A.2 ----------------- */

  const paidNow = request.paymentMethod === "cash" || request.paymentMethod === "upiToAccount";
  const orderState = paidNow ? stateAfterPayment(request.fulfilment) : "awaitingPayment";

  /* ---- the customer, brief 7A.1 step 1 ------------------------------- */

  const customerIsNew = context.customer === null;
  if (customerIsNew) {
    if (!request.confirmNewCustomer) {
      // The callable checks the near misses before it ever gets here; this is
      // the belt to that braces, so a caller that skips the screen still has
      // to say out loud that it means to create a person.
      return fail(
        "failed-precondition",
        "This number has never bought from us. Check it, then save again to add them.",
      );
    }
    if (request.customerName === null) {
      // A number with no name is how a stranger gets created and never
      // noticed. Typing the name is the moment somebody looks at the number.
      return fail("invalid-argument", "This is a new number. Please give their name.");
    }
  }

  /* ---- the order, brief 18.1 ----------------------------------------- */

  const batchRef = context.batch?.ref ?? null;
  const order: Record<string, unknown> = {
    // ASSUMED (M2.8): the order's human name is its own reference, the way a
    // batch's is before bottling (D21c). The bill number is a different
    // series, issued from `counters` into `documents` in M2.9.
    number: context.orderId,
    channel: "counter",
    customerPhone: request.customerPhone,
    deliveryContact: request.deliveryContact,
    placeOfSupply: request.deliveryContact?.state ?? context.homeState,
    state: orderState,
    lines: [
      {
        productSlug: request.line.productSlug,
        // D21c: the reference, never the printed number, so a line written
        // against an open batch still names it after bottling.
        batchRef,
        qty: request.line.qty,
        unitPrice,
        customDescription: request.line.customDescription,
        jarNumbers: [],
      },
    ],
    batchRefs: batchRef === null ? [] : [batchRef],
    shippingFee: totals.shippingFee,
    discount:
      request.discountPaise === 0
        ? null
        : { amount: request.discountPaise, reason: request.discountReason, by: caller.uid },
    total: totals.total,
    fulfilment: request.fulfilment,
    payment: {
      method: request.paymentMethod as PaymentMethod,
      status: paidNow ? "captured" : "created",
      razorpayIds: {},
      markedPaidBy: paidNow ? caller.uid : null,
      upiRef: request.upiRef,
      amount: paidNow ? totals.total : 0,
      refundedAmount: 0,
    },
    shareCodeUsed: null,
    // ASSUMED (M2.8): a counter sale agrees to no web policy page, because
    // nobody at the door was shown one. An empty string says that plainly;
    // an online order carries the version it really agreed to.
    policyVersion: "",
    kitchenNote: request.kitchenNote,
    draft: false,
    soldBy: caller.uid,
    /** Null on a paid sale; the payment link's expiry on an unpaid one. */
    holdExpiresAt: null,
    /** M2.9 fills these in when a bill is issued and sent. */
    billNumber: null,
    billSentAt: null,
    /** The void of 7A.6 writes these; they are the record that it happened. */
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    /** 7A.6: recorded when an Owner waived the per-person limit. */
    limitOverridden: request.overrideLimit,
    /**
     * The key the screen minted for this sale. Kept on the order so a repeat
     * of the same sale can be recognised as one, rather than charged again.
     */
    clientRef: request.clientRef,
  };

  /* ---- the customer document, brief 18.1 and 17.7 -------------------- */

  const customerPatch = planCustomerPatch(request, context, totals, customerIsNew);

  return {
    ok: true,
    value: {
      orderId: context.orderId,
      order,
      stampFields: paidNow ? ["createdAt", "updatedAt", "paidAt"] : ["createdAt", "updatedAt"],
      customerPatch: customerPatch.patch,
      customerStampFields: customerPatch.stampFields,
      customerIsNew,
      totals,
      rights,
      stockMode: paidNow ? "paid" : "hold",
      holdMinutes: paidNow ? null : context.paymentLinkHoldMinutes,
      batchRef,
      unitPrice,
      lineDescription: description,
    },
  };
}

/**
 * Who may sell at all. Brief 17.12: "Counter sale at list price, payment
 * link" is Owner and Kitchen; a Viewer reads everything and sells nothing.
 *
 * Separate from {@link planCounterSale} so the callable can ask it before it
 * opens a transaction: a Viewer, or a signed-in account with no role at all,
 * should be told what is wrong with them, not told that the last jar has
 * gone.
 */
export function checkSeller(caller: {
  readonly uid: string | null;
  readonly role: unknown;
}): { readonly ok: true; readonly role: Role; readonly uid: string } | Failure {
  if (caller.uid === null) return fail("unauthenticated", "Sign in first.");
  if (typeof caller.role !== "string" || !(ROLES as readonly string[]).includes(caller.role)) {
    return fail("permission-denied", "This account has no Lailark role. Ask Shefin.");
  }
  if (caller.role === "viewer") {
    return fail("permission-denied", "A Viewer can look at everything and sell nothing.");
  }
  return { ok: true, role: caller.role as Role, uid: caller.uid };
}

/** Brief 7A.2's "Order state" row, one column per fulfilment mode. */
export function stateAfterPayment(fulfilment: FulfilmentMode): string {
  if (fulfilment === "handedOver") return "delivered";
  if (fulfilment === "collect") return "readyForCollection";
  return "toPack";
}

interface PricedLine {
  readonly ok: true;
  readonly unitPrice: Paise;
  readonly description: string;
}

/**
 * Brief 7A.1 step 2, "Price prefilled from the batch", and step 3's rights.
 *
 * A price is never typed from nothing. It comes from the batch (in stock or
 * open, whichever the batch's own state makes it), or, for a custom line,
 * from the amount the Owner set on the product. The only way a number typed
 * at the counter becomes a price is the Owner's own override, and even then
 * a standard jar stays at or below the printed MRP.
 */
function priceLine(
  request: CounterSaleRequest,
  context: CounterSaleContext,
  rights: DiscountRights,
): PricedLine | Failure {
  const { line } = request;

  if (line.kind === "custom") {
    const amount = line.amountPaise ?? 0;
    const description = line.customDescription ?? "";

    if (!rights.mayChangePrice) {
      // 7A.6: the Kitchen may sell a custom line "at an amount set by the
      // owner in Products", so hers has to be one of that product's own
      // lines, matched on both the wording and the amount. She cannot invent
      // either, and she cannot sell a custom line under no product at all.
      const offered = context.product?.customLines ?? [];
      const match = offered.find(
        (custom) => custom.description.trim() === description && custom.amountPaise === amount,
      );
      if (!match) {
        return fail(
          "permission-denied",
          offered.length === 0
            ? "The kitchen sells custom lines only at an amount Shefin has set on the product."
            : `That is not one of the custom lines set for this product. The ones set are: ${offered.map((c) => `${c.description} at ${formatINR(c.amountPaise)}`).join(", ")}.`,
        );
      }
    }

    if (!isSellablePrice("custom", amount)) {
      return invalid(`${formatINR(amount)} does not look right for one line. Please check the amount.`);
    }
    return { ok: true, unitPrice: amount, description };
  }

  const batch = context.batch;
  if (batch === null) {
    return fail("not-found", "That batch is gone. Pick the product again.");
  }

  const openForBooking = (BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(batch.state);
  const inStock = (BATCH_STATES_IN_STOCK as readonly string[]).includes(batch.state);

  if (line.kind === "openBatch" && !openForBooking) {
    return fail(
      "failed-precondition",
      `${batchLabelCapitalised(batch.batchNo, batch.ref, batch.state)} is not open for booking any more.`,
    );
  }
  if (line.kind === "product" && !inStock) {
    return fail(
      "failed-precondition",
      `${batchLabelCapitalised(batch.batchNo, batch.ref, batch.state)} has no jars in stock.`,
    );
  }

  // The batch's own price, which the Owner set when he opened it. Brief 4.1:
  // Rs 599 booked in an open batch, Rs 649 in stock.
  const listed = line.kind === "openBatch" ? batch.priceOpen : batch.priceInStock;
  if (!isSellablePrice(line.kind, listed)) {
    return fail(
      "failed-precondition",
      `${batchLabelCapitalised(batch.batchNo, batch.ref, batch.state)} has no usable price on it. Ask Shefin to set one.`,
    );
  }

  if (line.unitPricePaise === null) {
    return { ok: true, unitPrice: listed, description: describeJar(context, batch) };
  }

  if (!rights.mayChangePrice) {
    return fail("permission-denied", "Only Shefin can change a jar's price. A discount is the other way.");
  }
  if (!isSellablePrice(line.kind, line.unitPricePaise)) {
    // CLAUDE.md section 3 and 7A.1 step 3: never above the printed MRP.
    return fail(
      "permission-denied",
      `A jar is never sold above the printed MRP of ${formatINR(MRP_PAISE)}. Please enter that or less.`,
    );
  }
  return { ok: true, unitPrice: line.unitPricePaise, description: describeJar(context, batch) };
}

function describeJar(context: CounterSaleContext, batch: SaleBatchView): string {
  const name = context.product?.name ?? batch.productSlug;
  return `${name}, ${batchLabel(batch.batchNo, batch.ref, batch.state)}`;
}

function discountRefusal(reason: string, rights: DiscountRights): string {
  if (reason === "noReason") return "Please say why this discount was given.";
  if (reason === "overSubtotal") return "A discount cannot be more than the sale is worth.";
  if (reason === "overCap") {
    return rights.maxDiscount === 0
      ? "Shefin has not set a discount cap for the kitchen, so no discount can be given here."
      : `The kitchen's discount cap is ${formatINR(rights.maxDiscount ?? 0)}. Anything more is Shefin's to give.`;
  }
  return "A discount must be a whole number of rupees and paise, zero or more.";
}

/**
 * The `customers/{phone}` document this sale writes. Brief 18.1 and 17.7.
 *
 * **Consent.** A tick that is on records consent given, with today's date and
 * who ticked it. A tick that is off on a brand new customer records that they
 * were asked and said no. A tick that is off on somebody who already agreed
 * leaves what they agreed alone: an unticked box at a busy counter is "we did
 * not ask this time", not "they withdrew", and withdrawing is its own action
 * on the Customers screen (17.7, "remove from marketing"). Reading silence as
 * a withdrawal would quietly drop people off the list they asked to be on.
 *
 * ASSUMED (M2.8): the brief gives the two ticks and does not say what an
 * unticked box does to consent already on file.
 */
function planCustomerPatch(
  request: CounterSaleRequest,
  context: CounterSaleContext,
  totals: SaleTotals,
  isNew: boolean,
): { readonly patch: Record<string, unknown>; readonly stampFields: readonly string[] } {
  const existing = context.customer;
  const patch: Record<string, unknown> = {};
  const stampFields: string[] = ["updatedAt"];

  if (isNew) {
    patch.name = request.customerName ?? "";
    patch.email = null;
    patch.country = "IN";
    patch.shareCode = null;
    stampFields.push("createdAt");
  } else if (request.customerName !== null && request.customerName !== existing?.name) {
    // A name typed at the counter corrects the record; it never blanks it.
    patch.name = request.customerName;
  }

  const consents: Record<string, unknown> = {};
  // Ticked: consent given, with today's date and who ticked it. New customer:
  // whatever the box says, because they were asked for the first time.
  // Unticked on someone who already agreed: nothing, so silence at a busy
  // counter never reads as a withdrawal.
  if (request.consents.updates || isNew) {
    consents.updates = consentValue(request.consents.updates, context);
  }
  if (request.consents.marketing || isNew) {
    consents.marketing = consentValue(request.consents.marketing, context);
  }
  if (Object.keys(consents).length > 0) patch.consents = consents;

  patch.stats = {
    orders: (existing?.orders ?? 0) + 1,
    jars: (existing?.jars ?? 0) + totals.jars,
    lastOrderAtMillis: context.nowMillis,
  };

  return { patch, stampFields };
}

function consentValue(
  given: boolean,
  context: CounterSaleContext,
): { given: boolean; atMillis: number; by: string | null } {
  return { given, atMillis: context.nowMillis, by: context.caller.uid };
}

/* -------------------------------------------------------------------------- */
/* Voiding a sale entered by mistake, brief 7A.6                              */
/* -------------------------------------------------------------------------- */

/** `orders/{id}` as the void planner reads it. Plain values only. */
export interface VoidableOrderView {
  readonly id: string;
  readonly channel: string;
  readonly state: string;
  readonly customerPhone: string;
  readonly batchRef: string | null;
  readonly jars: number;
  readonly total: Paise;
  readonly paymentMethod: string;
  readonly paymentStatus: string;
  readonly createdAtMillis: number | null;
  /** Non-null once M2.9/M5 have actually sent the bill to the customer. */
  readonly billSentAtMillis: number | null;
  readonly voidedAtMillis: number | null;
}

export interface VoidContext {
  readonly caller: { readonly uid: string | null; readonly role: unknown };
  /** The customer as the transaction read them, for the stats coming back down. */
  readonly customer: SaleCustomerView | null;
  readonly nowMillis: number;
}

export interface VoidPlan {
  readonly orderPatch: Readonly<Record<string, unknown>>;
  readonly stampFields: readonly string[];
  readonly customerPatch: Readonly<Record<string, unknown>>;
  readonly customerStampFields: readonly string[];
  /** How the jars left: `paid` moves `paidCount` back, `hold` drops the key. */
  readonly stockMode: "hold" | "paid";
  readonly batchRef: string | null;
  readonly jars: number;
}

const MAX_VOID_REASON = 200;

/**
 * Whether this sale may be voided now, and what voiding it writes.
 *
 * Brief 7A.6 gives both roles "void a sale entered by mistake (**same day,
 * before the bill is sent**)", and gives the Owner alone "cancel a sale after
 * the bill is sent, by credit note". So there are exactly three gates here,
 * and each of them refuses by pointing at the thing that can still be done.
 *
 * **"Same day" is the business day, not the calendar date.** See
 * `BUSINESS_DAY_START_HOUR_IST` in `@lailark/shared`: a Lailark day runs
 * 05:00 to 05:00, so a jar sold at 23:50 is still voidable at 00:10 while the
 * counter is being tidied. Read as the calendar date, "same day" would break
 * in exactly the twenty minutes it exists for.
 *
 * **Money never moves here.** Cash and UPI at the counter were taken by hand,
 * so they are given back by hand; the order going terminal is what says the
 * sale is undone. A payment link that has actually been paid is a different
 * thing entirely, and is refused: taking money back through Razorpay is a
 * refund or a credit note, which is the Owner's (7A.6) and is M4's.
 */
export function planCounterSaleVoid(
  order: VoidableOrderView,
  reason: string,
  context: VoidContext,
): { readonly ok: true; readonly value: VoidPlan } | Failure {
  const seller = checkSeller(context.caller);
  if (!seller.ok) return seller;

  const trimmed = reason.trim();
  if (trimmed === "") {
    // A void moves money and stock. The trail has to say why, or "the count
    // went down and then up again" is all anybody can ever read back.
    return invalid("Please say why this sale is being voided.");
  }
  if (trimmed.length > MAX_VOID_REASON) {
    return invalid(`A void reason must be ${MAX_VOID_REASON} characters or fewer.`);
  }

  if (order.voidedAtMillis !== null || order.state === "voided") {
    return fail("failed-precondition", "This sale is already voided.");
  }
  if (order.channel !== "counter") {
    return fail(
      "failed-precondition",
      "Only a sale entered at the counter is voided this way. An online order is cancelled or refunded.",
    );
  }
  if ((ORDER_STATES_TERMINAL as readonly string[]).includes(order.state)) {
    return fail("failed-precondition", "This order is closed. Nothing more happens to it.");
  }

  if (order.billSentAtMillis !== null) {
    return fail(
      "failed-precondition",
      "The bill has already gone to the customer, so this cannot be voided. Shefin cancels it with a credit note.",
    );
  }

  if (order.createdAtMillis === null) {
    return fail("failed-precondition", "This sale has no time on it, so it cannot be voided.");
  }
  if (!inSameBusinessDay(order.createdAtMillis, context.nowMillis)) {
    return fail(
      "failed-precondition",
      "A sale is voided on the day it was entered. This one is from an earlier day, so Shefin cancels it with a credit note.",
    );
  }

  // A payment link that Razorpay has actually captured is money in the bank.
  if (order.paymentMethod === "paymentLink" && order.paymentStatus === "captured") {
    return fail(
      "failed-precondition",
      "This payment link has been paid, so voiding it would leave money with us and no jar owed. Shefin refunds it instead.",
    );
  }

  const stockMode: "hold" | "paid" = order.paymentStatus === "captured" ? "paid" : "hold";

  return {
    ok: true,
    value: {
      orderPatch: {
        state: "voided",
        voidedBy: seller.uid,
        voidReason: trimmed,
        // `payment` is left exactly as it was. It is the record of what
        // happened at the counter, and voiding does not make it untrue; the
        // state is what says the sale is undone, and it is what Day close
        // (7A.3) and the P&L read.
        holdExpiresAt: null,
      },
      stampFields: ["updatedAt", "voidedAt"],
      // A mistyped sale must not leave somebody's history inflated for good,
      // so the two counters come back down. Never below zero: a stat that is
      // already wrong is a thing to look at, not a thing to go negative.
      customerPatch: {
        stats: {
          orders: Math.max(0, (context.customer?.orders ?? 0) - 1),
          jars: Math.max(0, (context.customer?.jars ?? 0) - order.jars),
        },
      },
      customerStampFields: ["updatedAt"],
      stockMode,
      batchRef: order.batchRef,
      jars: order.jars,
    },
  };
}
