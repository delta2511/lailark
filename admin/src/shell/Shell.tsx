import type { JSX } from "preact";
import { useEffect } from "preact/hooks";

import { COPY } from "../copy";
import { isOrderDetailRoute, navigate, useRoute, type MatchedRoute, type RoutePath } from "../router";
import { Batches } from "../screens/Batches";
import { More } from "../screens/More";
import { MoreEmptyScreen } from "../screens/MoreEmptyScreen";
import { Orders } from "../screens/Orders";
import { Products } from "../screens/Products";
import { Sell } from "../screens/Sell";
import { Settings } from "../screens/Settings";
import { Today } from "../screens/Today";
import type { Session } from "../session";
import { BottomBar } from "./BottomBar";
import { ChevronLeftIcon } from "./icons";
import { OfflinePill } from "./OfflinePill";

interface ShellProps {
  readonly session: Session;
  readonly onSignOut: () => void;
}

/**
 * The five bottom-bar sections; everything under `/more/*` collapses to
 * "More", and an order detail (`/orders/<id>`) collapses to "/orders", the
 * same tab its list lives under.
 */
function activeTab(pathname: string): RoutePath {
  if (pathname === "/" || pathname === "/sell" || pathname === "/batches" || pathname === "/orders") {
    return pathname;
  }
  if (pathname.startsWith("/orders/")) return "/orders";
  return "/more";
}

function Screen({ route, session, onSignOut }: ShellProps & { route: MatchedRoute }): JSX.Element {
  if (isOrderDetailRoute(route)) {
    return <Orders orderId={route.orderId} session={session} />;
  }
  switch (route.path) {
    case "/":
      return <Today session={session} />;
    case "/sell":
      return <Sell session={session} />;
    case "/batches":
      return <Batches session={session} />;
    case "/orders":
      return <Orders orderId={null} session={session} />;
    case "/more":
      return <More role={session.role} />;
    case "/more/settings":
      return <Settings session={session} onSignOut={onSignOut} />;
    case "/more/concerns":
      return <MoreEmptyScreen rowKey="concerns" />;
    case "/more/products":
      return <Products session={session} />;
    case "/more/customers":
      return <MoreEmptyScreen rowKey="customers" />;
    case "/more/agent":
      return <MoreEmptyScreen rowKey="agent" />;
    case "/more/money":
      return <MoreEmptyScreen rowKey="money" />;
  }
}

/**
 * Top area (offline pill, back affordance, serif title), a scrolling content
 * region, and the bottom bar. Everything past the home page is paper ground
 * (Flow section 10): the admin is a tool, not a decoration.
 */
export function Shell({ session, onSignOut }: ShellProps): JSX.Element {
  const route = useRoute();
  const onOrderDetail = isOrderDetailRoute(route);
  const isMoreSubPage = route.path !== "/more" && route.path.startsWith("/more/");
  const showBack = isMoreSubPage || onOrderDetail;
  const backTarget = onOrderDetail ? "/orders" : "/more";
  const title = onOrderDetail ? COPY.orderDetailTitle : route.title;

  // Money is Owner and Viewer only (D13, brief section 17.12): Kitchen never
  // lands on it, deep link or not.
  useEffect(() => {
    if (route.path === "/more/money" && session.role === "kitchen") {
      navigate("/more");
    }
  }, [route.path, session.role]);

  if (route.path === "/more/money" && session.role === "kitchen") {
    return <main class="shell" data-testid="app-shell" />;
  }

  return (
    <main class="shell" data-testid="app-shell">
      <OfflinePill />
      <header class="shell-header">
        {showBack ? (
          <button type="button" class="back-button" onClick={() => navigate(backTarget)}>
            <ChevronLeftIcon size={20} />
            {COPY.back}
          </button>
        ) : null}
        <h1 class="screen-title">{title}</h1>
      </header>
      <div class="shell-content">
        <Screen route={route} session={session} onSignOut={onSignOut} />
      </div>
      <BottomBar activePath={activeTab(route.path)} />
    </main>
  );
}
