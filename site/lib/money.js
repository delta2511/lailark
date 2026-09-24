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

/**
 * The Legal Metrology "unit sale price" (brief 20.3): price per gram, e.g.
 * `₹3.25/g` for a ₹649 200 g jar, the same figure the printed label carries.
 * Rounded to the nearest paisa for display only; the paise integer the price
 * actually comes from is never touched.
 */
export function unitPricePerGram(paise, grams) {
  if (!Number.isInteger(grams) || grams < 1) {
    throw new RangeError(`jar grams must be a positive whole number, got ${grams}`);
  }
  return `${formatINR(Math.round(paise / grams))}/g`;
}
