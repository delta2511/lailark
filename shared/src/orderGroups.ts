/**
 * The Orders screen's groups, brief §17.5: "Grouped: Awaiting payment, Paid
 * waiting, Ships today, To pack, Packed, Shipped, Ready for collection,
 * Problem, Delivered, Refunded, Closed."
 *
 * `ORDER_STATES` (`states.ts`) has 17 spellings; the brief names 11 groups.
 * M3.9's done-when is "every order created in M2 and M3 is findable", which
 * means every one of the 17 has to land in exactly one group and none of
 * them can fall through unassigned. This file is that mapping, written out
 * state by state rather than left to a `default:` case, so a state added to
 * `states.ts` later and never taught to this switch fails a type check
 * instead of silently going ungrouped (see `assertNever` below).
 *
 * **"Ships today" is not one of the 17 states.** Brief §17.5 lists it as a
 * group but nothing in §9.1's state table calls anything "Ships today": the
 * closest thing to a state that name could mean is a subset of `paidWaiting`
 * and `toPack` orders whose fulfilment is a ship (not a counter collection
 * or a hand-over) and that have not moved to `packed` yet, i.e. the pile the
 * kitchen needs to clear before the day's courier pickup. So it is a
 * **derived view**, `isShippingToday` below, layered on top of the state
 * groups rather than a twelfth bucket a state maps into. An order inside it
 * still belongs to its own state group too (`paidWaiting` or `toPack`) — the
 * screen offers "Ships today" as an extra lens, the way a filter would, not
 * as a twelfth place an order can live and nowhere else.
 *
 * Logged as `ASSUMED` (M3.9): the brief does not spell out this mapping
 * itself, only the 17 states (§9.1) and the 11 named groups (§17.5), so
 * matching one to the other is this file's own reading of both tables. Every
 * choice below is explained at the state, not asserted bare.
 */
import { ORDER_STATES, type FulfilmentMode, type OrderState } from "./states.js";

/** The 11 groups brief §17.5 names, in the order it lists them. */
export const ORDER_GROUPS = [
  "awaitingPayment",
  "paidWaiting",
  "toPack",
  "packed",
  "shipped",
  "readyForCollection",
  "problem",
  "delivered",
  "refunded",
  "closed",
] as const;
export type OrderGroup = (typeof ORDER_GROUPS)[number];

/** A label for each group, admin-facing (CLAUDE.md §5: admin wording may be assumed freely). */
export const ORDER_GROUP_LABELS: Readonly<Record<OrderGroup, string>> = {
  awaitingPayment: "Awaiting payment",
  paidWaiting: "Paid, waiting",
  toPack: "To pack",
  packed: "Packed",
  shipped: "Shipped",
  readyForCollection: "Ready for collection",
  problem: "Problem",
  delivered: "Delivered",
  refunded: "Refunded",
  closed: "Closed",
};

/** Exhaustiveness helper: a branch here means a state in `ORDER_STATES` was never taught a group. */
function assertNever(value: never): never {
  throw new Error(`orderGroupForState: no group for state ${String(value)}`);
}

/**
 * The one group an order's `state` puts it in. Every one of the 17
 * `ORDER_STATES` is a case here, on purpose (see the file doc-comment).
 */
export function orderGroupForState(state: OrderState): OrderGroup {
  switch (state) {
    // Not yet paid. A draft (offline counter sale, or an agent-built sale not
    // yet sent) has the same "nothing has arrived yet" shape as a live hold
    // or a sent payment link, and brief §9.1's own "Next" column for Draft is
    // "Held, Awaiting payment, Discarded", the same two live states plus a
    // path to Expired — so it reads with them rather than needing its own
    // bucket the brief never named.
    case "draft":
    case "held":
    case "awaitingPayment":
      return "awaitingPayment";

    // Paid, batch not yet bottled: brief calls this state "Paid, waiting"
    // and the group is the same name.
    case "paidWaiting":
      return "paidWaiting";

    case "toPack":
      return "toPack";
    case "packed":
      return "packed";
    case "shipped":
      return "shipped";
    case "readyForCollection":
      return "readyForCollection";
    case "delivered":
      return "delivered";

    // Brief §9.1 sends all four of these to "Concern" as their next step,
    // and `ORDER_STATES_RAISING_CONCERN` (states.ts) is exactly these four:
    // one thing has gone wrong and the Owner has to look, whichever of the
    // four it is. One "Problem" group for all of them, rather than four
    // groups the brief never named.
    case "deliveryProblem":
    case "claim":
    case "changeRequested":
    case "paused":
      return "problem";

    case "refunded":
      return "refunded";

    // `ORDER_STATES_TERMINAL` (states.ts) is exactly `expired`, `voided`,
    // `closed`: "nothing more expected" is brief §9.1's own description of
    // Closed, and it is equally true of an expired hold and a same-day void,
    // neither of which the brief gives a group of its own. All three close
    // the list together.
    case "expired":
    case "voided":
    case "closed":
      return "closed";

    default:
      return assertNever(state);
  }
}

/**
 * Every state that maps to `group`, for a filter chip or a Firestore
 * `in` query. Built from {@link orderGroupForState} rather than duplicated by
 * hand, so the two can never drift apart.
 */
export function statesInGroup(group: OrderGroup): readonly OrderState[] {
  return ORDER_STATES.filter((state) => orderGroupForState(state) === group);
}

/**
 * Brief §17.5's "Ships today": the derived view over paid-and-unpacked
 * orders described in the file doc-comment, not a state of its own.
 *
 * An order qualifies while it is paid and has not yet been packed
 * (`paidWaiting` or `toPack`) and its fulfilment actually leaves by courier:
 * a counter collection or a hand-over never "ships" at all, so including
 * them here would put orders that will never see a courier in a courier
 * queue the Kitchen is trying to clear before pickup.
 */
export function isShippingToday(order: { readonly state: OrderState; readonly fulfilment: FulfilmentMode }): boolean {
  return (order.state === "paidWaiting" || order.state === "toPack") && order.fulfilment === "ship";
}
