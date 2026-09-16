import { describe, expect, it } from "vitest";
import {
  batchMaths,
  formatBatchNo,
  formatCalDate,
  formatINR,
  PRICE_IN_STOCK_PAISE,
  PRICE_OPEN_PAISE,
  saleStopOn,
  SHARED_VERSION,
} from "@lailark/shared";

/**
 * The functions workspace imports @lailark/shared for real. This test is the
 * proof that the workspace link resolves and that the compiled CommonJS build
 * of the package is the one the Functions runtime will load.
 */
describe("@lailark/shared, from functions", () => {
  it("resolves the workspace link", () => {
    expect(SHARED_VERSION).toBe("0.0.0");
  });

  it("agrees on batch 001", () => {
    expect(formatBatchNo(1)).toBe("001");
    expect(batchMaths(22).bookableJars).toBe(19);
    expect(formatCalDate(saleStopOn("2026-09-04"))).toBe("2027-01-02");
  });

  it("agrees on the two prices", () => {
    expect(formatINR(PRICE_IN_STOCK_PAISE)).toBe("₹649");
    expect(formatINR(PRICE_OPEN_PAISE)).toBe("₹599");
  });
});
