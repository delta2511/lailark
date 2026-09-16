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

/**
 * Matches a pathname against the route table. A trailing slash (other than
 * root) is stripped before matching, so `/orders/` finds `/orders`. Anything
 * that is not one of the known paths falls back to the root route: this is a
 * closed set of admin screens, not a place for a 404 page.
 */
export function matchRoute(pathname: string): RouteDef {
  const normalised = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return ROUTES.find((route) => route.path === normalised) ?? ROUTES[0];
}

const NAVIGATE_EVENT = "lailark:navigate";

/** Pushes a new path onto the History stack and tells every `useLocation` to re-read it. */
export function navigate(path: RoutePath): void {
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
export function useRoute(): RouteDef {
  return matchRoute(useLocation());
}
