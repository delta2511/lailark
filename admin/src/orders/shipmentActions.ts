/**
 * The three callables M4.1 adds: `packOrder`, `shipOrder`, `deliverOrder`
 * (`functions/src/shipments/`). Every state move an order makes from here on
 * is server side (`firestore.rules`' `orders/{orderId}` and `shipments/
 * {shipmentId}` blocks deny every client write), so this file is the one
 * door the Packing section of `OrderDetail.tsx` goes through, the same shape
 * `batches/data.ts`'s `callTransitionBatch` already is for a batch.
 */
import { httpsCallable } from "firebase/functions";

import { functions } from "../firebase";

export interface PackOrderResult {
  readonly orderId: string;
  readonly state: string;
  readonly packingCostPaise: number;
}

/** Brief §11.3 steps 2-4: assigns jar numbers, moves `toPack -> packed`. */
export async function callPackOrder(
  orderId: string,
  packingCostPaise?: number,
): Promise<PackOrderResult> {
  const call = httpsCallable<Record<string, unknown>, PackOrderResult>(functions, "packOrder");
  const result = await call({
    orderId,
    ...(packingCostPaise === undefined ? {} : { packingCostPaise }),
  });
  return result.data;
}

export interface ShipOrderResult {
  readonly orderId: string;
  readonly state: string;
  readonly awb: string;
}

/** Brief §11.3 step 6: the India Post consignment number, `packed -> shipped`. */
export async function callShipOrder(
  orderId: string,
  consignmentNumber: string,
  courierCostPaise?: number,
): Promise<ShipOrderResult> {
  const call = httpsCallable<Record<string, unknown>, ShipOrderResult>(functions, "shipOrder");
  const result = await call({
    orderId,
    consignmentNumber,
    ...(courierCostPaise === undefined ? {} : { courierCostPaise }),
  });
  return result.data;
}

export interface DeliverOrderResult {
  readonly orderId: string;
  readonly state: string;
}

/** Brief §11.1's "delivered by hand", and the ordinary end of the courier path. */
export async function callDeliverOrder(orderId: string): Promise<DeliverOrderResult> {
  const call = httpsCallable<Record<string, unknown>, DeliverOrderResult>(functions, "deliverOrder");
  const result = await call({ orderId });
  return result.data;
}
