import { describe, expect, it } from "vitest";

import {
  checkDiscount,
  discountRights,
  isSellablePrice,
  MAX_CUSTOM_LINE_PAISE,
  saleLineTotal,
  saleTotals,
} from "./counterSale.js";
import { MRP_PAISE, PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE } from "./money.js";

describe("saleTotals", () => {
  it("adds jars at the batch price and keeps every figure a whole paisa", () => {
    const totals = saleTotals({
      lines: [{ kind: "product", unitPrice: PRICE_IN_STOCK_PAISE, qty: 2 }],
      discount: 0,
    });
    expect(totals.subtotal).toBe(129_800);
    expect(totals.total).toBe(129_800);
    expect(totals.jars).toBe(2);
    expect(Number.isInteger(totals.total)).toBe(true);
  });

  it("takes the discount off the subtotal and puts shipping on after it", () => {
    const totals = saleTotals({
      lines: [{ kind: "openBatch", unitPrice: PRICE_OPEN_PAISE, qty: 1 }],
      discount: 5_000,
      shippingFee: 6_000,
    });
    expect(totals.subtotal).toBe(59_900);
    expect(totals.total).toBe(59_900 - 5_000 + 6_000);
  });

  it("does not count a custom line as a jar", () => {
    const totals = saleTotals({
      lines: [
        { kind: "custom", unitPrice: 15_000, qty: 3 },
        { kind: "product", unitPrice: PRICE_IN_STOCK_PAISE, qty: 1 },
      ],
      discount: 0,
    });
    expect(totals.jars).toBe(1);
    expect(totals.subtotal).toBe(45_000 + 64_900);
  });

  it("refuses a fractional quantity rather than rounding it", () => {
    expect(() => saleLineTotal({ kind: "product", unitPrice: 64_900, qty: 1.5 })).toThrow(
      /whole number/,
    );
  });
});

describe("discountRights, decision D17", () => {
  it("gives the Kitchen nothing at all until the Owner sets a cap", () => {
    for (const cap of [null, undefined, 0, -1, 12.5]) {
      const rights = discountRights({ role: "kitchen", kitchenCap: cap as number | null });
      expect(rights.mayDiscount, String(cap)).toBe(false);
      expect(rights.maxDiscount).toBe(0);
    }
  });

  it("gives the Kitchen exactly the cap, and no price change or limit override", () => {
    const rights = discountRights({ role: "kitchen", kitchenCap: 5_000 });
    expect(rights).toEqual({
      maxDiscount: 5_000,
      mayDiscount: true,
      mayChangePrice: false,
      mayOverrideLimit: false,
    });
  });

  it("gives the Owner any amount, a price change and the limit override", () => {
    expect(discountRights({ role: "owner", kitchenCap: null })).toEqual({
      maxDiscount: null,
      mayDiscount: true,
      mayChangePrice: true,
      mayOverrideLimit: true,
    });
  });

  it("gives a Viewer nothing", () => {
    expect(discountRights({ role: "viewer", kitchenCap: 50_000 }).mayDiscount).toBe(false);
  });
});

describe("checkDiscount", () => {
  const kitchen = discountRights({ role: "kitchen", kitchenCap: 5_000 });
  const owner = discountRights({ role: "owner", kitchenCap: null });

  it("lets the Kitchen go up to the cap, with a reason", () => {
    expect(checkDiscount({ discount: 5_000, reason: "regular", subtotal: 64_900, rights: kitchen })).toEqual({ ok: true });
  });

  it("stops the Kitchen one paisa past the cap", () => {
    expect(checkDiscount({ discount: 5_001, reason: "regular", subtotal: 64_900, rights: kitchen })).toEqual({
      ok: false,
      reason: "overCap",
    });
  });

  it("insists on a reason from both roles", () => {
    expect(checkDiscount({ discount: 100, reason: "  ", subtotal: 64_900, rights: kitchen }).ok).toBe(false);
    expect(checkDiscount({ discount: 100, reason: "", subtotal: 64_900, rights: owner })).toEqual({
      ok: false,
      reason: "noReason",
    });
  });

  it("never lets a discount exceed the sale, even for the Owner", () => {
    expect(checkDiscount({ discount: 64_901, reason: "gift", subtotal: 64_900, rights: owner })).toEqual({
      ok: false,
      reason: "overSubtotal",
    });
  });

  it("refuses a negative or fractional discount", () => {
    expect(checkDiscount({ discount: -1, reason: "x", subtotal: 64_900, rights: owner }).ok).toBe(false);
    expect(checkDiscount({ discount: 10.5, reason: "x", subtotal: 64_900, rights: owner }).ok).toBe(false);
  });

  it("needs no reason for no discount", () => {
    expect(checkDiscount({ discount: 0, reason: "", subtotal: 64_900, rights: kitchen })).toEqual({ ok: true });
  });
});

describe("isSellablePrice", () => {
  it("never lets a standard jar go above the printed MRP", () => {
    expect(isSellablePrice("product", MRP_PAISE)).toBe(true);
    expect(isSellablePrice("product", MRP_PAISE + 1)).toBe(false);
    expect(isSellablePrice("openBatch", MRP_PAISE + 1)).toBe(false);
  });

  it("lets a custom line be more than one jar's MRP, up to the typo guard", () => {
    expect(isSellablePrice("custom", MRP_PAISE * 3)).toBe(true);
    expect(isSellablePrice("custom", MAX_CUSTOM_LINE_PAISE)).toBe(true);
    expect(isSellablePrice("custom", MAX_CUSTOM_LINE_PAISE + 1)).toBe(false);
  });

  it("refuses a free, negative or fractional price", () => {
    expect(isSellablePrice("product", 0)).toBe(false);
    expect(isSellablePrice("product", -100)).toBe(false);
    expect(isSellablePrice("product", 649.5)).toBe(false);
  });
});
