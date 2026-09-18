import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inStockPrice,
  lineTotal,
  openBatchPrice,
  PRICE_IN_STOCK_PAISE,
  PRICE_OPEN_PAISE,
} from "../lib/money.js";

/**
 * Node's own test runner, not Vitest: Playwright is the site's only test
 * framework and this one file does not earn a second one. `npm test` in this
 * workspace runs these first, then Playwright.
 */
describe("site money helpers", () => {
  it("resolves @lailark/shared through the workspace link", () => {
    assert.equal(PRICE_IN_STOCK_PAISE, 64900);
    assert.equal(PRICE_OPEN_PAISE, 59900);
  });

  it("prints the two prices the way the cards do", () => {
    assert.equal(inStockPrice(), "₹649");
    assert.equal(openBatchPrice(), "₹599");
  });

  it("prints a line total with Indian digit grouping", () => {
    assert.equal(lineTotal(PRICE_IN_STOCK_PAISE, 1), "₹649");
    assert.equal(lineTotal(PRICE_OPEN_PAISE, 2), "₹1,198");
    assert.equal(lineTotal(PRICE_IN_STOCK_PAISE, 0), "₹0");
  });

  it("refuses a quantity that is not a whole number of jars", () => {
    assert.throws(() => lineTotal(PRICE_OPEN_PAISE, 1.5), RangeError);
    assert.throws(() => lineTotal(PRICE_OPEN_PAISE, -1), RangeError);
  });
});
