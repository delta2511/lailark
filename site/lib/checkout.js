/**
 * The checkout page's own arithmetic and reading, kept out of the component
 * so it can be tested without a browser.
 *
 * Every sum here is `@lailark/shared`'s, never a second one: the figure this
 * page prints is the figure `createCheckout` is about to charge, and the
 * server refuses the order outright if the two ever differ (brief 4.2,
 * CLAUDE.md section 3, no surprise charges at payment).
 */

import {
  effectiveShippingSwitch,
  formatINR,
  IN_STOCK_PER_PERSON_LIMIT,
  MAX_WEB_JARS,
  normaliseShippingSwitch,
  shippingFeeFor,
} from "@lailark/shared";

export { formatINR };

/** `?p=<slug>&q=<jars>`, read off a URL string. Nothing is trusted. */
export function readCheckoutQuery(search) {
  let params;
  try {
    params = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return { slug: null, qty: 1 };
  }
  const slug = params.get("p");
  const qty = Number.parseInt(params.get("q") ?? "1", 10);
  return {
    slug: typeof slug === "string" && /^[a-z0-9][a-z0-9-]{1,48}$/.test(slug) ? slug : null,
    qty: Number.isInteger(qty) && qty >= 1 && qty <= 20 ? qty : 1,
  };
}

/**
 * How many jars this page may offer. Brief 4.1: two online on an in-stock
 * batch, the batch's own cap on an open one, and never more jars than are
 * actually takeable, so the picker cannot offer something the server would
 * refuse.
 *
 * Two things it reads rather than works out for itself.
 *
 * **The cap.** `perPersonLimit` comes off `/api/counts`, which resolves it
 * exactly as the hold does (D52: the Owner's typed number is the authority
 * in both directions). A zero is therefore a real cap and offers nothing;
 * only a missing or malformed field falls back, and the fallback is the
 * tighter of the two.
 *
 * **What is free.** `available` is capacity less paid less every **live
 * hold**. `total - count` is not: on an open batch `count` is the paid
 * marks, so subtracting it offered the jar somebody else was in the middle
 * of paying for, and the customer met brief 9.3's refusal at the Pay button
 * instead of an honest picker.
 *
 * And one ceiling of its own: `MAX_WEB_JARS`, the most jars one web order
 * may carry whatever the batch allows. `parseCheckoutRequest` refuses
 * anything above it, and a batch may run to forty jars with a per-person
 * limit the Owner typed himself (D52), so without this the picker offered
 * jar counts the callable was always going to turn away.
 */
export function jarChoicesFor(entry) {
  if (!entry || (entry.mode !== "inStock" && entry.mode !== "open")) return [];
  const cap =
    Number.isInteger(entry.perPersonLimit) && entry.perPersonLimit >= 0
      ? entry.perPersonLimit
      : IN_STOCK_PER_PERSON_LIMIT;
  const free = Number.isInteger(entry.available) ? entry.available : null;
  if (free === null) return [];
  const most = Math.min(cap, free, MAX_WEB_JARS);
  if (most < 1) return [];
  return Array.from({ length: most }, (_, i) => i + 1);
}

/** The unit price this batch actually carries, in paise, or null. */
export function unitPaiseFor(entry) {
  if (!entry) return null;
  if (entry.mode === "inStock") {
    return Number.isInteger(entry.priceInStockPaise) ? entry.priceInStockPaise : null;
  }
  if (entry.mode === "open") {
    return Number.isInteger(entry.priceOpenPaise) ? entry.priceOpenPaise : null;
  }
  return null;
}

/**
 * `/api/counts`'s `shipping` block as `@lailark/shared` wants it: the
 * endpoint names the fee `flatFeePaise` because everything it sends is in
 * paise, and the settings document names it `flatFee`. One conversion, in
 * one place, rather than two shapes drifting apart.
 */
export function shippingSwitchFrom(shipping) {
  // Through the shared clamp, which is what `/api/counts` and the server's
  // own reader both use. Three readers of one document, one set of numbers.
  return normaliseShippingSwitch({
    rule: shipping?.rule,
    flatFee: shipping?.flatFeePaise,
    freeFromJars: shipping?.freeFromJars,
  });
}

/**
 * The three lines the page prints before the Pay button: jars, shipping and
 * the total. Returns null when any part of it is unknown, because a checkout
 * that cannot say the total honestly must not offer a Pay button at all.
 */
export function checkoutTotals(entry, qty, shipping, productRule = null) {
  const unit = unitPaiseFor(entry);
  if (unit === null) return null;
  if (!Number.isInteger(qty) || qty < 1) return null;
  const switchUsed = effectiveShippingSwitch(shippingSwitchFrom(shipping), productRule);
  const shippingFee = shippingFeeFor(switchUsed, qty);
  const subtotal = unit * qty;
  return {
    unitPaise: unit,
    qty,
    subtotalPaise: subtotal,
    shippingFeePaise: shippingFee,
    totalPaise: subtotal + shippingFee,
  };
}

/** "1 jar" / "3 jars". Read aloud, so it is never "1 jars". */
export function jarWords(qty) {
  return `${qty} jar${qty === 1 ? "" : "s"}`;
}
