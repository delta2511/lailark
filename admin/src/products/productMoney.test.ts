import { describe, expect, it } from "vitest";

import { isCustomLineAmountPaise, isSellablePaise, parseRupeesToPaise } from "./productMoney";

describe("parseRupeesToPaise", () => {
  it("parses a plain rupee amount", () => {
    expect(parseRupeesToPaise("649")).toBe(64_900);
    expect(parseRupeesToPaise("599")).toBe(59_900);
  });

  it("parses paise", () => {
    expect(parseRupeesToPaise("12.50")).toBe(1250);
    expect(parseRupeesToPaise("0.01")).toBe(1);
    expect(parseRupeesToPaise("0.1")).toBe(10);
  });

  // D42: a third decimal is a slip or a paste, and rounding it stored a
  // number nobody typed. Null is what every box here already reads as "not an
  // amount yet", so the person is told instead.
  it("is null for an amount finer than a paisa, rather than rounding it", () => {
    expect(parseRupeesToPaise("6.495")).toBeNull();
    expect(parseRupeesToPaise("12.345")).toBeNull();
    expect(parseRupeesToPaise("0.005")).toBeNull();
  });

  it("trims surrounding space", () => {
    expect(parseRupeesToPaise("  649  ")).toBe(64_900);
  });

  it("is null for an empty box or anything that is not a number", () => {
    expect(parseRupeesToPaise("")).toBeNull();
    expect(parseRupeesToPaise("   ")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
    expect(parseRupeesToPaise("64-9")).toBeNull();
    expect(parseRupeesToPaise("NaN")).toBeNull();
    expect(parseRupeesToPaise("Infinity")).toBeNull();
  });

  it("is null rather than throwing on a value outside the safe integer range", () => {
    expect(parseRupeesToPaise("1e300")).toBeNull();
  });
});

describe("isSellablePaise", () => {
  it("accepts valid prices from 1 paisa up to the MRP", () => {
    expect(isSellablePaise(1)).toBe(true);
    expect(isSellablePaise(100)).toBe(true);
    expect(isSellablePaise(64_900)).toBe(true);
  });

  it("rejects negative amounts", () => {
    expect(isSellablePaise(-1)).toBe(false);
    expect(isSellablePaise(-500)).toBe(false);
  });

  it("rejects zero", () => {
    expect(isSellablePaise(0)).toBe(false);
  });

  it("rejects amounts above the MRP", () => {
    expect(isSellablePaise(64_901)).toBe(false);
  });

  it("rejects non-integer amounts", () => {
    expect(isSellablePaise(1.5)).toBe(false);
  });

  it("rejects null, undefined, NaN, and non-numbers", () => {
    expect(isSellablePaise(null)).toBe(false);
    expect(isSellablePaise(undefined)).toBe(false);
    expect(isSellablePaise(NaN)).toBe(false);
    // @ts-expect-error testing string input
    expect(isSellablePaise("649")).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(isSellablePaise(Infinity)).toBe(false);
  });
});

describe("isCustomLineAmountPaise", () => {
  it("accepts zero and positive amounts", () => {
    expect(isCustomLineAmountPaise(0)).toBe(true);
    expect(isCustomLineAmountPaise(1)).toBe(true);
    expect(isCustomLineAmountPaise(100)).toBe(true);
    expect(isCustomLineAmountPaise(64_900)).toBe(true);
  });

  it("rejects negative amounts", () => {
    expect(isCustomLineAmountPaise(-1)).toBe(false);
    expect(isCustomLineAmountPaise(-500)).toBe(false);
  });

  it("rejects non-integer amounts", () => {
    expect(isCustomLineAmountPaise(1.5)).toBe(false);
  });

  it("rejects null, undefined, NaN, and non-numbers", () => {
    expect(isCustomLineAmountPaise(null)).toBe(false);
    expect(isCustomLineAmountPaise(undefined)).toBe(false);
    expect(isCustomLineAmountPaise(NaN)).toBe(false);
    // @ts-expect-error testing string input
    expect(isCustomLineAmountPaise("649")).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(isCustomLineAmountPaise(Infinity)).toBe(false);
  });
});
