/**
 * The two bounds on the refund panel's money boxes. Money, so the edges are
 * spelled out rather than assumed, and the shared parser's own behaviour is
 * asserted here too, because the point of using it is that this screen agrees
 * with every other one.
 */
import { describe, expect, it } from "vitest";

import { gatewayFeePaise, refundAmountPaise } from "./refundMoney";

describe("the refund amount box", () => {
  it("turns rupees into whole paise", () => {
    expect(refundAmountPaise("649")).toBe(64_900);
    expect(refundAmountPaise("649.00")).toBe(64_900);
    expect(refundAmountPaise("0.01")).toBe(1);
    expect(refundAmountPaise(" 300 ")).toBe(30_000);
  });

  it("refuses anything that is not an amount above zero", () => {
    for (const value of ["", "   ", "abc", "-", "-1", "0", "0.00", "NaN", "Infinity"]) {
      expect(refundAmountPaise(value), value).toBeNull();
    }
  });

  it("refuses an amount finer than a paisa rather than rounding it (D42)", () => {
    expect(refundAmountPaise("12.345")).toBeNull();
  });

  it("reads exponent notation the way every other money box in the admin does", () => {
    // Not a thing anyone types, but the shared parser accepts it, and the point
    // of using the shared parser is that this box does not disagree with the
    // price boxes about what a string means.
    expect(refundAmountPaise("6.5e2")).toBe(65_000);
  });
});

describe("the gateway fee box", () => {
  it("accepts zero, because a fee of nothing is a real answer", () => {
    expect(gatewayFeePaise("0")).toBe(0);
    expect(gatewayFeePaise("15.32")).toBe(1_532);
  });

  it("refuses a negative fee, or anything that is not a number", () => {
    for (const value of ["", "-1", "abc", "1.005"]) {
      expect(gatewayFeePaise(value), value).toBeNull();
    }
  });
});
