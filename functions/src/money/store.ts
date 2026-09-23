/**
 * The Firestore side of documents: the counter a number comes out of, the
 * settings a document is spelled with, and the write that creates both a
 * number and the document that owns it in one commit.
 *
 * **A number and its document are born together.** {@link readDocumentSerial}
 * puts `counters/{series}` in the caller's transaction read set, and
 * {@link writeDocument} advances that counter and `tx.create`s
 * `documents/{id}` in the same commit. So:
 *
 *  - two callers cannot take the same number: the second transaction is
 *    retried against the first one's counter, which is ordinary contention,
 *    not a failure;
 *  - a number cannot be issued and then lost, because the create is in the
 *    same commit as the increment;
 *  - a number cannot be used twice even if the counter were somehow behind,
 *    because the document id **is** the number and `tx.create` refuses an id
 *    that exists (brief 18.1).
 *
 * The counter document not existing is not a special case: the first bill of
 * a financial year reads a missing document, gets `next = 1`, and the same
 * write creates it. That is what "resets each 1 April" means here. Nothing
 * runs on 1 April; a document issued on or after it simply belongs to a
 * different series key (`LK/27-28`), which is a different counter document,
 * which has never been written, which starts at 1. The old counter is left
 * exactly where it was, so a late bill dated in March still takes the next
 * 26-27 number.
 */

import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {
  type CalDateInput,
  counterId,
  DEFAULT_DOCUMENT_PREFIXES,
  type DocumentKind,
  type DocumentPrefixes,
  DOCUMENT_KINDS,
  documentNumberFor,
  financialYearLabel,
  type SellerIdentity,
  seriesKey,
} from "@lailark/shared";

import { writeAudit } from "../audit/write";
import { DEFAULT_SELLER } from "./copy";
import type { DocumentBody } from "./plan";

export const DOCUMENTS = "documents";
export const COUNTERS = "counters";
export const SETTINGS = "settings";
/** `concerns/{id}`, brief 12.1: everything that waits for the Owner. */
export const CONCERNS = "concerns";

/** `settings/prefixes`, brief 17.11. A new legal entity starts a new series. */
export const PREFIXES_SETTINGS_ID = "prefixes";
/** `settings/seller`: the block at the top of every document (13.2). */
export const SELLER_SETTINGS_ID = "seller";
/** `settings/gst`, brief 4.5. Off at launch (D26). */
export const GST_SETTINGS_ID = "gst";

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The document prefixes, per kind. A26: they are a parameter with brief
 * 13.3's defaults, so December's new legal entity is a settings change.
 *
 * Read field by field, so a settings document that names only `bill` leaves
 * the other three at their defaults rather than breaking them.
 */
export async function readDocumentPrefixes(
  tx: Transaction,
  db: Firestore,
): Promise<DocumentPrefixes> {
  const snap = await tx.get(db.collection(SETTINGS).doc(PREFIXES_SETTINGS_ID));
  const stored = snap.get("document");
  if (typeof stored !== "object" || stored === null) return DEFAULT_DOCUMENT_PREFIXES;
  const out: Record<string, string> = { ...DEFAULT_DOCUMENT_PREFIXES };
  for (const kind of DOCUMENT_KINDS) {
    const value = (stored as Record<string, unknown>)[kind];
    if (typeof value === "string" && /^[A-Z]+$/.test(value)) out[kind] = value;
  }
  return out as DocumentPrefixes;
}

