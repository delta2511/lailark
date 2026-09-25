/**
 * The web checkout planner, with no emulator behind it. Brief §6.1, §7.2,
 * §4.1, §4.2, §6.2 and §11.5, each as its own refusal.
 */

import { DEFAULT_PINCODE_LIST, DEFAULT_SHIPPING_SWITCH, isOrderToken } from "@lailark/shared";
import { describe, expect, it } from "vitest";

import {
  checkResumableCheckout,
  chooseWebBatch,
  minutesInWords,
  RESUME_LAPSED_REASON,
  RESUME_REASON_ALREADY_PAID,
  RESUME_REASON_CHANGED,
  RESUME_REASON_START_AGAIN,
  type CheckoutBatchCandidate,
  type CheckoutContext,
  type CheckoutRequest,
  parseCheckoutRequest,
  planCheckout,
  planResumedContact,
  type StoredContact,
} from "./checkout";

const TODAY = "2026-09-24";

function request(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    productSlug: "prawns-and-dates",
    qty: 1,
    customerName: "Asha",
    customerPhone: "9446587027",
    address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
    consents: { updates: true, marketing: false },
    expectedTotalPaise: 64_900,
    clientRef: "abc-123",
    ...over,
  };
}

function parsed(over: Partial<Record<string, unknown>> = {}): CheckoutRequest {
  const out = parseCheckoutRequest(request(over));
  if (!out.ok) throw new Error(`could not parse: ${out.message}`);
  return out.value;
}

function context(over: Partial<CheckoutContext> = {}): CheckoutContext {
  return {
    orderId: "o-7f3a2c",
    batch: {
      ref: "b-7f3a2c",
      batchNo: "001",
      state: "inStock",
      productSlug: "prawns-and-dates",
      priceOpen: 59_900,
      priceInStock: 64_900,
      saleStopOn: "2027-01-02",
    },
    product: {
      slug: "prawns-and-dates",
      name: "Prawns and dates",
      hsn: "16",
      priceInStock: 64_900,
      priceOpen: 59_900,
      customLines: [],
      shippingRule: "free",
      restriction: { allowedStates: null, excludedPincodes: null },
    },
    customer: null,
    shipping: DEFAULT_SHIPPING_SWITCH,
    pincodes: DEFAULT_PINCODE_LIST,
    policyVersion: "",
    holdMinutes: 15,
    nowMillis: Date.parse("2026-09-24T10:00:00+05:30"),
    todayIso: TODAY,
    orderToken: "0123456789abcdef0123456789abcdef",
    freshShareCode: "k3n9x2p1a7",
    ...over,
  };
}

describe("parsing what the checkout page sends, brief 5", () => {
  it("takes a name, a number, an Indian address and a pincode", () => {
    const out = parsed();
    expect(out.customerPhone).toBe("+919446587027");
    expect(out.address.pincode).toBe("673571");
    expect(out.email).toBeNull();
  });

  it("accepts an email and leaves it out when it is blank", () => {
    expect(parsed({ email: "asha@example.com" }).email).toBe("asha@example.com");
    expect(parsed({ email: "   " }).email).toBeNull();
  });

  it("refuses an order with the WhatsApp updates box unticked", () => {
    const out = parseCheckoutRequest(request({ consents: { updates: false, marketing: false } }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain("tick that box");
  });

  it("leaves the new-batch box alone, ticked or not", () => {
    expect(parsed().consents.marketing).toBe(false);
    expect(parsed({ consents: { updates: true, marketing: true } }).consents.marketing).toBe(true);
  });

  it("points a customer abroad at WhatsApp rather than at a validation error", () => {
    const out = parseCheckoutRequest(request({ customerPhone: "+14155550123" }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain("WhatsApp");
  });

  it("asks for each missing box in its own words", () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ customerName: "" }, /your name/],
      [{ address: { lines: [], city: "Kozhikode", state: "KL", pincode: "673571" } }, /address/],
      [
        { address: { lines: ["x"], city: "", state: "KL", pincode: "673571" } },
        /town or city/,
      ],
      [{ address: { lines: ["x"], city: "K", state: "", pincode: "673571" } }, /state/],
      [{ address: { lines: ["x"], city: "K", state: "KL", pincode: "12" } }, /six digit/],
      [{ qty: 0 }, /1 and 20 jars/],
      [{ qty: 99 }, /1 and 20 jars/],
    ];
    for (const [over, pattern] of cases) {
      const out = parseCheckoutRequest(request(over));
      expect(out.ok, JSON.stringify(over)).toBe(false);
      if (!out.ok) expect(out.message).toMatch(pattern);
    }
  });

  it("never puts an em dash in front of a customer", () => {
    const messages: string[] = [];
    for (const over of [{ qty: 0 }, { customerName: "" }, { customerPhone: "123" }]) {
      const out = parseCheckoutRequest(request(over));
      if (!out.ok) messages.push(out.message);
    }
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message).not.toMatch(/[—–]/);
  });
});

