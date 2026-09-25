import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkoutTotals,
  jarChoicesFor,
  jarWords,
  readCheckoutQuery,
  unitPaiseFor,
} from "../lib/checkout.js";

// The `/api/counts` shape, which is what the page actually receives.
const FREE = { rule: "free", flatFeePaise: 6000, freeFromJars: 2 };
const IN_STOCK = {
  mode: "inStock",
  count: 4,
  total: 22,
  available: 4,
  priceInStockPaise: 64900,
  perPersonLimit: 2,
  shippingRule: null,
};
const OPEN = {
  mode: "open",
  count: 5,
  total: 19,
  available: 14,
  priceOpenPaise: 59900,
  perPersonLimit: 4,
  shippingRule: null,
};

describe("reading the checkout link", () => {
  it("takes the slug and the jar count out of the query", () => {
    assert.deepEqual(readCheckoutQuery("?p=prawns-and-dates&q=2"), {
      slug: "prawns-and-dates",
      qty: 2,
    });
  });

  it("drops a slug that is not a slug, rather than trusting it", () => {
    assert.equal(readCheckoutQuery("?p=../../etc&q=1").slug, null);
    assert.equal(readCheckoutQuery("").slug, null);
  });

  it("falls back to one jar for anything that is not a sane count", () => {
    assert.equal(readCheckoutQuery("?p=koorka&q=0").qty, 1);
    assert.equal(readCheckoutQuery("?p=koorka&q=99").qty, 1);
    assert.equal(readCheckoutQuery("?p=koorka").qty, 1);
  });
});

describe("how many jars the page may offer", () => {
  it("offers at most two on an in-stock batch, brief 4.1", () => {
    assert.deepEqual(jarChoicesFor(IN_STOCK), [1, 2]);
  });

  it("offers the batch's own cap on an open batch", () => {
    assert.deepEqual(jarChoicesFor(OPEN), [1, 2, 3, 4]);
  });

  it("never offers more jars than are free", () => {
    assert.deepEqual(jarChoicesFor({ ...IN_STOCK, count: 1, available: 1 }), [1]);
    assert.deepEqual(jarChoicesFor({ ...IN_STOCK, count: 0, available: 0 }), []);
    // An open batch with 18 of 19 paid has one left to book.
    assert.deepEqual(jarChoicesFor({ ...OPEN, count: 18, available: 1 }), [1]);
  });

  it("does not offer the jar somebody else is paying for", () => {
    // Brief 9.3. An open batch's `count` is the paid marks, so `19 - 17` is
    // two jars while a live hold has already taken one of them. Only
    // `available` knows, and offering the second one sent the customer to a
    // refusal at the Pay button instead of an honest picker.
    assert.deepEqual(jarChoicesFor({ ...OPEN, count: 17, available: 1 }), [1]);
  });

  it("offers nothing at all rather than guessing when the free figure is missing", () => {
    const { available, ...withoutAvailable } = OPEN;
    assert.equal(available, 14);
    assert.deepEqual(jarChoicesFor(withoutAvailable), []);
  });

  it("offers nothing when the batch's cap is nothing, and never widens it (D52)", () => {
    // A cap of zero is a real answer: `/api/counts` resolves it exactly as
    // the hold does, and neither side floors it at one. Falling back to the
    // two-jar default here would offer a jar the server is about to refuse.
    assert.deepEqual(jarChoicesFor({ ...OPEN, perPersonLimit: 0 }), []);
    // Above two as well as below it: the Owner's typed number stands.
    assert.deepEqual(jarChoicesFor({ ...OPEN, perPersonLimit: 5 }), [1, 2, 3, 4, 5]);
    assert.deepEqual(jarChoicesFor({ ...IN_STOCK, perPersonLimit: 1 }), [1]);
  });

  it("never offers more jars than one web order may carry", () => {
    // `parseCheckoutRequest` refuses anything over twenty, and a batch may
    // run to forty jars with a per-person limit the Owner typed himself
    // (D52), so without this ceiling the picker offered a jar count the
    // callable was always going to turn away at the Pay button.
    const big = { ...OPEN, total: 40, count: 0, available: 40, perPersonLimit: 25 };
    const choices = jarChoicesFor(big);
    assert.equal(choices.length, 20);
    assert.equal(choices[choices.length - 1], 20);
  });

  it("offers nothing at all for a batch that is not on sale", () => {
    assert.deepEqual(jarChoicesFor({ mode: "none" }), []);
    assert.deepEqual(jarChoicesFor(null), []);
  });
});

