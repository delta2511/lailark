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

import { randomBytes } from "node:crypto";

import {
  type DocumentReference,
  type DocumentSnapshot,
  FieldValue,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import {
  batchRefFromBytes,
  formatBatchNo,
  type MessagesSettings,
  ORDER_STATES_TERMINAL,
} from "@lailark/shared";

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
export const PRODUCTS = "products";
export const RECIPES = "recipes";
export const INGREDIENTS = "ingredients";
export const SETTINGS = "settings";
/** `settings/messages`: the Owner's wording for the three messages (D24). */
export const MESSAGES_SETTINGS_ID = "messages";

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

/**
 * The batch document as the pure module wants it: plain values only.
 *
 * D21c: the document id is the batch's internal reference, and the printed
 * number is the `batchNo` field, which is null until bottling. Nothing here
 * reads one as the other.
 */
export function batchViewFrom(snap: DocumentSnapshot): BatchView {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  return {
    ref: snap.id,
    batchNo: typeof d.batchNo === "string" && d.batchNo !== "" ? d.batchNo : null,
    state: typeof d.state === "string" ? d.state : undefined,
    productSlug: typeof d.productSlug === "string" ? d.productSlug : "",
    productName: typeof d.productName === "string" ? d.productName : null,
    recipeId: typeof d.recipeId === "string" ? d.recipeId : "",
    mainIngredientName:
      typeof d.mainIngredientName === "string" ? d.mainIngredientName : null,
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
    pausedFrom: typeof d.pausedFrom === "string" ? d.pausedFrom : null,
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
 * A fresh internal reference for a new batch. **Decision D21c.**
 *
 * `b-` plus six lowercase base32 characters, from `crypto.randomBytes`, which
 * is the document id and is fixed for the batch's whole life. Nothing about it
 * is sequential and nothing about it is guessable: it carries no information,
 * which is the point, because the number that carries information is stamped
 * later and is a field.
 *
 * A collision is about one in a billion, and the create is a `tx.create`, so a
 * collision fails the transaction rather than overwriting a batch. `freshRefs`
 * hands out a few candidates so the caller can pick one that is free.
 */
export function newBatchRef(): string {
  return batchRefFromBytes(randomBytes(6));
}

/**
 * Mints a reference and proves it is free, inside the transaction. Reads come
 * before writes, so this is called during the read phase.
 */
export async function freeBatchRef(tx: Transaction, db: Firestore): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ref = newBatchRef();
    const taken = await tx.get(db.collection(BATCHES).doc(ref));
    if (!taken.exists) return ref;
  }
  throw new Error("could not mint a free batch reference in five tries");
}

/**
 * The printed batch number, from a transaction on `counters/batch`.
 *
 * Global across products, sequential, zero-padded by the shared
 * `formatBatchNo`, never reused. D21c: this is read at **bottling**, not at
 * creation, so a batch that is abandoned before bottling never takes a number
 * and the sequence has no hole in it.
 *
 * The counter document is in the read set of the transaction that issues the
 * number, so two kitchens bottling at the same moment cannot both read the
 * same `next`: whichever commits second is retried by the SDK against the
 * number the first one wrote.
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

/**
 * Whether a printed number is already on a batch. D21c: the number is a field,
 * not the document id, so "is this number taken" is a query, not a `get`. It
 * runs inside the bottling transaction, before anything is written, so a
 * counter that has fallen behind is caught rather than printing a duplicate.
 */
export async function batchNoTaken(
  tx: Transaction,
  db: Firestore,
  batchNo: string,
): Promise<boolean> {
  const found = await tx.get(db.collection(BATCHES).where("batchNo", "==", batchNo).limit(1));
  return !found.empty;
}

/** Other batches of the same product. Decision D15 reads this. */
export async function siblingBatches(
  tx: Transaction,
  db: Firestore,
  productSlug: string,
  exceptRef: string,
): Promise<SiblingBatch[]> {
  if (productSlug === "") return [];
  const found = await tx.get(db.collection(BATCHES).where("productSlug", "==", productSlug));
  return found.docs
    .filter((doc) => doc.id !== exceptRef)
    .map((doc) => ({
      ref: doc.id,
      batchNo: typeof doc.get("batchNo") === "string" ? (doc.get("batchNo") as string) : null,
      state: String(doc.get("state") ?? ""),
    }));
}

/**
 * Orders in this batch. `batchRefs` is the flat array of batch **references**
 * an order touches, which is the only shape Firestore can query (the lines
 * themselves are an array of maps, and those cannot be filtered on).
 *
 * D21c: references, not printed numbers. An order placed while the batch was
 * open was written before the batch had a number, and it still resolves to the
 * same batch after bottling, because the reference it carries never changed.
 *
 * Orders arrive in M2.8; until then this reads an empty collection and answers
 * with an empty list rather than failing.
 */
export async function ordersInBatch(
  tx: Transaction,
  db: Firestore,
  batchRef: string,
): Promise<{ readonly paid: PaidOrderView[]; readonly open: number }> {
  const found = await tx.get(db.collection(ORDERS).where("batchRefs", "array-contains", batchRef));
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
        jars: jarsInBatch(doc, batchRef),
        paidAtMillis: millisOf(doc.get("paidAt")) ?? 0,
      });
    }
  }
  return { paid, open };
}