describe("choosing the batch, brief 6.1 and 7.2", () => {
  const base: CheckoutBatchCandidate = {
    ref: "b-aaaaaa",
    batchNo: "001",
    state: "inStock",
    packedOn: "2026-09-04",
    saleStopOn: "2027-01-02",
    createdAtMillis: 1,
    available: 4,
  };

  it("prefers an in-stock batch over an open one, as the product page does", () => {
    const out = chooseWebBatch(
      [
        { ...base, ref: "b-open", state: "open", saleStopOn: null, available: 9 },
        { ...base, ref: "b-stock" },
      ],
      "Prawns and dates",
      TODAY,
    );
    expect(out).toEqual({ ok: true, ref: "b-stock" });
  });

  it("falls through to an open batch when nothing is in stock", () => {
    const out = chooseWebBatch(
      [{ ...base, ref: "b-open", state: "open", saleStopOn: null, available: 9 }],
      "Prawns and dates",
      TODAY,
    );
    expect(out).toEqual({ ok: true, ref: "b-open" });
  });

  it("never suggests an in-stock batch past its sale stop, brief 6.2", () => {
    const out = chooseWebBatch([{ ...base, saleStopOn: "2026-01-01" }], "Prawns and dates", TODAY);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain("no longer sold online");
  });

  it("hands a batch with no jar free to the transaction, which says why", () => {
    // Brief 9.3 tells "someone is paying for the last jar" apart from
    // "someone just bought the last one", and only the hold knows which.
    const out = chooseWebBatch([{ ...base, available: 0 }], "Prawns and dates", TODAY);
    expect(out).toEqual({ ok: true, ref: "b-aaaaaa" });
  });

  it("says so plainly when there is no batch at all", () => {
    const out = chooseWebBatch([], "Prawns and dates", TODAY);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain("no Prawns and dates");
  });
});

