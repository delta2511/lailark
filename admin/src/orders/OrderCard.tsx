/**
 * One row of the Orders list, brief §17.5.
 *
 * The group chip is computed from the order's own state
 * (`orderGroupForState`, `@lailark/shared`), never stored, so it can never
 * drift from the mapping this milestone wrote. The money badge is the one
 * thing this card adds beyond the chip: **A201**, an order whose capture
 * ended as a concern stays in `held` with `payment.status: "captured"`, and
 * A184 forbids expiring a paid order, so that is correct state, not a bug.
 * Left as just the "Awaiting payment" chip, a real payment sits invisible
 * behind a chip that reads as unpaid. The badge only ever shows inside that
 * one group: everywhere else the group name itself already says the money
 * arrived (Paid waiting, To pack, Packed, ...), so a second "Paid" label
 * would be noise repeating what the chip already says.
 *
 * M3.9 round 3 (Shefin's phone check): the card also shows when the order
 * was placed, in Asia/Kolkata regardless of the phone's own timezone
 * (`formatKolkataDateTime`, `@lailark/shared`) — the kitchen is in
 * Kunnamangalam, not wherever the phone thinks it is.
 */
import { formatINR, formatKolkataDateTime, ORDER_GROUP_LABELS, orderGroupForState, type Paise } from "@lailark/shared";
import type { JSX } from "preact";

import { ORDERS } from "../copy";
import { millisOf } from "../today/waiting";
import type { OrderDoc } from "./data";

interface Props {
  readonly order: OrderDoc;
  readonly onOpen: () => void;
}

export function OrderCard({ order, onOpen }: Props): JSX.Element {
  const group = order.state ? orderGroupForState(order.state) : null;
  const groupLabel = group ? ORDER_GROUP_LABELS[group] : (order.state ?? "");
  const name = order.deliveryContact?.name || order.customerPhone || "";
  const total = typeof order.total === "number" ? formatINR(order.total as Paise) : "";

  // `createdAt` is a server timestamp: it can be missing or still null on a
  // document written a moment ago, the same case `millisOf` already exists
  // for on Today. A card with no usable value shows nothing in this slot
  // rather than "Invalid Date" or the 1970 epoch.
  const createdAtMillis = millisOf(order.createdAt);
  const createdAtLabel = createdAtMillis !== null ? formatKolkataDateTime(createdAtMillis) : null;

  const showsPaidBadge = group === "awaitingPayment" && order.payment?.status === "captured";

  return (
    <li>
      <button type="button" class="batch-card" data-testid={`order-row-${order.id}`} onClick={onOpen}>
        <div class="batch-card-top">
          <span class="batch-card-label" data-testid="order-card-number">
            {order.number ?? order.id}
          </span>
          <span class="state-chip" data-testid="order-card-group">
            {groupLabel}
          </span>
        </div>
        <p class="batch-card-product" data-testid="order-card-name">
          {name}
        </p>
        {createdAtLabel ? (
          <p class="batch-card-product" data-testid="order-card-created-at">
            {createdAtLabel}
          </p>
        ) : null}

        <div class="batch-card-bottom">
          <span class="field-value number" data-testid="order-card-total">
            {total}
          </span>
          {order.channel ? (
            <span class="clock-pill" data-testid="order-card-channel">
              {ORDERS.channelLabel[order.channel] ?? order.channel}
            </span>
          ) : null}
          {showsPaidBadge ? (
            <span class="approval-badge" data-testid="order-card-paid-badge">
              {ORDERS.paidWhileHeld} {total}
            </span>
          ) : null}
        </div>
      </button>
    </li>
  );
}
