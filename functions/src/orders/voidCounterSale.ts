/**
 * `voidCounterSale`: brief 7A.6, "void a sale entered by mistake (same day,
 * before the bill is sent)", for both staff roles.
 *
 * `./sale.ts`'s `planCounterSaleVoid` decides whether this sale may be
 * voided and what voiding it writes; this file does the Firestore work, in
 * one transaction, the same way `createCounterSale` does.
 *
 * **The jar goes back the way it came.** Through `batches/holds.ts`, on the
 * batch document, inside the transaction that writes the order and the
 * customer, so a void that puts the jar back but leaves the order standing
 * cannot exist, and neither can its opposite.
 *
 * **Both the sale and the void are in the trail.** The sale's own
 * `audit/{id}` entries are never touched: audit entries are append-only
 * (`firestore.rules`), and this adds three more (order, customer, batch). A
 * void that silently vanished would be worse than no void at all, because the
 * count would move and the history would say nothing moved.
 */

import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { toDocumentId } from "@lailark/shared";

import { writeAudit } from "../audit/write";
import { readStockRelease, ReleaseRefused, writeStockRelease } from "../batches/holds";
import { BATCHES } from "../batches/store";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { markDocumentVoid, raiseUnmarkedBillConcern, readOrderBill, type UnmarkedBillReason } from "../money/issue";
import { checkSeller, planCounterSaleVoid, type VoidableOrderView } from "./sale";
import {
  CUSTOMERS,
  isOrderRef,
  ORDERS,
  saleCustomerViewFrom,
  withCustomerTimestamps,
} from "./store";

const MAX_TRANSACTION_ATTEMPTS = 12;

