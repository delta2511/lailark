/**
 * The arithmetic and the rights of a counter sale (brief sections 7A.1 and
 * 7A.6), with no Firebase and no Firestore in it.
 *
 * It lives in `@lailark/shared` rather than in the callable because the Sell
 * screen has to show the person at the counter the same total the server is
 * about to charge, and the same discount box the server is about to allow. If
 * the two computed it separately they would eventually disagree, and the day
 * they disagree somebody is charged a number they were not shown. Sharing the
 * function makes "what you are told you will pay is what is charged"
 * (CLAUDE.md section 3) true by construction rather than by care.
 *
 * Money is integers in paise throughout. Nothing here ever sees a rupee.
 */

import {
  addPaise,
  type Paise,
  MRP_PAISE,
  multiplyPaise,
  subtractPaise,
} from "./money.js";
import type { Role } from "./states.js";

/* -------------------------------------------------------------------------- */
/* Lines                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The three things brief 7A.1 step 2 lets a counter sale be.
 *
 *  - `product`: a standard jar out of stock, at the batch's in-stock price.
 *  - `openBatch`: a jar booked in a batch that is still open, at the open
 *    price, counted inside the same 90% cap as a web booking.
 *  - `custom`: "a free description and an amount, for anything that is not a
 *    standard jar". It may still be tied to a batch, so jars leave the count.
 */
export const SALE_LINE_KINDS = ["product", "openBatch", "custom"] as const;
export type SaleLineKind = (typeof SALE_LINE_KINDS)[number];

/** A line as both the screen and the server hold it, before it is an order. */
export interface SaleLineAmounts {
  readonly kind: SaleLineKind;
  /** Paise. For a custom line this is the whole agreed amount for one unit. */
  readonly unitPrice: Paise;
  readonly qty: number;
  /**
   * The batch this line takes its jars from, when one is known. A product or
   * open-batch line always takes jars, even before the server has picked
   * which batch; a custom line takes them only when it is tied to one.
   */
  readonly batchRef?: string | null;
}

/**
 * Does this line move stock?
 *
 * A custom line is usually a service or a thing that is not a jar, so it
 * counts nothing. But brief 7A.1 step 2 allows one to be tied to a batch, and
 * then jars really do leave the count. A void decides the same question by
 * asking whether the stored line carries a `batchRef`
 * (`voidCounterSale.ts`), so this has to be asked the same way here, or a
 * sale and its own undo disagree about what a jar is: the customer's history
 * is credited nothing at the counter and debited the lot when the sale is
 * taken back.
 */
export function lineTakesJars(line: SaleLineAmounts): boolean {
  return line.kind !== "custom" || (line.batchRef !== null && line.batchRef !== undefined);
}

/**
 * The most a single custom line may come to, as a guard against a typing
 * slip rather than a business rule: an extra zero on an agreed amount is the
 * one mistake at this box that nothing downstream would catch, because a
 * custom line has no list price to compare against.
 *
 * ASSUMED (M2.8): the brief sets no ceiling on a custom line. One lakh is far
 * above anything a home kitchen sells across a counter in one line, so it
 * refuses only typos. An Owner with a genuinely larger order splits it.
 */
export const MAX_CUSTOM_LINE_PAISE: Paise = 100_000_00;

/** A whole jar count. Fractions of a jar do not exist. */
export const MAX_SALE_QTY = 200;

