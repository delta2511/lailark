/**
 * Issuing a document, and making sure it has a page.
 *
 * ## Where the bill is issued, and why not the PDF with it
 *
 * The **number and the document** are issued inside the same transaction as
 * the sale: one more read (`counters/{series}`) in its read phase and one
 * more create in its write phase. So a counter sale cannot commit without a
 * bill, and a bill cannot exist for a sale that did not commit. That is what
 * brief 13.1's "Counter sale: at save" has to mean if it is to mean anything.
 *
 * The **PDF** is not drawn there. Drawing a page takes tens of milliseconds
 * and allocates a megabyte or two, and the transaction it would sit in is
 * holding a lock on the batch document, which is the one document every other
 * sale in the kitchen is queueing behind. A slow render must never hold the
 * count. So the transaction writes `pdfPath: null` and the page is drawn
 * afterwards, by {@link ensureDocumentPdf}, from two directions:
 *
 *  1. `onDocumentIssued` (see `./triggers.ts`) fires on the write and draws
 *     it, usually before anyone asks;
 *  2. `billForOrder` calls the same function before handing out a link, so a
 *     Kitchen phone that taps "Bill" the instant the sale saves gets the page
 *     rather than "not ready yet".
 *
 * Both call one idempotent function, keyed on the document's own id: if
 * `pdfPath` is already set and the object is there, it does nothing, and two
 * callers racing simply write identical bytes to the same path.
 */