describe("planning the order", () => {
  it("prices an in-stock jar off the batch and caps the person at two, brief 4.1", () => {
    const out = planCheckout(parsed(), context());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.unitPrice).toBe(64_900);
    expect(out.value.totals.total).toBe(64_900);
    expect(out.value.lineKind).toBe("product");
    // D52: a blank override falls back to brief 4.1's two jars.
    expect(out.value.perPersonLimitFallback).toBe(2);
    expect(out.value.order.state).toBe("held");
    expect(out.value.order.channel).toBe("web");
    expect((out.value.order.payment as Record<string, unknown>).status).toBe("created");
    // D36: no bill number is spent on a hold that may expire.
    expect(out.value.order.billNumber).toBeNull();
  });

  it("prices an open batch at its own open price and leaves the quarter alone", () => {
    const ctx = context({
      batch: { ...context().batch, state: "open", batchNo: null, saleStopOn: null },
    });
    const out = planCheckout(parsed({ expectedTotalPaise: 59_900 }), ctx);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.unitPrice).toBe(59_900);
    expect(out.value.lineKind).toBe("openBatch");
    // D52: an open batch's blank fallback is the computed quarter, which the
    // batch answers on its own, so nothing is passed.
    expect(out.value.perPersonLimitFallback).toBeNull();
    expect(out.value.lineDescription).toBe("Prawns and dates, this batch");
  });

  it("refuses rather than charging a different total, brief 4.2", () => {
    const out = planCheckout(parsed({ expectedTotalPaise: 59_900 }), context());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("aborted");
    expect(out.message).toContain("₹649");
    expect(out.message).toContain("₹599");
  });

  it("adds the shipping fee to the total when a product with no rule of its own is shipped", () => {
    const ctx = context({
      shipping: { rule: "flatFee", flatFee: 6_000, freeFromJars: 2 },
      product: { ...context().product, shippingRule: null },
    });
    const out = planCheckout(parsed({ expectedTotalPaise: 70_900 }), ctx);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.totals.shippingFee).toBe(6_000);
    expect(out.value.order.shippingFee).toBe(6_000);
  });

  it("lets the product's own rule stand once the global switch is off free", () => {
    // Every seeded product carries a rule (`seed-products.mjs` writes "free"
    // for three of the four heroes and "flatFee" for beef), so this, not the
    // null above, is what production actually runs. It is the case that
    // broke: the page could not see `shippingRule` and computed the global
    // rule for every product, so its total and this one parted company the
    // moment the switch left "free" and the order was refused (brief 4.2).
    const shipping = { rule: "freeOnTwo" as const, flatFee: 6_000, freeFromJars: 2 };

    const free = planCheckout(
      parsed({ expectedTotalPaise: 64_900 }),
      context({ shipping, product: { ...context().product, shippingRule: "free" } }),
    );
    expect(free.ok, free.ok ? "" : free.message).toBe(true);
    if (!free.ok) return;
    expect(free.value.totals.shippingFee).toBe(0);

    const charged = planCheckout(
      parsed({ expectedTotalPaise: 70_900 }),
      context({ shipping, product: { ...context().product, shippingRule: "flatFee" } }),
    );
    expect(charged.ok, charged.ok ? "" : charged.message).toBe(true);
    if (!charged.ok) return;
    expect(charged.value.totals.shippingFee).toBe(6_000);
  });

  it("charges nothing while the global switch is free, whatever the product says", () => {
    const ctx = context({ product: { ...context().product, shippingRule: "flatFee" } });
    const out = planCheckout(parsed(), ctx);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.totals.shippingFee).toBe(0);
    expect(out.value.totals.total).toBe(64_900);
  });

  it("refuses an in-stock batch past its sale stop, brief 6.2", () => {
    const ctx = context({ batch: { ...context().batch, saleStopOn: "2026-01-01" } });
    const out = planCheckout(parsed(), ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain("no longer sold online");
  });

  it("refuses a pincode the Owner's enforced list does not carry, brief 11.5", () => {
    const ctx = context({ pincodes: { serviceable: ["682001"], enforce: true } });
    const out = planCheckout(parsed(), ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain("673571");
  });

  it("refuses a product whose own rule excludes the address, brief 11.5", () => {
    const ctx = context({
      product: {
        ...context().product,
        restriction: { allowedStates: ["TN"], excludedPincodes: null },
      },
    });
    const out = planCheckout(parsed(), ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain("Prawns and dates");
  });

  it("records both consent ticks on the customer with today's date", () => {
    const out = planCheckout(parsed({ consents: { updates: true, marketing: true } }), context());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const consents = out.value.customerPatch.consents as Record<
      string,
      { given: boolean; atMillis: number }
    >;
    expect(consents.updates.given).toBe(true);
    expect(consents.marketing.given).toBe(true);
    expect(consents.marketing.atMillis).toBe(context().nowMillis);
  });

  it("does not credit the customer's jar count before a rupee has arrived", () => {
    const out = planCheckout(parsed(), context());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.customerPatch.stats).toBeUndefined();
  });

  it("addresses the parcel to the person who paid, brief 5", () => {
    const out = planCheckout(parsed(), context());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.order.deliveryContact).toMatchObject({
      name: "Asha",
      phone: "+919446587027",
      pincode: "673571",
    });
    expect(out.value.order.placeOfSupply).toBe("KL");
  });

  it("refuses a batch of some other pickle", () => {
    const ctx = context({ batch: { ...context().batch, productSlug: "koorka" } });
    const out = planCheckout(parsed(), ctx);
    expect(out.ok).toBe(false);
  });
});

