"use client";

import { useSyncExternalStore } from "react";
import { shareCodeFrom } from "../../lib/checkout";

/**
 * `window.location.search`, read the way React wants a browser value read: a
 * snapshot that is `""` on the server, so the prerendered HTML and the first
 * client render agree and nothing hydrates twice.
 *
 * This is a static export, so there is no router to ask. Two pages need the
 * query string now (the checkout and, since M3.8, the product page's Buy
 * link), so it lives here rather than twice.
 */
const subscribeToNothing = () => () => {};
const serverSearch = () => "";
/**
 * Empty on the server, which no real path ever is. A page that reads the
 * path can therefore tell "not mounted yet" from "mounted, and this path is
 * not one we know", and say nothing at all in the first case rather than
 * flashing a refusal into the prerendered HTML.
 */
const serverPath = () => "";

export function usePathname() {
  return useSyncExternalStore(subscribeToNothing, () => window.location.pathname, serverPath);
}

export function useSearch() {
  return useSyncExternalStore(subscribeToNothing, () => window.location.search, serverSearch);
}

/**
 * The `?s=<shareCode>` this visit arrived with, or null. M3.8: somebody who
 * followed a customer's share link carries the code from the product page
 * into the checkout, and `createCheckout` records it on the order.
 *
 * Null on the server render, which is correct rather than unfortunate: the
 * page is a static file and the code is in the URL the browser has.
 */
export function useShareCode() {
  return shareCodeFrom(useSearch());
}
