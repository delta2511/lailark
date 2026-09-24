/**
 * Pure helpers over `Product` (brief section 17.8 and 18.1). The shape
 * itself lives in `types/catalogue.ts`; this file is the one place that
 * knows what a season window means.
 */
import type { CalDate } from "./dates.js";

const MONTH_DAY = /^(\d{2})-(\d{2})$/;

/** Non-leap day counts. 29 Feb is allowed on either side of a window: a
 * season boundary is a rule of thumb ("roughly November to February"), not a
 * date that has to exist every year. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** `"MM-DD"`: two-digit month 01-12, two-digit day valid for that month. */
export function isValidMonthDay(text: string): boolean {
  const match = MONTH_DAY.exec(text);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

function monthDayOrdinal(text: string): number {
  const [month, day] = text.split("-").map(Number);
  return month * 100 + day;
}

/**
 * Whether `date` falls inside a product's season window.
 *
 * `seasonStart` and `seasonEnd` are both `"MM-DD"` or both null (brief
 * section 18.1): a product with no season sells all year, so a missing
 * window always answers true. Koorka's window is roughly November to
 * February, which crosses the year boundary, so a window whose start comes
 * later in the year than its end wraps around 31 December rather than being
 * read as empty.
 */
export function isWithinSeasonWindow(
  seasonStart: string | null,
  seasonEnd: string | null,
  date: CalDate,
): boolean {
  if (seasonStart === null || seasonEnd === null) return true;
  if (!isValidMonthDay(seasonStart) || !isValidMonthDay(seasonEnd)) {
    throw new RangeError(`season window must be "MM-DD": ${seasonStart} to ${seasonEnd}`);
  }
  const start = monthDayOrdinal(seasonStart);
  const end = monthDayOrdinal(seasonEnd);
  const current = monthDayOrdinal(`${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`);
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}
