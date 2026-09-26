/**
 * The one answer to "did this order actually take jars".
 *
 * **M3.6c, fixing A203.** Three places have to agree about this, and before
 * this module existed two of them disagreed:
 *
 *  - `ordersInBatch` (`batches/store.ts`), whose `paid` list is the
 *    per-person limit at checkout (`readStockClaim`), the per-person limit on
 *    the reclaim path (`customerJarsInBatch`), and the Owner's yield-shortfall
 *    and pause concerns (`transitions.ts`);
 *  - the sending list of D32 (`approvals/recipients.ts`);
 *  - anything later that needs the same question answered.
 *
 * `ordersInBatch` used to ask `payment.status === "captured" || paidAt set`.
 * `writePaymentOnly` (`webhooks/capture.ts`) writes exactly that status onto
 * every **refused** capture: a capture whose amount did not match, whose
 * batch could give no jar, or which would have taken the customer past the
 * per-person limit. Those orders stay `held`, with no `billNumber`, no
 * `paidAt`, and not one jar moved onto `paidCount`. So the jars a refused
 * customer merely *asked* for were counted as jars they *own*, for the life
 * of the batch: `createCheckout` then told somebody who owned none that they
 * already had their two, and each refusal inflated the next.
 *
 * ## The predicate
 *
 * "Paid" means the order really took jars, and only two things say so:
 *
 *  1. the order's own state has reached one of brief §9.1's paid states
 *     (`ORDER_STATES_PAID`), or
 *  2. `paidAt` is set, which only a path that completes a sale writes.
 *
 * `payment.status` is never asked. It is the honest record that Razorpay
 * captured money (A201, A184: a refused capture must stay `held` with its
 * payment on it, so the sweep and `releaseHold` leave it alone), and it is
 * deliberately not evidence that a jar moved.
 *
 * Both tests are kept, not one. `paidAt` alone would drop nothing that exists
 * today but would silently stop counting a paid order some future path forgot
 * to stamp, and an undercount here can oversell a batch. `ORDER_STATES_PAID`
 * alone would drop a paid order that has walked on into `closed`, `refunded`
 * or one of §9.1's concern states, all of which really did take their jars.
 *
 * ## Why `voided` is excluded first
 *
 * Brief §7A.6: a voided counter sale did not happen. Its payment block is
 * left as it was, because it is the record of what was taken at the counter,
 * and the void path puts its jars back. Counting it would cost the customer
 * an allowance they never used, so a mistyped sale would follow them for the
 * life of the batch. Every other terminal state is counted: a `closed` order
 * really did take its jars.
 */

import type { DocumentSnapshot } from "firebase-admin/firestore";
import { ORDER_STATES_PAID } from "@lailark/shared";

/**
 * Whether this order really took jars out of a batch.
 *
 * Reads only `state` and `paidAt`, defensively: the snapshot comes straight
 * from Firestore, so neither field is trusted to be the type it should be.
 */
export function orderTookJars(doc: DocumentSnapshot): boolean {
  return orderTookJarsFrom(doc.get("state"), doc.get("paidAt"));
}

/**
 * The same predicate off plain values, for a caller that has the order as a
 * map rather than a snapshot. One implementation, two doors.
 */
export function orderTookJarsFrom(state: unknown, paidAt: unknown): boolean {
  const s = typeof state === "string" ? state : "";
  // Brief §7A.6, and first: a voided sale did not happen, whatever else is
  // written on it.
  if (s === "voided") return false;
  if ((ORDER_STATES_PAID as readonly string[]).includes(s)) return true;
  return paidAt !== undefined && paidAt !== null;
}
