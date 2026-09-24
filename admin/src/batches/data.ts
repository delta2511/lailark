/**
 * The Firestore and Functions side of the Batches screens (brief section
 * 17.4).
 *
 * Every write that moves the lifecycle goes through the `transitionBatch` and
 * `approveBatchFull` callables (M2.3, M2.3a): this file never writes `state`,
 * a count or any other protected field itself (`PROTECTED_BATCH_FIELDS`,
 * `shared/src/rules.ts`). The fields the rules do give a client
 * (`KITCHEN_BATCH_FIELDS`) are written directly, edited in place the same way
 * M2.2 writes a product, and (M2.6) through the same audit wrapper. The
 * per-ingredient actuals live one level down, in `batches/{ref}/lines/{id}`,
 * which both staff roles may write directly (`firestore.rules`, `isStaff()`).
 */
import {
  isKitchenBatchField,
  isProtectedBatchField,
  type Approval,
  type Batch,
  type BatchCosts,
  type BatchLine,
  type BatchState,
  type Role,
} from "@lailark/shared";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type CollectionReference,
  type Query,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "preact/hooks";

import { undoAuditEntry, writeWithAudit, type AuditedWriteResult, type UndoOutcome } from "../audit/write";
import { callableMessage } from "../callableError";
import { db, functions } from "../firebase";
import type { Live } from "../products/data";

export const BATCHES_COLLECTION = "batches";
export const APPROVALS_COLLECTION = "approvals";
export const LINES_SUBCOLLECTION = "lines";

/** A document as a screen holds it: its id, and the fields it carries. */
export type BatchDoc = Partial<Batch> & { readonly id: string };
export type ApprovalDoc = Partial<Approval> & { readonly id: string };
export type BatchLineDoc = Partial<BatchLine> & { readonly id: string };

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

function watch<T extends { id: string }>(
  target: Query | CollectionReference,
  set: (state: Live<T>) => void,
): Unsubscribe {
  return onSnapshot(
    target,
    (snap) => set({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as T), loading: false, denied: false }),
    () => set({ items: [], loading: false, denied: true }),
  );
}

/** Every batch, newest first (brief 17.4's list: "newest first"). */
export function useBatches(): Live<BatchDoc> {
  const [state, setState] = useState<Live<BatchDoc>>({ items: [], loading: true, denied: false });

  useEffect(() => {
    const q = query(collection(db, BATCHES_COLLECTION), orderBy("createdAt", "desc"));
    return watch<BatchDoc>(q, setState);
  }, []);

  return state;
}

/** Every approval raised against one batch, whatever it is answered. */
export function useApprovalsForBatch(batchRef: string | null): Live<ApprovalDoc> {
  const [state, setState] = useState<Live<ApprovalDoc>>({
    items: [],
    loading: batchRef !== null,
    denied: false,
  });

  useEffect(() => {
    if (batchRef === null) {
      setState({ items: [], loading: false, denied: false });
      return undefined;
    }
    const q = query(collection(db, APPROVALS_COLLECTION), where("batchRef", "==", batchRef));
    return watch<ApprovalDoc>(q, setState);
  }, [batchRef]);

  return state;
}

/**
 * Every waiting approval, in one listener, for the list screen: the card's
 * badge and clock (brief 17.4) group these by `batchRef` client side rather
 * than opening one listener per card.
 */
export function useWaitingApprovals(): Live<ApprovalDoc> {
  const [state, setState] = useState<Live<ApprovalDoc>>({ items: [], loading: true, denied: false });

  useEffect(() => {
    const q = query(collection(db, APPROVALS_COLLECTION), where("status", "==", "waiting"));
    return watch<ApprovalDoc>(q, setState);
  }, []);

  return state;
}

/** `batches/{ref}/lines`: what the pot actually used, per ingredient (brief 14.1). */
export function useBatchLines(batchRef: string | null): Live<BatchLineDoc> {
  const [state, setState] = useState<Live<BatchLineDoc>>({
    items: [],
    loading: batchRef !== null,
    denied: false,
  });

  useEffect(() => {
    if (batchRef === null) {
      setState({ items: [], loading: false, denied: false });
      return undefined;
    }
    return watch<BatchLineDoc>(collection(db, BATCHES_COLLECTION, batchRef, LINES_SUBCOLLECTION), setState);
  }, [batchRef]);

  return state;
}

