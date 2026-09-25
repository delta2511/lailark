/**
 * The web checkout's arithmetic and its two gates, with no Firebase in it.
 *
 * It lives in `@lailark/shared` for the same reason `counterSale.ts` does:
 * the checkout page has to show the customer the same total the server is
 * about to charge, and the same shipping line the product card already
 * promised. Two separate sums eventually disagree, and the day they disagree
 * somebody is charged a number they were not shown. Brief §4.2 names that
 * exact failure ("drip pricing" under the CCPA dark patterns guidelines) and
 * CLAUDE.md §3 forbids it outright, so the sum is shared rather than
 * duplicated.
 *
 * Money is integers in paise throughout. Nothing here ever sees a rupee.
 */

import type { Paise } from "./money.js";
import type { ShippingRule } from "./states.js";

/* -------------------------------------------------------------------------- */
/* Shipping, brief §4.2 and decision D12                                      */
/* -------------------------------------------------------------------------- */

/** `settings/shipping` as the fee calculation reads it. */
export interface ShippingSwitch {
  readonly rule: ShippingRule;
  /** D12: ₹60, editable. Only meaningful when the rule is not `free`. */
  readonly flatFee: Paise;
  /** `freeOnTwo`: the jar count at which the fee stops. Brief §4.2 says two. */
  readonly freeFromJars: number;
}

/** What the switch is at launch, and what a missing document reads as. */
export const DEFAULT_SHIPPING_SWITCH: ShippingSwitch = {
  rule: "free",
  flatFee: 6_000,
  freeFromJars: 2,
};

/**
 * `settings/shipping` as read off a document, clamped to numbers the fee
 * calculation can actually use. **Both sides read this, never one of them.**
 *
 * The clamp used to live on the publishing side alone: `/api/counts` floored
 * `freeFromJars` and the server's own reader passed the raw field through,
 * so a `freeFromJars` of `3.5` in Settings gave the page one total and the
 * server another, and every two-jar order was refused with "This now comes
 * to ₹1,298, not ₹1,358." The same held for a fractional `flatFee`. Nothing
 * upstream constrains either field: there is no writer for them in the
 * admin, in `firestore.rules` or in the seed scripts, so a hand-edited
 * document is the only way they are set at all.
 *
 * So the clamp is here, in the one module both sides already import for the
 * sum itself. Money stays an integer number of paise (CLAUDE.md §3), a fee
 * is never negative, and `freeFromJars` is never below the two of brief
 * §4.2. A missing or unusable field falls back to {@link
 * DEFAULT_SHIPPING_SWITCH} rather than to zero, because a zero fee that
 * should have been ₹60 is a charge that appears later, which is exactly
 * what §4.2 forbids.
 */
export function normaliseShippingSwitch(raw: {
  readonly rule?: unknown;
  readonly flatFee?: unknown;
  readonly freeFromJars?: unknown;
}): ShippingSwitch {
  const rule = SHIPPING_RULE_NAMES.includes(String(raw.rule))
    ? (raw.rule as ShippingRule)
    : DEFAULT_SHIPPING_SWITCH.rule;
  const fee = raw.flatFee;
  const from = raw.freeFromJars;
  return {
    rule,
    flatFee:
      typeof fee === "number" && Number.isFinite(fee)
        ? Math.max(0, Math.floor(fee))
        : DEFAULT_SHIPPING_SWITCH.flatFee,
    freeFromJars:
      typeof from === "number" && Number.isFinite(from)
        ? Math.max(DEFAULT_SHIPPING_SWITCH.freeFromJars, Math.floor(from))
        : DEFAULT_SHIPPING_SWITCH.freeFromJars,
  };
}

/** The three positions of the one switch, brief §4.2. */
const SHIPPING_RULE_NAMES: readonly string[] = ["free", "flatFee", "freeOnTwo"];

/**
 * What one order pays for shipping.
 *
 * Brief §4.2, all three positions of the one switch:
 *
 *  - `free`: no shipping line at all. This is launch (D12).
 *  - `flatFee`: one amount per order, whatever the jar count.
 *  - `freeOnTwo`: the fee on a one-jar order, nothing from two jars up.
 *
 * A counter sale handed over in person never carries a shipping line, which
 * is why `saleTotals` takes the fee as an argument and this function is only
 * ever asked about a shipped web order.
 */
export function shippingFeeFor(
  ship: ShippingSwitch,
  jars: number,
): Paise {
  if (!Number.isInteger(jars) || jars < 1) return 0;
  const fee = Number.isSafeInteger(ship.flatFee) && ship.flatFee > 0 ? ship.flatFee : 0;
  if (ship.rule === "free") return 0;
  if (ship.rule === "flatFee") return fee;
  // freeOnTwo: the fee applies below the threshold and stops at it.
  const from = Number.isInteger(ship.freeFromJars) && ship.freeFromJars > 1 ? ship.freeFromJars : 2;
  return jars >= from ? 0 : fee;
}

