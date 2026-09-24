/**
 * `answerApproval`: the Owner's answer to an approval that moves no state.
 *
 * Brief section 7.3 gives three answers, and this callable carries two and a
 * half of them:
 *
 *   - **not yet, with a reason**, for any kind of approval. Nothing moves and
 *     nothing is sent; the card comes back next morning.
 *   - **yes**, and **edit then yes**, for the two kinds that move no state:
 *     the broadcast offers (batch open, back in stock) and the kitchen photo
 *     updates of D5.
 *
 * The yes on a half-reached approval is not here: it **is** the `Half reached
 * -> Sourcing` row of section 8.2, so it goes through `transitionBatch`, and
 * the yes on a full approval has had `approveBatchFull` since A62. Both are
 * refused here by name, so each yes has exactly one door.
 *
 * Owner only, decided on the server in `./answers.ts` and checked again by the
 * rules (`approvals` is `allow update: if isOwner()`). Nothing here sends
 * anything: a yes records that the message was approved and leaves `sentAt`
 * null for M5.
 */

import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { APPROVALS, approvalViewFrom, BATCHES, UPDATES } from "../batches/store";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { type AnswerContext, parseAnswerApprovalRequest, planApprovalAnswer } from "./answers";

export const answerApproval = onCall(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    // App Check arrives with M5.9; until then the role claim is the gate.
    enforceAppCheck: false,
  },
  async (request) => {
    const parsed = parseAnswerApprovalRequest(request.data);
    if (!parsed.ok) throw new HttpsError(parsed.code, parsed.message);
    const input = parsed.value;

    const db = getFirestore(getAdminApp());
    const caller = {
      uid: request.auth?.uid ?? null,
      role: request.auth?.token?.role,
    };

    return db.runTransaction(async (tx) => {
      /* ---- read ------------------------------------------------------ */

      const approvalDoc = db.collection(APPROVALS).doc(input.id);
      const snap = await tx.get(approvalDoc);
      const approval = snap.exists ? approvalViewFrom(snap) : null;

      /* ---- plan ------------------------------------------------------ */

      const context: AnswerContext = { caller, approval, nowMillis: Date.now() };
      const decision = planApprovalAnswer(input, context);
      if (!decision.ok) throw new HttpsError(decision.code, decision.message);
      const plan = decision.value;

      // A second yes writes nothing, so the first one is the one that stands.
      if (plan.alreadyAnswered) {
        return {
          id: plan.id,
          kind: plan.kind,
          answer: plan.answer,
          alreadyAnswered: true,
          computed: plan.computed,
        };
      }

      /* ---- write ----------------------------------------------------- */

      const actor = caller.uid ?? "unknown";
      const patch: Record<string, unknown> = { ...plan.patch, updatedBy: actor };
      for (const field of plan.stampFields) {
        patch[field] = FieldValue.serverTimestamp();
      }
      if (plan.remindAtMillis !== null) {
        patch.remindAt = Timestamp.fromMillis(plan.remindAtMillis);
      }
      tx.set(approvalDoc, patch, { merge: true });

      // D5: the update the Owner has just approved is stamped in the same
      // transaction, so an approved photo and its approval cannot disagree.
      // `sentAt` is untouched on both: M5 sends.
      if (plan.photoUpdate) {
        tx.set(
          db
            .collection(BATCHES)
            .doc(plan.photoUpdate.batchRef)
            .collection(UPDATES)
            .doc(plan.photoUpdate.updateId),
          {
            approvedBy: actor,
            messageText: plan.photoUpdate.messageText,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor,
          },
          { merge: true },
        );
      }

      return {
        id: plan.id,
        kind: plan.kind,
        answer: plan.answer,
        alreadyAnswered: false,
        computed: plan.computed,
      };
    });
  },
);
