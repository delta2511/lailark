/**
 * `billForOrder`: one order in, a short-lived link to its bill out.
 *
 * **Decision D35.** Kitchen may open the bill for any order, but only through
 * here. The money collections stay shut: `documents`, `counters`, `refunds`
 * and `settlements` in Firestore, and `documents/**` in the bucket, all keep
 * `seesMoney()`, so a Kitchen phone cannot browse the books, cannot query the
 * documents collection and cannot fetch a PDF out of Storage by guessing a
 * path. What it can do is name one order it is working on and be handed that
 * one bill. This callable runs with admin rights, which is what makes the
 * narrow door possible without a hole in the rules.
 *
 * The link itself is a V4 signed URL that expires in ten minutes (see
 * `./files.ts`), because a bill carries a customer's name, their number and
 * what they paid.
 */

import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { ROLES, type Role, toDocumentId } from "@lailark/shared";

import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { isOrderRef, ORDERS } from "../orders/store";
import { BILL_LINK_MINUTES, readLinkFor } from "./files";
import { ensureDocumentPdf } from "./issue";
import { DOCUMENTS } from "./store";

/** Brief 17.12: all three admin roles read an order. A Viewer reads the books. */
const MAY_OPEN: readonly Role[] = ["owner", "kitchen", "viewer"];

export interface BillForOrderResult {
  readonly orderId: string;
  readonly documentNumber: string;
  readonly documentId: string;
  readonly kind: string;
  readonly url: string;
  readonly expiresAtMillis: number;
  readonly signed: boolean;
  readonly voided: boolean;
}

export const billForOrder = onCall(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    enforceAppCheck: false,
  },
  async (request): Promise<BillForOrderResult> => {
    const uid = request.auth?.uid ?? null;
    const role = request.auth?.token?.role;

    if (uid === null) throw new HttpsError("unauthenticated", "Sign in first.");
    if (
      typeof role !== "string" ||
      !(ROLES as readonly string[]).includes(role) ||
      !MAY_OPEN.includes(role as Role)
    ) {
      throw new HttpsError("permission-denied", "Ask Shefin to give you a role first.");
    }

    const data = (request.data ?? {}) as Record<string, unknown>;
    const orderId = typeof data.orderId === "string" ? data.orderId.trim() : "";
    if (!isOrderRef(orderId)) {
      throw new HttpsError(
        "invalid-argument",
        'An order is named by its reference, for example "o-7f3a2c".',
      );
    }

    const db = getFirestore(getAdminApp());

    const orderSnap = await db.collection(ORDERS).doc(orderId).get();
    if (!orderSnap.exists) throw new HttpsError("not-found", "There is no sale with that reference.");

    const billNumber = orderSnap.get("billNumber");
    if (typeof billNumber !== "string" || billNumber === "") {
      // Not an error the person did anything wrong: an unpaid payment link has
      // no bill yet, and neither has an open-batch booking before bottling.
      throw new HttpsError("failed-precondition", "There is no bill for this sale yet.");
    }

    let documentId: string;
    try {
      documentId = toDocumentId(billNumber);
    } catch {
      throw new HttpsError("internal", "This sale's bill number cannot be read. Tell Shefin.");
    }

    const documentSnap = await db.collection(DOCUMENTS).doc(documentId).get();
    if (!documentSnap.exists) {
      throw new HttpsError("internal", "This sale's bill is missing. Tell Shefin.");
    }

    const path = await ensureDocumentPdf(db, documentId);
    if (path === null) {
      throw new HttpsError("internal", "This sale's bill is missing. Tell Shefin.");
    }
    const link = await readLinkFor(path, BILL_LINK_MINUTES);

    return {
      orderId,
      documentNumber: billNumber,
      documentId,
      kind: String(documentSnap.get("kind") ?? "bill"),
      url: link.url,
      expiresAtMillis: link.expiresAtMillis,
      signed: link.signed,
      voided: documentSnap.get("voided") != null,
    };
  },
);
