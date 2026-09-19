/**
 * Batch maths: the 90% cap, shelf life, and the last-jar arithmetic.
 *
 * Every function here is pure. The Firestore transaction that actually takes a
 * hold lives in `functions/`; this module is the arithmetic it runs on, so the
 * site, the admin and the server all agree on what a number means before
 * anybody writes one.
 */

import {
  addMonths,
  type CalDate,
  type CalDateInput,
  diffDays,
  type InstantInput,
  isAfter,
  subtractDays,
  toCalDate,
  toEpochMillis,
} from "./dates.js";

/* -------------------------------------------------------------------------- */
/* The 90% cap, brief section 7.1                                             */
/* -------------------------------------------------------------------------- */

/** 9/10, kept as two integers so the maths never touches a float. */
export const BOOKABLE_NUMERATOR = 9;
export const BOOKABLE_DENOMINATOR = 10;

/** A quarter of the bookable jars, rounded down, minimum 1. Section 4.1. */
export const PER_PERSON_LIMIT_DIVISOR = 4;

function assertWholeJars(jars: number, label: string): number {
  if (!Number.isInteger(jars) || jars < 0) {
    throw new RangeError(`${label} must be a whole number of jars, got ${jars}`);
  }
  return jars;
}

/**
 * At most 90% of the planned jars, rounded down. The other 10% is the buffer
 * for a pot that yields less, so nobody pays and then hears there is no jar.
 *
 * Computed as `floor(planned * 9 / 10)` rather than `floor(planned * 0.9)`,
 * because 20 * 0.9 is 18.000000000000004 in binary floating point and 40 * 0.9
 * is 36.00000000000001. Both happen to floor correctly, but the integer form
 * cannot be wrong at any size.
 */
export function bookableJars(plannedJars: number): number {
  assertWholeJars(plannedJars, "plannedJars");
  return Math.floor((plannedJars * BOOKABLE_NUMERATOR) / BOOKABLE_DENOMINATOR);
}

/** Half of the bookable number, rounded up. Section 7.1. */
export function halfOfBookable(bookable: number): number {
  assertWholeJars(bookable, "bookableJars");
  return Math.ceil(bookable / 2);
}

/** A quarter of the bookable jars, rounded down, minimum 1. Section 4.1. */
export function perPersonLimit(bookable: number): number {
  assertWholeJars(bookable, "bookableJars");
  return Math.max(1, Math.floor(bookable / PER_PERSON_LIMIT_DIVISOR));
}

export interface BatchMaths {
  readonly plannedJars: number;
  readonly bookableJars: number;
  readonly halfJars: number;
  readonly perPersonLimit: number;
}

/** Every derived count for a batch, from the planned jar count alone. */
export function batchMaths(plannedJars: number): BatchMaths {
  const bookable = bookableJars(plannedJars);
  return {
    plannedJars,
    bookableJars: bookable,
    halfJars: halfOfBookable(bookable),
    perPersonLimit: perPersonLimit(bookable),
  };
}

/** Anything the pot gives beyond the bookable jars goes on sale in stock. */
export function surplusJars(bottledJars: number, bookedJars: number): number {
  assertWholeJars(bottledJars, "bottledJars");
  assertWholeJars(bookedJars, "bookedJars");
  return Math.max(0, bottledJars - bookedJars);
}

/**
 * The per-person cap, checked across every order this customer already has in
 * this batch. Brief section 7.2 step 3.
 */
export function withinPerPersonLimit(
  existingJarsInBatch: number,
  requested: number,
  limit: number,
): boolean {
  assertWholeJars(existingJarsInBatch, "existingJarsInBatch");
  assertWholeJars(limit, "limit");
  if (!Number.isInteger(requested) || requested < 1) {
    return false;
  }
  return existingJarsInBatch + requested <= limit;
}

/** How many more jars this customer may still take in this batch. */
export function remainingPerPersonAllowance(existingJarsInBatch: number, limit: number): number {
  assertWholeJars(existingJarsInBatch, "existingJarsInBatch");
  assertWholeJars(limit, "limit");
  return Math.max(0, limit - existingJarsInBatch);
}

/* -------------------------------------------------------------------------- */
/* Shelf life, brief section 6.2                                              */
/* -------------------------------------------------------------------------- */

/** Six months from packing. Batch 001: packed 4 Sep 2026, best before 4 Mar 2027. */
export const SHELF_LIFE_MONTHS = 6;

