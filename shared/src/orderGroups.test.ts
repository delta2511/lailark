import { describe, expect, it } from "vitest";

import {
  isShippingToday,
  ORDER_GROUP_LABELS,
  ORDER_GROUPS,
  orderGroupForState,
  statesInGroup,
} from "./orderGroups.js";
import { ORDER_STATES, type OrderState } from "./states.js";

describe("orderGroupForState: every one of the 17 states lands somewhere", () => {
  it("assigns exactly one of the 11 named groups to every state, exhaustively", () => {
    for (const state of ORDER_STATES) {
      const group = orderGroupForState(state);
      expect(ORDER_GROUPS, `state ${state}`).toContain(group);
    }
  });

  it("has a label for every group it can return", () => {
    for (const group of ORDER_GROUPS) {
      expect(ORDER_GROUP_LABELS[group].length, group).toBeGreaterThan(0);
    }
  });

  // Named one by one, so a state's group is asserted rather than merely
  // "some group or other": this is the table brief §9.1 and §17.5 do not
  // draw directly, and a typo here (e.g. "closed" swapped for "refunded")
  // would pass the exhaustiveness test above without this.
  const expected: Record<OrderState, string> = {
    draft: "awaitingPayment",
    held: "awaitingPayment",
    awaitingPayment: "awaitingPayment",
    expired: "closed",
    paidWaiting: "paidWaiting",
    toPack: "toPack",
    readyForCollection: "readyForCollection",
    packed: "packed",
    shipped: "shipped",
    delivered: "delivered",
    deliveryProblem: "problem",
    claim: "problem",
    changeRequested: "problem",
    paused: "problem",
    refunded: "refunded",
    voided: "closed",
    closed: "closed",
  };

  for (const state of ORDER_STATES) {
    it(`puts "${state}" in "${expected[state]}"`, () => {
      expect(orderGroupForState(state)).toBe(expected[state]);
    });
  }

  it("every state in ORDER_STATES appears in the expectation table (nothing untested)", () => {
    expect(Object.keys(expected).sort()).toEqual([...ORDER_STATES].sort());
  });
});

describe("statesInGroup", () => {
  it("is the inverse of orderGroupForState, and covers every state exactly once", () => {
    const seen = new Set<OrderState>();
    for (const group of ORDER_GROUPS) {
      for (const state of statesInGroup(group)) {
        expect(orderGroupForState(state)).toBe(group);
        expect(seen.has(state), `${state} appeared in more than one group`).toBe(false);
        seen.add(state);
      }
    }
    expect(seen.size).toBe(ORDER_STATES.length);
  });

  it("problem carries all four concern-raising states", () => {
    expect([...statesInGroup("problem")].sort()).toEqual(
      ["changeRequested", "claim", "deliveryProblem", "paused"].sort(),
    );
  });

  it("closed carries every terminal state", () => {
    expect([...statesInGroup("closed")].sort()).toEqual(["closed", "expired", "voided"].sort());
  });
});

describe("isShippingToday: the derived view, not a state", () => {
  it("is true for a paid, unpacked order that actually ships", () => {
    expect(isShippingToday({ state: "paidWaiting", fulfilment: "ship" })).toBe(true);
    expect(isShippingToday({ state: "toPack", fulfilment: "ship" })).toBe(true);
  });

  it("is false once an order is packed, even if it still ships", () => {
    expect(isShippingToday({ state: "packed", fulfilment: "ship" })).toBe(false);
    expect(isShippingToday({ state: "shipped", fulfilment: "ship" })).toBe(false);
  });

  it("is false for a counter collection or a hand-over: they never see a courier", () => {
    expect(isShippingToday({ state: "paidWaiting", fulfilment: "collect" })).toBe(false);
    expect(isShippingToday({ state: "toPack", fulfilment: "handedOver" })).toBe(false);
  });

  it("is false before payment and after delivery", () => {
    expect(isShippingToday({ state: "held", fulfilment: "ship" })).toBe(false);
    expect(isShippingToday({ state: "delivered", fulfilment: "ship" })).toBe(false);
  });
});
