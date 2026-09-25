import { describe, expect, it } from "vitest";

import {
  checkDeliverable,
  DEFAULT_PINCODE_LIST,
  DEFAULT_SHIPPING_SWITCH,
  effectiveShippingSwitch,
  isPincode,
  MAX_WEB_JARS,
  normaliseShippingSwitch,
  normaliseState,
  shippingFeeFor,
  WEB_HOLD_MINUTES,
} from "./checkout.js";

const NO_PRODUCT_RULE = { allowedStates: null, excludedPincodes: null };

describe("the shipping switch, brief 4.2 and D12", () => {
  it("charges nothing at launch, whatever the jar count", () => {
    expect(DEFAULT_SHIPPING_SWITCH.rule).toBe("free");
    expect(shippingFeeFor(DEFAULT_SHIPPING_SWITCH, 1)).toBe(0);
    expect(shippingFeeFor(DEFAULT_SHIPPING_SWITCH, 2)).toBe(0);
  });

  it("charges the flat fee once per order, not once per jar", () => {
    const ship = { rule: "flatFee" as const, flatFee: 6_000, freeFromJars: 2 };
    expect(shippingFeeFor(ship, 1)).toBe(6_000);
    expect(shippingFeeFor(ship, 2)).toBe(6_000);
    expect(shippingFeeFor(ship, 5)).toBe(6_000);
  });

  it("charges freeOnTwo below the threshold and nothing at or above it", () => {
    const ship = { rule: "freeOnTwo" as const, flatFee: 6_000, freeFromJars: 2 };
    expect(shippingFeeFor(ship, 1)).toBe(6_000);
    expect(shippingFeeFor(ship, 2)).toBe(0);
    expect(shippingFeeFor(ship, 3)).toBe(0);
  });

  it("treats a missing or nonsense fee as nothing, never as a guess", () => {
    expect(shippingFeeFor({ rule: "flatFee", flatFee: 0, freeFromJars: 2 }, 1)).toBe(0);
    expect(shippingFeeFor({ rule: "flatFee", flatFee: -1, freeFromJars: 2 }, 1)).toBe(0);
    expect(shippingFeeFor({ rule: "flatFee", flatFee: 6_000, freeFromJars: 2 }, 0)).toBe(0);
  });

  it("lets the global free switch beat any product rule (A55, no surprise charge)", () => {
    const free = effectiveShippingSwitch(DEFAULT_SHIPPING_SWITCH, "flatFee");
    expect(free.rule).toBe("free");
    expect(shippingFeeFor(free, 1)).toBe(0);
  });

  it("lets a product rule take over once the global switch is off free", () => {
    const global = { rule: "free" as const, flatFee: 6_000, freeFromJars: 2 };
    const on = { ...global, rule: "freeOnTwo" as const };
    expect(effectiveShippingSwitch(on, "flatFee").rule).toBe("flatFee");
    expect(effectiveShippingSwitch(on, null).rule).toBe("freeOnTwo");
  });
});

describe("reading settings/shipping, the one clamp both sides use", () => {
  it("floors a fractional freeFromJars instead of leaving the two sides to disagree", () => {
    // The defect: `/api/counts` floored this and the server did not, so with
    // `freeFromJars: 3.5` the page totalled two jars free of shipping and
    // the server charged the fee, and the order was refused for a
    // difference the customer could do nothing about.
    const ship = normaliseShippingSwitch({ rule: "freeOnTwo", flatFee: 6_000, freeFromJars: 3.5 });
    expect(ship.freeFromJars).toBe(3);
    expect(shippingFeeFor(ship, 2)).toBe(6_000);
    expect(shippingFeeFor(ship, 3)).toBe(0);
  });

  it("keeps a fee an integer number of paise, never a float", () => {
    // CLAUDE.md section 3: money is integers in paise, everywhere.
    expect(normaliseShippingSwitch({ rule: "flatFee", flatFee: 6_000.7 }).flatFee).toBe(6_000);
    expect(shippingFeeFor(normaliseShippingSwitch({ rule: "flatFee", flatFee: 6_000.7 }), 1)).toBe(
      6_000,
    );
  });

  it("never lets freeFromJars fall below the two of brief 4.2", () => {
    for (const from of [1, 0, -4, 1.9]) {
      expect(normaliseShippingSwitch({ rule: "freeOnTwo", freeFromJars: from }).freeFromJars).toBe(
        2,
      );
    }
  });

  it("never turns a fee negative", () => {
    expect(normaliseShippingSwitch({ rule: "flatFee", flatFee: -500 }).flatFee).toBe(0);
  });

  it("falls back to the launch switch for a missing or unusable document", () => {
    expect(normaliseShippingSwitch({})).toEqual(DEFAULT_SHIPPING_SWITCH);
    expect(normaliseShippingSwitch({ rule: "surprise-charge" }).rule).toBe("free");
    // Not to a zero fee: a zero that should have been ₹60 is a charge that
    // turns up later, which is the drip pricing 4.2 forbids.
    expect(normaliseShippingSwitch({ rule: "flatFee", flatFee: "lots" }).flatFee).toBe(
      DEFAULT_SHIPPING_SWITCH.flatFee,
    );
    expect(normaliseShippingSwitch({ rule: "freeOnTwo", freeFromJars: null }).freeFromJars).toBe(2);
  });

  it("gives the same answer whoever asks, which is the whole point", () => {
    const raw = { rule: "freeOnTwo", flatFee: 5_999.9, freeFromJars: 3.5 };
    // The site reads it off `/api/counts` (paise names), the server off the
    // document. Both end here, so both sums agree.
    expect(normaliseShippingSwitch(raw)).toEqual(normaliseShippingSwitch({ ...raw }));
    expect(shippingFeeFor(normaliseShippingSwitch(raw), 2)).toBe(5_999);
  });
});