/** The same shelf life in days, which is what the 30% test is taken on. */
export const SHELF_LIFE_DAYS = 180;

export interface ShelfLifeRule {
  /** Calendar months from packing to the printed best before. */
  readonly shelfLifeMonths: number;
  /** FSSAI: at least this fraction of the shelf life must be left on arrival. */
  readonly minRemainingFraction: number;
  /** ...or this many days, whichever is greater. */
  readonly minRemainingDays: number;
  /** Days allowed between dispatch and the jar reaching the customer. */
  readonly transitDays: number;
  /** How far ahead of the sale stop the admin is warned. */
  readonly warnDays: number;
}

/**
 * The rule as brief section 6.2 states it, as settings-able inputs. Held here
 * as defaults only: the live values live in `settings/shelfLife`.
 */
export const DEFAULT_SHELF_LIFE_RULE: ShelfLifeRule = {
  shelfLifeMonths: SHELF_LIFE_MONTHS,
  minRemainingFraction: 0.3,
  minRemainingDays: 45,
  transitDays: 7,
  warnDays: 14,
};

/**
 * The printed best before: six calendar months from the packing date, with
 * end-of-month clamping (see `addMonths`). 4 Sep 2026 gives 4 Mar 2027, which
 * is what is on the 22 jars of batch 001.
 */
export function bestBefore(
  packedOn: CalDateInput,
  months: number = SHELF_LIFE_MONTHS,
): CalDate {
  return addMonths(toCalDate(packedOn), months);
}

/**
 * The minimum shelf life that must be left when the jar reaches the customer:
 * 30% of the shelf life or 45 days, whichever is more. On a 180 day shelf life
 * that is 54 days, as section 6.2 says.
 */
export function minRemainingDaysOnArrival(
  shelfLifeDays: number = SHELF_LIFE_DAYS,
  rule: ShelfLifeRule = DEFAULT_SHELF_LIFE_RULE,
): number {
  return Math.max(Math.ceil(shelfLifeDays * rule.minRemainingFraction), rule.minRemainingDays);
}

/**
 * The last day an in-stock jar from this batch may be dispatched online.
 *
 *     saleStopOn = bestBefore - max(30% of shelfLifeDays, 45) - transitDays
 *
 * Counted back from the printed best before, not forward from packing,
 * because the best before is what the customer holds and what FSSAI measures
 * the remaining life against.
 *
 * Batch 001: best before 4 Mar 2027, minus 54 days is 9 Jan 2027, minus 7 days
 * in transit is **2 January 2027**, which is 120 days after packing. That is
 * exactly the "about 120 days" and "about 2 January 2027" of section 6.2.
 *
 * Counter sales of an older jar are still allowed up to the best before; this
 * date only hides the Buy button on the site.
 */
export function saleStopOn(
  packedOn: CalDateInput,
  shelfLifeDays: number = SHELF_LIFE_DAYS,
  rule: ShelfLifeRule = DEFAULT_SHELF_LIFE_RULE,
): CalDate {
  const end = bestBefore(packedOn, rule.shelfLifeMonths);
  return subtractDays(end, minRemainingDaysOnArrival(shelfLifeDays, rule) + rule.transitDays);
}

/** The date the admin starts warning: 14 days before the sale stop. */
export function saleStopWarnOn(
  packedOn: CalDateInput,
  shelfLifeDays: number = SHELF_LIFE_DAYS,
  rule: ShelfLifeRule = DEFAULT_SHELF_LIFE_RULE,
): CalDate {
  return subtractDays(saleStopOn(packedOn, shelfLifeDays, rule), rule.warnDays);
}

export interface ShelfLife {
  readonly packedOn: CalDate;
  readonly bestBefore: CalDate;
  readonly saleStopOn: CalDate;
  readonly saleStopWarnOn: CalDate;
}

/** Every shelf-life date a bottled batch needs, in one call. */
export function shelfLife(
  packedOn: CalDateInput,
  shelfLifeDays: number = SHELF_LIFE_DAYS,
  rule: ShelfLifeRule = DEFAULT_SHELF_LIFE_RULE,
): ShelfLife {
  return {
    packedOn: toCalDate(packedOn),
    bestBefore: bestBefore(packedOn, rule.shelfLifeMonths),
    saleStopOn: saleStopOn(packedOn, shelfLifeDays, rule),
    saleStopWarnOn: saleStopWarnOn(packedOn, shelfLifeDays, rule),
  };
}

