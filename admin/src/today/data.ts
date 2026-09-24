/**
 * The Firestore and Functions side of Today (brief section 17.2), as far as
 * M2.5 builds it: the approvals waiting on the Owner, and the batches on a
 * production clock.
 *
 * Nothing here writes an approval directly, although the rules would let the
 * Owner (`approvals` is `allow update: if isOwner()`). Every answer goes
 * through a callable, because an answer is never only a field:
 *
 *   - a yes on a half-reached approval **is** the `Half reached -> Sourcing`
 *     row of brief 8.2, so it goes through `transitionBatch` and the batch
 *     moves in the same transaction that records the approval;
 *   - a yes on a full approval stamps `fullApprovedAt` on the batch (A62);
 *   - a yes on a photo update stamps `approvedBy` on the update (D5);
 *   - and every one of them is Owner-only on the server, which a direct write
 *     would leave to the rules alone.
 *
 * `APPROVAL_YES_DOOR` in `@lailark/shared` is the one place that says which
 * callable answers which kind, so this file and the server cannot disagree.
 */
import { APPROVAL_YES_DOOR, type ApprovalKind } from "@lailark/shared";
import { collection, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "preact/hooks";

import {
  APPROVALS_COLLECTION,
  callApproveBatchFull,
  callTransitionBatch,
  type ApprovalDoc,
} from "../batches/data";
import { db, functions } from "../firebase";
import type { Live } from "../products/data";

// The deciding is all in `./waiting.ts`, which has no Firebase in it and is
// unit-tested on its own. Re-exported here so a screen has one import.
export {
  CLOCK_BATCH_STATES,
  type ClockRow,
  clockRows,
  millisOf,
  waitingOnYou,
} from "./waiting";

/**
 * The statuses Today ever listens to. `approved`, `edited` and `dropped` are
 * answered and never come back, so they are left in Firestore rather than
 * streamed to a phone.
 */
export const OPEN_APPROVAL_STATUSES = ["waiting", "notYet"] as const;

/**
 * Every approval that is not answered yet: the ones still waiting, and the
 * ones the Owner put off, which come back on their own morning (brief 7.3).
 * The morning itself is checked in `waitingOnYou` below, against the clock on
 * the device, so a card appears without anything having to be re-queried.
 */
export function useOpenApprovals(): Live<ApprovalDoc> {
  const [state, setState] = useState<Live<ApprovalDoc>>({ items: [], loading: true, denied: false });

  useEffect(() => {
    const q = query(
      collection(db, APPROVALS_COLLECTION),
      where("status", "in", [...OPEN_APPROVAL_STATUSES]),
    );
    const stop: Unsubscribe = onSnapshot(
      q,
      (snap) =>
        setState({
          items: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ApprovalDoc),
          loading: false,
          denied: false,
        }),
      () => setState({ items: [], loading: false, denied: true }),
    );
    return stop;
  }, []);

  return state;
}

/* -------------------------------------------------------------------------- */
/* The three answers (brief 7.3)                                              */
/* -------------------------------------------------------------------------- */

export interface AnswerApprovalInput {
  readonly id: string;
  readonly answer: "yes" | "notYet";
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AnswerApprovalResult {
  readonly id: string;
  readonly kind: string;
  readonly answer: string;
  readonly alreadyAnswered: boolean;
}

/** The callable that answers an approval which moves no state. */
export async function callAnswerApproval(
  input: AnswerApprovalInput,
): Promise<AnswerApprovalResult> {
  const call = httpsCallable<AnswerApprovalInput, AnswerApprovalResult>(functions, "answerApproval");
  const result = await call(input);
  return result.data;
}

/**
 * Yes, and edit then yes, routed to whichever callable owns this kind.
 *
 * `messageText` is the Owner's own wording when he edited it, and null when
 * the draft stood as it was. Either way nothing is sent: what is recorded is
 * that he approved it, and M5 sends.
 */
export async function answerYes(
  approval: ApprovalDoc,
  messageText: string | null,
): Promise<void> {
  const data = messageText === null ? {} : { messageText };
  const door = APPROVAL_YES_DOOR[(approval.kind ?? "") as ApprovalKind];

  if (door === "transitionBatch") {
    // Brief 8.2's `Half reached -> Sourcing`: the yes is the transition.
    if (!approval.batchRef) throw new Error("That approval has no batch on it.");
    await callTransitionBatch({ ref: approval.batchRef, to: "sourcing", data });
    return;
  }
  if (door === "approveBatchFull") {
    if (!approval.batchRef) throw new Error("That approval has no batch on it.");
    await callApproveBatchFull(approval.batchRef, data);
    return;
  }
  await callAnswerApproval({ id: approval.id, answer: "yes", data });
}

/** "Not yet, with a reason": nothing moves, and the card comes back. */
export async function answerNotYet(approval: ApprovalDoc, reason: string): Promise<void> {
  await callAnswerApproval({ id: approval.id, answer: "notYet", data: { reason } });
}
