/**
 * The clock shown on a batch card and in its detail (brief 17.4): the
 * production clock an approval carries in `dueAt` (5 days at half reached, 3
 * days once full, brief 7.3 and 8.2).
 */
import { toEpochMillis, type InstantInput } from "@lailark/shared";

import { BATCHES } from "../copy";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days remaining, rounded up, so "a few hours left" still reads "1 day
 * left". Null when `dueAt` cannot be read as an instant at all.
 *
 * `toEpochMillis` throws on anything that is not a number, a Date or a
 * Firestore timestamp. A clock is decoration on a card: a batch whose `dueAt`
 * somehow arrived malformed should still show its state, its fill and its
 * button, so this catches rather than takes the whole screen down with it.
 * Same reasoning as `CookingActuals` wrapping its `toGrams` call.
 */
export function daysRemaining(dueAt: InstantInput, now: InstantInput = Date.now()): number | null {
  try {
    return Math.ceil((toEpochMillis(dueAt) - toEpochMillis(now)) / DAY_MS);
  } catch {
    return null;
  }
}

/** "5 days left", "1 day left", "due today", "overdue", or null when unreadable. */
export function formatClock(dueAt: InstantInput, now: InstantInput = Date.now()): string | null {
  const days = daysRemaining(dueAt, now);
  if (days === null || !Number.isFinite(days)) return null;
  if (days < 0) return BATCHES.clockOverdue;
  if (days === 0) return BATCHES.clockDueToday;
  return BATCHES.clockDays(days);
}
