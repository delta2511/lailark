/**
 * What Today decides to show (M2.5): the waiting list, and the clocks.
 */
import { describe, expect, it } from "vitest";

import type { ApprovalDoc } from "../batches/data";
import { CLOCK_BATCH_STATES, clockRows, millisOf, waitingOnYou } from "./waiting";

const NOW = Date.UTC(2026, 8, 20, 6, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * A document as the listener hands it over. The timestamps are written as
 * plain millis here, which is one of the three spellings `millisOf` accepts,
 * so the fields are typed loosely rather than as Firestore timestamps.
 */
function approval(over: Record<string, unknown> & { id: string }): ApprovalDoc {
  return {
    kind: "halfReached",
    batchRef: "b-7f3a2c",
    draft: "Half the batch is paid for.",
    status: "waiting",
    createdAt: NOW - DAY,
    ...over,
  } as unknown as ApprovalDoc;
}

describe("millisOf", () => {
  it("reads a number, a Date and a Firestore timestamp", () => {
    expect(millisOf(NOW)).toBe(NOW);
    expect(millisOf(new Date(NOW))).toBe(NOW);
    expect(millisOf({ seconds: NOW / 1000, nanoseconds: 0 })).toBe(NOW);
  });

  it("answers null for anything it cannot read, rather than throwing", () => {
    expect(millisOf(null)).toBeNull();
    expect(millisOf(undefined)).toBeNull();
    expect(millisOf("tomorrow")).toBeNull();
    expect(millisOf({})).toBeNull();
  });
});

describe("waiting on you", () => {
  it("keeps the waiting ones and drops the answered", () => {
    const items = [
      approval({ id: "a", status: "waiting" }),
      approval({ id: "b", status: "approved" }),
      approval({ id: "c", status: "edited" }),
      approval({ id: "d", status: "dropped" }),
    ];
    expect(waitingOnYou(items, NOW).map((a) => a.id)).toEqual(["a"]);
  });

  it("holds a not-yet back until its morning, then shows it again", () => {
    const put_off = approval({ id: "a", status: "notYet", remindAt: NOW + 6 * HOUR });
    expect(waitingOnYou([put_off], NOW)).toHaveLength(0);
    expect(waitingOnYou([put_off], NOW + 7 * HOUR)).toHaveLength(1);
  });

  // Brief 17.2. The card that has waited longest is the one to answer first.
  it("is oldest first", () => {
    const items = [
      approval({ id: "old", createdAt: NOW - 3 * DAY }),
      approval({ id: "new", createdAt: NOW - HOUR }),
      approval({ id: "middle", createdAt: NOW - DAY }),
    ];
    expect(waitingOnYou(items, NOW).map((a) => a.id)).toEqual(["old", "middle", "new"]);
  });

  it("does not lose an approval with no createdAt it can read", () => {
    const items = [approval({ id: "a", createdAt: undefined })];
    expect(waitingOnYou(items, NOW).map((a) => a.id)).toEqual(["a"]);
  });
});

describe("the clocks", () => {
  const open = () => "open";

  it("shows an approval with a dueAt, soonest first", () => {
    const items = [
      approval({ id: "late", batchRef: "b-aaaaaa", dueAt: NOW + 3 * DAY }),
      approval({ id: "soon", batchRef: "b-bbbbbb", dueAt: NOW + DAY }),
    ];
    expect(clockRows(items, open, NOW).map((r) => r.approvalId)).toEqual(["soon", "late"]);
  });

  it("marks one that has run out as overdue", () => {
    const items = [approval({ id: "gone", dueAt: NOW - HOUR })];
    expect(clockRows(items, open, NOW)[0].overdue).toBe(true);
  });

  it("shows nothing for an approval with no clock on it", () => {
    expect(clockRows([approval({ id: "a", dueAt: null })], open, NOW)).toHaveLength(0);
  });

  it("drops a clock once the batch is cooking or past it", () => {
    const items = [approval({ id: "a", dueAt: NOW + DAY })];
    for (const state of ["cooking", "bottled", "inStock", "soldOut", "archived", "paused", "draft"]) {
      expect(clockRows(items, () => state, NOW), state).toHaveLength(0);
    }
    for (const state of CLOCK_BATCH_STATES) {
      expect(clockRows(items, () => state, NOW), state).toHaveLength(1);
    }
  });

  it("drops a clock whose batch it cannot see at all", () => {
    const items = [approval({ id: "a", dueAt: NOW + DAY })];
    expect(clockRows(items, () => undefined, NOW)).toHaveLength(0);
  });

  it("never recomputes a clock: what it shows is the dueAt it was given", () => {
    const dueAt = NOW + 2 * DAY + 3 * HOUR;
    expect(clockRows([approval({ id: "a", dueAt })], open, NOW)[0].dueAtMillis).toBe(dueAt);
  });
});
