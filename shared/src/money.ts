/**
 * Money.
 *
 * Hard rule (CLAUDE.md section 3): money is integers in paise. Never floats,
 * never rupees, anywhere in code or data. Rupees exist only in the string that
 * a human reads, which is what {@link formatINR} makes.
 */

/**
 * An amount in paise. 100 paise is 1 rupee.
 *
 * A plain `number` alias, not a branded type. A brand would need a cast at
 * every literal, and `site/` is plain JavaScript (DECISIONS A5) where a brand
 * buys nothing at all. The name carries the meaning; the rule is enforced by
 * never having a rupee-valued number in the first place.
 */
export type Paise = number;

export const PAISE_PER_RUPEE = 100;

/** Price of a 200 g jar sold in stock: Rs 649. Brief section 4.1. */
export const PRICE_IN_STOCK_PAISE: Paise = 64_900;

/** Price of a 200 g jar booked in an open batch: Rs 599. Brief section 4.1. */
export const PRICE_OPEN_PAISE: Paise = 59_900;

/** MRP printed on the label: Rs 649. Selling above it is never allowed. */
export const MRP_PAISE: Paise = 64_900;

/** Online per-person limit on an in-stock batch: 2 jars. Brief section 4.1. */
export const IN_STOCK_PER_PERSON_LIMIT = 2;

function assertPaise(value: number, label = "amount"): Paise {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer number of paise, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} is outside the safe integer range: ${value}`);
  }
  return value;
}

export function isPaise(value: unknown): value is Paise {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * For the one place rupees are legitimate: a number typed by a human into the
 * admin. Rounds half away from zero, so 6.495 becomes 650 paise, not 649.
 */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new RangeError(`rupees must be finite, got ${rupees}`);
  }
  const scaled = rupees * PAISE_PER_RUPEE;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return assertPaise(rounded, "rupees");
}

/** Only for display maths that is about to be rendered. Never for storage. */
export function paiseToRupees(paise: Paise): number {
  return assertPaise(paise) / PAISE_PER_RUPEE;
}

export function addPaise(...amounts: readonly Paise[]): Paise {
  let total = 0;
  for (const amount of amounts) {
    total += assertPaise(amount);
  }
  return assertPaise(total, "total");
}

export function subtractPaise(a: Paise, b: Paise): Paise {
  return assertPaise(assertPaise(a) - assertPaise(b), "difference");
}

/** A line total: a unit price times a whole quantity. Stays an integer. */
export function multiplyPaise(unit: Paise, quantity: number): Paise {
  assertPaise(unit, "unit price");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a whole number, got ${quantity}`);
  }
  return assertPaise(unit * quantity, "line total");
}

/**
 * Indian digit grouping: the last three digits, then pairs.
 * 1000 -> "1,000". 100000 -> "1,00,000". 10000000 -> "1,00,00,000".
 */
export function groupIndianDigits(digits: string): string {
  if (digits.length <= 3) {
    return digits;
  }
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${pairs},${last3}`;
}

export interface FormatINROptions {
  /**
   * Show `.00` even on a whole rupee amount. Off by default: a bill reads
   * "Rs 649", not "Rs 649.00". Turn it on for a column of figures that has to
   * line up.
   */
  readonly alwaysPaise?: boolean;
  /** Render the rupee sign. On by default. */
  readonly symbol?: boolean;
}

/**
 * Renders paise for a human.
 *
 * The rule: two decimal places only when there are paise to show. 64900 reads
 * as "Rs 649", 64950 reads as "Rs 649.50", 124800 reads as "Rs 1,248", and
 * 10000000 reads as "Rs 1,00,000". A negative amount takes the sign in front
 * of the symbol, as a refund line does: "-Rs 599".
 *
 * Hand-rolled rather than `Intl.NumberFormat` so the output is identical in
 * Node, in the browser and in an ICU-less build, and so it never depends on a
 * locale that happens to be set on the machine.
 */
export function formatINR(paise: Paise, options: FormatINROptions = {}): string {
  assertPaise(paise);
  const { alwaysPaise = false, symbol = true } = options;

  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / PAISE_PER_RUPEE);
  const remainder = absolute % PAISE_PER_RUPEE;

  let body = groupIndianDigits(String(rupees));
  if (remainder !== 0 || alwaysPaise) {
    body += `.${String(remainder).padStart(2, "0")}`;
  }

  return `${negative ? "-" : ""}${symbol ? "₹" : ""}${body}`;
}

/** True when the amount is at or below the printed MRP. */
export function isAtOrBelowMrp(paise: Paise, mrp: Paise = MRP_PAISE): boolean {
  return assertPaise(paise) <= assertPaise(mrp, "mrp");
}

/** Throws when a price would go above MRP. Selling below MRP is fine. */
export function assertAtOrBelowMrp(paise: Paise, mrp: Paise = MRP_PAISE): Paise {
  if (!isAtOrBelowMrp(paise, mrp)) {
    throw new RangeError(`${formatINR(paise)} is above the MRP of ${formatINR(mrp)}`);
  }
  return paise;
}
