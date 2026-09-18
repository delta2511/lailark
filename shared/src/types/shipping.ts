/** `shipments` and its events. Brief section 18.1. */

import type { Paise } from "../money.js";
import type { Courier, ShipmentStatus } from "../states.js";
import type { BaseDoc, Timestamp } from "./base.js";

/** `shipments/{id}`. */
export interface Shipment extends BaseDoc {
  readonly orderId: string;
  readonly courier: Courier;
  readonly awb: string | null;
  readonly labelPath: string | null;
  /** Packing cost is per shipment; packaging cost is per batch. */
  readonly packingCost: Paise;
  readonly courierCost: Paise;
  readonly status: ShipmentStatus;
  readonly pickupAt: Timestamp | null;
  readonly deliveredAt: Timestamp | null;
  readonly rto: boolean;
  readonly claimRef: string | null;
}

/** `shipments/{id}/events/{id}`. */
export interface ShipmentEvent extends BaseDoc {
  readonly status: ShipmentStatus;
  readonly location: string | null;
  readonly at: Timestamp;
}
