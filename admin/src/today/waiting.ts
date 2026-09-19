/**
 * What Today puts on screen, decided with no Firebase in it: which approvals
 * are waiting on the Owner right now, and which batches are on a clock.
 *
 * Kept apart from `./data.ts` (the listeners and the callables) so both can be
 * unit-tested without an emulator, the same way the transition table is kept
 * apart from the callable that runs it.
 */
import { isApprovalWaitingOnOwner, toEpochMillis, type ApprovalKind, type InstantInput } from "@lailark/shared";

import type { ApprovalDoc } from "../batches/data";

/**
 * Epoch millis for a Firestore timestamp, a number or a Date, else null.
 *
 * `toEpochMillis` throws on some rubbish and answers NaN on the rest (a
 * string, or a map with no `seconds`), so both are caught here. A card whose
 * timestamp cannot be read still belongs on Today: it sorts last and carries
 * no clock, rather than taking the screen down or being quietly dropped.
 */
export function millisOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  try {
    const millis = toEpochMillis(value as InstantInput);
    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

/**
 * The approvals Today shows, **oldest first**, as brief §17.2 says.
 *
 * The oldest card is the one that has been waiting longest, and on a list
 * meant to be worked down rather than browsed that is the one to answer
 * first. A newest-first list quietly buries the thing that has been sitting
 * there since Tuesday under whatever arrived this morning, which is the
 * opposite of what "Waiting on you" is for. M2.5's task text names no order,
 * so the brief decides it (CLAUDE.md section 2).
 */
export function waitingOnYou(
  approvals: readonly ApprovalDoc[],
  now: number = Date.now(),
): readonly ApprovalDoc[] {
  return approvals
    .filter((approval) =>
      isApprovalWaitingOnOwner(
        { status: approval.status, remindAtMillis: millisOf(approval.remindAt) },
        now,
      ),
    )
    .slice()
    .sort((a, b) => (millisOf(a.createdAt) ?? 0) - (millisOf(b.createdAt) ?? 0));
}

/**
 * The batch states a production clock belongs to (brief 17.2's "batches in
 * their 5-day or 3-day production window").
 *
 * ASSUMED (M2.5): the window is over once the kitchen is cooking. The clock is
 * the promise that cooking will start (brief 7.3: "the commitment is to the
 * kitchen"), so a batch that is cooking, bottled or beyond has kept it and its
 * old `dueAt` is history rather than something still counting at the Owner. A
 * paused batch is left off too: its sales are frozen and its customers are on
 * a Concern, which is a card of its own.
 */
export const CLOCK_BATCH_STATES: readonly string[] = ["open", "halfReached", "sourcing"];

export interface ClockRow {
  readonly approvalId: string;
  readonly batchRef: string;
  readonly kind: ApprovalKind;
  /** The clock itself, read off the approval and never recomputed (A61). */
  readonly dueAtMillis: number;
  readonly overdue: boolean;
}

/**
 * One row per live production clock, soonest first.
 *
 * A61: exactly one clock is live on a batch at a time, because raising the
 * full flag clears the half approval's `dueAt` and records what superseded it.
 * So this reads `dueAt` and trusts it. No screen recomputes five days from
 * `halfReachedAt`, or the number Shefin reads would be a second opinion.
 */
export function clockRows(
  approvals: readonly ApprovalDoc[],
  batchStateOf: (batchRef: string) => string | undefined,
  now: number = Date.now(),
): readonly ClockRow[] {
  const rows: ClockRow[] = [];
  for (const approval of approvals) {
    const dueAtMillis = millisOf(approval.dueAt);
    if (dueAtMillis === null) continue;
    const batchRef = approval.batchRef ?? null;
    if (batchRef === null) continue;
    const state = batchStateOf(batchRef);
    if (state === undefined || !CLOCK_BATCH_STATES.includes(state)) continue;
    rows.push({
      approvalId: approval.id,
      batchRef,
      kind: (approval.kind ?? "halfReached") as ApprovalKind,
      dueAtMillis,
      overdue: dueAtMillis < now,
    });
  }
  return rows.sort((a, b) => a.dueAtMillis - b.dueAtMillis);
}
