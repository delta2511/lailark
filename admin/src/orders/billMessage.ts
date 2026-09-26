/**
 * The bill message a person sends by hand from an order's detail screen
 * (brief §17.5, D32): the draft is filled in, a `wa.me` link is opened, and
 * the sender ticks it sent. Nothing here sends anything itself.
 *
 * A205: `shareCodeUsed` is the one order field this app has already learned
 * not to trust blindly in a link (it can be set by the public `createCheckout`
 * callable before App Check, M5.9). It plays no part here, but the same
 * discipline applies to the order token: {@link orderUrl} in
 * `shared/src/links.ts` already refuses anything that is not exactly 32
 * lower-case hex characters and returns `null` rather than a link built out
 * of something unchecked, so nothing here needs to re-validate it.
 */
import { customerMessage, formatINR, orderUrl, waMeLink, type CustomerMessageValues } from "@lailark/shared";

import type { OrderDoc } from "./data";

export interface BillMessage {
  /** The drafted text, with every placeholder this order has data for filled in. */
  readonly text: string;
  /** A `wa.me` link ready to open, or null when there is nobody or nothing to send it to. */
  readonly waLink: string | null;
  /** False on an order written before M3.8, which has no token and so no private link at all. */
  readonly hasToken: boolean;
}

/**
 * `overrides` is `settings/messages` as read (D24's pattern, extended to the
 * bill by M3.9): the Owner's own wording wins over the draft in
 * `DEFAULT_CUSTOMER_MESSAGES`, exactly as it does for the three batch
 * messages.
 */
export function billMessageFor(
  order: OrderDoc,
  siteOrigin: string,
  overrides?: Partial<Record<string, unknown>> | null,
): BillMessage {
  const link = orderUrl(siteOrigin, order.token ?? null);
  const hasToken = link !== null;

  const values: Partial<CustomerMessageValues> = {
    orderNumber: order.number ?? "",
    total: typeof order.total === "number" ? formatINR(order.total) : "",
    orderLink: link ?? "",
  };

  const text = customerMessage("billSent", values, overrides);
  const waLink = hasToken ? waMeLink(order.customerPhone, text) : null;

  return { text, waLink, hasToken };
}
