import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  businessDay,
  businessDayKey,
  compareCalDate,
  daysInMonth,
  diffDays,
  formatCalDate,
  fromDayNumber,
  isAfter,
  isBefore,
  inSameBusinessDay,
  isLeapYear,
  isSameDate,
  isValidCalDate,
  KOLKATA_UTC_OFFSET_MINUTES,
  kolkataDate,
  kolkataStartOfDay,
  parseCalDate,
  subtractDays,
  toDayNumber,
  toEpochMillis,
} from "./dates.js";

describe("calendar basics", () => {
  it("knows the leap years", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2027)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("knows the month lengths", () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 8)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("validates a date", () => {
    expect(isValidCalDate({ y: 2026, m: 9, d: 4 })).toBe(true);
    expect(isValidCalDate({ y: 2027, m: 2, d: 29 })).toBe(false);
    expect(isValidCalDate({ y: 2028, m: 2, d: 29 })).toBe(true);
    expect(isValidCalDate({ y: 2026, m: 13, d: 1 })).toBe(false);
    expect(isValidCalDate({ y: 2026, m: 0, d: 1 })).toBe(false);
    expect(isValidCalDate({ y: 2026, m: 9, d: 0 })).toBe(false);
    expect(isValidCalDate({ y: 2026, m: 9, d: 4.5 })).toBe(false);
  });
});

describe("parse and format", () => {
  it("round-trips YYYY-MM-DD", () => {
    expect(parseCalDate("2026-09-04")).toEqual({ y: 2026, m: 9, d: 4 });
    expect(formatCalDate({ y: 2026, m: 9, d: 4 })).toBe("2026-09-04");
    expect(formatCalDate(parseCalDate("2027-03-04"))).toBe("2027-03-04");
  });

  it("is strict about the spelling", () => {
    expect(() => parseCalDate("2026-9-4")).toThrow(/YYYY-MM-DD/);
    expect(() => parseCalDate("04-09-2026")).toThrow();
    expect(() => parseCalDate("2027-02-29")).toThrow(/not a calendar date/);
    expect(() => parseCalDate("")).toThrow();
  });
});

describe("day numbers", () => {
  it("anchors on the Unix epoch", () => {
    expect(toDayNumber("1970-01-01")).toBe(0);
    expect(toDayNumber("1969-12-31")).toBe(-1);
    expect(toDayNumber("1970-01-02")).toBe(1);
  });

  it("round-trips through fromDayNumber over a long span", () => {
    for (let n = -3000; n <= 30000; n += 37) {
      expect(toDayNumber(fromDayNumber(n))).toBe(n);
    }
  });

  it("agrees with UTC Date on known dates, though it never uses Date itself", () => {
    for (const iso of ["2000-02-29", "2026-09-04", "2027-03-04", "2028-02-29", "2100-03-01"]) {
      const [y, m, d] = iso.split("-").map(Number);
      expect(toDayNumber(iso)).toBe(Date.UTC(y, m - 1, d) / 86_400_000);
    }
  });
});

describe("addDays and diffDays", () => {
  it("crosses month and year ends", () => {
    expect(formatCalDate(addDays("2026-09-30", 1))).toBe("2026-10-01");
    expect(formatCalDate(addDays("2026-12-31", 1))).toBe("2027-01-01");
    expect(formatCalDate(addDays("2028-02-28", 1))).toBe("2028-02-29");
    expect(formatCalDate(addDays("2027-02-28", 1))).toBe("2027-03-01");
    expect(formatCalDate(subtractDays("2027-01-01", 1))).toBe("2026-12-31");
  });

  it("counts the 120 days from packing to the sale stop of batch 001", () => {
    expect(diffDays("2027-01-02", "2026-09-04")).toBe(120);
    expect(formatCalDate(addDays("2026-09-04", 120))).toBe("2027-01-02");
  });

  it("counts the 181 days from packing to the best before of batch 001", () => {
    expect(diffDays("2027-03-04", "2026-09-04")).toBe(181);
  });

  it("does not shift a date across a DST boundary, because no Date is involved", () => {
    // 29 March 2026 is when the EU moves its clocks. A host in that zone would
    // make a naive Date-based addDays return 29 March twice or skip it.
    expect(formatCalDate(addDays("2026-03-28", 1))).toBe("2026-03-29");
    expect(formatCalDate(addDays("2026-03-29", 1))).toBe("2026-03-30");
    expect(diffDays("2026-03-30", "2026-03-28")).toBe(2);
  });
});