/**
 * The effective switch for one product.
 *
 * ASSUMED (M3.5): the **global** switch is the master, exactly as A55 reads
 * §17.11 ("the global off switch is a Settings field, not a product field").
 * So while `settings/shipping.rule` is `free` nothing is charged for
 * anything, whatever a product carries; only once the Owner moves the global
 * switch off `free` does a product's own `shippingRule` take over for that
 * product. The safe direction is deliberate: the product card reads the
 * global switch (M3.3's `ProductShippingLine`), so a product rule that could
 * charge while the card says "Shipping is free." would be the surprise
 * charge CLAUDE.md §3 forbids.
 */
export function effectiveShippingSwitch(
  global: ShippingSwitch,
  productRule: ShippingRule | null | undefined,
): ShippingSwitch {
  if (global.rule === "free") return global;
  if (productRule === null || productRule === undefined) return global;
  return { ...global, rule: productRule };
}

/* -------------------------------------------------------------------------- */
/* Where we will send it, brief §11.5                                         */
/* -------------------------------------------------------------------------- */

/** Six digits, never starting with a zero. The same shape `sale.ts` uses. */
const PINCODE = /^[1-9]\d{5}$/;

export function isPincode(value: unknown): value is string {
  return typeof value === "string" && PINCODE.test(value);
}

/**
 * `settings/pincodes` as the checkout reads it, plus the switch that decides
 * whether the list refuses anything.
 *
 * ASSUMED (M3.5): the serviceable list is an **allow list only when the Owner
 * switches it on** (`enforce: true`) and it is not empty. Otherwise every
 * well-formed Indian pincode is accepted. Brief §11.5 says the list comes
 * from Shiprocket and that "India Post covers the rest", and D33 says India
 * Post is the only courier at launch, so a pincode missing from a Shiprocket
 * list is not a pincode we cannot deliver to: refusing it would turn a
 * courier's coverage map into a wall across the customer's order. The check
 * is built, and switched off, which is the same shape §11.5 asks for on the
 * product rule.
 */
export interface PincodeList {
  readonly serviceable: readonly string[];
  /** Off unless the Owner has set a literal `true`. */
  readonly enforce: boolean;
}

/** What a missing `settings/pincodes` document reads as. */
export const DEFAULT_PINCODE_LIST: PincodeList = { serviceable: [], enforce: false };

/**
 * A product's own shipping restriction. Brief §11.5: "Product shipping rule
 * (allowed states, excluded pincodes): **built, switched off** for beef for
 * now."
 *
 * ASSUMED (M3.5): the two field names on `products/{slug}`. Both are absent
 * on every seeded product, and absent means no restriction, which is what
 * "switched off" has to mean for the four heroes selling today.
 */
export interface ProductShippingRestriction {
  /** Two-letter state codes a product may be sent to. Null or empty: all. */
  readonly allowedStates: readonly string[] | null;
  /** Pincodes this product is never sent to. */
  readonly excludedPincodes: readonly string[] | null;
}

export type DeliveryRefusal =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "malformed" | "notServiceable" | "productNotShipped";
    };

/**
 * Whether we can send this product to this address. Brief §6.1 step 3:
 * "Pincode checked against serviceable list and the product's shipping rule."
 *
 * Order matters. A malformed pincode is a typing slip, and saying so is more
 * use than saying we do not deliver there; the product rule is asked last
 * because it is the narrowest of the three, so the customer hears the widest
 * true reason first.
 */
export function checkDeliverable(args: {
  readonly pincode: string;
  readonly state: string;
  readonly list: PincodeList;
  readonly product: ProductShippingRestriction;
}): DeliveryRefusal {
  const { pincode, state, list, product } = args;

  if (!isPincode(pincode)) return { ok: false, reason: "malformed" };

  if (list.enforce && list.serviceable.length > 0 && !list.serviceable.includes(pincode)) {
    return { ok: false, reason: "notServiceable" };
  }

  const excluded = product.excludedPincodes ?? [];
  if (excluded.includes(pincode)) return { ok: false, reason: "productNotShipped" };

  const allowed = product.allowedStates ?? [];
  if (allowed.length > 0 && !allowed.includes(normaliseState(state))) {
    return { ok: false, reason: "productNotShipped" };
  }

  return { ok: true };
}

/** `"kerala"`, `" KL "` and `"Kl"` are all `"KL"` for comparison purposes. */
export function normaliseState(state: string): string {
  return typeof state === "string" ? state.trim().toUpperCase() : "";
}

/* -------------------------------------------------------------------------- */
/* The hold, brief §9.3                                                       */
/* -------------------------------------------------------------------------- */

/**
 * "Jars **held** for 15 minutes" (brief §6.1 step 4, §9.3). The number lives
 * here rather than only in the callable so the checkout page can say the same
 * thing the server is doing.
 */
export const WEB_HOLD_MINUTES = 15;

/** The most jars one web order may carry, whatever the batch's own limit is. */
export const MAX_WEB_JARS = 20;
