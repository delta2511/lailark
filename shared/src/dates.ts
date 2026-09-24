/**
 * Calendar dates, timezone-free.
 *
 * Every date this business cares about is a calendar date: a packing date, a
 * best before, a sale stop, a financial year boundary. None of them is an
 * instant. Doing arithmetic on a JavaScript `Date` for those drags in the host
 * timezone, DST and UTC boundaries, and silently shifts a date by a day. So
 * the package works on {@link CalDate} values and converts to and from days
 * since the Unix epoch with integer maths only.
 *
 * The one place an instant appears is "what is today", which is decided in
 * Asia/Kolkata (a fixed +05:30 offset, no DST, ever). {@link kolkataDate}
 * turns an instant into the Kolkata calendar date.
 */

/** A calendar date. `m` is 1-12, `d` is 1-31. No time, no zone. */
export interface CalDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

/** Asia/Kolkata is UTC+05:30 and has no daylight saving. */
export const KOLKATA_UTC_OFFSET_MINUTES = 330;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) {
    return isLeapYear(y) ? 29 : 28;
  }
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export function isValidCalDate(date: CalDate): boolean {
  const { y, m, d } = date;
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return false;
  }
  if (m < 1 || m > 12 || d < 1) {
    return false;
  }
  return d <= daysInMonth(y, m);
}

function assertValid(date: CalDate, label = "date"): CalDate {
  if (!isValidCalDate(date)) {
    throw new RangeError(`${label} is not a calendar date: ${JSON.stringify(date)}`);
  }
  return date;
}