describe("the total the page prints", () => {
  it("is the batch's own price times the jars, brief D40", () => {
    const totals = checkoutTotals(IN_STOCK, 2, FREE);
    assert.equal(totals.subtotalPaise, 129800);
    assert.equal(totals.shippingFeePaise, 0);
    assert.equal(totals.totalPaise, 129800);
  });

  it("takes the open price on an open batch", () => {
    assert.equal(unitPaiseFor(OPEN), 59900);
    assert.equal(checkoutTotals(OPEN, 1, FREE).totalPaise, 59900);
  });

  it("shows the shipping fee before the Pay button, never after it", () => {
    const totals = checkoutTotals(IN_STOCK, 1, {
      rule: "flatFee",
      flatFeePaise: 6000,
      freeFromJars: 2,
    });
    assert.equal(totals.shippingFeePaise, 6000);
    assert.equal(totals.totalPaise, 70900);
  });

  it("charges nothing for shipping while the global switch is free", () => {
    const totals = checkoutTotals(IN_STOCK, 1, FREE, "flatFee");
    assert.equal(totals.shippingFeePaise, 0);
  });

  it("clamps the shipping switch exactly as the server does", () => {
    // A fractional `freeFromJars` used to be floored on the way down from
    // `/api/counts` and left raw on the server, where it silently read as 2:
    // the page showed two jars shipped free and the server charged the fee.
    const ship = { rule: "freeOnTwo", flatFeePaise: 6000, freeFromJars: 3.5 };
    assert.equal(checkoutTotals(IN_STOCK, 2, ship).shippingFeePaise, 6000);
    assert.equal(checkoutTotals({ ...OPEN, available: 14 }, 3, ship).shippingFeePaise, 0);
    // And a fee that is not a whole number of paise is floored, never lost.
    const fractional = { rule: "flatFee", flatFeePaise: 6000.7, freeFromJars: 2 };
    assert.equal(checkoutTotals(IN_STOCK, 1, fractional).shippingFeePaise, 6000);
  });

  it("takes the product's own rule, which is the one the server enforces", () => {
    // `createCheckout` reads `products/{slug}.shippingRule` and refuses any
    // total that differs from the page's, so the rule the page sums with has
    // to be the same one, off `/api/counts` (brief 4.2).
    const global = { rule: "flatFee", flatFeePaise: 6000, freeFromJars: 2 };
    const free = { ...IN_STOCK, shippingRule: "free" };
    assert.equal(checkoutTotals(free, 1, global, free.shippingRule).shippingFeePaise, 0);
    const charged = { ...IN_STOCK, shippingRule: "flatFee" };
    assert.equal(checkoutTotals(charged, 1, global, charged.shippingRule).shippingFeePaise, 6000);
  });

  it("refuses to make up a total it cannot back with a price", () => {
    assert.equal(checkoutTotals({ mode: "inStock", count: 4, total: 22 }, 1, FREE), null);
    assert.equal(checkoutTotals(IN_STOCK, 0, FREE), null);
    assert.equal(checkoutTotals({ mode: "none" }, 1, FREE), null);
  });
});

describe("freeOnTwo reads its threshold from the payload, never assumes two", () => {
  it("charges one jar and lets two through", () => {
    const ship = { rule: "freeOnTwo", flatFeePaise: 6000, freeFromJars: 2 };
    assert.equal(checkoutTotals(IN_STOCK, 1, ship).shippingFeePaise, 6000);
    assert.equal(checkoutTotals(IN_STOCK, 2, ship).shippingFeePaise, 0);
  });

  it("follows the Owner if he moves the threshold", () => {
    const ship = { rule: "freeOnTwo", flatFeePaise: 6000, freeFromJars: 3 };
    assert.equal(checkoutTotals(OPEN, 2, ship).shippingFeePaise, 6000);
    assert.equal(checkoutTotals(OPEN, 3, ship).shippingFeePaise, 0);
  });
});

describe("reading a jar count aloud", () => {
  it("never says one jars", () => {
    assert.equal(jarWords(1), "1 jar");
    assert.equal(jarWords(2), "2 jars");
  });
});