import {
  type DocumentSnapshot,
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {
  type DocumentKind,
  DOCUMENT_KINDS,
  type DocumentPrefixes,
  kolkataDate,
  formatCalDate,
  type SellerIdentity,
} from "@lailark/shared";

import { writeAudit } from "../audit/write";
import { documentPdfExists, documentPdfPath, putDocumentPdf } from "./files";
import { renderDocumentPdf, type RenderableDocument } from "./pdf";
import { type DocumentBody, type DocumentSource, planDocument } from "./plan";
import {
  CONCERNS,
  DOCUMENTS,
  type DocumentSerial,
  type GstSettingsView,
  readDocumentPrefixes,
  readDocumentSerial,
  readGstSettings,
  readSeller,
  writeDocument,
} from "./store";

/* -------------------------------------------------------------------------- */
/* The read phase                                                             */
/* -------------------------------------------------------------------------- */

/** Everything a document is spelled with, read inside the transaction. */
export interface DocumentContext {
  readonly prefixes: DocumentPrefixes;
  readonly seller: SellerIdentity;
  readonly gst: GstSettingsView;
}

/**
 * The three settings documents, in the caller's read phase. Cheap: three gets
 * that are almost always cached, and they are read rather than imported so
 * a new address or a new series prefix needs no deploy.
 */
export async function readDocumentContext(
  tx: Transaction,
  db: Firestore,
): Promise<DocumentContext> {
  // One at a time, in the transaction's read phase, the shape every other
  // store module in this codebase keeps.
  const prefixes = await readDocumentPrefixes(tx, db);
  const seller = await readSeller(tx, db);
  const gst = await readGstSettings(tx, db);
  return { prefixes, seller, gst };
}

/** The number this document will take, read but not yet written. */
export async function readIssue(
  tx: Transaction,
  db: Firestore,
  kind: DocumentKind,
  nowMillis: number,
  context: DocumentContext,
): Promise<DocumentSerial> {
  return readDocumentSerial(tx, db, kind, kolkataDate(nowMillis), context.prefixes);
}

/* -------------------------------------------------------------------------- */
/* The write phase                                                            */
/* -------------------------------------------------------------------------- */

export interface IssueInput {
  readonly source: DocumentSource;
  readonly context: DocumentContext;
  readonly nowMillis: number;
  /** For a credit note or refund note: the number it is against. */
  readonly voids?: string | null;
  /** For a partial refund. Null means the whole order. */
  readonly amount?: number | null;
}

/**
 * Plans the document and writes it, with its number, in the caller's
 * transaction. Returns the body it wrote, so the caller can put the number
 * on the order in the same commit.
 */
export function issueDocument(
  tx: Transaction,
  db: Firestore,
  serial: DocumentSerial,
  input: IssueInput,
  actor: string,
): DocumentBody {
  const body = planDocument({
    kind: serial.kind,
    source: input.source,
    seller: input.context.seller,
    gstEnabled: input.context.gst.enabled,
    homeState: input.context.gst.homeState,
    issuedOn: formatCalDate(kolkataDate(input.nowMillis)),
    voids: input.voids ?? null,
    amount: input.amount ?? null,
  });
  writeDocument(tx, db, serial, body, actor);
  return body;
}

/* -------------------------------------------------------------------------- */
/* Voiding, brief 13.3                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The bill an order carries, read inside the caller's transaction.
 *
 * Reading it is not optional. `markDocumentVoid` used to `set(..., { merge:
 * true })` straight onto the id, which **creates** the document when it is
 * not there: a well-formed number with nothing behind it produced a row with
 * no `kind`, no `number` and no total, which then wedged the whole series,
 * because every later sale's `tx.create` on that same id failed for good, and
 * crashed the render trigger on the way past. A document is created in
 * exactly one place, {@link issueDocument}, where `tx.create` on the
 * number-as-id is what makes "never reused" true. Nothing else may write an
 * id that does not exist.
 */
export async function readOrderBill(
  tx: Transaction,
  db: Firestore,
  documentId: string,
): Promise<DocumentSnapshot> {
  return tx.get(db.collection(DOCUMENTS).doc(documentId));
}

/**
 * "A counter sale voided the same day before its bill was sent keeps its
 * number, marked void."
 *
 * So the document is not deleted and the counter is not wound back: the
 * number stays where it is in the series, and the document says it is void.
 * `pdfPath` is cleared so the page is drawn again, this time with the void
 * mark across it, rather than the old clean page staying in the bucket where
 * somebody could still open it.
 *
 * Takes the snapshot rather than the id, so it is impossible to call without
 * having read the document first, and the audit entry gets a real `before`.
 */
export function markDocumentVoid(
  tx: Transaction,
  db: Firestore,
  snap: DocumentSnapshot,
  reason: string,
  actor: string,
): void {
  if (!snap.exists) {
    throw new Error(`markDocumentVoid called on a document that is not there: ${snap.id}`);
  }
  const patch = {
    voided: { at: FieldValue.serverTimestamp(), by: actor, reason },
    cancelledBy: actor,
    pdfPath: null,
  };
  tx.update(snap.ref, { ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor });
  writeAudit(tx, db, {
    object: `${DOCUMENTS}/${snap.id}`,
    action: "voidDocument",
    patch: { cancelledBy: actor, voidReason: reason },
    beforeSnap: snap,
    by: actor,
  });
}

/* -------------------------------------------------------------------------- */
/* When the bill cannot be marked                                             */
/* -------------------------------------------------------------------------- */

/** Why a void could not put the void mark on the bill it names. */
export type UnmarkedBillReason = "unreadable-number" | "no-document";

/**
 * A void that could not mark its bill, made visible.
 *
 * The jar still goes back: refusing the whole void would leave the count
 * wrong as well as the books, which is worse. But **a live bill for a sale
 * that did not happen is money**, so it cannot end as a silent branch with a
 * comment saying the trail will show it. Two things are written, in the same
 * commit as the void:
 *
 *  1. an `audit/{id}` entry, so the history says the mark was skipped and
 *     why, rather than saying nothing at all;
 *  2. a `concerns/{id}` of type `technicalFailure`, urgent, which is how
 *     anything that needs the Owner reaches him (brief 12.1). Nothing is
 *     drafted to a customer and nothing is sent: `draftMessage` is null, and
 *     concerns wait for the Owner by construction (CLAUDE.md section 3).
 *
 * The concern's id is derived from the order, so a retried transaction or a
 * second attempt at the same void raises one concern rather than a pile.
 */
export function raiseUnmarkedBillConcern(
  tx: Transaction,
  db: Firestore,
  input: {
    readonly orderId: string;
    readonly customerPhone: string | null;
    readonly billNumber: string;
    readonly total: number;
    readonly reason: UnmarkedBillReason;
    readonly voidReason: string;
  },
  actor: string,
): string {
  const summary =
    input.reason === "unreadable-number"
      ? `Order ${input.orderId} was voided, but its bill number ${JSON.stringify(input.billNumber)} cannot be read, so the bill it names is still standing as a live bill. Find it and cancel it with a credit note.`
      : `Order ${input.orderId} was voided, but there is no document behind its bill number ${input.billNumber}, so nothing could be marked void. Check whether that number was ever issued.`;

  const concernId = `bill-not-voided-${input.orderId}`;
  const body = {
    type: "technicalFailure",
    customerPhone: input.customerPhone,
    orderId: input.orderId,
    batchRef: null,
    summary,
    proposal: null,
    // Nothing is drafted to a customer and nothing is sent. This waits.
    draftMessage: null,
    answer: null,
    outcome: null,
    money: { amount: input.total, direction: "none" as const },
    dueAt: null,
    answeredAt: null,
    sentAt: null,
    urgent: true,
  };

  const ref = db.collection(CONCERNS).doc(concernId);
  tx.set(
    ref,
    {
      ...body,
      raisedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );

  writeAudit(tx, db, {
    object: `${CONCERNS}/${concernId}`,
    action: "billNotVoided",
    patch: {
      orderId: input.orderId,
      billNumber: input.billNumber,
      reason: input.reason,
      voidReason: input.voidReason,
    },
    beforeSnap: null,
    by: actor,
  });

  return concernId;
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * True for Firestore's "no such document" (gRPC status 5), which is what an
 * `update` on a document that has gone comes back as.
 */
function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 5;
}

/** Where a stored document's PDF belongs, from its own id. */
export function pathForDocument(documentId: string, fyLabel: string): string {
  return documentPdfPath(documentId, fyLabel);
}

/**
 * Whether this really is a document, rather than a row that got as far as
 * having an id.
 *
 * Only the fields the page cannot be drawn without. `renderDocumentPdf`
 * defends itself as well (it fills a blank for anything else that is
 * missing), so this is about refusing to draw a page for something that is
 * not a document at all, not about validating every field.
 */
export function isRenderable(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.kind === "string" &&
    (DOCUMENT_KINDS as readonly string[]).includes(d.kind) &&
    typeof d.number === "string" &&
    d.number !== "" &&
    typeof d.total === "number" &&
    Array.isArray(d.lines)
  );
}

/**
 * Draws the page if it is not there, and returns where it is. Null when there
 * is no such document.
 *
 * Idempotent and safe to call from anywhere: the path is a pure function of
 * the document id, `pdfPath` is only set after the bytes are stored, and two
 * callers racing write the same bytes to the same object.
 *
 * **Neither a missing nor a malformed document is an error here.** Trigger
 * delivery is at-least-once and out of band, so a firing can arrive after the
 * document it is about has gone, or before it is whole. Throwing takes down
 * the function instance, and in the emulator it takes the counter sales
 * sharing that instance with it, which is not a theoretical risk: it has
 * happened twice in this task, once from a missing document and once from a
 * half-written one with no `seller` on it. So the shape is checked here and
 * a document that cannot be drawn is simply not drawn. The caller decides
 * what a null means: the trigger does nothing, and `billForOrder` says the
 * bill is missing.
 */
export async function ensureDocumentPdf(
  db: Firestore,
  documentId: string,
): Promise<string | null> {
  const ref = db.collection(DOCUMENTS).doc(documentId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  if (!isRenderable(snap.data())) return null;

  const data = snap.data() as unknown as RenderableDocument & { pdfPath: string | null };
  const fyLabel = String(documentId.split("-").slice(1, 3).join("-"));
  const path = pathForDocument(documentId, fyLabel);

  if (data.pdfPath === path && (await documentPdfExists(path))) return path;

  const bytes = await renderDocumentPdf({
    ...data,
    number: data.number,
    issuedOn: data.issuedOn,
  });
  await putDocumentPdf(path, bytes);

  // `update`, never a merging `set`. The existence check above happened
  // before the render and the upload, and a merging `set` on an id that has
  // gone in that window **creates** it: exactly the ghost row (no kind, no
  // number, no total) that the void path used to leave, which wedges the
  // series for good because every later sale's `tx.create` on that id then
  // fails. `update` fails on a missing document instead, which makes the
  // invariant true rather than probable: a `documents/{id}` is created in
  // exactly one place, `writeDocument`, and nowhere else.
  //
  // Nothing deletes a document in production, so the not-found branch is not
  // a live path; it is the emulator, a test suite clearing Firestore, and
  // anything that ever goes wrong by hand. It is treated as "there is no
  // document", which is what it is, not as a failure to render.
  try {
    await ref.update({
      pdfPath: path,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "system",
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  return path;
}