export function saleLineTotal(line: SaleLineAmounts): Paise {
  return multiplyPaise(line.unitPrice, line.qty);
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                     */
/* -------------------------------------------------------------------------- */

export interface SaleTotalsInput {
  readonly lines: readonly SaleLineAmounts[];
  /** Brief 7A.1 step 3. Never negative, never more than the subtotal. */
  readonly discount: Paise;
  /** Free at launch (D12 sets the fee for the day the switch is used). */
  readonly shippingFee?: Paise;
}

export interface SaleTotals {
  readonly subtotal: Paise;
  readonly discount: Paise;
  readonly shippingFee: Paise;
  readonly total: Paise;
  readonly jars: number;
}

/**
 * The one total. A discount comes off the subtotal, shipping goes on after
 * it, and the result can never be negative: a discount larger than the
 * subtotal is refused before it gets here (see {@link checkDiscount}).
 */
export function saleTotals(input: SaleTotalsInput): SaleTotals {
  const subtotal = input.lines.reduce<Paise>((sum, line) => addPaise(sum, saleLineTotal(line)), 0);
  const shippingFee = input.shippingFee ?? 0;
  const discount = input.discount;
  return {
    subtotal,
    discount,
    shippingFee,
    total: addPaise(subtractPaise(subtotal, discount), shippingFee),
    // `jars` is what leaves a batch, and a custom line tied to one does.
    jars: input.lines.reduce((sum, line) => sum + (lineTakesJars(line) ? line.qty : 0), 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Discount rights, decision D17 and brief 7A.6                               */
/* -------------------------------------------------------------------------- */

/**
 * `settings/discountCap` as this module reads it. **Decision D17:** the cap
 * is set by the Owner in Settings, not in code, and it ships empty, which
 * means the Kitchen may not discount at all until he sets one.
 */
export interface DiscountRightsInput {
  readonly role: Role | string;
  /** `settings/discountCap.kitchenCap`. Null, absent or not a whole number of paise all mean no kitchen discount. */
  readonly kitchenCap: Paise | null | undefined;
}

export interface DiscountRights {
  /** Paise the caller may take off, or null for the Owner's "any amount". */
  readonly maxDiscount: Paise | null;
  readonly mayDiscount: boolean;
  /** Only the Owner may set a price by hand, or go past the cap (7A.6). */
  readonly mayChangePrice: boolean;
  /** Only the Owner may override a batch's per-person limit (7A.6). */
  readonly mayOverrideLimit: boolean;
}

/**
 * Who may take how much off, from the caller's role and the Owner's cap.
 *
 * The Owner is `maxDiscount: null`, which is "any amount, with a reason", not
 * "no discount". The Kitchen is the cap, and a cap that was never set is
 * zero: D17's "it ships empty (no kitchen discount) until the Owner sets it".
 * A Viewer sells nothing at all (brief 17.12), so it gets nothing here
 * either; the callable refuses a Viewer long before this is asked.
 */
export function discountRights(input: DiscountRightsInput): DiscountRights {
  if (input.role === "owner") {
    return { maxDiscount: null, mayDiscount: true, mayChangePrice: true, mayOverrideLimit: true };
  }
  if (input.role === "kitchen") {
    const cap =
      typeof input.kitchenCap === "number" && Number.isSafeInteger(input.kitchenCap) && input.kitchenCap > 0
        ? input.kitchenCap
        : 0;
    return { maxDiscount: cap, mayDiscount: cap > 0, mayChangePrice: false, mayOverrideLimit: false };
  }
  return { maxDiscount: 0, mayDiscount: false, mayChangePrice: false, mayOverrideLimit: false };
}

export type DiscountCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "notWholePaise" | "negative" | "overCap" | "overSubtotal" | "noReason" };

/**
 * Whether a discount of `discount` paise, with `reason`, is one this caller
 * may give. Brief 7A.1 step 3 and 7A.6: within the cap, with a reason, and
 * never more than the sale is worth.
 *
 * The server asks this with the cap it read from Settings itself, so a caller
 * that skips the screen and posts straight to the callable is measured
 * against the same number: the cap is never something the request carries.
 */
export function checkDiscount(args: {
  readonly discount: Paise;
  readonly reason: string;
  readonly subtotal: Paise;
  readonly rights: DiscountRights;
}): DiscountCheck {
  const { discount, reason, subtotal, rights } = args;

  if (!Number.isSafeInteger(discount)) return { ok: false, reason: "notWholePaise" };
  if (discount < 0) return { ok: false, reason: "negative" };
  if (discount === 0) return { ok: true };

  if (rights.maxDiscount !== null && discount > rights.maxDiscount) {
    return { ok: false, reason: "overCap" };
  }
  if (discount > subtotal) return { ok: false, reason: "overSubtotal" };
  // D17, both halves of it: "Kitchen may discount up to a cap, **with a
  // reason**" and "Owner unlimited **with reason**". Neither role gets to
  // take money off a sale without saying why.
  if (reason.trim() === "") return { ok: false, reason: "noReason" };

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Prices                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A standard jar's price is never above the printed MRP (CLAUDE.md section 3,
 * brief 7A.1 step 3: "A standard jar can never be sold above Rs 649 MRP"),
 * whoever is asking. A custom line is not a standard jar: a gift set of three
 * is legitimately more than one jar's MRP, so it is bounded by
 * {@link MAX_CUSTOM_LINE_PAISE} instead.
 */
export function isSellablePrice(kind: SaleLineKind, unitPrice: Paise): boolean {
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 1) return false;
  return kind === "custom" ? unitPrice <= MAX_CUSTOM_LINE_PAISE : unitPrice <= MRP_PAISE;
}