function stringsOr(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  const lines = value.filter((line): line is string => typeof line === "string" && line.trim() !== "");
  return lines.length === 0 ? fallback : lines;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/**
 * Who the bill is from, frozen onto the document at issue. `settings/seller`
 * overrides {@link DEFAULT_SELLER} field by field; a missing document means
 * the constant, which is what Shefin gave, character for character.
 *
 * `gstin` is the one field with no fallback: it is null unless the settings
 * document carries a real one, because a GSTIN is never invented (D26).
 */
export async function readSeller(tx: Transaction, db: Firestore): Promise<SellerIdentity> {
  const snap = await tx.get(db.collection(SETTINGS).doc(SELLER_SETTINGS_ID));
  if (!snap.exists) return DEFAULT_SELLER;
  const gstin = snap.get("gstin");
  return {
    name: stringOr(snap.get("name"), DEFAULT_SELLER.name),
    addressLines: stringsOr(snap.get("addressLines"), DEFAULT_SELLER.addressLines),
    supportPhone: stringOr(snap.get("supportPhone"), DEFAULT_SELLER.supportPhone),
    fssai: stringOr(snap.get("fssai"), DEFAULT_SELLER.fssai),
    website: stringOr(snap.get("website"), DEFAULT_SELLER.website),
    gstin: typeof gstin === "string" && gstin.trim() !== "" ? gstin.trim() : null,
    // D38: editable as a note, with the brief's own wording as the fallback.
    handedOverText: stringOr(snap.get("handedOverText"), DEFAULT_SELLER.handedOverText),
  };
}

export interface GstSettingsView {
  readonly enabled: boolean;
  readonly gstin: string | null;
  readonly homeState: string;
}

/** Kerala. The place of supply when nothing is being shipped anywhere. */
export const DEFAULT_HOME_STATE = "KL";

/** `settings/gst`, whole. Off at launch, and off is the default. */
export async function readGstSettings(tx: Transaction, db: Firestore): Promise<GstSettingsView> {
  const snap = await tx.get(db.collection(SETTINGS).doc(GST_SETTINGS_ID));
  const gstin = snap.get("gstin");
  return {
    enabled: snap.get("enabled") === true,
    gstin: typeof gstin === "string" && gstin.trim() !== "" ? gstin.trim() : null,
    homeState: stringOr(snap.get("homeState"), DEFAULT_HOME_STATE),
  };
}

/* -------------------------------------------------------------------------- */
/* The number                                                                 */
/* -------------------------------------------------------------------------- */

/** A number that has been read but not yet written. */
export interface DocumentSerial {
  readonly kind: DocumentKind;
  /** `"LK/26-27/0001"`, what a person reads. */
  readonly number: string;
  /** `"LK-26-27-0001"`, the `documents/{id}` document id. */
  readonly id: string;
  /** `"LK/26-27"`. */
  readonly series: string;
  readonly fyLabel: string;
  readonly n: number;
  readonly counterRef: DocumentReference;
  readonly documentRef: DocumentReference;
}

function serialFrom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

/**
 * The next number in `kind`'s series for `date`, read inside the caller's
 * transaction and not yet written.
 *
 * Must be called in the transaction's **read** phase, like every other read:
 * the Node SDK refuses a read after a write. Pair it with
 * {@link writeDocument} in the write phase.
 */
export async function readDocumentSerial(
  tx: Transaction,
  db: Firestore,
  kind: DocumentKind,
  date: CalDateInput,
  prefixes: DocumentPrefixes = DEFAULT_DOCUMENT_PREFIXES,
): Promise<DocumentSerial> {
  const counterRef = db.collection(COUNTERS).doc(counterId(kind, date, prefixes));
  const snap = await tx.get(counterRef);
  const n = serialFrom(snap.get("next"));
  const { number, id } = documentNumberFor(kind, date, n, prefixes);
  return {
    kind,
    number,
    id,
    series: seriesKey(kind, date, prefixes),
    fyLabel: financialYearLabel(date),
    n,
    counterRef,
    documentRef: db.collection(DOCUMENTS).doc(id),
  };
}

/**
 * Creates `documents/{id}` and advances its counter, in the caller's
 * transaction. `tx.create` on an id that is the number itself is the last
 * guard against a number being used twice.
 */
export function writeDocument(
  tx: Transaction,
  db: Firestore,
  serial: DocumentSerial,
  body: DocumentBody,
  actor: string,
): void {
  const record = {
    ...body,
    number: serial.number,
    pdfPath: null,
    issuedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: actor,
    updatedBy: actor,
  };

  tx.create(serial.documentRef, record);
  tx.set(
    serial.counterRef,
    {
      next: serial.n + 1,
      kind: serial.kind,
      fyLabel: serial.fyLabel,
      series: serial.series,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );

  writeAudit(tx, db, {
    object: `${DOCUMENTS}/${serial.id}`,
    action: `issue:${serial.kind}`,
    patch: { kind: body.kind, number: serial.number, orderId: body.orderId, total: body.total },
    beforeSnap: null,
    by: actor,
  });
}