describe("picking a started checkout back up, M3.5 rounds 3 and 4", () => {
  const live = {
    state: "held",
    paymentStatus: "created",
    razorpayOrderId: "order_x1",
    holdExpiresAtMillis: 1_000_000,
    productSlug: "prawns-and-dates",
    qty: 1,
    totalPaise: 64_900,
    customerPhone: "+919446587027",
    heldJarsForOrder: 1,
    nowMillis: 900_000,
  };
  const same = {
    productSlug: "prawns-and-dates",
    qty: 1,
    expectedTotalPaise: 64_900,
    customerPhone: "+919446587027",
  };
  const resume = (
    order: Partial<typeof live> = {},
    request: Partial<typeof same> = {},
    holdMinutes = 15,
  ) => checkResumableCheckout({ ...live, ...order }, { ...same, ...request }, holdMinutes);

  it("hands back a double tap on a hold that is still live", () => {
    expect(resume().ok).toBe(true);
    expect(resume({ state: "awaitingPayment" }).ok).toBe(true);
  });

  it("refuses once the hold has lapsed, rather than selling jars nobody holds", () => {
    // `clientRef` is minted once per page mount and sent by every later tap,
    // so a tab left open past fifteen minutes retried a dead hold and was
    // handed the live Razorpay order id back.
    const out = resume({ nowMillis: live.holdExpiresAtMillis + 1 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("aborted");
    expect(out.reason).toBe(RESUME_LAPSED_REASON);
    expect(out.message).toContain("that time has passed");
  });

  it("refuses on the boundary, when the expiry is this very millisecond", () => {
    const out = resume({ nowMillis: live.holdExpiresAtMillis });
    expect(out.ok).toBe(false);
  });

  it("refuses an order the sweep has already expired", () => {
    expect(resume({ state: "expired", holdExpiresAtMillis: null }).ok).toBe(false);
  });

  it("refuses the order a failed gateway call already released", () => {
    const out = resume({ state: "expired" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain("Please start again");
  });

  it("refuses when there is no gateway order to open at all", () => {
    expect(resume({ razorpayOrderId: "" }).ok).toBe(false);
  });

  it("treats a hold with no expiry on it as no hold", () => {
    expect(resume({ holdExpiresAtMillis: null }).ok).toBe(false);
  });

  /* ---- round 4: the request is compared, not just the order ---------- */

  it("refuses a changed jar count instead of charging for the first one", () => {
    // The overcharge. The page said two jars and ₹1,298; the stored order
    // was one jar at ₹649, and that was what came back to be paid. Close the
    // Razorpay window, change the picker, tap Pay: no race, no tooling.
    const out = resume({}, { qty: 2, expectedTotalPaise: 129_800 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe(RESUME_REASON_CHANGED);
    // The jars go back, so the customer's own hold does not then refuse the
    // order the page is showing them.
    expect(out.releaseStoredHold).toBe(true);
    expect(out.message).toContain("put the first jars back");
  });

  it("refuses a total that has moved even when the jar count has not", () => {
    // The batch's price changed between the two taps (D40).
    const out = resume({}, { expectedTotalPaise: 59_900 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe(RESUME_REASON_CHANGED);
  });

  it("refuses a different pickle on the same reference", () => {
    const out = resume({}, { productSlug: "squid-and-dates" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe(RESUME_REASON_CHANGED);
  });

  it("tells a different phone nothing at all, and releases nothing", () => {
    // A guessed reference used to come back with the first customer's name
    // and phone on it. It is refused before anything is read out, and no
    // hold of theirs is touched.
    const out = resume({}, { customerPhone: "+919000009999" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe(RESUME_REASON_START_AGAIN);
    expect(out.releaseStoredHold).toBe(false);
    expect(out.message).not.toContain("jars");
  });

  it("believes the batch, not the order, about whether jars are held", () => {
    // Residual: an order left `held` with a future expiry over an empty
    // `heldJars`. Nothing reaches it today, because the sweep expires the
    // order in the same transaction that takes the jars.
    expect(resume({ heldJarsForOrder: null }).ok).toBe(false);
    expect(resume({ heldJarsForOrder: 0 }).ok).toBe(false);
  });

  it("refuses when the batch holds a different number of jars than the order says", () => {
    const out = resume({ heldJarsForOrder: 2 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe(RESUME_REASON_CHANGED);
  });

  /* ---- round 4: money on the order is never called a lapsed hold ----- */

  it("does not ask a customer who has already paid to start again", () => {
    for (const paymentStatus of ["authorized", "captured", "partlyRefunded"]) {
      const out = resume({ paymentStatus });
      expect(out.ok, paymentStatus).toBe(false);
      if (out.ok) return;
      expect(out.code).toBe("failed-precondition");
      expect(out.reason).toBe(RESUME_REASON_ALREADY_PAID);
      expect(out.message).toContain("already paid for");
    }
  });

  it("calls a paid order paid even when its payment map is missing", () => {
    // The shape that made this dangerous: the state alone said paid, the
    // payment status was empty, and the refusal came back as a lapsed hold.
    // The page then minted a fresh reference and the next tap took another
    // jar for an order already paid for.
    for (const state of ["paidWaiting", "toPack", "packed", "shipped", "delivered"]) {
      const out = resume({ state, paymentStatus: "" });
      expect(out.ok, state).toBe(false);
      if (out.ok) return;
      expect(out.reason, state).toBe(RESUME_REASON_ALREADY_PAID);
    }
  });

  it("does not offer a fresh start on a state it does not recognise", () => {
    const out = resume({ state: "somethingNew", paymentStatus: "" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe(RESUME_REASON_ALREADY_PAID);
  });

  it("lets a refunded order be started again, because the money came back", () => {
    const out = resume({ paymentStatus: "refunded", state: "expired" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).not.toBe(RESUME_REASON_ALREADY_PAID);
  });

  it("takes an empty payment status on a held order as the permissive case", () => {
    // An order written before the payment map existed is still resumable:
    // nothing says money has moved on it.
    expect(resume({ paymentStatus: "" }).ok).toBe(true);
  });

  it("reads the hold out of settings rather than writing fifteen into the sentence", () => {
    expect(resume({ state: "expired" }, {}, 15).ok).toBe(false);
    const fifteen = resume({ state: "expired" }, {}, 15);
    const twenty = resume({ state: "expired" }, {}, 20);
    if (fifteen.ok || twenty.ok) return;
    // D53 approved the sentence with the words in it, and the words stand.
    expect(fifteen.message).toBe(
      "Your jars were kept for fifteen minutes and that time has passed. Please start again.",
    );
    expect(twenty.message).toContain("twenty minutes");
  });
});

describe("the address on a resumed checkout, M3.5a", () => {
  const stored: StoredContact = {
    name: "Asha",
    phone: "+919446587027",
    lines: ["12 Mill Road"],
    city: "Kozhikode",
    state: "KL",
    pincode: "673571",
    placeOfSupply: "KL",
    customerEmail: null,
    shareCodeUsed: null,
  };
  const ctx = {
    productName: "Prawns and dates",
    restriction: { allowedStates: null, excludedPincodes: null },
    pincodes: DEFAULT_PINCODE_LIST,
  };
  const corrected = {
    customerName: "Asha Menon",
    address: { lines: ["99 New Street"], city: "Kannur", state: "KL", pincode: "670001" },
  };

  it("writes nothing when the second tap carries the same contact", () => {
    const out = planResumedContact(parsed(), stored, ctx);
    if (!out.ok) throw new Error(out.message);
    expect(out.value.orderPatch).toEqual({});
    expect(out.value.customerPatch).toEqual({});
  });

  it("carries a corrected address and name onto the order", () => {
    const out = planResumedContact(parsed(corrected), stored, ctx);
    if (!out.ok) throw new Error(out.message);
    expect(out.value.orderPatch.deliveryContact).toEqual({
      name: "Asha Menon",
      phone: "+919446587027",
      lines: ["99 New Street"],
      city: "Kannur",
      state: "KL",
      pincode: "670001",
    });
    expect(out.value.orderPatch.placeOfSupply).toBe("KL");
    expect(out.value.customerPatch).toEqual({ name: "Asha Menon" });
  });

  it("carries the place of supply when only the state was corrected", () => {
    const out = planResumedContact(
      parsed({ address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "TN", pincode: "673571" } }),
      stored,
      ctx,
    );
    if (!out.ok) throw new Error(out.message);
    expect(out.value.orderPatch.placeOfSupply).toBe("TN");
  });

  it("carries an email added on the second tap, and never blanks the one we hold", () => {
    const added = planResumedContact(parsed({ email: "asha@example.com" }), stored, ctx);
    if (!added.ok) throw new Error(added.message);
    expect(added.value.customerPatch).toEqual({ email: "asha@example.com" });
    expect(added.value.orderPatch).toEqual({});

    const blanked = planResumedContact(parsed(), { ...stored, customerEmail: "asha@example.com" }, ctx);
    if (!blanked.ok) throw new Error(blanked.message);
    expect(blanked.value.customerPatch).toEqual({});
  });

  it("refuses a corrected address the list does not cover, in the same words as a first attempt", () => {
    const out = planResumedContact(parsed(corrected), stored, {
      ...ctx,
      pincodes: { serviceable: ["673571"], enforce: true },
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toBe(
      "We cannot get a parcel to 670001 yet. Message us on WhatsApp and we will see what we can do.",
    );
    // Byte for byte what `planCheckout` refuses a first attempt with.
    const first = planCheckout(
      parsed(corrected),
      context({ pincodes: { serviceable: ["673571"], enforce: true } }),
    );
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.message).toBe(out.message);
  });

  it("refuses a corrected address the product itself is not sent to", () => {
    const out = planResumedContact(parsed(corrected), stored, {
      ...ctx,
      restriction: { allowedStates: null, excludedPincodes: ["670001"] },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("We cannot send Prawns and dates to 670001");
  });
});

describe("the private order link and the share code, M3.8", () => {
  it("puts the minted token on the order and nothing a caller sent", () => {
    const out = planCheckout(parsed(), context());
    if (!out.ok) throw new Error(out.message);
    expect(out.value.order.token).toBe("0123456789abcdef0123456789abcdef");
    expect(isOrderToken(out.value.order.token)).toBe(true);
  });

  it("records the share code the link carried", () => {
    const out = planCheckout(parsed({ shareCode: "k3n9x2p1a7" }), context());
    if (!out.ok) throw new Error(out.message);
    expect(out.value.order.shareCodeUsed).toBe("k3n9x2p1a7");
  });

  it("drops a share code that is not one, and still sells the jar (A205)", () => {
    // `createCheckout` is public and unauthenticated (App Check is M5.9), so
    // `shareCode` is whatever a caller puts on the query string. It is
    // attribution and nothing else, so anything that is not a share code is
    // dropped and the sale goes through: refusing would lose a paying
    // customer over a URL parameter they never typed.
    for (const rubbish of [
      "<img src=x onerror=alert(1)>",
      "<script>alert(1)</script>xx",
      "UPPERCASE",
      "has space",
      "abc", // three characters: under the four `isShareCode` wants
      "x".repeat(33),
      "../../etc/passwd",
      "k3n9x2p1a7 and more",
    ]) {
      const out = parseCheckoutRequest(request({ shareCode: rubbish }));
      expect(out.ok, `refused ${JSON.stringify(rubbish)}`).toBe(true);
      if (!out.ok) continue;
      expect(out.value.shareCode, `kept ${JSON.stringify(rubbish)}`).toBeNull();

      const planned = planCheckout(out.value, context());
      if (!planned.ok) throw new Error(planned.message);
      expect(planned.value.order.shareCodeUsed).toBeNull();
    }
  });

  it("drops rubbish on the resume door too, A194 (iv)", () => {
    const stored: StoredContact = {
      name: "Asha",
      phone: "+919446587027",
      lines: ["12 Mill Road"],
      city: "Kozhikode",
      state: "KL",
      pincode: "673571",
      placeOfSupply: "KL",
      customerEmail: null,
      shareCodeUsed: null,
    };
    const out = parseCheckoutRequest(request({ shareCode: "<script>alert(1)</script>xx" }));
    if (!out.ok) throw new Error(out.message);
    const plan = planResumedContact(out.value, stored, {
      productName: "Prawns and dates",
      restriction: { allowedStates: null, excludedPincodes: null },
      pincodes: DEFAULT_PINCODE_LIST,
    });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.value.orderPatch).toEqual({});
  });

  it("mints a share code for a customer who has none", () => {
    const out = planCheckout(parsed(), context());
    if (!out.ok) throw new Error(out.message);
    expect(out.value.customerPatch.shareCode).toBe("k3n9x2p1a7");
  });

  it("leaves an existing share code alone, so their links keep working", () => {
    const out = planCheckout(
      parsed(),
      context({
        customer: {
          phone: "+919446587027",
          name: "Asha",
          email: null,
          orders: 1,
          jars: 1,
          consentUpdates: true,
          consentMarketing: false,
          shareCode: "alreadyhere",
        },
      }),
    );
    if (!out.ok) throw new Error(out.message);
    expect(out.value.customerPatch.shareCode).toBeUndefined();
  });
});

describe("the share link on a resumed checkout, M3.8 (A194 iv)", () => {
  const stored: StoredContact = {
    name: "Asha",
    phone: "+919446587027",
    lines: ["12 Mill Road"],
    city: "Kozhikode",
    state: "KL",
    pincode: "673571",
    placeOfSupply: "KL",
    customerEmail: null,
    shareCodeUsed: null,
  };
  const ctx = {
    productName: "Prawns and dates",
    restriction: { allowedStates: null, excludedPincodes: null },
    pincodes: DEFAULT_PINCODE_LIST,
  };

  it("records a share code the first tap did not carry", () => {
    const out = planResumedContact(parsed({ shareCode: "k3n9x2p1a7" }), stored, ctx);
    if (!out.ok) throw new Error(out.message);
    expect(out.value.orderPatch).toEqual({ shareCodeUsed: "k3n9x2p1a7" });
    // Attribution only: nothing here may move a total or a count.
    expect(Object.keys(out.value.orderPatch)).not.toContain("total");
    expect(Object.keys(out.value.orderPatch)).not.toContain("lines");
    expect(Object.keys(out.value.orderPatch)).not.toContain("shippingFee");
    expect(out.value.customerPatch).toEqual({});
  });

  it("never overwrites the code the first tap already recorded", () => {
    const out = planResumedContact(parsed({ shareCode: "second0000" }), {
      ...stored,
      shareCodeUsed: "first00000",
    }, ctx);
    if (!out.ok) throw new Error(out.message);
    expect(out.value.orderPatch).toEqual({});
  });

  it("writes nothing when neither tap carried one", () => {
    const out = planResumedContact(parsed(), stored, ctx);
    if (!out.ok) throw new Error(out.message);
    expect(out.value.orderPatch).toEqual({});
  });

  it("carries the code alongside a corrected address", () => {
    const out = planResumedContact(
      parsed({
        shareCode: "k3n9x2p1a7",
        address: { lines: ["99 New Street"], city: "Kannur", state: "KL", pincode: "673571" },
      }),
      stored,
      ctx,
    );
    if (!out.ok) throw new Error(out.message);
    expect(out.value.orderPatch.shareCodeUsed).toBe("k3n9x2p1a7");
    expect(out.value.orderPatch.placeOfSupply).toBe("KL");
  });

  it("refuses an undeliverable corrected address even with a share code on it", () => {
    const out = planResumedContact(
      parsed({
        shareCode: "k3n9x2p1a7",
        address: { lines: ["99 New Street"], city: "Kannur", state: "KL", pincode: "670001" },
      }),
      stored,
      { ...ctx, pincodes: { serviceable: ["673571"], enforce: true } },
    );
    expect(out.ok).toBe(false);
  });
});

describe("a number of minutes in words", () => {
  it("spells out the ones a shop would actually set", () => {
    expect(minutesInWords(15)).toBe("fifteen minutes");
    expect(minutesInWords(1)).toBe("one minute");
    expect(minutesInWords(10)).toBe("ten minutes");
    expect(minutesInWords(20)).toBe("twenty minutes");
    expect(minutesInWords(25)).toBe("twenty five minutes");
    expect(minutesInWords(30)).toBe("thirty minutes");
    expect(minutesInWords(45)).toBe("forty five minutes");
    expect(minutesInWords(60)).toBe("sixty minutes");
  });

  it("falls back to the figure rather than to a wrong number", () => {
    expect(minutesInWords(120)).toBe("120 minutes");
    expect(minutesInWords(1.5)).toBe("1.5 minutes");
  });
});
