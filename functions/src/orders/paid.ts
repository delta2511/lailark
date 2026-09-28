/**
 * The two questions about an order that everything else asks, kept apart.
 *
 * **M3.6c, fixing A203**, made this one predicate, `orderTookJars`, because
 * three places disagreed about "did this order actually take jars". **M4.5 and
 * D65 split it in two**, because the refund made the two things it was
 * answering stop being the same thing. Read the history below before merging
 * them again, because merging them is the defect.
 *
 * ## Question one: does this order still hold jars? `orderHoldsJars`
 *
 * This is the question **`batches/{ref}.paidCount` answers**. It is a count of
 * jars that have left the shelf and not come back, so any list that has to
 * agree with `paidCount` must be built from this predicate, and nothing else:
 *
 *  - `ordersInBatch(...).holdsJars` (`batches/store.ts`), which becomes
 *    `paidOrders` in `transitions.ts`, which is
 *      - brief §7.7's **yield shortfall**: `jarsShort = paidCount - jarCount`,
 *        allocated over these orders. The subtrahend and the list must
 *        describe the same set or the shortfall lands on the wrong customer;
 *      - D23's **pause concerns**, one per person who is owed a jar;
 *  - D32's **sending list** (`approvals/recipients.ts`): "half the batch is
 *    paid for" goes to the people actually holding jars;
 *  - `money/refundPlan.ts`, deciding whether a refund has a jar to give back.
 *
 * ## Question two: has this order spent the customer's allowance?
 * `orderSpentAllowance`
 *
 * This is **D65's** question, and brief §7.2 step 3's "limit checked against
 * the number, across all their orders in this batch":
 *
 *  - `readStockClaim`'s per-person limit at checkout and at the counter;
 *  - `customerJarsInBatch`, the same limit on the reclaim path (D60).
 *
 * ## The one case where the two differ, which is the whole reason for the split
 *
 * A refund **marked as a refusal** (D65): the jar goes back on sale, because
 * refusing a person is not a reason to lose a jar out of a 15-to-40 jar batch,
 * and the person's allowance stays **spent**, so they cannot simply buy it
 * again. So that order holds no jars and has spent an allowance: `holdsJars`
 * says no, `spentAllowance` says yes.
 *
 * Getting that one case wrong in either direction is a real harm, which is why
 * it has a paragraph rather than a line:
 *
 *  - asking `spentAllowance` where `paidCount` is meant sends the yield
 *    shortfall and the pause concern to the refunded, refused customer, who is
 *    owed nothing, and sends nothing to the customer who is holding a paid jar
 *    that will not exist;
 *  - asking `holdsJars` where the limit is meant hands the refused customer
 *    their allowance back, which is the thing the refusal mark exists to stop.
 *
 * **A refunded order that was already packed or shipped is not that case.** No
 * jar came back (brief §12.3's "if not packed"), so it still **holds** its
 * jars, and a plain refund still **frees** its allowance. Both are right: the
 * jars are in a box on their way to somebody, so they are not on sale and the
 * shortfall may still land here, while the money has gone back, so the person
 * is free to buy again.
 *
 * ## What both share: how "took jars" is decided
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
 * "Took jars" therefore means the order really took jars, and only two things
 * say so:
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
 * ## Why `voided` is excluded first, in both
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

/* -------------------------------------------------------------------------- */
/* Shared: did this order ever take jars at all                               */
/* -------------------------------------------------------------------------- */

/**
 * The part both questions share, before any refund is considered. Private on
 * purpose: a caller that asks only this has not said which of the two
 * questions above it means, and that ambiguity is what M4.5 had to unpick.
 */
function tookJars(state: unknown, paidAt: unknown): boolean {
  const s = typeof state === "string" ? state : "";
  // Brief §7A.6, and first: a voided sale did not happen, whatever else is
  // written on it.
  if (s === "voided") return false;
  if ((ORDER_STATES_PAID as readonly string[]).includes(s)) return true;
  return paidAt !== undefined && paidAt !== null;
}

/* -------------------------------------------------------------------------- */
/* Shared: how many jars is one line                                          */
/* -------------------------------------------------------------------------- */

