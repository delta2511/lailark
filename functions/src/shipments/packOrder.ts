/**
 * `packOrder`: brief §11.3 steps 2-4. Moves an order `toPack -> packed`,
 * assigns jar numbers to every batch line inside one transaction (so two
 * Kitchen phones packing at once can never hand out the same jar), and
 * creates or updates the order's `shipments/{id}` document with the packing
 * cost.
 *
 * Owner and Kitchen both may pack (brief §17.12's role matrix row for this
 * task). Nothing here messages a customer.
 */

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { BATCHES } from "../batches/store";
import { writeAudit } from "../audit/write";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { checkSeller } from "../orders/sale";
import { DEFAULT_PACKING_COST_PAISE, planPackOrder } from "./shipments";
import {
  batchRefsOf,
  courierSettings,
  ORDERS,
  orderForShipmentFrom,
  packableLinesOf,
  readPackingBatches,
  SHIPMENTS,
  shipmentIdFor,
  withJarNumbers,
} from "./store";

const MAX_TRANSACTION_ATTEMPTS = 12;

export const packOrder = onCall(
  {
    // A callable's own auth is the Firebase Auth token this function checks
    // for itself, not IAM: Cloud Run must therefore let an anonymous request
    // reach it, or the SDK's call is refused before any of our code runs.
    // The CLI applies this on create, and a function whose first build failed
    // never got it (A254), so every export states it rather than inheriting
    // whatever a past deploy happened to leave behind.
    invoker: "public",
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
    const requestedCost = typeof data.packingCostPaise === "number" ? data.packingCostPaise : null;

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

        const batchRefs = batchRefsOf(order);
        const batches = await readPackingBatches(tx, db, batchRefs);
        const courier = await courierSettings(tx, db);

        const packingCostPaise = requestedCost ?? courier.defaultPackingCost ?? DEFAULT_PACKING_COST_PAISE;

        const shipmentRef = db.collection(SHIPMENTS).doc(shipmentIdFor(orderId));
        const shipmentSnap = await tx.get(shipmentRef);

        /* ---- plan ------------------------------------------------------ */

        const decision = planPackOrder(batches, {
          orderId,
          state: order.state,
          lines: packableLinesOf(order),
          packingCostPaise,
        });
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);
        const plan = decision.value;

        /* ---- write ----------------------------------------------------- */

        const orderPatch = {
          state: "packed",
          lines: withJarNumbers(order.lines, plan.jarNumbersByLine),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor,
        };
        tx.set(orderRef, orderPatch, { merge: true });
        writeAudit(tx, db, {
          object: `${ORDERS}/${orderId}`,
          action: "transition:toPack->packed",
          patch: { state: "packed" },
          beforeSnap: orderSnap,
          by: actor,
        });

        for (const [batchRef, jarsAssigned] of plan.jarsAssignedByBatch) {
          const batchDoc = db.collection(BATCHES).doc(batchRef);
          tx.set(
            batchDoc,
            { jarsAssigned, updatedBy: actor, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
        }

        const shipmentPatch = {
          orderId,
          courier: courier.preferred,
          awb: shipmentSnap.exists ? (shipmentSnap.get("awb") ?? null) : null,
          labelPath: shipmentSnap.exists ? (shipmentSnap.get("labelPath") ?? null) : null,
          packingCost: plan.packingCostPaise,
          courierCost: shipmentSnap.exists ? (shipmentSnap.get("courierCost") ?? 0) : 0,
          status: shipmentSnap.exists ? shipmentSnap.get("status") : "created",
          pickupAt: shipmentSnap.exists ? (shipmentSnap.get("pickupAt") ?? null) : null,
          deliveredAt: shipmentSnap.exists ? (shipmentSnap.get("deliveredAt") ?? null) : null,
          rto: shipmentSnap.exists ? shipmentSnap.get("rto") === true : false,
          claimRef: shipmentSnap.exists ? (shipmentSnap.get("claimRef") ?? null) : null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor,
        };
        if (!shipmentSnap.exists) {
          tx.create(shipmentRef, {
            ...shipmentPatch,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: actor,
          });
        } else {
          tx.set(shipmentRef, shipmentPatch, { merge: true });
        }
        writeAudit(tx, db, {
          object: `${SHIPMENTS}/${shipmentIdFor(orderId)}`,
          action: shipmentSnap.exists ? "packed" : "create",
          patch: { packingCost: plan.packingCostPaise, status: shipmentPatch.status },
          beforeSnap: shipmentSnap.exists ? shipmentSnap : null,
          by: actor,
        });

        return {
          orderId,
          state: "packed",
          packingCostPaise: plan.packingCostPaise,
          jarNumbersByLine: plan.jarNumbersByLine,
        };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  },
);
