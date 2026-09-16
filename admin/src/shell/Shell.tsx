import type { JSX } from "preact";
import { useEffect } from "preact/hooks";

import { COPY } from "../copy";
import { navigate, useRoute, type RoutePath } from "../router";
import { Batches } from "../screens/Batches";
import { More } from "../screens/More";
import { MoreEmptyScreen } from "../screens/MoreEmptyScreen";
import { Orders } from "../screens/Orders";
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

/** The five bottom-bar sections; everything under `/more/*` collapses to "More". */
function activeTab(pathname: string): RoutePath {
  if (pathname === "/" || pathname === "/sell" || pathname === "/batches" || pathname === "/orders") {
    return pathname;
  }
  return "/more";
}

function Screen({ path, session, onSignOut }: ShellProps & { path: RoutePath }): JSX.Element {
  switch (path) {
    case "/":
      return <Today />;
    case "/sell":
      return <Sell />;
    case "/batches":
      return <Batches />;
    case "/orders":
      return <Orders />;
    case "/more":
      return <More role={session.role} />;
    case "/more/settings":
      return <Settings session={session} onSignOut={onSignOut} />;
    case "/more/concerns":
      return <MoreEmptyScreen rowKey="concerns" />;
    case "/more/products":
      return <MoreEmptyScreen rowKey="products" />;
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
  const isMoreSubPage = route.path !== "/more" && route.path.startsWith("/more/");

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
        {isMoreSubPage ? (
          <button type="button" class="back-button" onClick={() => navigate("/more")}>
            <ChevronLeftIcon size={20} />
            {COPY.back}
          </button>
        ) : null}
        <h1 class="screen-title">{route.title}</h1>
      </header>
      <div class="shell-content">
        <Screen path={route.path} session={session} onSignOut={onSignOut} />
      </div>
      <BottomBar activePath={activeTab(route.path)} />
    </main>
  );
}
