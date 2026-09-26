/**
 * The "dispatched" message a person sends by hand once the India Post
 * consignment number is entered (brief §15.7 template 9, D32), the same
 * shape `billMessage.ts` already is for the bill: the draft is filled in, a
 * `wa.me` link is opened, and the sender ticks it sent. Nothing here sends
 * anything itself.
 */
import { customerMessage, formatINR, indiaPostTrackingUrl, waMeLink, type CustomerMessageValues } from "@lailark/shared";

import type { OrderDoc, ShipmentDoc } from "./data";

export interface ShipMessage {
  /** The drafted text, with every placeholder this shipment has data for filled in. */
  readonly text: string;
  /** A `wa.me` link ready to open, or null when there is nobody or nothing to send it to. */
  readonly waLink: string | null;
  /** False until the shipment carries a consignment number to track. */
  readonly hasTracking: boolean;
}

/**
 * `overrides` is `settings/messages` as read (D24), the same pattern
 * `billMessageFor` already follows: the Owner's own wording wins over the
 * draft in `DEFAULT_CUSTOMER_MESSAGES`.
 */
export function shipMessageFor(
  order: OrderDoc,
  shipment: ShipmentDoc | null,
  overrides?: Partial<Record<string, unknown>> | null,
): ShipMessage {
  const trackingLink = indiaPostTrackingUrl(shipment?.awb ?? null);
  const hasTracking = trackingLink !== null;

  const values: Partial<CustomerMessageValues> = {
    orderNumber: order.number ?? "",
    total: typeof order.total === "number" ? formatINR(order.total) : "",
    trackingLink: trackingLink ?? "",
    // India Post's page carries no per-consignment link (see
    // `indiaPostTrackingUrl`), so the number itself is the other half of
    // what makes the tracking page useful, not just a courtesy detail.
    consignmentNumber: shipment?.awb ?? "",
  };

  const text = customerMessage("shipped", values, overrides);
  const waLink = hasTracking ? waMeLink(order.customerPhone, text) : null;

  return { text, waLink, hasTracking };
}
