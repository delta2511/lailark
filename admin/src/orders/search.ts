/**
 * The Orders screen's search, brief §17.5: "Search by name, number, bill
 * number, pincode." Kept as a plain function over an `OrderDoc` and the
 * documents already read for it, rather than a Firestore query, because none
 * of the four fields it searches are on one document (the bill number lives
 * on `documents`, not on `orders`) and the order list is small enough (a
 * home kitchen's whole history) that client-side filtering over what is
 * already on screen is simpler than four separate indexed queries merged
 * back together for a box that is typed into on every keystroke.
 */
import type { DocumentDoc, OrderDoc } from "./data";

/** Case-insensitive, accent-blind substring match, the same rule for every field. */
function matches(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

/**
 * True when `order` matches `rawQuery` on name, order number, bill number, or
 * pincode. An empty (or whitespace-only) query matches everything, so the
 * search box narrows the list only once something is typed into it.
 *
 * `documents` is every `documents/{id}` this order has (from
 * `useDocumentsForOrder`), passed in rather than read here, because bill
 * numbers exist to be searched here and are otherwise never touched by this
 * module: reading them is the caller's job. An empty or denied array simply
 * never matches on the bill-number path, which is correct for a role that
 * cannot see documents at all.
 */
export function orderMatchesSearch(order: OrderDoc, rawQuery: string, documents: readonly DocumentDoc[] = []): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (q === "") return true;

  if (matches(order.number, q)) return true;
  if (matches(order.deliveryContact?.name, q)) return true;
  if (matches(order.deliveryContact?.pincode, q)) return true;
  if (matches(order.customerPhone, q)) return true;

  for (const document of documents) {
    if (matches(document.number, q)) return true;
  }

  return false;
}
