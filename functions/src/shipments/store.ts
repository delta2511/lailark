/**
 * The Firestore side of packing and India Post (M4.1): reading an order and
 * its batches into the plain views `./shipments.ts` plans against, and
 * turning that plan into the writes on `orders/{id}`, `batches/{ref}` and
 * `shipments/{id}`.
 *
 * Same four-step shape as `batches/store.ts` and `orders/store.ts`: every
 * read here happens inside the caller's transaction, before any write.
 */

import {
  type DocumentSnapshot,
  FieldValue,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import type { Courier, OrderLine, OrderState, ShipmentStatus } from "@lailark/shared";

import { BATCHES } from "../batches/store";
import type { PackableLine, PackingBatchView } from "./shipments";

export const ORDERS = "orders";
export const SHIPMENTS = "shipments";
export const SETTINGS = "settings";
/** `settings/courier`, brief §11.1 and §11.3 step 4. */
export const COURIER_SETTINGS_ID = "courier";

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

export interface OrderForShipment {
  readonly id: string;
  readonly state: OrderState;
  readonly fulfilment: string;
  readonly number: string;
  readonly customerPhone: string;
  readonly lines: readonly OrderLine[];
}

export function orderForShipmentFrom(snap: DocumentSnapshot): OrderForShipment {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(d.lines) ? (d.lines as OrderLine[]) : [];
  return {
    id: snap.id,
    state: (typeof d.state === "string" ? d.state : "") as OrderState,
    fulfilment: typeof d.fulfilment === "string" ? d.fulfilment : "",
    number: typeof d.number === "string" ? d.number : snap.id,
    customerPhone: typeof d.customerPhone === "string" ? d.customerPhone : "",
    lines,
  };
}

export function packableLinesOf(order: OrderForShipment): readonly PackableLine[] {
  return order.lines.map((line) => ({ batchRef: line.batchRef, qty: line.qty }));
}

/** Every distinct, non-null batch reference an order's lines touch. */
export function batchRefsOf(order: OrderForShipment): readonly string[] {
  const refs = new Set<string>();
  for (const line of order.lines) {
    if (line.batchRef !== null) refs.add(line.batchRef);
  }
  return [...refs];
}

/** Reads every batch an order's lines name, keyed by reference. */
export async function readPackingBatches(
  tx: Transaction,
  db: Firestore,
  batchRefs: readonly string[],
): Promise<ReadonlyMap<string, PackingBatchView>> {
  const out = new Map<string, PackingBatchView>();
  for (const ref of batchRefs) {
    const snap = await tx.get(db.collection(BATCHES).doc(ref));
    if (!snap.exists) continue;
    out.set(ref, {
      ref,
      jarsAssigned: numberOr(snap.get("jarsAssigned"), 0),
      bottledJars: numberOr(snap.get("bottledJars"), 0),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `settings/courier`, brief §11.1. Missing document or field falls back to
 * India Post and {@link DEFAULT_PACKING_COST_PAISE} (`./shipments.ts`): the
 * Settings screen that writes this is fast-follow (M4.1's scope note).
 */
export async function courierSettings(
  tx: Transaction,
  db: Firestore,
): Promise<{ readonly preferred: Courier; readonly defaultPackingCost: number | null }> {
  const snap = await tx.get(db.collection(SETTINGS).doc(COURIER_SETTINGS_ID));
  const preferred = snap.get("preferred");
  const defaultPackingCost = snap.get("defaultPackingCost");
  return {
    preferred: preferred === "shiprocket" ? "shiprocket" : "indiaPost",
    defaultPackingCost:
      typeof defaultPackingCost === "number" && Number.isInteger(defaultPackingCost) && defaultPackingCost >= 0
        ? defaultPackingCost
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Shipments                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The shipment document's own id. One shipment per order, so packing is
 * always a `get` by a known id rather than a query, the same trick an order's
 * own reference gives every other read in this system.
 */
export function shipmentIdFor(orderId: string): string {
  return orderId;
}

export interface ShipmentForTransition {
  readonly exists: boolean;
  readonly status: ShipmentStatus | "";
  readonly courier: Courier | null;
}

export async function readShipment(
  tx: Transaction,
  db: Firestore,
  orderId: string,
): Promise<ShipmentForTransition> {
  const snap = await tx.get(db.collection(SHIPMENTS).doc(shipmentIdFor(orderId)));
  if (!snap.exists) return { exists: false, status: "", courier: null };
  return {
    exists: true,
    status: (snap.get("status") as ShipmentStatus | undefined) ?? "",
    courier: (snap.get("courier") as Courier | undefined) ?? null,
  };
}

/** Applies the jar numbers a pack plan computed onto an order's own lines. */
export function withJarNumbers(
  lines: readonly OrderLine[],
  jarNumbersByLine: readonly (readonly number[])[],
): readonly OrderLine[] {
  return lines.map((line, i) => ({ ...line, jarNumbers: jarNumbersByLine[i] ?? line.jarNumbers ?? [] }));
}

/** `Timestamp.now()`, kept behind one function so a test can see the seam. */
export function nowTimestamp(): Timestamp {
  return Timestamp.now();
}

export { FieldValue };
