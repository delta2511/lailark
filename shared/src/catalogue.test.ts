import { describe, expect, it } from "vitest";

import { isValidMonthDay, isWithinSeasonWindow } from "./catalogue.js";

describe("isValidMonthDay", () => {
  it("accepts a real MM-DD", () => {
    expect(isValidMonthDay("11-01")).toBe(true);
    expect(isValidMonthDay("02-29")).toBe(true);
    expect(isValidMonthDay("12-31")).toBe(true);
  });

  it("rejects a bad month, a bad day, or the wrong shape", () => {
    expect(isValidMonthDay("13-01")).toBe(false);
    expect(isValidMonthDay("00-01")).toBe(false);
    expect(isValidMonthDay("04-31")).toBe(false);
    expect(isValidMonthDay("2026-11-01")).toBe(false);
    expect(isValidMonthDay("11-1")).toBe(false);
    expect(isValidMonthDay("")).toBe(false);
  });
});

describe("isWithinSeasonWindow", () => {
  it("is always true when a product has no season", () => {
    expect(isWithinSeasonWindow(null, null, { y: 2026, m: 6, d: 15 })).toBe(true);
  });

  it("Koorka's window, November to February, wraps the year", () => {
    const start = "11-01";
    const end = "02-28";
    expect(isWithinSeasonWindow(start, end, { y: 2026, m: 11, d: 1 })).toBe(true);
    expect(isWithinSeasonWindow(start, end, { y: 2026, m: 12, d: 25 })).toBe(true);
    expect(isWithinSeasonWindow(start, end, { y: 2027, m: 1, d: 15 })).toBe(true);
    expect(isWithinSeasonWindow(start, end, { y: 2027, m: 2, d: 28 })).toBe(true);
    expect(isWithinSeasonWindow(start, end, { y: 2027, m: 3, d: 1 })).toBe(false);
    expect(isWithinSeasonWindow(start, end, { y: 2026, m: 6, d: 15 })).toBe(false);
    expect(isWithinSeasonWindow(start, end, { y: 2026, m: 10, d: 31 })).toBe(false);
  });

  it("a window that does not wrap is a plain range", () => {
    expect(isWithinSeasonWindow("03-01", "05-31", { y: 2026, m: 4, d: 1 })).toBe(true);
    expect(isWithinSeasonWindow("03-01", "05-31", { y: 2026, m: 6, d: 1 })).toBe(false);
    expect(isWithinSeasonWindow("03-01", "05-31", { y: 2026, m: 2, d: 28 })).toBe(false);
  });

  it("the boundary days themselves are in season", () => {
    expect(isWithinSeasonWindow("11-01", "02-28", { y: 2026, m: 11, d: 1 })).toBe(true);
    expect(isWithinSeasonWindow("11-01", "02-28", { y: 2027, m: 2, d: 28 })).toBe(true);
  });

  it("refuses a malformed window rather than guessing", () => {
    expect(() => isWithinSeasonWindow("2026-11-01", "02-28", { y: 2026, m: 12, d: 1 })).toThrow(
      /season window must be/,
    );
  });
});
