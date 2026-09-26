/**
 * M3.6c, A203: the one predicate for "did this order actually take jars".
 *
 * The five cases in the first block moved here verbatim from
 * `approvals/recipients.test.ts`, which is where this predicate used to live;
 * the rest are the paths M3.6c had to prove still count. The point of every
 * one of them is the same: too loose refuses a paying customer and misinforms
 * the Owner, too tight oversells the batch.
 */

import { describe, expect, it } from "vitest";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { ORDER_STATES_PAID } from "@lailark/shared";

import { orderTookJars, orderTookJarsFrom } from "./paid";

/** A `DocumentSnapshot` as far as this predicate reads one. */
function order(fields: Record<string, unknown>): DocumentSnapshot {
  const data: Record<string, unknown> = {
    state: "paidWaiting",
    customerPhone: "+919446587027",
    ...fields,
  };
  return {
    id: "o-1",
    get: (path: string) => {
      if (!path.includes(".")) return data[path];
      const [head, tail] = path.split(".");
      return (data[head as string] as Record<string, unknown> | undefined)?.[tail as string];
    },
  } as unknown as DocumentSnapshot;
}

describe("whether an order really took jars", () => {
  it("yes for every paid state of brief §9.1", () => {
    for (const state of ["paidWaiting", "toPack", "packed", "shipped", "delivered"]) {
      expect(orderTookJars(order({ state }))).toBe(true);
    }
  });

  it("yes for an order the sale path stamped `paidAt` on", () => {
    expect(orderTookJars(order({ state: "closed", paidAt: 1 }))).toBe(true);
  });

  it("no for a held order carrying a captured payment (A203)", () => {
    // The M3.6 case: the money arrived, the capture sold nothing, the order
    // sits in `held` with a concern against it. Counting its jars would
    // refuse that customer their next checkout for jars they do not own.
    expect(
      orderTookJars(order({ state: "held", payment: { status: "captured" } })),
    ).toBe(false);
  });

  it("no for a voided counter sale, which did not happen", () => {
    expect(orderTookJars(order({ state: "voided", paidAt: 1 }))).toBe(false);
  });

  it("no for a checkout nobody paid for", () => {
    expect(orderTookJars(order({ state: "held" }))).toBe(false);
    expect(orderTookJars(order({ state: "expired" }))).toBe(false);
  });
});

describe("every state brief §9.1 calls paid", () => {
  it("counts, one by one, with nothing else on the order", () => {
    for (const state of ORDER_STATES_PAID) {
      expect(orderTookJars(order({ state }))).toBe(true);
    }
  });
});

describe("the legitimate paid paths M3.6c had to keep counting", () => {
  it("counts an online capture, which stamps both a paid state and `paidAt`", () => {
    // `applyCapturedPayment`'s success branch: `state: paidWaiting` on an
    // open batch, `toPack` in stock, and `paidAt` on both.
    expect(orderTookJars(order({ state: "paidWaiting", paidAt: 1, payment: { status: "captured" } })))
      .toBe(true);
    expect(orderTookJars(order({ state: "toPack", paidAt: 1, payment: { status: "captured" } })))
      .toBe(true);
  });

  it("counts a cash or UPI counter sale, which is paid the moment it is entered", () => {
    // `planCounterSale` with `paidNow`: `stateAfterPayment(fulfilment)`, plus
    // `paidAt` in its stamp fields.
    for (const state of ["toPack", "readyForCollection"]) {
      expect(orderTookJars(order({ state, paidAt: 1, payment: { status: "captured" } })))
        .toBe(true);
    }
  });

  it("does not count a payment link before it is paid, and counts it after", () => {
    // `planCounterSale` without `paidNow`: `awaitingPayment`, no `paidAt`,
    // `payment.status: "created"`, and its jars are a hold, not a sale. The
    // capture then takes it through the same branch as a web order.
    expect(orderTookJars(order({ state: "awaitingPayment", payment: { status: "created" } })))
      .toBe(false);
    expect(orderTookJars(order({ state: "toPack", paidAt: 1, payment: { status: "captured" } })))
      .toBe(true);
  });

  it("keeps counting an order that has walked past the paid states", () => {
    // These took their jars and still hold them. Dropping any of them would
    // undercount the batch, and an undercount oversells.
    for (const state of ["deliveryProblem", "claim", "changeRequested", "paused", "closed", "refunded"]) {
      expect(orderTookJars(order({ state, paidAt: 1 }))).toBe(true);
    }
  });
});

describe("the predicate off plain values", () => {
  it("answers the same as the snapshot door", () => {
    expect(orderTookJarsFrom("toPack", undefined)).toBe(true);
    expect(orderTookJarsFrom("held", undefined)).toBe(false);
    expect(orderTookJarsFrom("closed", 1)).toBe(true);
    expect(orderTookJarsFrom("voided", 1)).toBe(false);
  });

  it("treats a missing or junk state as not paid, never as paid", () => {
    expect(orderTookJarsFrom(undefined, undefined)).toBe(false);
    expect(orderTookJarsFrom(null, undefined)).toBe(false);
    expect(orderTookJarsFrom(7, undefined)).toBe(false);
    // A stamped `paidAt` is still evidence, whatever the state says.
    expect(orderTookJarsFrom(undefined, 1)).toBe(true);
  });

  it("never reads `payment.status`, however captured it says it is", () => {
    expect(orderTookJarsFrom("held", null)).toBe(false);
  });
});
