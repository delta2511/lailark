/**
 * Orders (brief §17.5): grouped, filtered, searched, with a detail screen at
 * `/orders/<id>` (M3.9).
 *
 * M3.9's scope is read only (see the task): the actions brief §17.5 lists
 * (pack, book courier, change address, send a payment link, raise a Concern,
 * record an outcome, void) each belong to a later milestone. This screen is
 * the list, the grouping, the filters, the search and the detail, plus the
 * `wa.me` bill link (D32).
 */
import { batchLabelCapitalised, isShippingToday, ORDER_GROUP_LABELS, ORDER_GROUPS, orderGroupForState, type OrderGroup } from "@lailark/shared";
import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";

import { useBatches } from "../batches/data";
import { ORDERS } from "../copy";
import { navigate, orderDetailPath } from "../router";
import type { Session } from "../session";
import { siteOrigin } from "../siteOrigin";
import {
  documentsByOrderId,
  useAllDocuments,
  useOrder,
  useOrders,
  type OrderDoc,
} from "../orders/data";
import { OrderCard } from "../orders/OrderCard";
import { OrderDetail } from "../orders/OrderDetail";
import { orderMatchesSearch } from "../orders/search";

interface Props {
  readonly orderId: string | null;
  readonly session: Session;
}

const ALL = "all";
type Filter = typeof ALL;

/**
 * The group tabs, plus two pseudo-tabs that are not states of their own:
 * "shipsToday" (see `shared/src/orderGroups.ts`) and "all", every order
 * regardless of group. Neither belongs in `ORDER_GROUPS` itself, which stays
 * exactly the brief's eleven named groups (`orderGroups.ts`'s own doc-comment
 * says why the switch there has to stay exhaustive over real states only).
 */
type OrdersTab = OrderGroup | "shipsToday" | "all";

/** "All" first, then "Ships today", then the brief's eleven groups in its
 * own order (M3.9 round 3, Shefin's phone check: "a button to show all
 * orders together"). */
const TABS: readonly OrdersTab[] = ["all", "shipsToday", ...ORDER_GROUPS];

/**
 * The tab the list opens on. A single named constant, on purpose: Shefin
 * asked for this default (M3.9 round 3) but flagged it as the one thing he
 * might flip back after using it, and it doubles as M3.9's own done-when
 * ("every order created in M2 and M3 is findable") — landing on the
 * everything-view, newest first, serves both directly. Change it here, not
 * by hunting through the component.
 */
const DEFAULT_TAB: OrdersTab = "all";

function tabLabel(tab: OrdersTab): string {
  if (tab === "all") return ORDERS.filterAll;
  if (tab === "shipsToday") return "Ships today";
  return ORDER_GROUP_LABELS[tab];
}

export function Orders({ orderId, session }: Props): JSX.Element {
  if (orderId !== null) {
    return <OrderDetailScreen orderId={orderId} session={session} />;
  }
  return <OrdersList />;
}

function OrderDetailScreen({ orderId, session }: { readonly orderId: string; readonly session: Session }): JSX.Element {
  const { order, loading, denied, notFound } = useOrder(orderId);

  if (loading) {
    return (
      <div class="orders" data-testid="screen-orders">
        <p data-testid="order-loading">{ORDERS.loading}</p>
      </div>
    );
  }
  if (denied) {
    return (
      <div class="orders" data-testid="screen-orders">
        <p data-testid="order-denied">{ORDERS.readDenied}</p>
      </div>
    );
  }
  if (notFound || !order) {
    return (
      <div class="orders" data-testid="screen-orders">
        <p data-testid="order-not-found">{ORDERS.empty}</p>
        <button type="button" class="quiet" onClick={() => navigate("/orders")}>
          {ORDERS.backToOrders}
        </button>
      </div>
    );
  }

  return (
    <div class="orders" data-testid="screen-orders">
      <OrderDetail order={order} role={session.role} siteOrigin={siteOrigin()} />
    </div>
  );
}

