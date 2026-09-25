import { describe, expect, it } from "vitest";
import {
  batchAvailability,
  batchMaths,
  bestBefore,
  bookableJars,
  canHold,
  DEFAULT_SHELF_LIFE_RULE,
  daysToSaleStop,
  effectivePerPersonLimit,
  halfOfBookable,
  type HeldJars,
  inStockAvailability,
  isOnlineSaleAllowed,
  isPerPersonLimitOverride,
  liveHeldJars,
  minRemainingDaysOnArrival,
  perPersonLimit,
  remainingPerPersonAllowance,
  resolvePerPersonLimit,
  saleStopOn,
  saleStopWarnOn,
  shelfLife,
  SHELF_LIFE_DAYS,
  SHELF_LIFE_MONTHS,
  surplusJars,
  withinPerPersonLimit,
} from "./batch.js";
import { formatCalDate } from "./dates.js";

/**
 * Brief section 7.1, reproduced exactly. If any cell of this table changes,
 * the brief changed, not the code.
 */
const NINETY_PERCENT_TABLE = [
  { planned: 15, bookable: 13, half: 7, limit: 3 },
  { planned: 20, bookable: 18, half: 9, limit: 4 },
  { planned: 22, bookable: 19, half: 10, limit: 4 },
  { planned: 40, bookable: 36, half: 18, limit: 9 },
] as const;

describe("the 90% cap table, brief 7.1", () => {
  for (const row of NINETY_PERCENT_TABLE) {
    it(`planned ${row.planned} gives bookable ${row.bookable}, half ${row.half}, limit ${row.limit}`, () => {
      expect(bookableJars(row.planned)).toBe(row.bookable);
      expect(halfOfBookable(row.bookable)).toBe(row.half);
      expect(perPersonLimit(row.bookable)).toBe(row.limit);
    });
  }

  it("batchMaths returns every row of the table in one call", () => {
    for (const row of NINETY_PERCENT_TABLE) {
      expect(batchMaths(row.planned)).toEqual({
        plannedJars: row.planned,
        bookableJars: row.bookable,
        halfJars: row.half,
        perPersonLimit: row.limit,
      });
    }
  });
});

describe("bookableJars", () => {
  it("floors, and is not fooled by binary floating point", () => {
    // 20 * 0.9 is 18.000000000000004 and 40 * 0.9 is 36.00000000000001.
    expect(bookableJars(20)).toBe(18);
    expect(bookableJars(40)).toBe(36);
    expect(bookableJars(70)).toBe(63);
    expect(bookableJars(1)).toBe(0);
    expect(bookableJars(2)).toBe(1);
    expect(bookableJars(10)).toBe(9);
    expect(bookableJars(11)).toBe(9);
    expect(bookableJars(0)).toBe(0);
  });

  it("refuses anything that is not a whole number of jars", () => {
    expect(() => bookableJars(22.5)).toThrow(/whole number of jars/);
    expect(() => bookableJars(-1)).toThrow(/whole number of jars/);
  });
});

describe("perPersonLimit", () => {
  it("is never below one, even on a tiny batch", () => {
    expect(perPersonLimit(0)).toBe(1);
    expect(perPersonLimit(1)).toBe(1);
    expect(perPersonLimit(3)).toBe(1);
    expect(perPersonLimit(4)).toBe(1);
    expect(perPersonLimit(8)).toBe(2);
  });
});