/* -------------------------------------------------------------------------- */
/* The state machine: `transitionBatch` and `approveBatchFull` (M2.3, M2.3a)  */
/* -------------------------------------------------------------------------- */

export interface TransitionInput {
  /** Absent only for the row that creates a batch (none -> draft). */
  readonly ref?: string;
  readonly to: BatchState;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface TransitionResult {
  readonly ref: string;
  readonly batchNo: string | null;
  readonly from: string;
  readonly to: string;
  readonly computed: Readonly<Record<string, unknown>>;
}

/** The one door for every state move: brief section 8.2, decision D21c. */
export async function callTransitionBatch(input: TransitionInput): Promise<TransitionResult> {
  const call = httpsCallable<TransitionInput, TransitionResult>(functions, "transitionBatch");
  const result = await call(input);
  return result.data;
}

export interface FullApprovalResult {
  readonly ref: string;
  readonly batchNo: string | null;
  readonly alreadyApproved: boolean;
}

/** The Owner's yes on "The batch is full." (A62, not a state hop.) */
export async function callApproveBatchFull(
  ref: string,
  data: Readonly<Record<string, unknown>> = {},
): Promise<FullApprovalResult> {
  const call = httpsCallable<
    { ref: string; data: Readonly<Record<string, unknown>> },
    FullApprovalResult
  >(functions, "approveBatchFull");
  const result = await call({ ref, data });
  return result.data;
}

/**
 * A refusal from a callable reads as a plain line, never a blank screen
 * ("What to build" step 3) and never a status code (`callableError.ts`).
 */
export function callableErrorMessage(error: unknown, fallback: string): string {
  return callableMessage(error, fallback);
}

/* -------------------------------------------------------------------------- */
/* Direct writes: the fields `KITCHEN_BATCH_FIELDS` gives a client (M2.6:     */
/* every one of them now goes through the audit wrapper, so there is one     */
/* write path here rather than a plain `setDoc` some callers use and the     */
/* wrapper others do.)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One or more of `KITCHEN_BATCH_FIELDS` (`cookedOn`, `landedOn`, `packedOn`,
 * `source`, `weightRaw`, `weightCleaned`, `weightCooked`, `costs`), edited in
 * place the way M2.2 edits a product field. The rules check the field names
 * that changed, not their values, so this never sends a protected field.
 *
 * `before` is the same keys as `patch`, read from the document as the screen
 * already has it, so the `audit/{id}` entry this write creates (M2.6, brief
 * 18.1) carries both without a second read. The returned `auditId` is what a
 * caller offering undo hands to {@link undoBatchWrite}.
 */
export async function updateBatchField(
  ref: string,
  patch: Readonly<Record<string, unknown>>,
  before: Readonly<Record<string, unknown>>,
  uid: string,
): Promise<AuditedWriteResult> {
  return writeWithAudit({ object: `${BATCHES_COLLECTION}/${ref}`, action: "update", patch, before, by: uid });
}

/**
 * `costs` is one field to the rules (`onlyChanged`/`touches` compare whole
 * top-level keys), so every save sends the whole map, not just the one line
 * that changed, and the whole previous map is what `before` carries too.
 */
export async function updateBatchCosts(
  ref: string,
  costs: BatchCosts,
  beforeCosts: BatchCosts,
  uid: string,
): Promise<AuditedWriteResult> {
  return updateBatchField(ref, { costs }, { costs: beforeCosts }, uid);
}

/**
 * Whether `role` may write `field` on a batch: the same two lists the rules
 * enforce (`shared/src/rules.ts`, `firestore.rules`). M2.6 uses this to gate
 * the Undo button, so it never offers to restore a field the write would be
 * refused for, whoever is asking, the Owner included. An undo is a write
 * like any other, and it must not become a back door to a field the actor
 * could never have written directly.
 */
export function canRoleWriteBatchField(role: Role, field: string): boolean {
  if (role === "owner") return !isProtectedBatchField(field);
  if (role === "kitchen") return isKitchenBatchField(field);
  return false;
}

/** Undoes a batch field write within its toast's 8 second window. See `undoAuditEntry`. */
export async function undoBatchWrite(auditId: string, uid: string, role: Role): Promise<UndoOutcome> {
  return undoAuditEntry(auditId, uid, (field) => canRoleWriteBatchField(role, field));
}

/**
 * Whether `role` may write a per-ingredient actual (`qtyActual` or
 * `costActual`): `firestore.rules`' `isStaff()` on `lines/{lineId}` gives
 * both staff roles either field, unlike the batch document itself where
 * Kitchen and Owner see different lists. M2.14 uses this to gate the Undo
 * button on the Cooking actuals the same way `canRoleWriteBatchField` gates
 * it on the batch fields above: an undo must not reach a write its actor
 * could never have made directly, whoever is asking.
 */
export function canRoleWriteBatchLine(role: Role): boolean {
  return role === "owner" || role === "kitchen";
}

/**
 * Undoes a per-ingredient actual write within its toast's 8 second window
 * (M2.14). See `undoAuditEntry` for the race guard: it reads `lines/{id}`
 * back and refuses if the field the undo would restore no longer holds the
 * value this write left there, e.g. Sumayya has since typed a different
 * weight into the same box from her phone. Nothing here is silently
 * overwritten; the caller sees `"raced"` and the newer figure stands.
 */
export async function undoBatchLineWrite(auditId: string, uid: string, role: Role): Promise<UndoOutcome> {
  return undoAuditEntry(auditId, uid, () => canRoleWriteBatchLine(role));
}

/** The two fields an actuals row owns, one box each. */
export type BatchLineField = "qtyActual" | "costActual";

/**
 * One field of one ingredient's actuals, prefilled from the recipe (brief
 * 17.4's "Cooking" row). Every line is keyed by its own ingredient
 * (`lineIds.ts`), the main one included: that is the id
 * `sourcing -> cooking` writes it under too (`functions/src/batches/
 * transitions.ts`, `planStartCooking`), so there is exactly one line per
 * ingredient and this screen and the server never disagree about where one
 * lives. M2.13: until then a line flagged `isMain` was keyed under the
 * literal id `"main"`, which made the two main lines of a batch 001 shaped
 * recipe one document and lost a cost typed against the first of them.
 *
 * **One field per call, deliberately.** The write is a `merge`, so each box
 * sends only the field it owns and nothing else on the document is touched.
 * The signature makes that the only thing a caller can do: the earlier
 * two-field form let the weight box carry a cost it had read from the last
 * snapshot, and a cost typed a moment earlier that the listener had not yet
 * echoed back was rewritten as zero. Money was lost with no error shown. A
 * caller here cannot reach the other box's value, so it cannot overwrite it.
 *
 * M2.6: audited like every other batch write (`ingredientId` and the create
 * stamps ride along as `extra`, not as an audited field: they identify the
 * row, they are never a value a person edited).
 *
 * M2.14 (superseding A79): this screen now offers the same 8 second undo as
 * every other in-place field, through `undoBatchLineWrite` above. The "one
 * field per call" guarantee is what makes that safe: `undoAuditEntry`'s race
 * guard already refuses an undo the moment the field it would restore no
 * longer matches what this write left behind, and because a commit here
 * only ever touches the one field the person typed into, an undo of it can
 * only ever collide with a later write to that same field, on that same
 * document, never with the row's other box. See `CookingActuals.tsx`.
 */
export async function saveBatchLine(
  ref: string,
  lineId: string,
  ingredientId: string,
  field: BatchLineField,
  value: number,
  beforeValue: number | null,
  uid: string,
  isNew: boolean,
): Promise<AuditedWriteResult> {
  return writeWithAudit({
    object: `${BATCHES_COLLECTION}/${ref}/${LINES_SUBCOLLECTION}/${lineId}`,
    action: isNew ? "create" : "update",
    patch: { [field]: value },
    before: { [field]: beforeValue },
    by: uid,
    extra: { ingredientId, ...(isNew ? { createdAt: serverTimestamp(), createdBy: uid } : {}) },
  });
}

/** True when a Firestore error is the rules saying no. */
export function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "permission-denied"
  );
}