export const voidCounterSale = onCall(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    enforceAppCheck: false,
  },
  async (request) => {
    const caller = { uid: request.auth?.uid ?? null, role: request.auth?.token?.role };
    const seller = checkSeller(caller);
    if (!seller.ok) throw new HttpsError(seller.code, seller.message);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const orderId = typeof data.orderId === "string" ? data.orderId.trim() : "";
    if (!isOrderRef(orderId)) {
      throw new HttpsError("invalid-argument", 'An order is named by its reference, for example "o-7f3a2c".');
    }
    const reason = typeof data.reason === "string" ? data.reason : "";

    const db = getFirestore(getAdminApp());

    return db.runTransaction(
      async (tx) => {
        const nowMillis = Date.now();

        /* ---- read ---------------------------------------------------- */

        const orderRef = db.collection(ORDERS).doc(orderId);
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
          throw new HttpsError("not-found", "There is no sale with that reference.");
        }
        const order = voidableOrderFrom(orderSnap.id, orderSnap.data() ?? {});

        // Brief 13.3: "A counter sale voided the same day before its bill was
        // sent keeps its number, marked void." So the bill is not deleted and
        // the counter is not wound back.
        //
        // The document is **read** here, in the read phase, and only marked
        // if it is really there. Writing the mark blind with a merge would
        // create a document at that id when there is none, which is how a
        // ghost row with no kind and no total gets into `documents`, wedges
        // the whole series (every later sale's `tx.create` on that id fails
        // for good) and crashes the render trigger. A document is created in
        // exactly one place, and this is not it.
        const rawBillNumber = orderSnap.get("billNumber");
        const billNumber =
          typeof rawBillNumber === "string" && rawBillNumber !== "" ? rawBillNumber : null;

        let billDocumentId: string | null = null;
        let billProblem: UnmarkedBillReason | null = null;
        if (billNumber !== null) {
          try {
            billDocumentId = toDocumentId(billNumber);
          } catch {
            billProblem = "unreadable-number";
          }
        }
        const billSnap = billDocumentId === null ? null : await readOrderBill(tx, db, billDocumentId);
        if (billSnap !== null && !billSnap.exists) billProblem = "no-document";

        const customerRef = db.collection(CUSTOMERS).doc(order.customerPhone);
        const customerSnap = order.customerPhone === "" ? null : await tx.get(customerRef);

        const decision = planCounterSaleVoid(order, reason, {
          caller,
          customer:
            customerSnap && customerSnap.exists ? saleCustomerViewFrom(customerSnap) : null,
          nowMillis,
        });
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);
        const plan = decision.value;

        // Read before any write, as ever.
        let release = null;
        if (plan.batchRef !== null && plan.jars > 0) {
          try {
            release = await readStockRelease(tx, db, {
              batchRef: plan.batchRef,
              orderId,
              qty: plan.jars,
              mode: plan.stockMode,
            });
          } catch (error) {
            if (error instanceof ReleaseRefused) {
              throw new HttpsError("failed-precondition", error.message, { reason: error.reason });
            }
            throw error;
          }
        }

        /* ---- write --------------------------------------------------- */

        const actor = seller.uid;
        const orderPatch = { ...plan.orderPatch };

        tx.set(orderRef, withStamps(orderPatch, plan.stampFields, actor), { merge: true });
        writeAudit(tx, db, {
          object: `${ORDERS}/${orderId}`,
          action: "counterSaleVoid",
          patch: orderPatch,
          beforeSnap: orderSnap,
          by: actor,
        });

        if (customerSnap && customerSnap.exists) {
          const customerPatch = withCustomerTimestamps(plan.customerPatch);
          tx.set(customerRef, withStamps(customerPatch, plan.customerStampFields, actor), {
            merge: true,
          });
          writeAudit(tx, db, {
            object: `${CUSTOMERS}/${order.customerPhone}`,
            action: "counterSaleVoid",
            patch: customerPatch,
            beforeSnap: customerSnap,
            by: actor,
          });
        }

        // The jar goes back either way: refusing the whole void because the
        // bill cannot be found would leave the count wrong as well as the
        // books. But a live bill for a sale that did not happen is money, so
        // the skip is never silent: it raises a concern for the Owner and
        // goes in the trail. Nothing is drafted or sent to a customer.
        let concernId: string | null = null;
        if (billSnap !== null && billSnap.exists) {
          markDocumentVoid(tx, db, billSnap, plan.orderPatch.voidReason as string, actor);
        } else if (billNumber !== null && billProblem !== null) {
          concernId = raiseUnmarkedBillConcern(
            tx,
            db,
            {
              orderId,
              customerPhone: order.customerPhone === "" ? null : order.customerPhone,
              billNumber,
              total: order.total,
              reason: billProblem,
              voidReason: plan.orderPatch.voidReason as string,
            },
            actor,
          );
        }

        if (release !== null) {
          writeStockRelease(tx, db, release, actor);
          writeAudit(tx, db, {
            object: `${BATCHES}/${release.batchRef}`,
            action: "counterSaleVoid",
            patch: release.auditPatch,
            beforeSnap: release.batchSnap,
            by: actor,
          });
        }

        return {
          orderId,
          state: "voided",
          batchRef: plan.batchRef,
          jarsReturned: release?.qtyReturned ?? 0,
          reason: plan.orderPatch.voidReason as string,
          /** The number the bill keeps (13.3), whatever happened to the mark. */
          billNumber,
          /** False when the bill could not be marked. Then `concernId` says so. */
          billMarkedVoid: billSnap !== null && billSnap.exists,
          concernId,
        };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  },
);

function millisOf(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return null;
}

/** The order document as the pure void planner reads it. */
export function voidableOrderFrom(id: string, raw: Record<string, unknown>): VoidableOrderView {
  const payment = (raw.payment ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(raw.lines) ? (raw.lines as Array<Record<string, unknown>>) : [];
  const batchRefs = Array.isArray(raw.batchRefs) ? (raw.batchRefs as unknown[]) : [];

  let jars = 0;
  for (const line of lines) {
    // A custom line with no batch behind it took no jar, so it gives none back.
    if (typeof line?.batchRef === "string" && typeof line?.qty === "number") jars += line.qty;
  }

  return {
    id,
    channel: typeof raw.channel === "string" ? raw.channel : "",
    state: typeof raw.state === "string" ? raw.state : "",
    customerPhone: typeof raw.customerPhone === "string" ? raw.customerPhone : "",
    batchRef: typeof batchRefs[0] === "string" ? (batchRefs[0] as string) : null,
    jars,
    total: typeof raw.total === "number" ? raw.total : 0,
    paymentMethod: typeof payment.method === "string" ? payment.method : "",
    paymentStatus: typeof payment.status === "string" ? payment.status : "",
    createdAtMillis: millisOf(raw.createdAt),
    billSentAtMillis: millisOf(raw.billSentAt),
    voidedAtMillis: millisOf(raw.voidedAt),
  };
}

function withStamps(
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