/** The day after which the Buy button is hidden. Inclusive of the stop date. */
export function isOnlineSaleAllowed(
  today: CalDateInput,
  packedOn: CalDateInput,
  shelfLifeDays: number = SHELF_LIFE_DAYS,
  rule: ShelfLifeRule = DEFAULT_SHELF_LIFE_RULE,
): boolean {
  return !isAfter(today, saleStopOn(packedOn, shelfLifeDays, rule));
}

/** Days remaining from packing to the sale stop. 120 for batch 001. */
export function daysToSaleStop(
  packedOn: CalDateInput,
  shelfLifeDays: number = SHELF_LIFE_DAYS,
  rule: ShelfLifeRule = DEFAULT_SHELF_LIFE_RULE,
): number {
  return diffDays(saleStopOn(packedOn, shelfLifeDays, rule), packedOn);
}

/* -------------------------------------------------------------------------- */
/* Holds and the last jar, brief section 9.3                                  */
/* -------------------------------------------------------------------------- */

/** One entry of `batches/{ref}.heldJars`, keyed by order id. */
export interface HeldJar {
  readonly qty: number;
  readonly expiresAt: InstantInput;
}

export type HeldJars = Readonly<Record<string, HeldJar>>;

/**
 * Jars held right now. A hold counts only while its expiry is in the future,
 * so a lapsed hold frees its jar even when the clean-up job is late.
 */
export function liveHeldJars(heldJars: HeldJars | undefined, now: InstantInput): number {
  if (!heldJars) {
    return 0;
  }
  const nowMillis = toEpochMillis(now);
  let total = 0;
  for (const hold of Object.values(heldJars)) {
    if (toEpochMillis(hold.expiresAt) > nowMillis) {
      total += assertWholeJars(hold.qty, "hold qty");
    }
  }
  return total;
}

export interface OpenBatchAvailabilityInput {
  readonly bookableJars: number;
  readonly paidCount: number;
  readonly heldJars?: HeldJars;
  readonly now: InstantInput;
}

export interface BatchAvailability {
  /** The ceiling this availability is measured against. */
  readonly capacity: number;
  readonly paidCount: number;
  readonly liveHeldJars: number;
  /** `capacity - paid - live holds`, never below zero. */
  readonly available: number;
  /** No jar is free: every one is paid for, held, or gone. */
  readonly isFull: boolean;
  /** Every free jar is held by somebody else right now. Section 9.3's message. */
  readonly heldOutByOthers: boolean;
}

/**
 * Open batch: `available = bookable - paid - live holds`. Brief section 9.3.
 *
 * `heldOutByOthers` is true when there is nothing available but a live hold is
 * the reason, which is the case the site answers with "someone is paying for
 * the last jar, check back in 15 minutes" and a notify-me, rather than "sold
 * out".
 */
export function batchAvailability(input: OpenBatchAvailabilityInput): BatchAvailability {
  const capacity = assertWholeJars(input.bookableJars, "bookableJars");
  const paid = assertWholeJars(input.paidCount, "paidCount");
  const held = liveHeldJars(input.heldJars, input.now);
  const available = Math.max(0, capacity - paid - held);
  return {
    capacity,
    paidCount: paid,
    liveHeldJars: held,
    available,
    isFull: available === 0,
    heldOutByOthers: available === 0 && held > 0,
  };
}

export interface InStockAvailabilityInput {
  readonly bottledJars: number;
  readonly paidCount: number;
  readonly heldJars?: HeldJars;
  readonly writtenOff?: number;
  readonly now: InstantInput;
}

/**
 * In stock: `available = bottled - paid - live holds - written off`.
 * Brief section 6.2: the shown count is never typed by hand.
 */
export function inStockAvailability(input: InStockAvailabilityInput): BatchAvailability {
  const bottled = assertWholeJars(input.bottledJars, "bottledJars");
  const writtenOff = assertWholeJars(input.writtenOff ?? 0, "writtenOff");
  return batchAvailability({
    bookableJars: Math.max(0, bottled - writtenOff),
    paidCount: input.paidCount,
    heldJars: input.heldJars,
    now: input.now,
  });
}

/** Can this many jars be held right now? The predicate the transaction uses. */
export function canHold(availability: BatchAvailability, qty: number): boolean {
  if (!Number.isInteger(qty) || qty < 1) {
    return false;
  }
  return qty <= availability.available;
}
