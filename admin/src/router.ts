/**
 * A tiny router of the admin's own, over the History API. No dependency:
 * the whole surface is a route table, a pure matcher (unit tested), and a
 * hook that re-renders on navigation.
 *
 * Routes are the ones brief section 17.1 names for the bottom bar plus the
 * six rows under More. Every one of them must render on a hard reload or a
 * typed-in deep link: the Hosting rewrite (firebase.json, the `admin`
 * target) already serves index.html for any path that is not a file, and
 * admin/scripts/serve-dist.mjs mirrors that for the Playwright run.
 */
import { useEffect, useState } from "preact/hooks";

export type RoutePath =
  | "/"
  | "/sell"
  | "/batches"
  | "/orders"
  | "/more"
  | "/more/concerns"
  | "/more/products"
  | "/more/customers"
  | "/more/agent"
  | "/more/money"
  | "/more/settings";

export interface RouteDef {
  readonly path: RoutePath;
  readonly title: string;
}

/**
 * `/orders/<id>`, M3.9's order detail. A template literal type rather than a
 * member of `RoutePath`, because `RoutePath` is the closed set of the app's
 * *screens* (bottom bar plus the six More rows) and an order id is not a
 * screen of its own, it is a parameter into the Orders screen. Built with
 * {@link orderDetailPath}, never written out by hand, so the one place that
 * knows how an order id is escaped into a URL segment is this file.
 */
export type OrderDetailPath = `/orders/${string}`;

/** Everywhere `navigate` may go: a screen, or one order's own page. */
export type NavigablePath = RoutePath | OrderDetailPath;

/** An order detail match: `path` stays `"/orders"` on purpose, see {@link MatchedRoute}. */
export interface OrderDetailRouteDef extends RouteDef {
  readonly path: "/orders";
  readonly orderId: string;
}

/**
 * What {@link matchRoute} returns: one of the fixed screens, or the Orders
 * screen matched with an id. `path` reads `"/orders"` on both branches
 * deliberately: `BottomBar`'s active-tab check and `Shell`'s "which screen is
 * this" switch both key off `path`, and an order detail is the Orders
 * screen with a parameter, not a fourteenth entry in that switch. The two
 * are told apart with {@link isOrderDetailRoute}, not by comparing strings.
 */
export type MatchedRoute = RouteDef | OrderDetailRouteDef;

export function isOrderDetailRoute(route: MatchedRoute): route is OrderDetailRouteDef {
  return "orderId" in route;
}

/** The URL for one order's detail page. Encodes the id; nobody else should. */
export function orderDetailPath(orderId: string): OrderDetailPath {
  return `/orders/${encodeURIComponent(orderId)}`;
}

/** The full route table, in the order brief section 17.1 lists them. */
export const ROUTES: readonly RouteDef[] = [
  { path: "/", title: "Today" },
  { path: "/sell", title: "Sell" },
  { path: "/batches", title: "Batches" },
  { path: "/orders", title: "Orders" },
  { path: "/more", title: "More" },
  { path: "/more/concerns", title: "Concerns" },
  { path: "/more/products", title: "Products" },
  { path: "/more/customers", title: "Customers" },
  { path: "/more/agent", title: "Agent" },
  { path: "/more/money", title: "Money" },
  { path: "/more/settings", title: "Settings" },
];

const ORDER_DETAIL_PATTERN = /^\/orders\/([^/]+)$/;

/**
 * Matches a pathname against the route table. A trailing slash (other than
 * root) is stripped before matching, so `/orders/` finds `/orders`. Anything
 * that is not one of the known paths, and does not fit `/orders/<id>`,
 * falls back to the root route: this is a closed set of admin screens plus
 * one parameterised one, not a place for a 404 page.
 *
 * `/orders/<id>` is checked before the plain table lookup so a bare
 * `/orders` (no segment after it) still resolves to the ordinary list route,
 * and an id is decoded once here, in the one place a raw pathname segment
 * becomes a value the rest of the app trusts.
 */
export function matchRoute(pathname: string): MatchedRoute {
  const normalised = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  const orderMatch = ORDER_DETAIL_PATTERN.exec(normalised);
  if (orderMatch) {
    const orderId = decodeURIComponent(orderMatch[1]);
    if (orderId !== "") {
      return { path: "/orders", title: "Order", orderId };
    }
  }

  return ROUTES.find((route) => route.path === normalised) ?? ROUTES[0];
}

const NAVIGATE_EVENT = "lailark:navigate";

/** Pushes a new path onto the History stack and tells every `useLocation` to re-read it. */
export function navigate(path: NavigablePath): void {
  if (window.location.pathname !== path) {
    window.history.pushState(null, "", path);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** The current pathname, re-read on `popstate` (back/forward) and on `navigate`. */
export function useLocation(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onChange = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onChange);
    window.addEventListener(NAVIGATE_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(NAVIGATE_EVENT, onChange);
    };
  }, []);

  return pathname;
}

/** The matched route for the current location, re-computed on every navigation. */
export function useRoute(): MatchedRoute {
  return matchRoute(useLocation());
}
