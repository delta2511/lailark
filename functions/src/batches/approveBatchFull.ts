/**
 * `approveBatchFull`: the Owner's yes on "The batch is full."
 *
 * Brief section 8.2's last row is "Batch full (90% booked) | **Automatic
 * flag, then owner yes** | Optional edit | 3-day production clock replaces
 * the 5-day | 'The batch is full', after yes". The flag half is the trigger
 * in `./triggers.ts`; this is the yes.
 *
 * It is not `transitionBatch`, because the batch does not move: full is a
 * flag on a batch that stays open, half reached or sourcing. So this is an
 * answer to a waiting approval, in the same shape as the half approval's
 * answer: Owner only, an optional edit of the message, `fullApprovedAt`
 * stamped, the approval marked approved or edited, and `sentAt` left alone.
 * Sending is M5; D5 is that the Owner's yes comes first and is recorded.
 *
 * M2.6: the batch write below is followed by `writeAudit` in the same
 * transaction, exactly like `transitionBatch`. A second yes writes nothing
 * (`plan.alreadyApproved`), so it leaves no audit entry either: nothing
 * changed, there is nothing to record.
 */

import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { writeAudit } from "../audit/write";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import {
  APPROVALS,
  BATCHES,
  batchViewFrom,
  readExisting,
  withStamps,
  writeApprovals,
} from "./store";
import {
  approvalId,
  type BatchView,
  parseFullApprovalRequest,
  planFullApproval,
  type TransitionContext,
} from "./transitions";

export const approveBatchFull = onCall(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    // App Check arrives with M5.9; until then the role claim is the gate.
    enforceAppCheck: false,
  },
  async (request) => {
    const parsed = parseFullApprovalRequest(request.data);
    if (!parsed.ok) throw new HttpsError(parsed.code, parsed.message);
    const input = parsed.value;

    const db = getFirestore(getAdminApp());
    const caller = {
      uid: request.auth?.uid ?? null,
      role: request.auth?.token?.role,
    };

    return db.runTransaction(async (tx) => {
      /* ---- read ------------------------------------------------------ */

      // D21c: addressed by the internal reference, which the batch has had
      // since it was a draft. It may or may not carry a printed number yet.
      const batchDoc = db.collection(BATCHES).doc(input.ref);
      const snap = await tx.get(batchDoc);
      const batch: BatchView | null = snap.exists ? batchViewFrom(snap) : null;

      // The sentence the Owner was shown is the sentence he is approving.
      const raised = await tx.get(db.collection(APPROVALS).doc(approvalId("full", input.ref)));
      const raisedDraft = raised.get("draft");
      const existingApprovalDraft =
        typeof raisedDraft === "string" && raisedDraft.trim() !== "" ? raisedDraft : null;

      /* ---- plan ------------------------------------------------------ */

      const context: TransitionContext = {
        caller,
        batch,
        siblings: [],
        paidOrders: [],
        mainLines: [],
        existingApprovalDraft,
        nowMillis: Date.now(),
      };

      const decision = planFullApproval(input, context);
      if (!decision.ok) throw new HttpsError(decision.code, decision.message);
      const plan = decision.value;

      // Answering twice writes nothing at all, so the first yes is the one
      // that stands and a double tap cannot move the stamp.
      if (plan.alreadyApproved) {
        return {
          ref: plan.ref,
          batchNo: batch?.batchNo ?? null,
          alreadyApproved: true,
          approvals: [],
          computed: plan.computed,
        };
      }

      /* ---- read what the plan named ---------------------------------- */

      const existing = await readExisting(tx, db, { approvals: plan.approvals, concerns: [] });

      /* ---- write ----------------------------------------------------- */

      const actor = caller.uid ?? "unknown";
      tx.set(batchDoc, withStamps(plan.patch, plan.stampFields, actor), { merge: true });
      writeAudit(tx, db, {
        object: `${BATCHES}/${input.ref}`,
        action: "approveFull",
        patch: plan.patch,
        beforeSnap: snap.exists ? snap : null,
        by: actor,
      });
      writeApprovals(tx, db, plan.approvals, existing, actor);

      return {
        ref: plan.ref,
        batchNo: batch?.batchNo ?? null,
        alreadyApproved: false,
        approvals: plan.approvals.map((a) => a.id),
        computed: plan.computed,
      };
    });
  },
);
