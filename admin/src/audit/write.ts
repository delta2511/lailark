/**
 * The write wrapper every direct client Firestore write in the admin that
 * offers undo goes through (M2.6). Brief section 18.1: "`audit/{id}`: object,
 * action, before, after, by, at. Undo reads from here."
 *
 * **Keeping the write and its trail together.** An audit entry written in a
 * separate operation from the write it records can be lost, leaving a change
 * with no trail, or leave a trail entry for a change that never landed. This
 * wrapper puts both writes in one `writeBatch`: Firestore commits a batch
 * atomically (all of it or none of it), so the document patch and its
 * `audit/{id}` entry can never separate, with no transaction and no extra
 * read needed on the way in. `functions/src/audit/write.ts` is the server
 * twin, writing the same shape inside the Firestore transaction each callable
 * already runs, for the writes a client cannot make (batch state, counts).
 *
 * **The undo race.** The document this wrapper wrote to can change again
 * before the toast's 8 seconds are up, from the other person's phone: Sumayya
 * edits the weight Shefin's undo would otherwise blindly overwrite.
 * {@link undoAuditEntry} reads the audit entry back, compares every field it
 * is about to restore against the document's *current* value, and refuses
 * the undo the moment any one of them no longer matches what this write left
 * behind (`entry.after`). Nothing is silently overwritten; the caller is told
 * plainly that it changed again.
 *
 * **Undoing an undo.** An undo is applied through this same wrapper, so it
 * gets its own audit entry (`action: "undo"`, `undoes: <entry id>`) rather
 * than editing the one it reverses (entries are append-only,
 * `firestore.rules`). The caller is handed that new entry's id back, so
 * clicking Undo on *its* toast undoes the undo: an ordinary undo of the most
 * recent entry, which restores the value the first write set. The trail
 * never loses the fact that something was undone.
 *
 * **No back door.** `undoAuditEntry` takes a `canWriteField` predicate and
 * refuses before it writes anything if the caller's role may not write one of
 * the fields the undo would restore. This is defence in depth: the rules
 * would refuse the write anyway (a Kitchen undoing a price change, or anyone
 * undoing a state move a callable made), but a button that always fails is a
 * false affordance, and the two checks living in one place
 * (`shared/src/rules.ts`) means they cannot drift apart from what the rules
 * actually enforce.
 */
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";

import { db } from "../firebase";
import { sameValue } from "./sameValue";

export const AUDIT_COLLECTION = "audit";

export interface AuditedWriteInput {
  /** The document path that changed, e.g. `"batches/b-7f3a2c"`. */
  readonly object: string;
  /** `"create"`, `"update"`, or `"undo"`. Free text, shown on the timeline. */
  readonly action: string;
  /** The fields being set, and their new values. Plain values, no sentinels. */
  readonly patch: Readonly<Record<string, unknown>>;
  /** The same keys as `patch`, each one's value immediately before this write. */
  readonly before: Readonly<Record<string, unknown>>;
  readonly by: string;
  /** The id of the audit entry this write undoes, if it is an undo. */
  readonly undoes?: string | null;
  /**
   * Written onto the document alongside `patch`, but never audited and never
   * offered back by undo: identifying keys that never change on their own
   * (`saveBatchLine`'s `ingredientId`, for instance) rather than a value a
   * person typed.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface AuditedWriteResult {
  /** The new `audit/{id}` this write created. The next toast's `before`. */
  readonly auditId: string;
}

/**
 * Writes `patch` (plus the usual `updatedAt`/`updatedBy` stamps) onto
 * `object`, and one `audit/{id}` entry recording it, as a single Firestore
 * batch. Both commit or neither does.
 *
 * The two stamp fields are not part of `fields`/`before`/`after`: they are
 * bookkeeping the wrapper adds to every write, not something a person typed,
 * and undoing a field never needs to also undo who last touched the
 * document.
 */
export async function writeWithAudit(input: AuditedWriteInput): Promise<AuditedWriteResult> {
  const fields = Object.keys(input.patch);
  const target = doc(db, input.object);
  const auditRef = doc(collection(db, AUDIT_COLLECTION));

  const batch = writeBatch(db);
  batch.set(
    target,
    {
      ...input.extra,
      ...input.patch,
      updatedAt: serverTimestamp(),
      updatedBy: input.by,
    } as DocumentData,
    { merge: true },
  );
  batch.set(auditRef, {
    object: input.object,
    action: input.action,
    fields,
    before: input.before,
    after: input.patch,
    by: input.by,
    at: serverTimestamp(),
    undoes: input.undoes ?? null,
    source: "client",
  });
  await batch.commit();

  return { auditId: auditRef.id };
}

/** Why {@link undoAuditEntry} did not restore anything. */
export type UndoRefusal = "gone" | "forbidden" | "raced";

export type UndoOutcome =
  | { readonly ok: true; readonly auditId: string; readonly restored: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: UndoRefusal };

interface AuditEntryData {
  readonly object: string;
  readonly action: string;
  readonly fields: readonly string[];
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

/**
 * Undoes the write that created `auditId`, within the toast's 8 second
 * window (the caller only ever reaches this from a still-visible
 * {@link UndoToast}, whose own timer is what actually enforces the window).
 *
 * Reads the entry back from `audit/{auditId}` rather than trusting whatever
 * the screen still has in memory, because that is the one copy every reader
 * agrees on. Refuses instead of writing when:
 *
 * - the entry is gone (`"gone"`, should not happen inside 8 seconds, but a
 *   read is cheap insurance against trusting stale local state);
 * - `canWriteField` says no for any field the undo would touch (`"forbidden"`,
 *   the back-door guard);
 * - the document's current value for any of those fields no longer matches
 *   what this write left behind (`"raced"`, the concurrent-edit guard: the
 *   other person's change stands, and nothing here is silently overwritten).
 *
 * On success, `restored` carries the values just written back, so a screen
 * that keeps its own copy of the document (rather than reading it live) can
 * update it immediately instead of waiting on a listener.
 */
export async function undoAuditEntry(
  auditId: string,
  by: string,
  canWriteField: (field: string) => boolean,
): Promise<UndoOutcome> {
  const auditSnap = await getDoc(doc(db, AUDIT_COLLECTION, auditId));
  if (!auditSnap.exists()) return { ok: false, reason: "gone" };
  const entry = auditSnap.data() as AuditEntryData;

  const fields = entry.fields ?? Object.keys(entry.before ?? {});
  if (!fields.every((field) => canWriteField(field))) {
    return { ok: false, reason: "forbidden" };
  }

  const targetSnap = await getDoc(doc(db, entry.object));
  const current = (targetSnap.exists() ? targetSnap.data() : {}) as Record<string, unknown>;
  const stillAsWritten = fields.every((field) => sameValue(current[field], entry.after?.[field]));
  if (!stillAsWritten) return { ok: false, reason: "raced" };

  const restore: Record<string, unknown> = {};
  const wasAfter: Record<string, unknown> = {};
  for (const field of fields) {
    restore[field] = entry.before[field] ?? null;
    wasAfter[field] = entry.after[field] ?? null;
  }

  const result = await writeWithAudit({
    object: entry.object,
    action: "undo",
    patch: restore,
    before: wasAfter,
    by,
    undoes: auditId,
  });
  return { ok: true, auditId: result.auditId, restored: restore };
}
