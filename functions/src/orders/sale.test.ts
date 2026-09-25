/**
 * The counter sale planner, with no emulator: brief 7A.1 step by step, and
 * every row of 7A.6's rights table.
 */

import { MRP_PAISE, PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE } from "@lailark/shared";
import { describe, expect, it } from "vitest";

import {
  type BatchCandidate,
  chooseInStockBatch,
  type CounterSaleContext,
  parseCounterSaleRequest,
  planCounterSale,
  planCounterSaleVoid,
  stateAfterPayment,
  type VoidableOrderView,
} from "./sale";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const PHONE = "+919446587027";
const OWNER = { uid: "uid-owner", role: "owner" };
const KITCHEN = { uid: "uid-kitchen", role: "kitchen" };

function rawSale(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerPhone: "9446587027",
    customerName: "Asha",
    confirmNewCustomer: false,
    line: { kind: "product", productSlug: "prawns-pickle", batchRef: "b-7f3a2c", qty: 1 },
    discountPaise: 0,
    discountReason: "",
    fulfilment: "handedOver",
    paymentMethod: "cash",
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    ...overrides,
  };
}

function parsed(overrides: Record<string, unknown> = {}) {
  const out = parseCounterSaleRequest(rawSale(overrides));
  if (!out.ok) throw new Error(`fixture did not parse: ${out.message}`);
  return out.value;
}

function context(overrides: Partial<CounterSaleContext> = {}): CounterSaleContext {
  return {
    caller: KITCHEN,
    orderId: "o-abc123",
    orderToken: "0123456789abcdef0123456789abcdef",
    freshShareCode: "k3n9x2p1a7",
    batch: {
      ref: "b-7f3a2c",
      batchNo: "001",
      state: "inStock",
      productSlug: "prawns-pickle",
      priceOpen: PRICE_OPEN_PAISE,
      priceInStock: PRICE_IN_STOCK_PAISE,
    },
    product: {
      slug: "prawns-pickle",
      name: "Prawns and dates",
      priceInStock: PRICE_IN_STOCK_PAISE,
      priceOpen: PRICE_OPEN_PAISE,
      customLines: [{ description: "Tasting pot", amountPaise: 15_000 }],
    },
    customer: {
      phone: PHONE,
      name: "Asha",
      orders: 2,
      jars: 3,
      consentUpdates: false,
      consentMarketing: false,
      shareCode: "alreadyhere",
    },
    kitchenDiscountCap: null,
    homeState: "KL",
    paymentLinkHoldMinutes: 1440,
    nowMillis: Date.UTC(2026, 8, 21, 12, 0),
    ...overrides,
  };
}

function plan(requestOverrides: Record<string, unknown> = {}, ctx: Partial<CounterSaleContext> = {}) {
  return planCounterSale(parsed(requestOverrides), context(ctx));
}