/**
 * The jars one order line took, from a `qty` read straight off Firestore.
 *
 * **One test, because two places have to agree.** `orderHoldsJars` is a
 * **whole-order** predicate, and every caller consumes it **per batch**:
 * `ordersInBatch` asks it once per order and then attributes `jarsInBatch(doc,
 * batchRef)` jars to the batch it is reading. So if the function that decides
 * *whether* a refund gave jars back counted a line that the function summing
 * jars per batch did not, or the other way round, the disagreement does not
 * cancel out, it moves jars between batches.
 *
 * The case, measured by the M4.5 round-1 tester: an order with one sound line
 * on batch A and one line whose `qty` is a fraction on batch B. `jarsByBatch`
 * skipped the bad line, so the refund returned only A's jar, so `jarsReturned`
 * was 1, so `orderHoldsJars` went false for **the whole order**, batch B
 * included, while B's `paidCount` never moved. B was then left holding two
 * phantom jars that no order in the `holdsJars` list claimed, which is exactly
 * the brief section 7.7 shortfall harm the two-predicate split exists to
 * prevent.
 *
 * **It is not reachable in production today.** `createCounterSale` and
 * `createCheckout` both validate `qty`, and `firestore.rules` lets no client
 * write `orders` at all, so it needs a corrupt document or a future function
 * bug. It is closed anyway, here, so the agreement is by construction rather
 * than by both places happening to be written the same way.
 *
 * A jar is a whole jar: anything that is not a positive integer is no jars,
 * which is the direction that cannot invent stock.
 */
export function jarsOnLine(qty: unknown): number {
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) return 0;
  return qty;
}

/* -------------------------------------------------------------------------- */
/* Question one: does this order still hold jars                              */
/* -------------------------------------------------------------------------- */

/**
 * Whether this order is still holding jars out of a batch, which is exactly
 * what `batches/{ref}.paidCount` counts.
 *
 * Reads `state`, `paidAt` and `refund`, defensively: the snapshot comes
 * straight from Firestore, so no field is trusted to be the type it should be.
 */
export function orderHoldsJars(doc: DocumentSnapshot): boolean {
  return orderHoldsJarsFrom(doc.get("state"), doc.get("paidAt"), doc.get("refund"));
}

/**
 * The same predicate off plain values, for a caller that has the order as a
 * map rather than a snapshot. One implementation, two doors.
 *
 * `refund` is `orders/{id}.refund` (M4.5). Leaving it out reads as "no refund
 * has been recorded", which is true of every order written before M4.5.
 */
export function orderHoldsJarsFrom(state: unknown, paidAt: unknown, refund?: unknown): boolean {
  if (!tookJars(state, paidAt)) return false;
  // The refund gave the jars back, so `paidCount` no longer counts them and
  // neither does this. `jarsReturned` is what `recordRefund` decremented the
  // batch by, in the same commit, which is why it is the field read here
  // rather than `fullyRefunded`: a refund of a packed order is full and
  // returns nothing, and those jars are still out of the kitchen.
  return refundReturnedJars(refund) === false;
}

/**
 * Whether a refund has put this order's jars back on a batch's paid count.
 *
 * Read strictly: anything that is not plainly a positive `jarsReturned` leaves
 * the order holding its jars, which is the direction that cannot oversell.
 */
export function refundReturnedJars(refund: unknown): boolean {
  const map = asMap(refund);
  if (map === null) return false;
  const returned = map.jarsReturned;
  return typeof returned === "number" && Number.isFinite(returned) && returned > 0;
}

/* -------------------------------------------------------------------------- */
/* Question two: has this order spent the customer's allowance (D65)          */
/* -------------------------------------------------------------------------- */

/**
 * Whether this order counts against its customer's per-person limit for the
 * batch. Brief §7.2 step 3, and D65.
 */
export function orderSpentAllowance(doc: DocumentSnapshot): boolean {
  return orderSpentAllowanceFrom(doc.get("state"), doc.get("paidAt"), doc.get("refund"));
}

/** The same, off plain values. See {@link orderHoldsJarsFrom}. */
export function orderSpentAllowanceFrom(state: unknown, paidAt: unknown, refund?: unknown): boolean {
  if (!tookJars(state, paidAt)) return false;
  // D65: a full refund hands the allowance back, so that person may buy again,
  // and there is no loop to abuse because every refund is the Owner's own
  // manual act. Unless he marked it a refusal, which keeps it spent.
  return refundReleasedTheAllowance(refund) === false;
}

/**
 * D65's question, off `orders/{id}.refund`: has this order's refund handed the
 * customer's per-person allowance back?
 *
 * Yes when the whole payment has been returned and the Owner did **not** mark
 * the refund a refusal. Read defensively, field by field: the map comes
 * straight from Firestore, and anything that is not plainly `fullyRefunded:
 * true` with no `refusal` on it leaves the allowance exactly where it was,
 * which is the strict direction.
 */
export function refundReleasedTheAllowance(refund: unknown): boolean {
  const map = asMap(refund);
  if (map === null) return false;
  if (map.fullyRefunded !== true) return false;
  return asMap(map.refusal) === null;
}

function asMap(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
