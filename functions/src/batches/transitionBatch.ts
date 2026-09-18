/**
 * `transitionBatch`: the only way a batch changes state.
 *
 * Brief section 8.2 is the specification, and `./transitions.ts` is that
 * table as code, with no Firebase in it. This file does the Firestore work
 * the table asks for, all of it inside one transaction: the batch number from
 * `counters/batch`, the computed fields from the shared helpers, the
 * approvals and concerns the Owner has to answer, and decision D15.
 *
 * Every field this callable writes on a batch is a protected field (A40), so
 * this is the only code path in the system that can write them. A request
 * that carries one of them is refused before anything is read.
 */

import { type DocumentReference, FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import {
  BATCHES,
  batchViewFrom,
  mainIngredientOf,
  nextBatchNo,
  ordersInBatch,
  readExisting,
  siblingBatches,
  withStamps,
  writeApprovals,
  writeConcerns,
} from "./store";
import {
  type BatchView,
  type PaidOrderView,
  parseTransitionRequest,
  planTransition,
  type SiblingBatch,
  type TransitionContext,
} from "./transitions";

/** Contention on `counters/batch` is a retry, not a failure (8.3). */
const MAX_TRANSACTION_ATTEMPTS = 12;

export const transitionBatch = onCall(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    // App Check arrives with M5.9; until then the role claim is the gate.
    enforceAppCheck: false,
  },
  async (request) => {
    const parsed = parseTransitionRequest(request.data);
    if (!parsed.ok) throw new HttpsError(parsed.code, parsed.message);
    const input = parsed.value;

    const db = getFirestore(getAdminApp());
    const caller = {
      uid: request.auth?.uid ?? null,
      role: request.auth?.token?.role,
    };

    return db.runTransaction(
      async (tx) => {
        /* ---- read ------------------------------------------------------ */

        let batch: BatchView | null = null;
        let batchNo = input.batchNo ?? null;
        let counterRef: DocumentReference | null = null;
        let counterNext = 0;

        if (batchNo !== null) {
          const snap = await tx.get(db.collection(BATCHES).doc(batchNo));
          if (snap.exists) batch = batchViewFrom(snap);
        }

        // Only the rows that need them pay for these reads.
        let siblings: SiblingBatch[] = [];
        let orders: { paid: PaidOrderView[]; open: number } = { paid: [], open: 0 };
        let mainIngredientId: string | null = null;
        if (batch !== null) {
          if (input.to === "open") {
            siblings = await siblingBatches(tx, db, batch.productSlug, batch.batchNo);
          }
          if (input.to === "bottled" || input.to === "paused") {
            orders = await ordersInBatch(tx, db, batch.batchNo);
          }
          if (input.to === "cooking") {
            mainIngredientId = await mainIngredientOf(tx, db, batch.recipeId);
          }
        }

        // A new batch needs its number, and the number comes from the counter
        // inside this same transaction, so the counter is in the read set
        // before anything is written.
        if (batch === null && input.batchNo === undefined && input.to === "draft") {
          const allocated = await nextBatchNo(tx, db);
          const taken = await tx.get(db.collection(BATCHES).doc(allocated.batchNo));
          if (taken.exists) {
            throw new HttpsError(
              "aborted",
              `Batch ${allocated.batchNo} already exists. The counter is behind; try again.`,
            );
          }
          batchNo = allocated.batchNo;
          counterRef = allocated.counterRef;
          counterNext = allocated.n + 1;
        }

        /* ---- plan ------------------------------------------------------ */

        const context: TransitionContext = {
          caller,
          batch,
          siblings,
          paidOrders: orders.paid,
          mainIngredientId,
          nowMillis: Date.now(),
        };

        const decision = planTransition(input, context);
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);
        const plan = decision.value;

        if (batchNo === null) {
          throw new HttpsError("internal", "No batch number to write to.");
        }

        /* ---- read what the plan named ---------------------------------- */

        const existing = await readExisting(tx, db, plan);

        /* ---- write ----------------------------------------------------- */

        const actor = caller.uid ?? "unknown";
        const batchRef = db.collection(BATCHES).doc(batchNo);

        if (plan.row.from === "none") {
          tx.create(batchRef, withStamps(plan.patch, plan.stampFields, actor));
          if (counterRef) tx.set(counterRef, { next: counterNext }, { merge: true });
        } else {
          tx.set(batchRef, withStamps(plan.patch, plan.stampFields, actor), { merge: true });
        }

        for (const line of plan.lines) {
          tx.set(
            batchRef.collection("lines").doc(line.id),
            {
              ingredientId: line.ingredientId,
              qtyActual: line.qtyActual,
              costActual: line.costActual,
              createdAt: FieldValue.serverTimestamp(),
              createdBy: actor,
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: actor,
            },
            { merge: true },
          );
        }

        writeApprovals(tx, db, plan.approvals, existing, actor);
        writeConcerns(tx, db, plan.concerns, existing, actor);

        return {
          batchNo,
          from: plan.row.from,
          to: plan.row.to,
          computed: plan.computed,
          approvals: plan.approvals.map((a) => a.id),
          concerns: plan.concerns.map((c) => c.id),
        };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  },
);