function mustPlan(requestOverrides: Record<string, unknown> = {}, ctx: Partial<CounterSaleContext> = {}) {
  const out = plan(requestOverrides, ctx);
  if (!out.ok) throw new Error(`plan refused: ${out.message}`);
  return out.value;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

describe("parseCounterSaleRequest", () => {
  it("normalises the number to the one spelling that is the customer's id", () => {
    for (const typed of ["9446587027", "+91 94465 87027", "094465-87027"]) {
      expect(parsed({ customerPhone: typed }).customerPhone).toBe(PHONE);
    }
  });

  it("refuses a number that is not an Indian mobile", () => {
    const out = parseCounterSaleRequest(rawSale({ customerPhone: "12345" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/10 digit Indian mobile/);
  });

  it("refuses a quantity that is not a whole jar", () => {
    for (const qty of [0, -1, 1.5, "2"]) {
      const out = parseCounterSaleRequest(
        rawSale({ line: { kind: "product", productSlug: "p", batchRef: null, qty } }),
      );
      expect(out.ok, String(qty)).toBe(false);
    }
  });

  it("refuses a custom line with no description or no amount", () => {
    expect(
      parseCounterSaleRequest(rawSale({ line: { kind: "custom", qty: 1, amountPaise: 15_000 } })).ok,
    ).toBe(false);
    expect(
      parseCounterSaleRequest(
        rawSale({ line: { kind: "custom", qty: 1, customDescription: "Gift set" } }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a long dash in anything the customer will read on the bill", () => {
    const dashed = parseCounterSaleRequest(
      rawSale({
        line: { kind: "custom", qty: 1, customDescription: "Gift set — three jars", amountPaise: 150_000 },
      }),
    );
    expect(dashed.ok).toBe(false);
    const reason = parseCounterSaleRequest(rawSale({ discountPaise: 100, discountReason: "friend — of the house" }));
    expect(reason.ok).toBe(false);
  });

  it("refuses a fractional amount: money is whole paise", () => {
    expect(
      parseCounterSaleRequest(
        rawSale({ line: { kind: "custom", qty: 1, customDescription: "Pot", amountPaise: 150.5 } }),
      ).ok,
    ).toBe(false);
    expect(parseCounterSaleRequest(rawSale({ discountPaise: 10.5 })).ok).toBe(false);
  });

  it("says plainly that Razorpay at the counter is not built yet", () => {
    const out = parseCounterSaleRequest(rawSale({ paymentMethod: "razorpayQr" }));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("failed-precondition");
      expect(out.message).toMatch(/not switched on yet/);
    }
  });

  it("insists on an address for a shipped order", () => {
    const out = parseCounterSaleRequest(rawSale({ fulfilment: "ship" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/address/);
  });

  it("takes a full address for a shipped order", () => {
    const out = parseCounterSaleRequest(
      rawSale({
        fulfilment: "ship",
        deliveryContact: {
          name: "Asha",
          phone: "9446587027",
          lines: ["12 Mill Road", ""],
          city: "Kozhikode",
          state: "KL",
          pincode: "673571",
        },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.deliveryContact?.lines).toEqual(["12 Mill Road"]);
  });

  it("refuses a UPI reference on a cash sale", () => {
    expect(parseCounterSaleRequest(rawSale({ upiRef: "1234" })).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Who may sell, brief 17.12 and 7A.6                                         */
/* -------------------------------------------------------------------------- */

describe("who may sell", () => {
  it("refuses a Viewer", () => {
    const out = plan({}, { caller: { uid: "uid-viewer", role: "viewer" } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("permission-denied");
  });

  it("refuses an account with no role", () => {
    const out = plan({}, { caller: { uid: "uid-x", role: undefined } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("permission-denied");
  });

  it("refuses nobody at all", () => {
    const out = plan({}, { caller: { uid: null, role: "owner" } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("unauthenticated");
  });

  it("lets the Kitchen sell a jar for cash at list price", () => {
    const out = mustPlan();
    expect(out.totals.total).toBe(PRICE_IN_STOCK_PAISE);
    expect(out.order.state).toBe("delivered");
    expect(out.stockMode).toBe("paid");
  });
});

/* -------------------------------------------------------------------------- */
/* Price, brief 7A.1 step 2 and 3                                             */
/* -------------------------------------------------------------------------- */

describe("the price", () => {
  it("is prefilled from the batch, never from the request", () => {
    const out = mustPlan();
    expect(out.unitPrice).toBe(PRICE_IN_STOCK_PAISE);
  });

  it("is the open price on an open batch, and the total follows", () => {
    const out = mustPlan(
      {
        line: { kind: "openBatch", productSlug: "prawns-pickle", batchRef: "b-7f3a2c", qty: 2 },
        expectedTotalPaise: PRICE_OPEN_PAISE * 2,
      },
      { batch: { ref: "b-7f3a2c", batchNo: null, state: "open", productSlug: "prawns-pickle", priceOpen: PRICE_OPEN_PAISE, priceInStock: PRICE_IN_STOCK_PAISE } },
    );
    expect(out.unitPrice).toBe(PRICE_OPEN_PAISE);
    expect(out.totals.total).toBe(119_800);
  });

  it("refuses an open-batch line against a batch that is no longer open", () => {
    const out = plan({
      line: { kind: "openBatch", productSlug: "prawns-pickle", batchRef: "b-7f3a2c", qty: 1 },
      expectedTotalPaise: PRICE_OPEN_PAISE,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/not open for booking/);
  });

  it("lets only the Owner set a price by hand (7A.6)", () => {
    const asKitchen = plan({
      line: { kind: "product", productSlug: "prawns-pickle", batchRef: "b-7f3a2c", qty: 1, unitPricePaise: 60_000 },
      expectedTotalPaise: 60_000,
    });
    expect(asKitchen.ok).toBe(false);
    if (!asKitchen.ok) expect(asKitchen.code).toBe("permission-denied");

    const asOwner = mustPlan(
      {
        line: { kind: "product", productSlug: "prawns-pickle", batchRef: "b-7f3a2c", qty: 1, unitPricePaise: 60_000 },
        expectedTotalPaise: 60_000,
      },
      { caller: OWNER },
    );
    expect(asOwner.unitPrice).toBe(60_000);
  });

  it("never lets even the Owner sell a jar above the printed MRP", () => {
    const out = plan(
      {
        line: { kind: "product", productSlug: "prawns-pickle", batchRef: "b-7f3a2c", qty: 1, unitPricePaise: MRP_PAISE + 1 },
        expectedTotalPaise: MRP_PAISE + 1,
      },
      { caller: OWNER },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/never sold above the printed MRP/);
  });
});

/* -------------------------------------------------------------------------- */
/* The custom line, brief 7A.1 step 2 and 7A.6                                */
/* -------------------------------------------------------------------------- */

describe("a custom line", () => {
  const tastingPot = {
    line: { kind: "custom", productSlug: "prawns-pickle", batchRef: null, qty: 1, customDescription: "Tasting pot", amountPaise: 15_000 },
    expectedTotalPaise: 15_000,
  };

  it("lets the Kitchen sell one the Owner set on the product", () => {
    const out = mustPlan(tastingPot);
    expect(out.unitPrice).toBe(15_000);
    expect(out.totals.jars).toBe(0);
  });

  it("refuses the Kitchen a wording the Owner never set", () => {
    const out = plan({
      ...tastingPot,
      line: { ...tastingPot.line, customDescription: "Anything I like" },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("permission-denied");
  });

  it("refuses the Kitchen an amount the Owner never set, even with his wording", () => {
    const out = plan({
      line: { ...tastingPot.line, amountPaise: 5_000 },
      expectedTotalPaise: 5_000,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("permission-denied");
  });

  it("refuses the Kitchen any custom line on a product with none set", () => {
    const out = plan(tastingPot, {
      product: { slug: "prawns-pickle", name: "Prawns and dates", priceInStock: PRICE_IN_STOCK_PAISE, priceOpen: PRICE_OPEN_PAISE, customLines: [] },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/only at an amount Shefin has set/);
  });

  it("lets the Owner name his own amount, above one jar's MRP", () => {
    const out = mustPlan(
      {
        line: { kind: "custom", productSlug: null, batchRef: null, qty: 1, customDescription: "Gift set, three jars", amountPaise: 180_000 },
        expectedTotalPaise: 180_000,
      },
      { caller: OWNER, batch: null, product: null },
    );
    expect(out.unitPrice).toBe(180_000);
    expect(out.batchRef).toBeNull();
  });

  it("still takes jars from the count when it is tied to a batch", () => {
    const out = mustPlan(
      {
        line: { kind: "custom", productSlug: "prawns-pickle", batchRef: "b-7f3a2c", qty: 2, customDescription: "Tasting pot", amountPaise: 15_000 },
        expectedTotalPaise: 30_000,
      },
    );
    expect(out.batchRef).toBe("b-7f3a2c");
    expect(out.order.batchRefs).toEqual(["b-7f3a2c"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Discount rights, D17 and brief 7A.6                                        */
/* -------------------------------------------------------------------------- */

describe("the discount cap, decision D17", () => {
  const discounted = { discountPaise: 5_000, discountReason: "regular", expectedTotalPaise: PRICE_IN_STOCK_PAISE - 5_000 };

  it("gives the Kitchen no discount at all while the cap is unset", () => {
    const out = plan(discounted, { kitchenDiscountCap: null });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("permission-denied");
      expect(out.message).toMatch(/has not set a discount cap/);
    }
  });

  it("lets the Kitchen go up to the cap the Owner set", () => {
    const out = mustPlan(discounted, { kitchenDiscountCap: 5_000 });
    expect(out.totals.total).toBe(PRICE_IN_STOCK_PAISE - 5_000);
    expect(out.order.discount).toEqual({ amount: 5_000, reason: "regular", by: "uid-kitchen" });
  });

  it("stops the Kitchen one paisa past the cap, whatever the request says", () => {
    const out = plan(
      { discountPaise: 5_001, discountReason: "regular", expectedTotalPaise: PRICE_IN_STOCK_PAISE - 5_001 },
      { kitchenDiscountCap: 5_000 },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/discount cap is/);
  });

  it("lets the Owner give any discount, with a reason", () => {
    const out = mustPlan(
      { discountPaise: 30_000, discountReason: "family", expectedTotalPaise: PRICE_IN_STOCK_PAISE - 30_000 },
      { caller: OWNER, kitchenDiscountCap: null },
    );
    expect(out.totals.discount).toBe(30_000);
  });

  it("insists on a reason from the Owner too", () => {
    const out = plan(
      { discountPaise: 30_000, discountReason: "", expectedTotalPaise: PRICE_IN_STOCK_PAISE - 30_000 },
      { caller: OWNER },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/say why/);
  });

  it("records no discount block at all when nothing was taken off", () => {
    expect(mustPlan().order.discount).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* No surprise charges                                                        */
/* -------------------------------------------------------------------------- */

describe("what the person was told they would pay", () => {
  it("refuses the sale rather than charging a different number", () => {
    const out = plan({ expectedTotalPaise: 50_000 });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("aborted");
      expect(out.message).toMatch(/This now comes to ₹649, not ₹500/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Fulfilment and payment, brief 7A.1 steps 4 and 5, and 7A.2                 */
/* -------------------------------------------------------------------------- */

describe("fulfilment and payment", () => {
  it("lands in the state brief 7A.2 gives each fulfilment", () => {
    expect(stateAfterPayment("handedOver")).toBe("delivered");
    expect(stateAfterPayment("collect")).toBe("readyForCollection");
    expect(stateAfterPayment("ship")).toBe("toPack");
  });

  it("marks cash paid on save", () => {
    const out = mustPlan();
    const payment = out.order.payment as Record<string, unknown>;
    expect(payment.status).toBe("captured");
    expect(payment.markedPaidBy).toBe("uid-kitchen");
    expect(payment.amount).toBe(PRICE_IN_STOCK_PAISE);
    expect(out.stockMode).toBe("paid");
  });

  it("records the UPI reference when UPI to the account was taken by eye", () => {
    const out = mustPlan({ paymentMethod: "upiToAccount", upiRef: "4471" });
    const payment = out.order.payment as Record<string, unknown>;
    expect(payment.method).toBe("upiToAccount");
    expect(payment.status).toBe("captured");
    expect(payment.upiRef).toBe("4471");
  });

  it("takes no money for a payment link: Awaiting payment, and the jar held", () => {
    const out = mustPlan({ paymentMethod: "paymentLink" });
    const payment = out.order.payment as Record<string, unknown>;
    expect(out.order.state).toBe("awaitingPayment");
    expect(payment.status).toBe("created");
    expect(payment.amount).toBe(0);
    expect(payment.markedPaidBy).toBeNull();
    expect(out.stockMode).toBe("hold");
    expect(out.holdMinutes).toBe(1440);
    expect(out.stampFields).not.toContain("paidAt");
  });
});

/* -------------------------------------------------------------------------- */
/* The customer, brief 7A.1 steps 1 and 6                                     */
/* -------------------------------------------------------------------------- */

describe("the customer", () => {
  it("will not invent a stranger without being told to", () => {
    const out = plan({}, { customer: null });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/never bought from us/);
  });

  it("will not create one with no name, even when confirmed", () => {
    const out = plan({ confirmNewCustomer: true, customerName: "" }, { customer: null });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/give their name/);
  });

  it("creates one when confirmed, with a name", () => {
    const out = mustPlan({ confirmNewCustomer: true }, { customer: null });
    expect(out.customerIsNew).toBe(true);
    expect(out.customerPatch.name).toBe("Asha");
    expect(out.customerStampFields).toContain("createdAt");
    expect((out.customerPatch.stats as Record<string, number>).orders).toBe(1);
    expect((out.customerPatch.stats as Record<string, number>).jars).toBe(1);
  });

  it("adds this sale to an existing customer's history", () => {
    const stats = mustPlan().customerPatch.stats as Record<string, number>;
    expect(stats.orders).toBe(3);
    expect(stats.jars).toBe(4);
  });

  it("records a ticked consent with today's date and who ticked it", () => {
    const consents = mustPlan().customerPatch.consents as Record<string, Record<string, unknown>>;
    expect(consents.updates.given).toBe(true);
    expect(consents.updates.by).toBe("uid-kitchen");
    expect(consents.updates.atMillis).toBe(Date.UTC(2026, 8, 21, 12, 0));
  });

  it("leaves a consent already given alone when the box was simply not ticked", () => {
    const patch = mustPlan(
      { consents: { updates: false, marketing: false } },
      { customer: { phone: PHONE, name: "Asha", orders: 2, jars: 3, consentUpdates: true, consentMarketing: true } },
    ).customerPatch;
    expect(patch.consents).toBeUndefined();
  });

  it("records both answers on a brand new customer, ticked or not", () => {
    const consents = mustPlan({ confirmNewCustomer: true, consents: { updates: true, marketing: false } }, { customer: null })
      .customerPatch.consents as Record<string, Record<string, unknown>>;
    expect(consents.updates.given).toBe(true);
    expect(consents.marketing.given).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The per-person limit override, brief 7A.6                                  */
/* -------------------------------------------------------------------------- */

describe("the per-person limit override", () => {
  it("is the Owner's alone", () => {
    const out = plan({ overrideLimit: true });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/Only Shefin/);
  });

  it("is recorded on the order when the Owner uses it", () => {
    const out = mustPlan({ overrideLimit: true }, { caller: OWNER });
    expect(out.order.limitOverridden).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Choosing the batch, brief 7A.1 step 2                                      */
/* -------------------------------------------------------------------------- */

describe("chooseInStockBatch", () => {
  function candidate(over: Partial<BatchCandidate>): BatchCandidate {
    return { ref: "b-aaaaaa", batchNo: "001", state: "inStock", packedOn: "2026-09-04", createdAtMillis: 1, available: 5, ...over };
  }

  it("takes the oldest packed batch first, so nothing ages out on the shelf", () => {
    const out = chooseInStockBatch(
      [
        candidate({ ref: "b-new", batchNo: "003", packedOn: "2026-12-01" }),
        candidate({ ref: "b-old", batchNo: "001", packedOn: "2026-09-04" }),
        candidate({ ref: "b-mid", batchNo: "002", packedOn: "2026-10-10" }),
      ],
      "Prawns and dates",
    );
    expect(out.ok && out.ref).toBe("b-old");
  });

  it("never suggests a batch with no free jar", () => {
    const out = chooseInStockBatch(
      [
        candidate({ ref: "b-empty", packedOn: "2026-09-04", available: 0 }),
        candidate({ ref: "b-has", packedOn: "2026-10-10", available: 2 }),
      ],
      "Prawns and dates",
    );
    expect(out.ok && out.ref).toBe("b-has");
  });

  it("never quietly books an open batch instead: it says so and stops", () => {
    const out = chooseInStockBatch(
      [candidate({ ref: "b-open", batchNo: null, state: "open", packedOn: null, available: 9 })],
      "Prawns and dates",
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toMatch(/no Prawns and dates in stock/);
      expect(out.message).toMatch(/booked at the open price instead/);
    }
  });

  it("says plainly when there is nothing at all", () => {
    const out = chooseInStockBatch([], "Prawns and dates");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toBe("There is no Prawns and dates to sell right now.");
  });

  it("never suggests a batch that is drafting, cooking, paused or archived", () => {
    for (const state of ["draft", "cooking", "paused", "archived"]) {
      const out = chooseInStockBatch([candidate({ state, packedOn: null })], "Prawns and dates");
      expect(out.ok, state).toBe(false);
      if (!out.ok) expect(out.message, state).toBe("There is no Prawns and dates to sell right now.");
    }
  });

  it("counts a sourcing batch as bookable, because Rs 599 is still open then", () => {
    const out = chooseInStockBatch(
      [candidate({ ref: "b-src", batchNo: null, state: "sourcing", packedOn: null, available: 4 })],
      "Prawns and dates",
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/booked at the open price instead/);
  });
});

/* -------------------------------------------------------------------------- */
/* The void, brief 7A.6                                                       */
/* -------------------------------------------------------------------------- */

describe("voiding a sale", () => {
  /** Epoch millis for a wall-clock time in Asia/Kolkata. */
  function ist(y: number, m: number, d: number, hh: number, mm = 0): number {
    return Date.UTC(y, m - 1, d, hh, mm) - 330 * 60_000;
  }

  function order(over: Partial<VoidableOrderView> = {}): VoidableOrderView {
    return {
      id: "o-abc123",
      channel: "counter",
      state: "delivered",
      customerPhone: PHONE,
      batchRef: "b-7f3a2c",
      jars: 1,
      total: PRICE_IN_STOCK_PAISE,
      paymentMethod: "cash",
      paymentStatus: "captured",
      createdAtMillis: ist(2026, 9, 21, 18, 0),
      billSentAtMillis: null,
      voidedAtMillis: null,
      ...over,
    };
  }

  const customer = { phone: PHONE, name: "Asha", orders: 3, jars: 4, consentUpdates: true, consentMarketing: false };

  function voidIt(o: Partial<VoidableOrderView>, reason = "wrong number typed", nowMillis = ist(2026, 9, 21, 18, 5), caller: { uid: string | null; role: unknown } = KITCHEN) {
    return planCounterSaleVoid(order(o), reason, { caller, customer, nowMillis });
  }

  it("lets the Kitchen void a cash sale made minutes ago", () => {
    const out = voidIt({});
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.orderPatch.state).toBe("voided");
      expect(out.value.orderPatch.voidReason).toBe("wrong number typed");
      expect(out.value.stockMode).toBe("paid");
      expect(out.value.jars).toBe(1);
    }
  });

  it("puts the customer's history back where it was", () => {
    const out = voidIt({});
    if (!out.ok) throw new Error(out.message);
    expect(out.value.customerPatch.stats).toEqual({ orders: 2, jars: 3 });
  });

  it("never takes a customer's history below zero", () => {
    const out = planCounterSaleVoid(order({ jars: 9 }), "mistake", {
      caller: KITCHEN,
      customer: { ...customer, orders: 0, jars: 1 },
      nowMillis: ist(2026, 9, 21, 18, 5),
    });
    if (!out.ok) throw new Error(out.message);
    expect(out.value.customerPatch.stats).toEqual({ orders: 0, jars: 0 });
  });

  it("insists on a reason, so the trail says why the count moved", () => {
    const out = voidIt({}, "   ");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/say why/);
  });

  it("still allows a void at ten past midnight on a sale made at ten to twelve", () => {
    const out = voidIt({ createdAtMillis: ist(2026, 9, 21, 23, 50) }, "wrong jar", ist(2026, 9, 22, 0, 10));
    expect(out.ok).toBe(true);
  });

  it("refuses a void the next evening: that is a different day's takings", () => {
    const out = voidIt({ createdAtMillis: ist(2026, 9, 21, 23, 50) }, "wrong jar", ist(2026, 9, 22, 18, 0));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/voided on the day it was entered/);
  });

  it("refuses once the bill has gone to the customer", () => {
    const out = voidIt({ billSentAtMillis: ist(2026, 9, 21, 18, 1) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/credit note/);
  });

  it("refuses a payment link that Razorpay has already captured", () => {
    const out = voidIt({ paymentMethod: "paymentLink", paymentStatus: "captured", state: "paidWaiting" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/refunds it instead/);
  });

  it("releases the hold on an unpaid payment link", () => {
    const out = voidIt({ paymentMethod: "paymentLink", paymentStatus: "created", state: "awaitingPayment" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.stockMode).toBe("hold");
  });

  it("refuses a second void", () => {
    expect(voidIt({ state: "voided" }).ok).toBe(false);
    expect(voidIt({ voidedAtMillis: ist(2026, 9, 21, 18, 1) }).ok).toBe(false);
  });

  it("refuses an order that did not start at the counter", () => {
    const out = voidIt({ channel: "web" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/entered at the counter/);
  });

  it("refuses a Viewer", () => {
    const out = voidIt({}, "mistake", ist(2026, 9, 21, 18, 5), { uid: "v", role: "viewer" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("permission-denied");
  });

  it("leaves the payment block alone: it is the record of what happened", () => {
    const out = voidIt({});
    if (!out.ok) throw new Error(out.message);
    expect(Object.keys(out.value.orderPatch)).not.toContain("payment");
    expect(Object.keys(out.value.orderPatch)).not.toContain("total");
  });
});
