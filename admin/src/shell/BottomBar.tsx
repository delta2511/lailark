import type { JSX } from "preact";

import { COPY } from "../copy";
import { navigate, type RoutePath } from "../router";
import { BatchesIcon, MoreIcon, OrdersIcon, SellIcon, TodayIcon } from "./icons";

interface NavItem {
  readonly path: RoutePath;
  readonly label: string;
  readonly testId: string;
  readonly Icon: (props: { size?: number }) => JSX.Element;
}

/** Today, Sell, Batches, Orders, More, in that order (brief section 17.1). */
const ITEMS: readonly NavItem[] = [
  { path: "/", label: COPY.navToday, testId: "tab-today", Icon: TodayIcon },
  { path: "/sell", label: COPY.navSell, testId: "tab-sell", Icon: SellIcon },
  { path: "/batches", label: COPY.navBatches, testId: "tab-batches", Icon: BatchesIcon },
  { path: "/orders", label: COPY.navOrders, testId: "tab-orders", Icon: OrdersIcon },
  { path: "/more", label: COPY.navMore, testId: "tab-more", Icon: MoreIcon },
];

interface BottomBarProps {
  readonly activePath: RoutePath;
}

/**
 * The active tab is marked by weight and an underline, never by colour
 * (Flow section 10 leaves colour for numbers and claims). Sell sits in the
 * middle, larger and ink-filled: one tap from anywhere to the sale screen.
 */
export function BottomBar({ activePath }: BottomBarProps): JSX.Element {
  return (
    <nav class="bottom-bar" aria-label="Sections">
      {ITEMS.map(({ path, label, testId, Icon }) => {
        const active = path === activePath;
        const isSell = path === "/sell";
        return (
          <button
            key={path}
            type="button"
            class={
              "bottom-bar-item" +
              (isSell ? " bottom-bar-item-sell" : "") +
              (active ? " active" : "")
            }
            data-testid={testId}
            aria-current={active ? "page" : undefined}
            onClick={() => navigate(path)}
          >
            <Icon size={isSell ? 28 : 22} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