function OrdersList(): JSX.Element {
  const orders = useOrders();
  const allDocuments = useAllDocuments();
  const batches = useBatches();

  const [tab, setTab] = useState<OrdersTab>(DEFAULT_TAB);
  const [batchFilter, setBatchFilter] = useState<Filter | string>(ALL);
  const [channelFilter, setChannelFilter] = useState<Filter | string>(ALL);
  // A plain local input, never derived from a snapshot: a Firestore update
  // arriving mid-keystroke cannot clobber it, unlike the bug M2.13a fixed
  // for a box whose value *was* a listener's own field.
  const [search, setSearch] = useState("");

  const docsByOrder = useMemo(() => documentsByOrderId(allDocuments.items), [allDocuments.items]);

  const batchLabelByRef = useMemo(() => {
    const map = new Map<string, string>();
    for (const batch of batches.items) {
      map.set(batch.id, batchLabelCapitalised(batch.batchNo ?? null, batch.id, batch.state ?? null));
    }
    return map;
  }, [batches.items]);

  const batchRefsInOrders = useMemo(() => {
    const refs = new Set<string>();
    for (const order of orders.items) {
      for (const ref of order.batchRefs ?? []) refs.add(ref);
    }
    return [...refs].sort();
  }, [orders.items]);

  const filtered = useMemo(() => {
    return orders.items.filter((order) => {
      if (!order.state) return false;

      // "all" means every group, not "ignore the tab": the batch, channel
      // and search filters below still narrow it exactly as they narrow any
      // other tab (M3.9 round 3).
      if (tab === "shipsToday") {
        if (!isShippingToday({ state: order.state, fulfilment: order.fulfilment ?? "ship" })) return false;
      } else if (tab !== "all" && orderGroupForState(order.state) !== tab) {
        return false;
      }

      if (batchFilter !== ALL && !(order.batchRefs ?? []).includes(batchFilter)) return false;
      if (channelFilter !== ALL && order.channel !== channelFilter) return false;

      if (!orderMatchesSearch(order, search, docsByOrder.get(order.id) ?? [])) return false;

      return true;
    });
  }, [orders.items, tab, batchFilter, channelFilter, search, docsByOrder]);

  function openOrder(order: OrderDoc): void {
    navigate(orderDetailPath(order.id));
  }

  return (
    <div class="orders" data-testid="screen-orders">
      {orders.loading ? <p data-testid="orders-loading">{ORDERS.loading}</p> : null}
      {orders.denied ? <p data-testid="orders-denied">{ORDERS.readDenied}</p> : null}

      {!orders.loading && !orders.denied && orders.items.length === 0 ? (
        <p data-testid="orders-empty">{ORDERS.empty}</p>
      ) : null}

      {!orders.loading && !orders.denied && orders.items.length > 0 ? (
        <>
          <label for="orders-search">{ORDERS.searchLabel}</label>
          <input
            id="orders-search"
            type="search"
            data-testid="orders-search"
            placeholder={ORDERS.searchPlaceholder}
            value={search}
            onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
          />

          <div class="fill-numbers">
            <div class="settings-field">
              <label for="orders-filter-batch" class="field-label">
                {ORDERS.filterBatch}
              </label>
              <select
                id="orders-filter-batch"
                data-testid="orders-filter-batch"
                value={batchFilter}
                onChange={(event) => setBatchFilter((event.target as HTMLSelectElement).value)}
              >
                <option value={ALL}>{ORDERS.filterAll}</option>
                {batchRefsInOrders.map((ref) => (
                  <option key={ref} value={ref}>
                    {batchLabelByRef.get(ref) ?? ref}
                  </option>
                ))}
              </select>
            </div>

            <div class="settings-field">
              <label for="orders-filter-channel" class="field-label">
                {ORDERS.filterChannel}
              </label>
              <select
                id="orders-filter-channel"
                data-testid="orders-filter-channel"
                value={channelFilter}
                onChange={(event) => setChannelFilter((event.target as HTMLSelectElement).value)}
              >
                <option value={ALL}>{ORDERS.filterAll}</option>
                {Object.entries(ORDERS.channelLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div class="tab-row" role="tablist" aria-label="Order groups">
            {TABS.map((groupTab) => (
              <button
                key={groupTab}
                type="button"
                class={tab === groupTab ? "chip chip-on" : "chip"}
                data-testid={`orders-tab-${groupTab}`}
                aria-current={tab === groupTab ? "page" : undefined}
                onClick={() => setTab(groupTab)}
              >
                {tabLabel(groupTab)}
              </button>
            ))}
          </div>

          <ul class="batch-list" data-testid="order-list">
            {filtered.map((order) => (
              <OrderCard key={order.id} order={order} onOpen={() => openOrder(order)} />
            ))}
          </ul>
          {filtered.length === 0 ? <p data-testid="orders-group-empty">{ORDERS.noneInGroup}</p> : null}
        </>
      ) : null}
    </div>
  );
}
