/**
 * `shipOrder`: brief §11.3 step 6, entering the India Post consignment
 * number. Moves an order `packed -> shipped` and stamps the shipment with the
 * courier's own reference.
 *
 * This never sends anything: the "dispatched" message (brief §15.7 template
 * 9) is drafted by the admin from the order this call returns, the same way
 * `billMessageFor` drafts the bill (D32).
 */

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { isIndiaPostConsignment } from "@lailark/shared";

import { writeAudit } from "../audit/write";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { checkSeller } from "../orders/sale";
import { planShipOrder } from "./shipments";
import { ORDERS, orderForShipmentFrom, SHIPMENTS, shipmentIdFor } from "./store";

const MAX_TRANSACTION_ATTEMPTS = 12;

export const shipOrder = onCall(
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
    const consignmentNumber = typeof data.consignmentNumber === "string" ? data.consignmentNumber : "";
    const courierCostPaise = typeof data.courierCostPaise === "number" ? data.courierCostPaise : null;

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
        if (!shipmentSnap.exists) {
          throw new HttpsError("failed-precondition", "This order has not been packed yet.");
        }

        /* ---- plan ------------------------------------------------------ */

        const decision = planShipOrder(
          {
            state: order.state,
            fulfilment: order.fulfilment,
            consignmentNumber,
            courierCostPaise,
          },
          isIndiaPostConsignment,
        );
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);
        const plan = decision.value;

        /* ---- write ----------------------------------------------------- */

        tx.set(
          orderRef,
          { state: "shipped", updatedAt: FieldValue.serverTimestamp(), updatedBy: actor },
          { merge: true },
        );
        writeAudit(tx, db, {
          object: `${ORDERS}/${orderId}`,
          action: "transition:packed->shipped",
          patch: { state: "shipped" },
          beforeSnap: orderSnap,
          by: actor,
        });

        // The courier already has the parcel by the time a consignment
        // number exists to type in (brief §11.3 step 5, "courier booked"
        // happens before step 6): `picked` is the shipment status for that,
        // not `created`.
        tx.set(
          shipmentRef,
          {
            courier: "indiaPost",
            awb: plan.awb,
            status: "picked",
            courierCost: plan.courierCostPaise > 0 ? plan.courierCostPaise : shipmentSnap.get("courierCost") ?? 0,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor,
          },
          { merge: true },
        );
        writeAudit(tx, db, {
          object: `${SHIPMENTS}/${shipmentIdFor(orderId)}`,
          action: "shipped",
          patch: { awb: plan.awb, status: "picked" },
          beforeSnap: shipmentSnap,
          by: actor,
        });

        return { orderId, state: "shipped", awb: plan.awb };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  },
);
