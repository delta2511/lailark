/**
 * The automatic rows of brief section 8.2, as Firestore triggers.
 *
 *   Open -> Half reached      automatic at half of bookable
 *   (any booking state)       the full flag at 90% booked
 *   Bottled -> In stock       automatic when surplus > 0
 *   Bottled -> Sold out       automatic when the pot gave no surplus (A28)
 *   In stock -> Sold out      automatic when no jar is free
 *   Sold out -> Archived      automatic once every order is closed
 *
 * How the loop is stopped. Every one of these writes the same document that
 * fires the trigger, so each write fires it again. Three things end it:
 *
 *  1. `nextAutomaticStep` is a table of preconditions, and every step makes
 *     its own precondition false: `state` moves on, or the stamp it was
 *     waiting for is set. The second firing therefore finds nothing to do and
 *     writes nothing, so the chain is at most four hops long and then stops.
 *  2. The precondition is re-checked inside the transaction, against the
 *     document as the transaction reads it, not against the event payload.
 *     Two firings of the same event (which Cloud Functions allows: delivery
 *     is at-least-once) cannot both apply the same step.
 *  3. A firing that needs no step returns before it opens a transaction, so
 *     the common case is one read and no write at all.
 *
 * Nothing here messages a customer. Half reached and full raise an
 * `approvals` document and wait for the Owner (CLAUDE.md section 3, D5).
 */

import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { ORDER_STATES_TERMINAL } from "@lailark/shared";

import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import {
  BATCHES,
  batchViewFrom,
  cancelApprovalClocks,
  heldJarsFrom,
  ordersInBatch,
  readExisting,
  SYSTEM_ACTOR,
  withStamps,
  writeApprovals,
} from "./store";
import { type AutomaticStep, nextAutomaticStep } from "./transitions";

function doesNothing(step: AutomaticStep): boolean {
  return step.to === null && step.stampFields.length === 0;
}

/**
 * Runs the automatic table against one batch, inside a transaction, and
 * applies at most one step. Safe to call at any time, from any trigger, as
 * often as you like: if no step is due it writes nothing.
 */
export async function advanceBatch(batchNo: string): Promise<AutomaticStep | null> {
  const db = getFirestore(getAdminApp());
  return db.runTransaction(async (tx) => {
    const ref = db.collection(BATCHES).doc(batchNo);
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const batch = batchViewFrom(snap);
    const heldJars = heldJarsFrom(snap);

    // Only the sold-out row needs to know about orders, so only it pays for
    // the query. Everything else is told there is an open order, which is the
    // reading that cannot archive a batch by accident.
    const openOrders =
      batch.state === "soldOut" ? (await ordersInBatch(tx, db, batchNo)).open : 1;

    const step = nextAutomaticStep({ batch, heldJars, openOrders, nowMillis: Date.now() });
    if (doesNothing(step)) return null;

    const existing = await readExisting(tx, db, {
      approvals: step.approvals,
      concerns: [],
      cancelClocks: step.cancelClocks,
    });

    const patch = withStamps(
      step.to === null ? step.patch : { ...step.patch, state: step.to },
      step.stampFields,
      SYSTEM_ACTOR,
    );
    tx.set(ref, patch, { merge: true });
    writeApprovals(tx, db, step.approvals, existing, SYSTEM_ACTOR);
    // Brief 8.2: the 3 day clock *replaces* the 5 day one, so the approval it
    // replaced stops counting in the same transaction that starts the new one.
    cancelApprovalClocks(tx, db, step.cancelClocks, existing, SYSTEM_ACTOR);
    return step;
  });
}

/**
 * Every automatic batch transition. Fires on its own writes too, which is
 * what the three guards above are for.
 */
export const onBatchWritten = onDocumentWritten(
  {
    document: `${BATCHES}/{batchNo}`,
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    // Guard 3: decide from the event payload whether a step could possibly be
    // due, and go no further if not. `openOrders: 1` here means "assume an
    // order is still open", so only a batch that is actually sold out opens a
    // transaction to find out.
    const batch = batchViewFrom(after);
    const probe = nextAutomaticStep({
      batch,
      heldJars: heldJarsFrom(after),
      openOrders: 1,
      nowMillis: Date.now(),
    });
    if (doesNothing(probe) && batch.state !== "soldOut") return;

    await advanceBatch(after.id);
  },
);

/**
 * "Sold out -> Archived: automatic, once every order is closed." The batch
 * document does not change when an order closes, so the last order to close
 * is what has to ask. Orders arrive in M2.8; this trigger is inert until they
 * do, and costs nothing while the collection is empty.
 */
export const onOrderWritten = onDocumentWritten(
  {
    document: "orders/{orderId}",
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const state = String(after.get("state") ?? "");
    if (!(ORDER_STATES_TERMINAL as readonly string[]).includes(state)) return;
    // Only the write that finished the order asks, not every later touch.
    const before = event.data?.before;
    if (before?.exists && String(before.get("state") ?? "") === state) return;

    const batchNos = after.get("batchNos");
    if (!Array.isArray(batchNos)) return;

    for (const batchNo of batchNos as unknown[]) {
      if (typeof batchNo === "string") await advanceBatch(batchNo);
    }
  },
);
