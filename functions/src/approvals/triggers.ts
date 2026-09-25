/**
 * The one trigger the sending list of D32 needs: when an approval is said yes
 * to, work out who the drafted message is for.
 *
 * Why a trigger rather than three additions to the three yes doors. A yes
 * arrives through `answerApproval` (broadcast, photo update), through
 * `transitionBatch` (half reached, which *is* the `Half reached -> Sourcing`
 * row of brief §8.2) and through `approveBatchFull`. The list is the same
 * list in all three cases, and building it in one place rather than three is
 * the difference between one rule and three that have to agree.
 *
 * The loop ends on its own: this writes `recipients`, and the only approval
 * it acts on is one whose `recipients` is missing, so the write it makes
 * fires it once more and that firing does nothing.
 *
 * **Nothing is sent, here or anywhere near here.** The approval's own
 * `sentAt` is not touched: it is M5's field and it stays null. What this
 * writes is a list of people and their numbers, for the Owner to work down
 * with the `wa.me` links the admin draws (D32, CLAUDE.md §3).
 */

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { isApprovalApproved } from "@lailark/shared";

import { APPROVALS, SYSTEM_ACTOR } from "../batches/store";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { readRecipients } from "./recipients";

/** Kinds whose yes means "tell the customers who paid into this batch". */
const KINDS_WITH_RECIPIENTS = ["halfReached", "full"] as const;

export const onApprovalWritten = onDocumentWritten(
  {
    document: `${APPROVALS}/{approvalId}`,
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    // Cheap reading off the event payload first: almost every write to an
    // approval is one of these three and opens no transaction at all.
    if (!isApprovalApproved(after.get("status"))) return;
    if (after.get("recipients") !== undefined && after.get("recipients") !== null) return;
    const kind = String(after.get("kind") ?? "");
    if (!(KINDS_WITH_RECIPIENTS as readonly string[]).includes(kind)) return;
    const batchRef = after.get("batchRef");
    if (typeof batchRef !== "string" || batchRef === "") return;

    const db = getFirestore(getAdminApp());
    const doc = db.collection(APPROVALS).doc(after.id);
    await db.runTransaction(async (tx) => {
      // Re-read inside the transaction: Cloud Functions delivers at least
      // once, and two firings of the same event must not both build a list.
      const snap = await tx.get(doc);
      if (!snap.exists) return;
      if (!isApprovalApproved(snap.get("status"))) return;
      const already = snap.get("recipients");
      if (already !== undefined && already !== null) return;

      const recipients = await readRecipients(tx, db, batchRef);
      tx.set(
        doc,
        {
          recipients,
          // Nobody to message: the list is closed as it is written, so it
          // never sits in the admin asking to be worked down.
          closedAt: recipients.length === 0 ? FieldValue.serverTimestamp() : null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: SYSTEM_ACTOR,
        },
        { merge: true },
      );
    });
  },
);
