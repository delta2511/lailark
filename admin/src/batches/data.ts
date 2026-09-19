/**
 * The Firestore and Functions side of the Batches screens (brief section
 * 17.4).
 *
 * Every write that moves the lifecycle goes through the `transitionBatch` and
 * `approveBatchFull` callables (M2.3, M2.3a): this file never writes `state`,
 * a count or any other protected field itself (`PROTECTED_BATCH_FIELDS`,
 * `shared/src/rules.ts`). The fields the rules do give a client
 * (`KITCHEN_BATCH_FIELDS`) are written directly, edited in place the same way
 * M2.2 writes a product. The per-ingredient actuals live one level down, in
 * `batches/{ref}/lines/{id}`, which both staff roles may write directly
 * (`firestore.rules`, `isStaff()`).
 */
import type { Approval, Batch, BatchCosts, BatchLine, BatchState } from "@lailark/shared";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type CollectionReference,
  type Query,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "preact/hooks";

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
 * ("What to build" step 3). `HttpsError.message` is already the plain
 * sentence `functions/src/batches/transitions.ts` writes for a person, so it
 * is shown as-is; anything shaped differently (offline, a thrown network
 * error) falls back to `fallback`.
 */
export function callableErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Direct writes: the fields `KITCHEN_BATCH_FIELDS` gives a client            */
/* -------------------------------------------------------------------------- */

function stamps(uid: string): Record<string, unknown> {
  return { updatedAt: serverTimestamp(), updatedBy: uid };
}

/**
 * One or more of `KITCHEN_BATCH_FIELDS` (`cookedOn`, `landedOn`, `packedOn`,
 * `source`, `weightRaw`, `weightCleaned`, `weightCooked`, `costs`), edited in
 * place the way M2.2 edits a product field. The rules check the field names
 * that changed, not their values, so this never sends a protected field.
 */
export async function updateBatchField(
  ref: string,
  patch: Readonly<Record<string, unknown>>,
  uid: string,
): Promise<void> {
  await setDoc(doc(db, BATCHES_COLLECTION, ref), { ...patch, ...stamps(uid) }, { merge: true });
}

/**
 * `costs` is one field to the rules (`onlyChanged`/`touches` compare whole
 * top-level keys), so every save sends the whole map, not just the one line
 * that changed.
 */
export async function updateBatchCosts(ref: string, costs: BatchCosts, uid: string): Promise<void> {
  await updateBatchField(ref, { costs }, uid);
}

/** The two fields an actuals row owns, one box each. */
export type BatchLineField = "qtyActual" | "costActual";

/**
 * One field of one ingredient's actuals, prefilled from the recipe (brief
 * 17.4's "Cooking" row). The main ingredient's line keeps the id `"main"`,
 * the id `sourcing -> cooking` wrote it under (`functions/src/batches/
 * transitions.ts`, `planStartCooking`); every other ingredient's line is
 * keyed by its own ingredient id, so there is exactly one line per ingredient
 * and this screen and the server never disagree about where one lives.
 *
 * **One field per call, deliberately.** The write is a `merge`, so each box
 * sends only the field it owns and nothing else on the document is touched.
 * The signature makes that the only thing a caller can do: the earlier
 * two-field form let the weight box carry a cost it had read from the last
 * snapshot, and a cost typed a moment earlier that the listener had not yet
 * echoed back was rewritten as zero. Money was lost with no error shown. A
 * caller here cannot reach the other box's value, so it cannot overwrite it.
 */
export async function saveBatchLine(
  ref: string,
  lineId: string,
  ingredientId: string,
  field: BatchLineField,
  value: number,
  uid: string,
  isNew: boolean,
): Promise<void> {
  await setDoc(
    doc(db, BATCHES_COLLECTION, ref, LINES_SUBCOLLECTION, lineId),
    {
      ingredientId,
      [field]: value,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      ...(isNew ? { createdAt: serverTimestamp(), createdBy: uid } : {}),
    },
    { merge: true },
  );
}

/** True when a Firestore error is the rules saying no. */
export function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "permission-denied"
  );
}