describe("effectivePerPersonLimit, D44", () => {
  it("is the computed quarter when nobody has typed a cap", () => {
    expect(effectivePerPersonLimit({ perPersonLimit: 4, perPersonLimitOverride: null })).toBe(4);
    expect(effectivePerPersonLimit({ perPersonLimit: 4 })).toBe(4);
    expect(effectivePerPersonLimit({ perPersonLimit: 9, perPersonLimitOverride: undefined })).toBe(9);
  });

  it("is the Owner's number the moment he types one", () => {
    expect(effectivePerPersonLimit({ perPersonLimit: 9, perPersonLimitOverride: 2 })).toBe(2);
    expect(effectivePerPersonLimit({ perPersonLimit: 1, perPersonLimitOverride: 6 })).toBe(6);
  });

  it("stands while the computed quarter moves under it, which is the point", () => {
    // The Owner typed 2 on a 22 jar batch, then replanned it at 40 jars: the
    // computed quarter goes 4 -> 9 and the cap he typed does not move.
    expect(effectivePerPersonLimit({ perPersonLimit: 4, perPersonLimitOverride: 2 })).toBe(2);
    expect(effectivePerPersonLimit({ perPersonLimit: 9, perPersonLimitOverride: 2 })).toBe(2);
  });

  it("falls back rather than enforcing nonsense a bad write left behind", () => {
    for (const bad of [0, -3, 2.5, Number.NaN]) {
      expect(effectivePerPersonLimit({ perPersonLimit: 4, perPersonLimitOverride: bad })).toBe(4);
    }
  });

  it("reads a missing computed quarter as no cap at all rather than throwing", () => {
    expect(effectivePerPersonLimit({})).toBe(0);
  });
});

describe("isPerPersonLimitOverride", () => {
  it("takes a whole number of jars, one or more, and nothing else", () => {
    expect(isPerPersonLimitOverride(1)).toBe(true);
    expect(isPerPersonLimitOverride(22)).toBe(true);
    for (const bad of [0, -1, 1.5, null, undefined, "2", Number.NaN]) {
      expect(isPerPersonLimitOverride(bad)).toBe(false);
    }
  });
});

describe("surplusJars", () => {
  it("is what goes on sale in stock at 649", () => {
    expect(surplusJars(22, 19)).toBe(3);
    expect(surplusJars(19, 19)).toBe(0);
    expect(surplusJars(17, 19)).toBe(0);
  });
});