function jarsInBatch(doc: DocumentSnapshot, batchRef: string): number {
  const lines = doc.get("lines");
  if (!Array.isArray(lines)) return 0;
  let total = 0;
  for (const line of lines as Array<Record<string, unknown>>) {
    if (line?.batchRef === batchRef) total += numberOr(line?.qty, 0);
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
  const snap = await tx.get(db.collection(RECIPES).doc(recipeId));
  const lines = snap.get("lines");
  if (!Array.isArray(lines)) return null;
  const main = (lines as Array<Record<string, unknown>>).find((line) => line?.isMain === true);
  return typeof main?.ingredientId === "string" ? main.ingredientId : null;
}

/**
 * The two names a customer message needs, read once when the batch is created
 * and then kept on the batch document (D24).
 *
 * Reading them here rather than at every message keeps the triggers to one
 * batch read: a trigger that has to draft the half-reached message would
 * otherwise read the recipe and the ingredient inside its transaction, every
 * time, for a string that never changes.
 *
 * Either can come back null. A message with a placeholder still standing is a
 * question the Owner can answer before he approves it, which is what D24 put
 * him in front of the draft for.
 */
export async function catalogueNamesFor(
  tx: Transaction,
  db: Firestore,
  productSlug: unknown,
  recipeId: unknown,
): Promise<{ readonly productName: string | null; readonly mainIngredientName: string | null }> {
  let productName: string | null = null;
  if (typeof productSlug === "string" && productSlug !== "") {
    const snap = await tx.get(db.collection(PRODUCTS).doc(productSlug));
    const name = snap.get("name");
    if (typeof name === "string" && name !== "") productName = name;
  }

  let mainIngredientName: string | null = null;
  if (typeof recipeId === "string" && recipeId !== "") {
    const ingredientId = await mainIngredientOf(tx, db, recipeId);
    if (ingredientId !== null) {
      const snap = await tx.get(db.collection(INGREDIENTS).doc(ingredientId));
      const labelName = snap.get("labelName");
      if (typeof labelName === "string" && labelName !== "") mainIngredientName = labelName;
    }
  }

  return { productName, mainIngredientName };
}

/**
 * `settings/messages`, the Owner's wording for the three customer messages
 * (D24). A missing document is not an error: `customerMessage` falls back to
 * the drafts in `@lailark/shared`.
 */
export async function messagesSettings(
  tx: Transaction,
  db: Firestore,
): Promise<Partial<MessagesSettings> | null> {
  const snap = await tx.get(db.collection(SETTINGS).doc(MESSAGES_SETTINGS_ID));
  if (!snap.exists) return null;
  return (snap.data() ?? null) as Partial<MessagesSettings> | null;
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
          // D21c: the reference, so nothing is re-pointed at bottling.
          batchRef: approval.batchRef,
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
      batchRef: approval.batchRef,
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
      batchRef: concern.batchRef,
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
