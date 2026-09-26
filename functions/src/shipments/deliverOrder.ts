/**
 * `deliverOrder`: brief §11.1 and §11.3 step 6's "Delivered by hand" and the
 * ordinary end of the courier path. Moves an order to `delivered`, either
 * from `shipped` (the courier finished) or from `packed` when the fulfilment
 * is not `ship` (a hand delivery that never went near a courier).
 */

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { writeAudit } from "../audit/write";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { checkSeller } from "../orders/sale";
import { planDeliverOrder } from "./shipments";
import { ORDERS, orderForShipmentFrom, SHIPMENTS, shipmentIdFor } from "./store";

const MAX_TRANSACTION_ATTEMPTS = 12;

export const deliverOrder = onCall(
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
    if (orderId === "") {
      throw new HttpsError("invalid-argument", "An order id is required.");
    }

    const db = getFirestore(getAdminApp());
    const actor = seller.uid;

    return db.runTransaction(
      async (tx) => {
        /* ---- read ---------------------------------------------------- */

        const orderRef = db.collection(ORDERS).doc(orderId);
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
          throw new HttpsError("not-found", "There is no order with that id.");
        }
        const order = orderForShipmentFrom(orderSnap);

        const shipmentRef = db.collection(SHIPMENTS).doc(shipmentIdFor(orderId));
        const shipmentSnap = await tx.get(shipmentRef);

        /* ---- plan ------------------------------------------------------ */

        const decision = planDeliverOrder({ state: order.state, fulfilment: order.fulfilment });
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);

        /* ---- write ----------------------------------------------------- */

        tx.set(
          orderRef,
          { state: "delivered", updatedAt: FieldValue.serverTimestamp(), updatedBy: actor },
          { merge: true },
        );
        writeAudit(tx, db, {
          object: `${ORDERS}/${orderId}`,
          action: `transition:${order.state}->delivered`,
          patch: { state: "delivered" },
          beforeSnap: orderSnap,
          by: actor,
        });

        if (shipmentSnap.exists) {
          tx.set(
            shipmentRef,
            {
              status: "delivered",
              deliveredAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: actor,
            },
            { merge: true },
          );
          writeAudit(tx, db, {
            object: `${SHIPMENTS}/${shipmentIdFor(orderId)}`,
            action: "delivered",
            patch: { status: "delivered" },
            beforeSnap: shipmentSnap,
            by: actor,
          });
        }

        return { orderId, state: "delivered" };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  },
);