describe("withinPerPersonLimit", () => {
  it("counts every jar the customer already has in this batch", () => {
    expect(withinPerPersonLimit(0, 4, 4)).toBe(true);
    expect(withinPerPersonLimit(0, 5, 4)).toBe(false);
    expect(withinPerPersonLimit(3, 1, 4)).toBe(true);
    expect(withinPerPersonLimit(3, 2, 4)).toBe(false);
    expect(withinPerPersonLimit(4, 1, 4)).toBe(false);
  });

  it("refuses a request of zero or a fraction", () => {
    expect(withinPerPersonLimit(0, 0, 4)).toBe(false);
    expect(withinPerPersonLimit(0, 1.5, 4)).toBe(false);
  });

  it("reports what is left", () => {
    expect(remainingPerPersonAllowance(0, 4)).toBe(4);
    expect(remainingPerPersonAllowance(3, 4)).toBe(1);
    expect(remainingPerPersonAllowance(9, 4)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("best before", () => {
  it("is six months from packing: batch 001 packed 4 Sep 2026", () => {
    expect(SHELF_LIFE_MONTHS).toBe(6);
    expect(formatCalDate(bestBefore("2026-09-04"))).toBe("2027-03-04");
  });

  it("clamps to the last day when the target month is shorter", () => {
    expect(formatCalDate(bestBefore("2026-08-31"))).toBe("2027-02-28");
    expect(formatCalDate(bestBefore("2027-08-31"))).toBe("2028-02-29");
    expect(formatCalDate(bestBefore("2026-10-31"))).toBe("2027-04-30");
    expect(formatCalDate(bestBefore("2026-12-31"))).toBe("2027-06-30");
    expect(formatCalDate(bestBefore("2026-07-31"))).toBe("2027-01-31");
  });

  it("takes a different shelf life when a product has one", () => {
    expect(formatCalDate(bestBefore("2026-09-04", 12))).toBe("2027-09-04");
    expect(formatCalDate(bestBefore("2026-08-31", 3))).toBe("2026-11-30");
  });
});

describe("sale stop, brief 6.2", () => {
  it("needs 54 days left on arrival on a 180 day shelf life", () => {
    expect(SHELF_LIFE_DAYS).toBe(180);
    expect(minRemainingDaysOnArrival()).toBe(54);
  });

  it("falls back to the 45 day floor on a short shelf life", () => {
    // 30% of 90 days is 27, which is below the 45 day floor.
    expect(minRemainingDaysOnArrival(90)).toBe(45);
    expect(minRemainingDaysOnArrival(150)).toBe(45);
    expect(minRemainingDaysOnArrival(151)).toBe(46);
  });

  it("stops batch 001 on 2 January 2027", () => {
    expect(formatCalDate(saleStopOn("2026-09-04"))).toBe("2027-01-02");
  });

  it("is 120 days after packing, as the brief says", () => {
    expect(daysToSaleStop("2026-09-04")).toBe(120);
  });

  it("warns 14 days ahead", () => {
    expect(formatCalDate(saleStopWarnOn("2026-09-04"))).toBe("2026-12-19");
  });

  it("takes every input from the rule, because they are settings", () => {
    const relaxed = { ...DEFAULT_SHELF_LIFE_RULE, transitDays: 3 };
    expect(formatCalDate(saleStopOn("2026-09-04", SHELF_LIFE_DAYS, relaxed))).toBe("2027-01-06");

    const strict = { ...DEFAULT_SHELF_LIFE_RULE, minRemainingFraction: 0.5 };
    expect(minRemainingDaysOnArrival(SHELF_LIFE_DAYS, strict)).toBe(90);
    expect(formatCalDate(saleStopOn("2026-09-04", SHELF_LIFE_DAYS, strict))).toBe("2026-11-27");

    const yearLong = { ...DEFAULT_SHELF_LIFE_RULE, shelfLifeMonths: 12 };
    expect(minRemainingDaysOnArrival(365, yearLong)).toBe(110);
    expect(formatCalDate(saleStopOn("2026-09-04", 365, yearLong))).toBe("2027-05-10");
  });

  it("gives every shelf-life date of batch 001 in one call", () => {
    const life = shelfLife("2026-09-04");
    expect(formatCalDate(life.packedOn)).toBe("2026-09-04");
    expect(formatCalDate(life.bestBefore)).toBe("2027-03-04");
    expect(formatCalDate(life.saleStopOn)).toBe("2027-01-02");
    expect(formatCalDate(life.saleStopWarnOn)).toBe("2026-12-19");
  });

  it("allows the online sale up to and including the stop date", () => {
    expect(isOnlineSaleAllowed("2027-01-01", "2026-09-04")).toBe(true);
    expect(isOnlineSaleAllowed("2027-01-02", "2026-09-04")).toBe(true);
    expect(isOnlineSaleAllowed("2027-01-03", "2026-09-04")).toBe(false);
  });

  it("clamps the best before first, so a 31st packing date still works", () => {
    // 31 Aug 2026 best before 28 Feb 2027, minus 54 minus 7 is 29 Dec 2026.
    expect(formatCalDate(saleStopOn("2026-08-31"))).toBe("2026-12-29");
  });
});

/* -------------------------------------------------------------------------- */

const NOW = Date.parse("2026-09-16T12:00:00Z");
const FUTURE = { seconds: Math.floor(NOW / 1000) + 600, nanoseconds: 0 };
const PAST = { seconds: Math.floor(NOW / 1000) - 600, nanoseconds: 0 };

describe("live holds, brief 9.3", () => {
  it("counts a hold only while its expiry is in the future", () => {
    const held: HeldJars = {
      ordA: { qty: 2, expiresAt: FUTURE },
      ordB: { qty: 3, expiresAt: PAST },
    };
    expect(liveHeldJars(held, NOW)).toBe(2);
  });

  it("frees a lapsed hold even when the clean-up job is late", () => {
    const held: HeldJars = { ordA: { qty: 1, expiresAt: PAST } };
    expect(liveHeldJars(held, NOW)).toBe(0);
  });

  it("treats an absent or empty map as nothing held", () => {
    expect(liveHeldJars(undefined, NOW)).toBe(0);
    expect(liveHeldJars({}, NOW)).toBe(0);
  });

  it("accepts millis and Dates as well as Timestamps", () => {
    const held: HeldJars = {
      ordA: { qty: 1, expiresAt: NOW + 1000 },
      ordB: { qty: 1, expiresAt: new Date(NOW + 1000) },
      ordC: { qty: 1, expiresAt: NOW - 1000 },
    };
    expect(liveHeldJars(held, NOW)).toBe(2);
  });
});

describe("batchAvailability on an open batch", () => {
  it("is bookable minus paid minus live holds", () => {
    const view = batchAvailability({
      bookableJars: 19,
      paidCount: 10,
      heldJars: { ordA: { qty: 2, expiresAt: FUTURE }, ordB: { qty: 5, expiresAt: PAST } },
      now: NOW,
    });
    expect(view.capacity).toBe(19);
    expect(view.paidCount).toBe(10);
    expect(view.liveHeldJars).toBe(2);
    expect(view.available).toBe(7);
    expect(view.isFull).toBe(false);
    expect(view.heldOutByOthers).toBe(false);
  });

  it("never goes below zero, even on an oversold-looking document", () => {
    const view = batchAvailability({ bookableJars: 19, paidCount: 21, now: NOW });
    expect(view.available).toBe(0);
    expect(view.isFull).toBe(true);
  });

  it("calls a batch full when every jar is paid for", () => {
    const view = batchAvailability({ bookableJars: 19, paidCount: 19, now: NOW });
    expect(view.isFull).toBe(true);
    expect(view.heldOutByOthers).toBe(false);
  });
});

describe("two people want the last jar", () => {
  const BOOKABLE = 19;
  const PAID = 18;

  it("lets the first one hold it and turns the second one away", () => {
    // Nothing is held yet: one jar is free, so the first person may take it.
    const before = batchAvailability({ bookableJars: BOOKABLE, paidCount: PAID, now: NOW });
    expect(before.available).toBe(1);
    expect(canHold(before, 1)).toBe(true);
    expect(canHold(before, 2)).toBe(false);

    // The first person's hold is now on the batch document.
    const after = batchAvailability({
      bookableJars: BOOKABLE,
      paidCount: PAID,
      heldJars: { first: { qty: 1, expiresAt: FUTURE } },
      now: NOW,
    });
    expect(after.available).toBe(0);
    expect(canHold(after, 1)).toBe(false);

    // And the reason is a live hold, not a sold-out batch, so the second
    // person is told to check back in 15 minutes rather than "sold out".
    expect(after.isFull).toBe(true);
    expect(after.heldOutByOthers).toBe(true);
  });

  it("gives the jar back to the second person once the first hold lapses", () => {
    const lapsed = batchAvailability({
      bookableJars: BOOKABLE,
      paidCount: PAID,
      heldJars: { first: { qty: 1, expiresAt: PAST } },
      now: NOW,
    });
    expect(lapsed.available).toBe(1);
    expect(canHold(lapsed, 1)).toBe(true);
    expect(lapsed.heldOutByOthers).toBe(false);
  });
});

describe("canHold", () => {
  const view = batchAvailability({ bookableJars: 19, paidCount: 15, now: NOW });

  it("refuses a request that is not a whole number of at least one jar", () => {
    expect(canHold(view, 0)).toBe(false);
    expect(canHold(view, -1)).toBe(false);
    expect(canHold(view, 1.5)).toBe(false);
  });

  it("allows exactly what is available and no more", () => {
    expect(view.available).toBe(4);
    expect(canHold(view, 4)).toBe(true);
    expect(canHold(view, 5)).toBe(false);
  });
});

describe("inStockAvailability, brief 6.2", () => {
  it("is bottled minus paid minus live holds minus written off", () => {
    const view = inStockAvailability({
      bottledJars: 22,
      paidCount: 19,
      writtenOff: 1,
      heldJars: { ordA: { qty: 1, expiresAt: FUTURE } },
      now: NOW,
    });
    expect(view.capacity).toBe(21);
    expect(view.available).toBe(1);
    expect(canHold(view, 1)).toBe(true);
    expect(canHold(view, 2)).toBe(false);
  });

  it("treats written-off jars as gone, not held", () => {
    const view = inStockAvailability({ bottledJars: 22, paidCount: 19, writtenOff: 3, now: NOW });
    expect(view.available).toBe(0);
    expect(view.isFull).toBe(true);
    expect(view.heldOutByOthers).toBe(false);
  });

  it("defaults writtenOff to zero", () => {
    const view = inStockAvailability({ bottledJars: 22, paidCount: 19, now: NOW });
    expect(view.available).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* D52: the typed limit governs the web too, in both directions               */
/* -------------------------------------------------------------------------- */

describe("resolvePerPersonLimit, decision D52", () => {
  /** A 22 jar batch: 19 bookable, computed quarter 4. */
  const batch = { perPersonLimit: 4 };
  const WEB_IN_STOCK_FALLBACK = 2;

  it("lets the Owner's typed number stand when it is higher than the fallback", () => {
    // The bug D52 was written against: a web buyer was told "limited to 2"
    // on a batch where the Owner had typed 5.
    expect(resolvePerPersonLimit({ ...batch, perPersonLimitOverride: 5 }, WEB_IN_STOCK_FALLBACK))
      .toBe(5);
  });

  it("lets it stand when it is lower than the fallback", () => {
    expect(resolvePerPersonLimit({ ...batch, perPersonLimitOverride: 1 }, WEB_IN_STOCK_FALLBACK))
      .toBe(1);
  });

  it("lets it stand when it is exactly the fallback", () => {
    expect(resolvePerPersonLimit({ ...batch, perPersonLimitOverride: 2 }, WEB_IN_STOCK_FALLBACK))
      .toBe(2);
  });

  it("lets it stand above the computed quarter as well", () => {
    expect(resolvePerPersonLimit({ ...batch, perPersonLimitOverride: 9 })).toBe(9);
  });

  it("falls back to two on a blank in-stock batch", () => {
    expect(resolvePerPersonLimit(batch, WEB_IN_STOCK_FALLBACK)).toBe(2);
    expect(resolvePerPersonLimit({ ...batch, perPersonLimitOverride: null }, WEB_IN_STOCK_FALLBACK))
      .toBe(2);
  });

  it("falls back to the computed quarter on a blank open batch, where no fallback is named", () => {
    expect(resolvePerPersonLimit(batch)).toBe(4);
    expect(resolvePerPersonLimit(batch, null)).toBe(4);
  });

  it("treats junk in the override box as blank, never as a cap", () => {
    for (const junk of [null, undefined, 0, -5, 1.5, "lots", true, {}]) {
      expect(
        resolvePerPersonLimit(
          { ...batch, perPersonLimitOverride: junk as number | null },
          WEB_IN_STOCK_FALLBACK,
        ),
        `override ${JSON.stringify(junk)}`,
      ).toBe(2);
    }
  });

  it("treats junk in the fallback as no fallback, never as a cap", () => {
    for (const junk of [0, -5, 1.5, "lots"]) {
      expect(
        resolvePerPersonLimit(batch, junk as number),
        `fallback ${JSON.stringify(junk)}`,
      ).toBe(4);
    }
  });

  it("agrees with effectivePerPersonLimit whenever no fallback is named", () => {
    for (const override of [null, 1, 3, 7]) {
      const value = { ...batch, perPersonLimitOverride: override };
      expect(resolvePerPersonLimit(value)).toBe(effectivePerPersonLimit(value));
    }
  });
});
