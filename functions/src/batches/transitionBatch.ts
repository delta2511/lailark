/**
 * `transitionBatch`: the only way a batch changes state.
 *
 * Brief section 8.2 is the specification, and `./transitions.ts` is that
 * table as code, with no Firebase in it. This file does the Firestore work
 * the table asks for, all of it inside one transaction: the printed batch
 * number from `counters/batch`, the computed fields from the shared helpers,
 * the approvals and concerns the Owner has to answer, and decision D15.
 *
 * **Decision D21c**, on the two names a batch has. A batch is addressed by its
 * internal reference (`b-7f3a2c`), which is its document id and is minted when
 * the draft is created. The printed number is the `batchNo` field, and it is
 * allocated here only on Cooking -> Bottled, inside the same transaction as
 * the rest of that step. Brief §8.2 puts the allocation on Draft -> Open; that
 * line is overridden, so that a number always means jars that exist and an
 * abandoned batch leaves no hole in the sequence.
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
  batchNoTaken,
  batchViewFrom,
  catalogueNamesFor,
  freeBatchRef,
  mainIngredientOf,
  messagesSettings,
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
        let ref = input.ref ?? null;
        let counterRef: DocumentReference | null = null;
        let counterNext = 0;
        let allocatedBatchNo: string | null = null;

        if (ref !== null) {
          const snap = await tx.get(db.collection(BATCHES).doc(ref));
          if (snap.exists) batch = batchViewFrom(snap);
        }

        // Only the rows that need them pay for these reads.
        let siblings: SiblingBatch[] = [];
        let orders: { paid: PaidOrderView[]; open: number } = { paid: [], open: 0 };
        let mainIngredientId: string | null = null;
        let productName: string | null = null;
        let mainIngredientName: string | null = null;
        let messages: Awaited<ReturnType<typeof messagesSettings>> = null;

        if (batch !== null) {
          if (input.to === "open") {
            siblings = await siblingBatches(tx, db, batch.productSlug, batch.ref);
          }
          if (input.to === "bottled" || input.to === "paused") {
            orders = await ordersInBatch(tx, db, batch.ref);
          }
          if (input.to === "cooking") {
            mainIngredientId = await mainIngredientOf(tx, db, batch.recipeId);
          }
          // D24: only the two rows that draft a customer message read the
          // Owner's wording. Everything else never looks at it.
          if (input.to === "open" || input.to === "sourcing") {
            messages = await messagesSettings(tx, db);
          }
        }

        // A new batch needs a reference, which is minted here and is the
        // document id from now until forever (D21c). It takes no number: a
        // draft is not jars.
        if (batch === null && input.ref === undefined && input.to === "draft") {
          ref = await freeBatchRef(tx, db);
          // D24: the product's name and the main ingredient's, read once and
          // kept on the batch, so no later transaction pays for them.
          const names = await catalogueNamesFor(
            tx,
            db,
            (input.data as Record<string, unknown>).productSlug,
            (input.data as Record<string, unknown>).recipeId,
          );
          productName = names.productName;
          mainIngredientName = names.mainIngredientName;
        }

        // D21c: **bottling is where the printed number is allocated.** The
        // counter is read inside this transaction, so it is in the read set
        // before anything is written: two kitchens bottling at the same moment
        // contend on `counters/batch` and the second is retried against the
        // number the first one wrote. Numbers come out in bottling order,
        // whatever order the batches were created in.
        if (batch !== null && input.to === "bottled" && batch.batchNo === null) {
          const allocated = await nextBatchNo(tx, db);
          if (await batchNoTaken(tx, db, allocated.batchNo)) {
            throw new HttpsError(
              "aborted",
              `Batch ${allocated.batchNo} already exists. The counter is behind; try again.`,
            );
          }
          allocatedBatchNo = allocated.batchNo;
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
          productName,
          mainIngredientName,
          messages,
          allocatedBatchNo,
          nowMillis: Date.now(),
        };

        const decision = planTransition(input, context);
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);
        const plan = decision.value;

        if (ref === null) {
          throw new HttpsError("internal", "No batch reference to write to.");
        }

        /* ---- read what the plan named ---------------------------------- */

        const existing = await readExisting(tx, db, plan);

        /* ---- write ----------------------------------------------------- */

        const actor = caller.uid ?? "unknown";
        const batchDoc = db.collection(BATCHES).doc(ref);

        if (plan.row.from === "none") {
          tx.create(batchDoc, withStamps(plan.patch, plan.stampFields, actor));
        } else {
          tx.set(batchDoc, withStamps(plan.patch, plan.stampFields, actor), { merge: true });
        }
        // The counter moves in the same transaction that stamps the number, so
        // the number and the jars it names are committed together or not at
        // all (D21c). A bottling that fails leaves the counter where it was.
        if (counterRef) tx.set(counterRef, { next: counterNext }, { merge: true });

        for (const line of plan.lines) {
          tx.set(
            batchDoc.collection("lines").doc(line.id),
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
          // D21c: the caller is answered with both names. `ref` is the one it
          // addresses the batch by from here on; `batchNo` is null until this
          // call was the bottling that stamped it.
          ref,
          batchNo: plan.batchNo ?? batch?.batchNo ?? null,
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
