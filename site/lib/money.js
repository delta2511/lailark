/**
 * Money on the customer site.
 *
 * Every rupee figure the site shows goes through here, so there is exactly one
 * place that turns a paise integer into a string a customer reads, and it is
 * the same code the admin and the functions use. Prices come from
 * `@lailark/shared`, not from a number typed into a page.
 */

import { formatINR, PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE } from "@lailark/shared";

export { formatINR, PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE };

/** The in-stock price, as the product card prints it: `₹649`. */
export function inStockPrice() {
  return formatINR(PRICE_IN_STOCK_PAISE);
}

/** The open-batch price, as the batch card prints it: `₹599`. */
export function openBatchPrice() {
  return formatINR(PRICE_OPEN_PAISE);
}

/** A line total for `qty` jars at `unitPaise`, already formatted. */
export function lineTotal(unitPaise, qty) {
  if (!Number.isInteger(qty) || qty < 0) {
    throw new RangeError(`quantity must be a whole number, got ${qty}`);
  }
  return formatINR(unitPaise * qty);
}
