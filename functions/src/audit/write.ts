/**
 * The audit wrapper every function write to a batch (and, from M2.8 on,
 * every order and customer write) goes through. Brief section 18.1:
 * "`audit/{id}`: object, action, before, after, by, at. Undo reads from
 * here." M2.6.
 *
 * The client twin is `admin/src/audit/write.ts`: same shape (`object`,
 * `action`, `fields`, `before`, `after`, `by`, `at`, `undoes`), so there is
 * one trail rather than two that drift, distinguished only by `source`
 * (`"client"` here is always `"function"`).
 *
 * **Keeping the write and its trail together.** `writeAudit` takes the same
 * `Transaction` the caller is already writing the document in
 * (`transitionBatch`, `approveBatchFull`) and adds one more `tx.create` to
 * it. Firestore commits a transaction atomically, so the document write and
 * its audit entry land together or the whole transaction (including the
 * document write) is retried and neither lands: an audit entry can never be
 * written for a change that did not happen, and a change can never land with
 * no trail.
 *
 * `buildAuditFields` is the pure half (no `Transaction`, no Firestore), kept
 * separate so it has a plain unit test (`write.test.ts`): given the
 * before-snapshot's getter and the patch a plan is about to write, which
 * fields actually changed, and what did each one read before and after.
 */
import {
  FieldValue,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

export const AUDIT_COLLECTION = "audit";

export interface AuditFields {
  readonly fields: readonly string[];
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

/**
 * `patch`'s keys are what changed; `before` is read off `beforeSnap` (the
 * document as it was read earlier in the same transaction), `null` for a
 * field that was not there, or for every field when `beforeSnap` is null (a
 * create: there was nothing before). `after` is `patch` itself, since that is
 * exactly what the write is about to set.
 *
 * A `FieldValue` sentinel (`serverTimestamp()`, `increment()`, `delete()`) in
 * `patch` is never a value a person typed or a state a person can be shown,
 * so it is dropped from `fields`/`before`/`after` rather than serialised as
 * `"[object Object]"`. `transitionBatch` and `approveBatchFull` only ever put
 * sentinels on the stamp fields (`withStamps`), which `writeAudit` is always
 * called with the *pre*-stamped `plan.patch`, so in practice this never
 * triggers; it is here so a future caller that does pass a sentinel gets a
 * clean field list instead of noise.
 */
export function buildAuditFields(
  patch: Readonly<Record<string, unknown>>,
  beforeSnap: DocumentSnapshot | null,
): AuditFields {
  const fields: string[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value instanceof FieldValue) continue;
    fields.push(field);
    before[field] = beforeSnap?.get(field) ?? null;
    after[field] = value ?? null;
  }
  return { fields, before, after };
}

export interface AuditWriteInput {
  /** The document path that changed, e.g. `"batches/b-7f3a2c"`. */
  readonly object: string;
  /** `"create"`, `"transition:<from>-><to>"`, `"approveFull"`, ... */
  readonly action: string;
  /** The fields this write is setting. Plain values; sentinels are dropped. */
  readonly patch: Readonly<Record<string, unknown>>;
  /** The document as read earlier in this transaction, or null on a create. */
  readonly beforeSnap: DocumentSnapshot | null;
  readonly by: string;
  readonly undoes?: string | null;
}

/**
 * Adds one `audit/{id}` entry to `tx`, in the same transaction as the
 * document write it records. Writes nothing when `patch` changes no
 * (non-sentinel) field, so a transition that only stamps `updatedAt` does
 * not leave a hollow "changed nothing" entry.
 */
export function writeAudit(tx: Transaction, db: Firestore, input: AuditWriteInput): void {
  const { fields, before, after } = buildAuditFields(input.patch, input.beforeSnap);
  if (fields.length === 0) return;

  const ref = db.collection(AUDIT_COLLECTION).doc();
  tx.create(ref, {
    object: input.object,
    action: input.action,
    fields,
    before,
    after,
    by: input.by,
    at: FieldValue.serverTimestamp(),
    undoes: input.undoes ?? null,
    source: "function",
  });
}
