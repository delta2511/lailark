/**
 * The Firestore side of the batch state machine: reading a batch into the
 * plain view the pure module works on, allocating a batch number, and writing
 * the approvals and concerns a transition flags.
 *
 * Every write in here happens inside a transaction the caller owns, and every
 * read in here happens before any of them. The Node SDK refuses a read after
 * a write in the same transaction, so both the callable and the triggers keep
 * the same four-step shape: read, plan, read what the plan names, write.
 */

import {
  type DocumentReference,
  type DocumentSnapshot,
  FieldValue,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { formatBatchNo, ORDER_STATES_TERMINAL } from "@lailark/shared";

import type {
  BatchView,
  PaidOrderView,
  PlannedApproval,
  PlannedClockCancel,
  PlannedConcern,
  SiblingBatch,
} from "./transitions";

/** `counters/batch`: the one counter every batch number comes from (8.3). */
export const BATCH_COUNTER_ID = "batch";
export const COUNTERS = "counters";
export const BATCHES = "batches";
export const APPROVALS = "approvals";
export const CONCERNS = "concerns";
export const ORDERS = "orders";

/** What a trigger and the callable both write as the actor. */
export const SYSTEM_ACTOR = "system";

function millisOf(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** The batch document as the pure module wants it: plain values only. */
export function batchViewFrom(snap: DocumentSnapshot): BatchView {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  return {
    batchNo: snap.id,
    state: typeof d.state === "string" ? d.state : undefined,
    productSlug: typeof d.productSlug === "string" ? d.productSlug : "",
    recipeId: typeof d.recipeId === "string" ? d.recipeId : "",
    plannedJars: numberOr(d.plannedJars, 0),
    bookableJars: numberOr(d.bookableJars, 0),
    perPersonLimit: numberOr(d.perPersonLimit, 0),
    priceOpen: numberOr(d.priceOpen, 0),
    priceInStock: numberOr(d.priceInStock, 0),
    paidCount: numberOr(d.paidCount, 0),
    bottledJars: numberOr(d.bottledJars, 0),
    writtenOff: numberOr(d.writtenOff, 0),
    packedOn: typeof d.packedOn === "string" ? d.packedOn : null,
    halfReachedAt: millisOf(d.halfReachedAt),
    fullReachedAt: millisOf(d.fullReachedAt),
    fullApprovedAt: millisOf(d.fullApprovedAt),
  };
}

/**
 * `heldJars` with the customer on each hold, for the per-person limit.
 *
 * `heldJarsFrom` deliberately drops everything but the arithmetic, because the
 * shared availability helpers must not see a phone number. This one keeps it,
 * and only the hold transaction calls it.
 */
export function heldJarsWithCustomerFrom(
  snap: DocumentSnapshot,
): Record<string, { qty: number; expiresAt: number; customerPhone: string | null }> {
  const raw = (snap.get("heldJars") ?? {}) as Record<string, unknown>;
  const out: Record<string, { qty: number; expiresAt: number; customerPhone: string | null }> = {};
  for (const [orderId, hold] of Object.entries(raw)) {
    if (typeof hold !== "object" || hold === null) continue;
    const { qty, expiresAt, customerPhone } = hold as {
      qty?: unknown;
      expiresAt?: unknown;
      customerPhone?: unknown;
    };
    const millis = millisOf(expiresAt);
    if (typeof qty === "number" && millis !== null) {
      out[orderId] = {
        qty,
        expiresAt: millis,
        customerPhone: typeof customerPhone === "string" ? customerPhone : null,
      };
    }
  }
  return out;
}

/** `heldJars` with its expiries as epoch millis, for the shared helpers. */
export function heldJarsFrom(snap: DocumentSnapshot): Record<string, { qty: number; expiresAt: number }> {
  const raw = (snap.get("heldJars") ?? {}) as Record<string, unknown>;
  const out: Record<string, { qty: number; expiresAt: number }> = {};
  for (const [orderId, hold] of Object.entries(raw)) {
    if (typeof hold !== "object" || hold === null) continue;
    const { qty, expiresAt } = hold as { qty?: unknown; expiresAt?: unknown };
    const millis = millisOf(expiresAt);
    if (typeof qty === "number" && millis !== null) {
      out[orderId] = { qty, expiresAt: millis };
    }
  }
  return out;
}

/**
 * The batch number, from a transaction on `counters/batch`.
 *
 * Global across products, sequential, zero-padded by the shared
 * `formatBatchNo`, never reused. The counter document is in the read set of
 * the transaction that issues the number, so two callers opening a batch at
 * the same moment cannot both read the same `next`: whichever commits second
 * is retried by the SDK against the number the first one wrote.
 */
export async function nextBatchNo(
  tx: Transaction,
  db: Firestore,
): Promise<{ readonly batchNo: string; readonly n: number; readonly counterRef: DocumentReference }> {
  const counterRef = db.collection(COUNTERS).doc(BATCH_COUNTER_ID);
  const snap = await tx.get(counterRef);
  const next = numberOr(snap.get("next"), 1);
  const n = Math.max(1, Math.floor(next));
  return { batchNo: formatBatchNo(n), n, counterRef };
}

/** Other batches of the same product. Decision D15 reads this. */
export async function siblingBatches(
  tx: Transaction,
  db: Firestore,
  productSlug: string,
  exceptBatchNo: string,
): Promise<SiblingBatch[]> {
  if (productSlug === "") return [];
  const found = await tx.get(db.collection(BATCHES).where("productSlug", "==", productSlug));
  return found.docs
    .filter((doc) => doc.id !== exceptBatchNo)
    .map((doc) => ({ batchNo: doc.id, state: String(doc.get("state") ?? "") }));
}

/**
 * Orders in this batch. `batchNos` is the flat array of batch numbers an
 * order touches, which is the only shape Firestore can query (the lines
 * themselves are an array of maps, and those cannot be filtered on). Orders
 * arrive in M2.8; until then this reads an empty collection and answers with
 * an empty list rather than failing.
 */
export async function ordersInBatch(
  tx: Transaction,
  db: Firestore,
  batchNo: string,
): Promise<{ readonly paid: PaidOrderView[]; readonly open: number }> {
  const found = await tx.get(db.collection(ORDERS).where("batchNos", "array-contains", batchNo));
  const terminal = ORDER_STATES_TERMINAL as readonly string[];
  const paid: PaidOrderView[] = [];
  let open = 0;
  for (const doc of found.docs) {
    const state = String(doc.get("state") ?? "");
    if (!terminal.includes(state)) open += 1;
    if (doc.get("payment.status") === "captured" || doc.get("paidAt") !== undefined) {
      paid.push({
        id: doc.id,
        customerPhone: (doc.get("customerPhone") as string | undefined) ?? null,
        jars: jarsInBatch(doc, batchNo),
        paidAtMillis: millisOf(doc.get("paidAt")) ?? 0,
      });
    }
  }
  return { paid, open };
}

function jarsInBatch(doc: DocumentSnapshot, batchNo: string): number {
  const lines = doc.get("lines");
  if (!Array.isArray(lines)) return 0;
  let total = 0;
  for (const line of lines as Array<Record<string, unknown>>) {
    if (line?.batchNo === batchNo) total += numberOr(line?.qty, 0);
  }
  return total;
}

/** The recipe's main ingredient, for the sourcing cost line (brief 14.1). */
export async function mainIngredientOf(
  tx: Transaction,
  db: Firestore,
  recipeId: string,
): Promise<string | null> {
  if (recipeId === "") return null;
  const snap = await tx.get(db.collection("recipes").doc(recipeId));
  const lines = snap.get("lines");
  if (!Array.isArray(lines)) return null;
  const main = (lines as Array<Record<string, unknown>>).find((line) => line?.isMain === true);
  return typeof main?.ingredientId === "string" ? main.ingredientId : null;
}

/** Turns the plan's stamp field list into `serverTimestamp()` values. */
export function withStamps(
  patch: Readonly<Record<string, unknown>>,
  stampFields: readonly string[],
  actor: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch, updatedBy: actor };
  for (const field of stampFields) {
    out[field] = FieldValue.serverTimestamp();
  }
  return out;
}

export interface PlannedWrites {
  readonly approvals: readonly PlannedApproval[];
  readonly concerns: readonly PlannedConcern[];
  readonly cancelClocks?: readonly PlannedClockCancel[];
}

/**
 * Reads every approval and concern the plan names, before anything is
 * written. An approval that is already there is never overwritten unless the
 * plan is answering it, so a trigger that fires twice raises one approval and
 * never undoes the Owner's answer.
 *
 * A Map rather than a Set, because cancelling a clock has to look at the
 * approval it is cancelling: only an approval still waiting has a clock worth
 * stopping. `.has(path)` reads the same on both.
 */
export async function readExisting(
  tx: Transaction,
  db: Firestore,
  plan: PlannedWrites,
): Promise<Map<string, DocumentSnapshot>> {
  const refs: DocumentReference[] = [
    ...plan.approvals.map((a) => db.collection(APPROVALS).doc(a.id)),
    ...plan.concerns.map((c) => db.collection(CONCERNS).doc(c.id)),
    ...(plan.cancelClocks ?? []).map((c) => db.collection(APPROVALS).doc(c.id)),
  ];
  if (refs.length === 0) return new Map();
  // The same approval can be named twice (raised and cancelled in one step),
  // and `getAll` refuses a repeated reference.
  const unique = new Map(refs.map((ref) => [ref.path, ref]));
  const snaps = await tx.getAll(...unique.values());
  return new Map(
    snaps.filter((snap) => snap.exists).map((snap) => [snap.ref.path, snap as DocumentSnapshot]),
  );
}

/**
 * Brief 8.2: "3-day production clock replaces the 5-day". Clears the `dueAt`
 * of the approval the new clock replaced, and records which approval replaced
 * it, so exactly one clock on a batch is ever live. An approval that is gone,
 * or that the Owner has already answered, is left alone: its clock is spent.
 */
export function cancelApprovalClocks(
  tx: Transaction,
  db: Firestore,
  cancels: readonly PlannedClockCancel[],
  existing: Map<string, DocumentSnapshot>,
  actor: string,
): void {
  for (const cancel of cancels) {
    const ref = db.collection(APPROVALS).doc(cancel.id);
    const snap = existing.get(ref.path);
    if (!snap) continue;
    if (snap.get("status") !== "waiting") continue;
    if (snap.get("dueAt") === null || snap.get("dueAt") === undefined) continue;
    tx.set(
      ref,
      {
        dueAt: null,
        dueAtSupersededBy: cancel.supersededBy,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor,
      },
      { merge: true },
    );
  }
}

/** Writes the approvals a transition flags. Nothing here sends anything. */
export function writeApprovals(
  tx: Transaction,
  db: Firestore,
  approvals: readonly PlannedApproval[],
  existing: Map<string, DocumentSnapshot>,
  actor: string,
): void {
  for (const approval of approvals) {
    const ref = db.collection(APPROVALS).doc(approval.id);
    const there = existing.has(ref.path);
    const now = FieldValue.serverTimestamp();

    if (approval.answer) {
      // The Owner's yes on a waiting approval. If the approval went missing
      // (a batch moved by hand, a replay), record the answer anyway: the
      // approval is the record that the send was authorised.
      tx.set(
        ref,
        {
          kind: approval.kind,
          batchNo: approval.batchNo,
          draft: approval.draft,
          status: approval.status,
          answeredBy: actor,
          at: now,
          updatedAt: now,
          updatedBy: actor,
          ...(there
            ? {}
            : {
                createdAt: now,
                createdBy: actor,
                dueAt: null,
                dueAtSupersededBy: null,
                sentAt: null,
              }),
        },
        { merge: true },
      );
      continue;
    }

    if (there) continue;
    tx.set(ref, {
      kind: approval.kind,
      batchNo: approval.batchNo,
      draft: approval.draft,
      status: approval.status,
      answeredBy: null,
      at: null,
      dueAt: approval.dueAtMillis === null ? null : Timestamp.fromMillis(approval.dueAtMillis),
      dueAtSupersededBy: null,
      sentAt: null,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    });
  }
}

/** Writes the concerns a transition raises. Nothing here sends anything. */
export function writeConcerns(
  tx: Transaction,
  db: Firestore,
  concerns: readonly PlannedConcern[],
  existing: Map<string, DocumentSnapshot>,
  actor: string,
): void {
  for (const concern of concerns) {
    const ref = db.collection(CONCERNS).doc(concern.id);
    if (existing.has(ref.path)) continue;
    const now = FieldValue.serverTimestamp();
    tx.set(ref, {
      type: concern.type,
      customerPhone: concern.customerPhone,
      orderId: concern.orderId,
      batchNo: concern.batchNo,
      summary: concern.summary,
      proposal: concern.proposal,
      draftMessage: null,
      answer: null,
      outcome: null,
      money: null,
      raisedAt: now,
      dueAt: null,
      answeredAt: null,
      sentAt: null,
      urgent: concern.urgent,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    });
  }
}