/** `{ y: 2026, m: 9, d: 4 }` -> `"2026-09-04"`. */
export function formatCalDate(date: CalDate): string {
  assertValid(date);
  const y = String(date.y).padStart(4, "0");
  const m = String(date.m).padStart(2, "0");
  const d = String(date.d).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `"2026-09-04"` -> `{ y: 2026, m: 9, d: 4 }`. Strict: rejects `"2026-9-4"`. */
export function parseCalDate(text: string): CalDate {
  const match = ISO_DATE.exec(text);
  if (!match) {
    throw new RangeError(`not a YYYY-MM-DD date: ${JSON.stringify(text)}`);
  }
  const date = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  return assertValid(date, JSON.stringify(text));
}

/** Accepts either spelling of a calendar date, so callers can pass strings. */
export type CalDateInput = CalDate | string;

export function toCalDate(input: CalDateInput): CalDate {
  return typeof input === "string" ? parseCalDate(input) : assertValid(input);
}

/**
 * Days since 1970-01-01, by Howard Hinnant's `days_from_civil`. Pure integer
 * arithmetic, correct for any proleptic Gregorian date, no `Date` involved.
 */
export function toDayNumber(input: CalDateInput): number {
  const { y, m, d } = toCalDate(input);
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The inverse of {@link toDayNumber}: Hinnant's `civil_from_days`. */
export function fromDayNumber(days: number): CalDate {
  if (!Number.isInteger(days)) {
    throw new RangeError(`day number must be an integer: ${days}`);
  }
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const yy = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yy + (m <= 2 ? 1 : 0), m, d };
}

export function addDays(input: CalDateInput, days: number): CalDate {
  if (!Number.isInteger(days)) {
    throw new RangeError(`days must be an integer: ${days}`);
  }
  return fromDayNumber(toDayNumber(input) + days);
}

export function subtractDays(input: CalDateInput, days: number): CalDate {
  return addDays(input, -days);
}

/** `a - b`, in whole days. Positive when `a` is later. */
export function diffDays(a: CalDateInput, b: CalDateInput): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** Negative, zero or positive, for sorting. */
export function compareCalDate(a: CalDateInput, b: CalDateInput): number {
  const left = toDayNumber(a);
  const right = toDayNumber(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isBefore(a: CalDateInput, b: CalDateInput): boolean {
  return compareCalDate(a, b) < 0;
}

export function isAfter(a: CalDateInput, b: CalDateInput): boolean {
  return compareCalDate(a, b) > 0;
}

export function isSameDate(a: CalDateInput, b: CalDateInput): boolean {
  return compareCalDate(a, b) === 0;
}

/**
 * Calendar month arithmetic with end-of-month clamping.
 *
 * The day of month is kept when the target month is long enough, and clamped
 * to the last day of the target month when it is not. So 31 August + 6 months
 * is 28 February (29 February in a leap year), not 3 March.
 */
export function addMonths(input: CalDateInput, months: number): CalDate {
  if (!Number.isInteger(months)) {
    throw new RangeError(`months must be an integer: ${months}`);
  }
  const { y, m, d } = toCalDate(input);
  const zeroBased = (y * 12 + (m - 1)) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = zeroBased - targetYear * 12 + 1;
  const clamped = Math.min(d, daysInMonth(targetYear, targetMonth));
  return { y: targetYear, m: targetMonth, d: clamped };
}

/** A Firestore `Timestamp` satisfies this structurally. See `types/base.ts`. */
export interface TimestampLike {
  readonly seconds: number;
  readonly nanoseconds: number;
}

/** Anything that names an instant: epoch millis, a `Date`, or a Timestamp. */
export type InstantInput = number | Date | TimestampLike;

/** Epoch milliseconds for any instant spelling the package accepts. */
export function toEpochMillis(instant: InstantInput): number {
  if (typeof instant === "number") {
    if (!Number.isFinite(instant)) {
      throw new RangeError(`epoch millis must be finite: ${instant}`);
    }
    return instant;
  }
  if (instant instanceof Date) {
    const ms = instant.getTime();
    if (Number.isNaN(ms)) {
      throw new RangeError("invalid Date");
    }
    return ms;
  }
  return instant.seconds * 1000 + Math.floor(instant.nanoseconds / 1_000_000);
}

/**
 * The Asia/Kolkata calendar date an instant falls on. This is the only
 * function that turns an instant into a date: everything the business decides
 * by "today" (sale stop, dispatch cut-off, financial year) decides it here.
 */
export function kolkataDate(instant: InstantInput): CalDate {
  const shifted = toEpochMillis(instant) + KOLKATA_UTC_OFFSET_MINUTES * MS_PER_MINUTE;
  return fromDayNumber(Math.floor(shifted / MS_PER_DAY));
}

/** Midnight Asia/Kolkata on `date`, as epoch millis. */
export function kolkataStartOfDay(input: CalDateInput): number {
  return toDayNumber(input) * MS_PER_DAY - KOLKATA_UTC_OFFSET_MINUTES * MS_PER_MINUTE;
}

/* -------------------------------------------------------------------------- */
/* The business day (M2.8)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * When one working day of this kitchen ends and the next begins, as an hour
 * in Asia/Kolkata.
 *
 * **Why this is not midnight.** Brief section 7A.6 lets either role "void a
 * sale entered by mistake (same day, before the bill is sent)". Read as the
 * calendar date, "same day" breaks in exactly the situation it exists for: a
 * jar sold at the door at 23:50 and a wrong number spotted at 00:10 while the
 * counter is still being tidied would be two different days, and the mistake
 * would be un-voidable twenty minutes after it was made. A kitchen that
 * closes after midnight is one working evening, not two days.
 *
 * So a Lailark day runs from 05:00 to 05:00. A sale belongs to the business
 * day its `createdAt` falls in, and may be voided while the clock is still in
 * that same business day: an evening sale stays voidable until five the next
 * morning, and a sale entered at 00:20 belongs to the evening it was part of.
 *
 * 05:00 rather than 04:00 or 06:00 because nothing is ever sold at the door
 * at five in the morning, which is what makes it a safe seam: no sale can
 * land on the wrong side of it by being a little late. Day close (brief 7A.3,
 * M2.11) totals the same window, so the sales a day close covers are exactly
 * the sales that were voidable that day.
 *
 * ASSUMED (M2.8): the brief says "same day" and names no hour.
 */
export const BUSINESS_DAY_START_HOUR_IST = 5;

const MS_PER_HOUR = 3_600_000;

/**
 * The business day an instant belongs to, named by its **opening** calendar
 * date in Asia/Kolkata. 23:50 on 21 Sep and 00:20 on 22 Sep are both the
 * business day `{ y: 2026, m: 9, d: 21 }`.
 */
export function businessDay(
  instant: InstantInput,
  startHour: number = BUSINESS_DAY_START_HOUR_IST,
): CalDate {
  return kolkataDate(toEpochMillis(instant) - startHour * MS_PER_HOUR);
}

/** `"2026-09-21"`, the business day's own name. Day close is keyed by this. */
export function businessDayKey(
  instant: InstantInput,
  startHour: number = BUSINESS_DAY_START_HOUR_IST,
): string {
  return formatCalDate(businessDay(instant, startHour));
}

/**
 * Whether two instants fall in the same business day. This is the whole of
 * "same day" in brief 7A.6's void rule.
 */
export function inSameBusinessDay(
  a: InstantInput,
  b: InstantInput,
  startHour: number = BUSINESS_DAY_START_HOUR_IST,
): boolean {
  return businessDayKey(a, startHour) === businessDayKey(b, startHour);
}
