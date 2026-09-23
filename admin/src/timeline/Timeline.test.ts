/**
 * `byAtDesc`, the sort `useTimeline` (`Timeline.tsx`) runs after merging its
 * two queries client side. No emulator needed for this part, the same way
 * `sameValue.test.ts` tests a pure function without one; the merge itself
 * (a batch's own entries plus its lines' entries, M2.14) is exercised end to
 * end in `admin/tests/timeline.spec.ts` against the real emulator.
 *
 * M2.14 fix round 2: a just-committed entry's `at` is `null` until the
 * server echoes back what its `serverTimestamp()` resolved to, and a first
 * version of this sort read that as `?? 0`, the Unix epoch, so the entry
 * for an edit someone had just made sorted to the *bottom* of the list for
 * the ~50-150ms round trip (longer on a phone), then visibly jumped to the
 * top the moment `at` resolved. The fix treats an unresolved `at` as the
 * newest thing the client knows about, matching what Firestore's own
 * `orderBy("at", "desc")` already does for a pending write server side.
 * `sortsUnresolvedFirst` below fails against the `?? 0` version and passes
 * against the fix, so this cannot come back silently.
 */
import { describe, expect, it } from "vitest";

import { byAtDesc, type TimelineEntry } from "./Timeline";

function entry(id: string, at: TimelineEntry["at"]): TimelineEntry {
  return {
    id,
    object: "batches/b-test",
    action: "update",
    fields: ["source"],
    before: {},
    after: {},
    by: "uid",
    at,
    undoes: null,
    source: "client",
  };
}

describe("byAtDesc", () => {
  it("sorts resolved entries newest first", () => {
    const older = entry("a", { seconds: 100, nanoseconds: 0 });
    const newer = entry("b", { seconds: 200, nanoseconds: 0 });
    expect([older, newer].sort(byAtDesc).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("breaks a tied second by nanoseconds, newest first", () => {
    const earlier = entry("a", { seconds: 100, nanoseconds: 100 });
    const later = entry("b", { seconds: 100, nanoseconds: 900 });
    expect([earlier, later].sort(byAtDesc).map((e) => e.id)).toEqual(["b", "a"]);
  });

  /**
   * The regression this task exists to fix: an entry whose `serverTimestamp()`
   * has not resolved yet (`at: null`, exactly what `onSnapshot` delivers for
   * a pending local write) must sort ahead of an older, already-resolved
   * entry, not behind it. A comparator reading `at?.seconds ?? 0` puts the
   * unresolved entry at 1970 and fails this.
   */
  it("sorts an entry with an unresolved `at` (a just-committed write) first, ahead of an already-resolved older one", () => {
    const alreadyResolved = entry("old", { seconds: 1_700_000_000, nanoseconds: 0 });
    const justCommitted = entry("new", null);
    expect([alreadyResolved, justCommitted].sort(byAtDesc).map((e) => e.id)).toEqual(["new", "old"]);
    // Order of the input array must not matter either.
    expect([justCommitted, alreadyResolved].sort(byAtDesc).map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("leaves two unresolved entries in a stable order rather than throwing or producing NaN", () => {
    const first = entry("first", null);
    const second = entry("second", null);
    expect(byAtDesc(first, second)).toBe(0);
    expect(Number.isNaN(byAtDesc(first, second))).toBe(false);
  });
});
