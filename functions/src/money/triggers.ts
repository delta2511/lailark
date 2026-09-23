/**
 * The page gets drawn.
 *
 * Fires on every write to `documents/{documentId}` and draws the PDF when
 * there is not one. Two firings, one page: `ensureDocumentPdf` is keyed on
 * the document's own id and does nothing when the object is already there.
 *
 * The loop stops the way the batch triggers' does: this writes `pdfPath`,
 * which fires the trigger again, and the second firing finds `pdfPath` set
 * and returns before it does anything at all. Voiding a document clears
 * `pdfPath` on purpose (brief 13.3: the number stands, the page is redrawn
 * with the void mark), which is the one case where the trigger draws twice.
 */

import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { ensureDocumentPdf } from "./issue";
import { DOCUMENTS } from "./store";

export const onDocumentIssued = onDocumentWritten(
  {
    document: `${DOCUMENTS}/{documentId}`,
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    if (typeof after.get("pdfPath") === "string") return;

    await ensureDocumentPdf(getFirestore(getAdminApp()), event.params.documentId);
  },
);
