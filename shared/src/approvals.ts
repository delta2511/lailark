/**
 * `approvals/{id}`: the one gate between Lailark and a customer's phone.
 *
 * Brief section 18.1 gives the shape and section 7.3 gives the three answers:
 * yes, not yet with a reason, or edit the message then yes. Decision D5 adds
 * the kitchen photo update to the same object, so **nothing a customer sees
 * goes out without Shefin**.
 *
 * This module is the part both sides have to agree on: which door a yes goes
 * through for each kind, whether an approval is waiting on the Owner *right
 * now*, and when a "not yet" card comes back. The admin reads it to decide
 * what to draw; the functions read it to decide what to accept. Neither sends
 * anything: sending arrives in M5, and an approval that has been said yes to
 * carries `sentAt: null` until it does.
 */

import { kolkataDate, kolkataStartOfDay, type InstantInput, toEpochMillis } from "./dates.js";
import type { ApprovalKind, ApprovalStatus } from "./states.js";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/* -------------------------------------------------------------------------- */
/* "The card comes back next morning" (brief 7.3)                             */
/* -------------------------------------------------------------------------- */

/**
 * ASSUMED (M2.5): "next morning" is 7 am Asia/Kolkata. Brief 7.3 says a "not
 * yet" card "comes back next morning" and names no hour. Seven is before the
 * kitchen starts and is when Shefin reads his phone; it is one number, in one
 * place, and it changes nothing a customer sees, so it is assumed rather than
 * asked (CLAUDE.md section 5: admin behaviour may be assumed).
 */
export const NOT_YET_REMIND_HOUR_KOLKATA = 7;

/**
 * The next 7 am Asia/Kolkata strictly after `now`.
 *
 * A "not yet" at nine in the evening comes back at seven the next day; a "not
 * yet" at two in the morning comes back at seven the same day, which is still
 * the next morning in the only sense that matters to the person reading it.
 */
export function nextMorningMillis(now: InstantInput): number {
  const millis = toEpochMillis(now);
  const startOfToday = kolkataStartOfDay(kolkataDate(millis));
  const morning = startOfToday + NOT_YET_REMIND_HOUR_KOLKATA * MS_PER_HOUR;
  return morning > millis ? morning : morning + MS_PER_DAY;
}

/* -------------------------------------------------------------------------- */
/* What is waiting on the Owner                                               */
/* -------------------------------------------------------------------------- */

/** The two statuses that mean the Owner has answered yes. */
export const APPROVAL_STATUSES_ANSWERED_YES: readonly ApprovalStatus[] = ["approved", "edited"];

/** True once the Owner has said yes, whether or not he edited the message. */
export function isApprovalApproved(status: unknown): boolean {
  return (APPROVAL_STATUSES_ANSWERED_YES as readonly string[]).includes(String(status));
}

/** What `isApprovalWaitingOnOwner` needs off an approval document. */
export interface ApprovalWaitingInput {
  readonly status: unknown;
  /** `remindAt` as epoch millis, or null on an approval nobody has deferred. */
  readonly remindAtMillis?: number | null;
}

/**
 * Whether this approval belongs on Today's "Waiting on you" right now.
 *
 * `waiting` always does. `notYet` does again from the morning the Owner's
 * deferral runs out (brief 7.3: "the card comes back next morning"), and not
 * before, so a "not yet" actually gets him to the end of the day. `approved`,
 * `edited` and `dropped` never do: they are answered.
 */
export function isApprovalWaitingOnOwner(
  approval: ApprovalWaitingInput,
  now: InstantInput = Date.now(),
): boolean {
  const status = String(approval.status);
  if (status === "waiting") return true;
  if (status !== "notYet") return false;
  const remindAt = approval.remindAtMillis;
  if (typeof remindAt !== "number" || !Number.isFinite(remindAt)) return true;
  return remindAt <= toEpochMillis(now);
}

/**
 * Whether there is a message to edit. An approval with no drafted line has
 * nothing to rewrite, so the screen offers no "edit then yes" for it: the
 * answer is only yes or not yet.
 */
export function approvalHasMessage(draft: unknown): boolean {
  return typeof draft === "string" && draft.trim() !== "";
}

/* -------------------------------------------------------------------------- */
/* Which door a yes goes through                                              */
/* -------------------------------------------------------------------------- */

/**
 * The callable that answers each kind of approval with a yes.
 *
 * Two of the four kinds are not free-standing answers at all:
 *
 *  - `halfReached`'s yes **is** the `Half reached -> Sourcing` row of brief
 *    section 8.2, so it goes through `transitionBatch` and the state moves in
 *    the same transaction that records the approval. There is no second door.
 *  - `full`'s yes moves no state (A62) and has its own callable.
 *
 * `broadcast` and `photoUpdate` move nothing and have no row, so they are
 * answered by `answerApproval`. A "not yet" is never a state move and always
 * goes to `answerApproval`, whatever the kind.
 */
export const APPROVAL_YES_DOOR: Readonly<Record<ApprovalKind, string>> = {
  halfReached: "transitionBatch",
  full: "approveBatchFull",
  broadcast: "answerApproval",
  photoUpdate: "answerApproval",
};

/** True when `answerApproval` is the right door for a yes on this kind. */
export function answersYesDirectly(kind: unknown): boolean {
  const door = APPROVAL_YES_DOOR[kind as ApprovalKind];
  return door === "answerApproval";
}

/* -------------------------------------------------------------------------- */
/* The production clocks (brief 7.3 and 8.2, A61)                             */
/* -------------------------------------------------------------------------- */

/**
 * The 5-day clock the half-reached approval starts (brief 7.3) and the 3-day
 * one that replaces it when the batch is full (brief 8.2). They are written
 * onto the approval's `dueAt` when it is raised and are never recomputed
 * afterwards: a screen reads `dueAt` and formats it, so what Shefin sees is
 * the clock the server actually started (A61).
 */
export const HALF_CLOCK_DAYS = 5;
export const FULL_CLOCK_DAYS = 3;

/** Which clock an approval of this kind carries, in days, or null for none. */
export function clockDaysForKind(kind: unknown): number | null {
  if (kind === "halfReached") return HALF_CLOCK_DAYS;
  if (kind === "full") return FULL_CLOCK_DAYS;
  return null;
}