describe("where we will send it, brief 11.5", () => {
  it("knows a six digit Indian pincode from anything else", () => {
    expect(isPincode("673571")).toBe(true);
    expect(isPincode("073571")).toBe(false);
    expect(isPincode("67357")).toBe(false);
    expect(isPincode(673571)).toBe(false);
  });

  it("accepts any well-formed pincode while the list is switched off", () => {
    expect(
      checkDeliverable({
        pincode: "110001",
        state: "DL",
        list: DEFAULT_PINCODE_LIST,
        product: NO_PRODUCT_RULE,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a malformed pincode before anything else", () => {
    const out = checkDeliverable({
      pincode: "12",
      state: "KL",
      list: { serviceable: ["673571"], enforce: true },
      product: NO_PRODUCT_RULE,
    });
    expect(out).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses an off-list pincode only once the Owner enforces the list", () => {
    const list = { serviceable: ["673571"], enforce: false };
    expect(
      checkDeliverable({ pincode: "110001", state: "DL", list, product: NO_PRODUCT_RULE }).ok,
    ).toBe(true);
    expect(
      checkDeliverable({
        pincode: "110001",
        state: "DL",
        list: { ...list, enforce: true },
        product: NO_PRODUCT_RULE,
      }),
    ).toEqual({ ok: false, reason: "notServiceable" });
  });

  it("never refuses everything because the list happens to be empty", () => {
    expect(
      checkDeliverable({
        pincode: "110001",
        state: "DL",
        list: { serviceable: [], enforce: true },
        product: NO_PRODUCT_RULE,
      }).ok,
    ).toBe(true);
  });

  it("honours a product's excluded pincodes and allowed states", () => {
    expect(
      checkDeliverable({
        pincode: "110001",
        state: "DL",
        list: DEFAULT_PINCODE_LIST,
        product: { allowedStates: null, excludedPincodes: ["110001"] },
      }),
    ).toEqual({ ok: false, reason: "productNotShipped" });

    expect(
      checkDeliverable({
        pincode: "110001",
        state: "Delhi",
        list: DEFAULT_PINCODE_LIST,
        product: { allowedStates: ["KL"], excludedPincodes: null },
      }),
    ).toEqual({ ok: false, reason: "productNotShipped" });

    expect(
      checkDeliverable({
        pincode: "673571",
        state: " kl ",
        list: DEFAULT_PINCODE_LIST,
        product: { allowedStates: ["KL"], excludedPincodes: null },
      }).ok,
    ).toBe(true);
  });

  it("compares states without caring about spacing or case", () => {
    expect(normaliseState(" kl ")).toBe("KL");
    expect(normaliseState("Kerala")).toBe("KERALA");
  });
});

describe("the hold", () => {
  it("is fifteen minutes, brief 6.1 step 4 and 9.3", () => {
    expect(WEB_HOLD_MINUTES).toBe(15);
  });

  it("caps one web order well below anything a home kitchen bottles", () => {
    expect(MAX_WEB_JARS).toBe(20);
  });
});
