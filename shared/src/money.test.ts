import { describe, expect, it } from "vitest";
import {
  addPaise,
  assertAtOrBelowMrp,
  formatINR,
  groupIndianDigits,
  IN_STOCK_PER_PERSON_LIMIT,
  isAtOrBelowMrp,
  isPaise,
  MRP_PAISE,
  multiplyPaise,
  paiseToRupees,
  PRICE_IN_STOCK_PAISE,
  PRICE_OPEN_PAISE,
  rupeesToPaise,
  subtractPaise,
} from "./money.js";

describe("prices", () => {
  it("holds the two prices from brief 4.1 as paise integers", () => {
    expect(PRICE_IN_STOCK_PAISE).toBe(64900);
    expect(PRICE_OPEN_PAISE).toBe(59900);
    expect(MRP_PAISE).toBe(64900);
    expect(IN_STOCK_PER_PERSON_LIMIT).toBe(2);
  });

  it("renders them the way the label and the card do", () => {
    expect(formatINR(PRICE_IN_STOCK_PAISE)).toBe("₹649");
    expect(formatINR(PRICE_OPEN_PAISE)).toBe("₹599");
  });

  it("never allows a price above MRP", () => {
    expect(isAtOrBelowMrp(PRICE_IN_STOCK_PAISE)).toBe(true);
    expect(isAtOrBelowMrp(PRICE_OPEN_PAISE)).toBe(true);
    expect(isAtOrBelowMrp(64901)).toBe(false);
    expect(() => assertAtOrBelowMrp(65000)).toThrow(/above the MRP/);
    expect(assertAtOrBelowMrp(PRICE_OPEN_PAISE)).toBe(PRICE_OPEN_PAISE);
  });
});

describe("groupIndianDigits", () => {
  it("groups the last three, then pairs", () => {
    expect(groupIndianDigits("1")).toBe("1");
    expect(groupIndianDigits("649")).toBe("649");
    expect(groupIndianDigits("1248")).toBe("1,248");
    expect(groupIndianDigits("12480")).toBe("12,480");
    expect(groupIndianDigits("124800")).toBe("1,24,800");
    expect(groupIndianDigits("1000000")).toBe("10,00,000");
    expect(groupIndianDigits("10000000")).toBe("1,00,00,000");
  });
});

describe("formatINR", () => {
  it("drops the decimals on a whole rupee amount", () => {
    expect(formatINR(64900)).toBe("₹649");
    expect(formatINR(59900)).toBe("₹599");
    expect(formatINR(124800)).toBe("₹1,248");
    expect(formatINR(0)).toBe("₹0");
  });

  it("shows two decimals only when there are paise", () => {
    expect(formatINR(64950)).toBe("₹649.50");
    expect(formatINR(64901)).toBe("₹649.01");
    expect(formatINR(1)).toBe("₹0.01");
    expect(formatINR(99)).toBe("₹0.99");
  });

  it("uses Indian digit grouping", () => {
    expect(formatINR(10000000)).toBe("₹1,00,000");
    expect(formatINR(100000000)).toBe("₹10,00,000");
    expect(formatINR(1000000000)).toBe("₹1,00,00,000");
    expect(formatINR(10000050)).toBe("₹1,00,000.50");
  });

  it("puts the sign in front of the symbol on a refund line", () => {
    expect(formatINR(-59900)).toBe("-₹599");
    expect(formatINR(-64950)).toBe("-₹649.50");
  });

  it("can be forced to show paise, for a column of figures", () => {
    expect(formatINR(64900, { alwaysPaise: true })).toBe("₹649.00");
    expect(formatINR(124800, { alwaysPaise: true })).toBe("₹1,248.00");
  });

  it("can drop the symbol", () => {
    expect(formatINR(64900, { symbol: false })).toBe("649");
    expect(formatINR(64950, { symbol: false })).toBe("649.50");
  });

  it("refuses a float, because money is never a float", () => {
    expect(() => formatINR(649.5)).toThrow(/integer number of paise/);
    expect(() => formatINR(Number.NaN)).toThrow();
  });
});

describe("paise arithmetic", () => {
  it("converts a number a human typed", () => {
    expect(rupeesToPaise(649)).toBe(64900);
    expect(rupeesToPaise(649.5)).toBe(64950);
    expect(rupeesToPaise(0.1)).toBe(10);
    expect(rupeesToPaise(-60)).toBe(-6000);
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow();
  });

  // D42: finer than a paisa is refused, not rounded. 12.345 is either 12.34
  // or 12.35 and only the person typing it knows which, so the function says
  // no rather than picking one and storing it as though it were given.
  it("refuses anything finer than a paisa rather than rounding it", () => {
    expect(() => rupeesToPaise(12.345)).toThrow(/whole paise/);
    expect(() => rupeesToPaise(6.495)).toThrow(/whole paise/);
    expect(() => rupeesToPaise(-6.495)).toThrow(/whole paise/);
    expect(() => rupeesToPaise(0.005)).toThrow(/whole paise/);
  });

  // The refusal is a check on the decimals, not a float comparison that
  // happens to work: 0.1 * 100 is 10.000000000000002 in binary floating
  // point, and ten paise is ten paise.
  it("still takes every amount that is a whole number of paise", () => {
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise(0.01)).toBe(1);
    expect(rupeesToPaise(0.1)).toBe(10);
    expect(rupeesToPaise(12.34)).toBe(1234);
    expect(rupeesToPaise(12.35)).toBe(1235);
    expect(rupeesToPaise(1234567.89)).toBe(123456789);
    expect(rupeesToPaise(-12.34)).toBe(-1234);
  });

  it("converts back only for display", () => {
    expect(paiseToRupees(64900)).toBe(649);
    expect(paiseToRupees(64950)).toBe(649.5);
  });

  it("adds, subtracts and multiplies without leaving the integers", () => {
    expect(addPaise(64900, 59900)).toBe(124800);
    expect(addPaise()).toBe(0);
    expect(subtractPaise(64900, 6000)).toBe(58900);
    expect(multiplyPaise(59900, 2)).toBe(119800);
    expect(multiplyPaise(59900, 0)).toBe(0);
    expect(() => multiplyPaise(59900, 1.5)).toThrow(/whole number/);
    expect(() => multiplyPaise(59900, -1)).toThrow(/whole number/);
  });

  it("knows a paise value from anything else", () => {
    expect(isPaise(64900)).toBe(true);
    expect(isPaise(649.5)).toBe(false);
    expect(isPaise("64900")).toBe(false);
    expect(isPaise(Number.NaN)).toBe(false);
  });
});