describe("addMonths", () => {
  it("keeps the day of month when it fits", () => {
    expect(formatCalDate(addMonths("2026-09-04", 6))).toBe("2027-03-04");
    expect(formatCalDate(addMonths("2026-01-15", 1))).toBe("2026-02-15");
    expect(formatCalDate(addMonths("2026-09-04", 0))).toBe("2026-09-04");
  });

  it("clamps to the last day when the target month is shorter", () => {
    expect(formatCalDate(addMonths("2026-08-31", 6))).toBe("2027-02-28");
    expect(formatCalDate(addMonths("2027-08-31", 6))).toBe("2028-02-29");
    expect(formatCalDate(addMonths("2026-10-31", 6))).toBe("2027-04-30");
    expect(formatCalDate(addMonths("2026-12-31", 6))).toBe("2027-06-30");
    expect(formatCalDate(addMonths("2026-01-31", 1))).toBe("2026-02-28");
    expect(formatCalDate(addMonths("2028-02-29", 12))).toBe("2029-02-28");
  });

  it("goes backwards too", () => {
    expect(formatCalDate(addMonths("2027-03-04", -6))).toBe("2026-09-04");
    expect(formatCalDate(addMonths("2027-01-15", -1))).toBe("2026-12-15");
    expect(formatCalDate(addMonths("2027-03-31", -1))).toBe("2027-02-28");
    expect(formatCalDate(addMonths("2026-01-15", -13))).toBe("2024-12-15");
  });

  it("is not reversible where it clamped, which is the point", () => {
    const forward = addMonths("2026-08-31", 6);
    expect(formatCalDate(addMonths(forward, -6))).toBe("2026-08-28");
  });
});

describe("comparison", () => {
  it("orders dates", () => {
    expect(compareCalDate("2026-09-04", "2027-03-04")).toBe(-1);
    expect(compareCalDate("2027-03-04", "2026-09-04")).toBe(1);
    expect(compareCalDate("2026-09-04", "2026-09-04")).toBe(0);
    expect(isBefore("2026-09-04", "2026-09-05")).toBe(true);
    expect(isAfter("2026-09-05", "2026-09-04")).toBe(true);
    expect(isSameDate("2026-09-04", { y: 2026, m: 9, d: 4 })).toBe(true);
  });
});

describe("Asia/Kolkata", () => {
  it("is a fixed +05:30", () => {
    expect(KOLKATA_UTC_OFFSET_MINUTES).toBe(330);
  });

  it("turns an instant into the Kolkata calendar date", () => {
    // 2026-09-03T19:00:00Z is 2026-09-04 00:30 in Kolkata: already tomorrow.
    expect(formatCalDate(kolkataDate(Date.parse("2026-09-03T19:00:00Z")))).toBe("2026-09-04");
    // 2026-09-03T18:29:59Z is 2026-09-03 23:59:59 in Kolkata: still today.
    expect(formatCalDate(kolkataDate(Date.parse("2026-09-03T18:29:59Z")))).toBe("2026-09-03");
  });

  it("accepts millis, a Date, and a Firestore-shaped Timestamp alike", () => {
    const millis = Date.parse("2026-09-03T19:00:00Z");
    expect(formatCalDate(kolkataDate(millis))).toBe("2026-09-04");
    expect(formatCalDate(kolkataDate(new Date(millis)))).toBe("2026-09-04");
    expect(
      formatCalDate(kolkataDate({ seconds: Math.floor(millis / 1000), nanoseconds: 0 })),
    ).toBe("2026-09-04");
  });

  it("round-trips midnight Kolkata", () => {
    const start = kolkataStartOfDay("2026-09-04");
    expect(formatCalDate(kolkataDate(start))).toBe("2026-09-04");
    expect(formatCalDate(kolkataDate(start - 1))).toBe("2026-09-03");
    expect(new Date(start).toISOString()).toBe("2026-09-03T18:30:00.000Z");
  });

  it("reads a Timestamp's nanoseconds", () => {
    expect(toEpochMillis({ seconds: 1, nanoseconds: 500_000_000 })).toBe(1500);
  });

  it("refuses a nonsense instant", () => {
    expect(() => toEpochMillis(Number.NaN)).toThrow();
    expect(() => toEpochMillis(new Date("nope"))).toThrow(/invalid Date/);
  });
});

describe("the business day, M2.8", () => {
  /** Epoch millis for a wall-clock time in Asia/Kolkata. */
  function ist(y: number, m: number, d: number, hh: number, mm = 0): number {
    return Date.UTC(y, m - 1, d, hh, mm) - KOLKATA_UTC_OFFSET_MINUTES * 60_000;
  }

  it("keeps a sale at 23:50 and a void at 00:10 in the same day", () => {
    const sale = ist(2026, 9, 21, 23, 50);
    const voidAt = ist(2026, 9, 22, 0, 10);
    // The calendar date has already turned over...
    expect(formatCalDate(kolkataDate(sale))).toBe("2026-09-21");
    expect(formatCalDate(kolkataDate(voidAt))).toBe("2026-09-22");
    // ...and the business day has not, which is the whole point.
    expect(inSameBusinessDay(sale, voidAt)).toBe(true);
    expect(businessDayKey(voidAt)).toBe("2026-09-21");
  });

  it("turns over at 05:00, not at midnight", () => {
    expect(businessDayKey(ist(2026, 9, 22, 4, 59))).toBe("2026-09-21");
    expect(businessDayKey(ist(2026, 9, 22, 5, 0))).toBe("2026-09-22");
  });

  it("puts a morning sale and the evening after it in one day", () => {
    expect(inSameBusinessDay(ist(2026, 9, 21, 9, 0), ist(2026, 9, 21, 21, 0))).toBe(true);
  });

  it("does not stretch to the next evening", () => {
    expect(inSameBusinessDay(ist(2026, 9, 21, 23, 50), ist(2026, 9, 22, 18, 0))).toBe(false);
  });

  it("names a business day by the date it opened on", () => {
    expect(businessDay(ist(2026, 9, 22, 2, 30))).toEqual({ y: 2026, m: 9, d: 21 });
  });
});
