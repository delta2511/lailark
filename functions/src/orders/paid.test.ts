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

import {
  orderHoldsJars,
  orderHoldsJarsFrom,
  orderSpentAllowance,
  orderSpentAllowanceFrom,
} from "./paid";

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

/**
 * **M4.5 and D65 split the old `orderTookJars` in two** (`orderHoldsJars` and
 * `orderSpentAllowance`), and they differ in exactly one case: a refund marked
 * a refusal. So every case below that has no refund on it asks **both** through
 * this helper, which fails if they ever disagree. The refusal case is asserted
 * on each predicate separately, in its own block at the end.
 */
function tookJars(doc: DocumentSnapshot): boolean {
  const holds = orderHoldsJars(doc);
  const spent = orderSpentAllowance(doc);
  expect(
    holds,
    "the two predicates may only disagree on a refund marked a refusal",
  ).toBe(spent);
  return holds;
}

function tookJarsFrom(state: unknown, paidAt: unknown, refund?: unknown): boolean {
  const holds = orderHoldsJarsFrom(state, paidAt, refund);
  expect(holds, "the two predicates may only disagree on a refund marked a refusal").toBe(
    orderSpentAllowanceFrom(state, paidAt, refund),
  );
  return holds;
}

describe("whether an order really took jars", () => {
  it("yes for every paid state of brief §9.1", () => {
    for (const state of ["paidWaiting", "toPack", "packed", "shipped", "delivered"]) {
      expect(tookJars(order({ state }))).toBe(true);
    }
  });

  it("yes for an order the sale path stamped `paidAt` on", () => {
    expect(tookJars(order({ state: "closed", paidAt: 1 }))).toBe(true);
  });

  it("no for a held order carrying a captured payment (A203)", () => {
    // The M3.6 case: the money arrived, the capture sold nothing, the order
    // sits in `held` with a concern against it. Counting its jars would
    // refuse that customer their next checkout for jars they do not own.
    expect(
      tookJars(order({ state: "held", payment: { status: "captured" } })),
    ).toBe(false);
  });

  it("no for a voided counter sale, which did not happen", () => {
    expect(tookJars(order({ state: "voided", paidAt: 1 }))).toBe(false);
  });

  it("no for a checkout nobody paid for", () => {
    expect(tookJars(order({ state: "held" }))).toBe(false);
    expect(tookJars(order({ state: "expired" }))).toBe(false);
  });
});

describe("every state brief §9.1 calls paid", () => {
  it("counts, one by one, with nothing else on the order", () => {
    for (const state of ORDER_STATES_PAID) {
      expect(tookJars(order({ state }))).toBe(true);
    }
  });
});

describe("the legitimate paid paths M3.6c had to keep counting", () => {
  it("counts an online capture, which stamps both a paid state and `paidAt`", () => {
    // `applyCapturedPayment`'s success branch: `state: paidWaiting` on an
    // open batch, `toPack` in stock, and `paidAt` on both.
    expect(tookJars(order({ state: "paidWaiting", paidAt: 1, payment: { status: "captured" } })))
      .toBe(true);
    expect(tookJars(order({ state: "toPack", paidAt: 1, payment: { status: "captured" } })))
      .toBe(true);
  });

  it("counts a cash or UPI counter sale, which is paid the moment it is entered", () => {
    // `planCounterSale` with `paidNow`: `stateAfterPayment(fulfilment)`, plus
    // `paidAt` in its stamp fields.
    for (const state of ["toPack", "readyForCollection"]) {
      expect(tookJars(order({ state, paidAt: 1, payment: { status: "captured" } })))
        .toBe(true);
    }
  });

  it("does not count a payment link before it is paid, and counts it after", () => {
    // `planCounterSale` without `paidNow`: `awaitingPayment`, no `paidAt`,
    // `payment.status: "created"`, and its jars are a hold, not a sale. The
    // capture then takes it through the same branch as a web order.
    expect(tookJars(order({ state: "awaitingPayment", payment: { status: "created" } })))
      .toBe(false);
    expect(tookJars(order({ state: "toPack", paidAt: 1, payment: { status: "captured" } })))
      .toBe(true);
  });

  it("keeps counting an order that has walked past the paid states", () => {
    // These took their jars and still hold them. Dropping any of them would
    // undercount the batch, and an undercount oversells.
    for (const state of ["deliveryProblem", "claim", "changeRequested", "paused", "closed", "refunded"]) {
      expect(tookJars(order({ state, paidAt: 1 }))).toBe(true);
    }
  });
});

describe("the predicate off plain values", () => {
  it("answers the same as the snapshot door", () => {
    expect(tookJarsFrom("toPack", undefined)).toBe(true);
    expect(tookJarsFrom("held", undefined)).toBe(false);
    expect(tookJarsFrom("closed", 1)).toBe(true);
    expect(tookJarsFrom("voided", 1)).toBe(false);
  });

  it("treats a missing or junk state as not paid, never as paid", () => {
    expect(tookJarsFrom(undefined, undefined)).toBe(false);
    expect(tookJarsFrom(null, undefined)).toBe(false);
    expect(tookJarsFrom(7, undefined)).toBe(false);
    // A stamped `paidAt` is still evidence, whatever the state says.
    expect(tookJarsFrom(undefined, 1)).toBe(true);
  });

  it("never reads `payment.status`, however captured it says it is", () => {
    expect(tookJarsFrom("held", null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* D65: what a refund does to the jars, and what it does to the allowance     */
/* -------------------------------------------------------------------------- */

/**
 * The decision M4.5 was built on, in its own words: "the refund reverses both.
 * The jar returns to `paidCount` if it is not packed, and a `refunded` order
 * stops counting toward that person's per-person limit for the batch, so they
 * may buy again... The exception: a refund marked as a refusal keeps the
 * allowance spent."
 *
 * The refusal is the **one** case where the two predicates disagree, and it is
 * where the first cut of M4.5 was wrong: the refusal kept the order in the list
 * that has to agree with `paidCount`, so brief §7.7's yield shortfall landed on
 * the refunded customer, who is owed nothing, instead of on the customer
 * holding a paid jar that would not exist. So each limb is asserted on each
 * predicate here, by name.
 */
describe("D65: the jar goes back, and the allowance goes back unless it was a refusal", () => {
  /** A plain full refund of an unpacked order: the jar went back on sale. */
  const PLAIN = { totalPaise: 64_900, fullyRefunded: true, jarsReturned: 1, refusal: null };
  /** The same refund, marked a refusal. The jar still went back. */
  const REFUSAL = { ...PLAIN, refusal: { reason: "Abusive on the phone", by: "owner" } };

  it("a plain full refund holds no jars and has spent no allowance", () => {
    const doc = order({ state: "refunded", paidAt: 1, refund: PLAIN });
    expect(orderHoldsJars(doc)).toBe(false);
    expect(orderSpentAllowance(doc)).toBe(false);
  });

  it("a refusal-marked refund holds no jars and HAS spent the allowance", () => {
    // The one disagreement, and the reason the predicates are two. `paidCount`
    // has given the jar back, so this order must be out of the jars list or the
    // shortfall lands on the wrong person. The allowance stays spent, which is
    // what the mark is for.
    const doc = order({ state: "refunded", paidAt: 1, refund: REFUSAL });
    expect(orderHoldsJars(doc)).toBe(false);
    expect(orderSpentAllowance(doc)).toBe(true);
  });

  it("a refund of an order already packed holds its jars and frees the allowance", () => {
    // Brief §12.3's "if not packed": nothing came back, so `jarsReturned` is 0
    // and those jars are in a box on their way to somebody. They are not on
    // sale, so the shortfall may still land here, and the money has gone back,
    // so the person is free to buy again. Both are right.
    const packed = { totalPaise: 64_900, fullyRefunded: true, jarsReturned: 0, refusal: null };
    const doc = order({ state: "shipped", paidAt: 1, refund: packed });
    expect(orderHoldsJars(doc)).toBe(true);
    expect(orderSpentAllowance(doc)).toBe(false);
  });

  it("a partial refund changes neither: the jar and the allowance are both still theirs", () => {
    const part = { totalPaise: 30_000, fullyRefunded: false, jarsReturned: 0, refusal: null };
    expect(tookJars(order({ state: "toPack", paidAt: 1, refund: part }))).toBe(true);
  });

  it("outranks the paid states and `paidAt`, which are what it has to reverse", () => {
    // A refunded order still carries `paidAt` and may still be sitting in a
    // paid state if the refund happened before it moved.
    for (const state of ORDER_STATES_PAID) {
      expect(orderHoldsJars(order({ state, paidAt: 1, refund: PLAIN })), state).toBe(false);
      expect(orderSpentAllowance(order({ state, paidAt: 1, refund: PLAIN })), state).toBe(false);
      expect(orderHoldsJars(order({ state, paidAt: 1, refund: REFUSAL })), state).toBe(false);
      expect(orderSpentAllowance(order({ state, paidAt: 1, refund: REFUSAL })), state).toBe(true);
    }
  });

  it("a voided sale is still excluded first, refund block or not", () => {
    expect(tookJars(order({ state: "voided", paidAt: 1, refund: PLAIN }))).toBe(false);
    expect(orderSpentAllowance(order({ state: "voided", paidAt: 1, refund: REFUSAL }))).toBe(false);
  });

  it("reads the block strictly, in the direction that cannot oversell", () => {
    // Anything that is not plainly a positive `jarsReturned` leaves the order
    // holding its jars, and anything that is not plainly `fullyRefunded: true`
    // leaves the allowance spent.
    for (const refund of [
      undefined,
      null,
      "refunded",
      7,
      [],
      {},
      { fullyRefunded: "yes" },
      { fullyRefunded: 1 },
      { jarsReturned: "1" },
      { jarsReturned: 0 },
      { jarsReturned: -1 },
      { totalPaise: 64_900 },
    ]) {
      expect(tookJars(order({ state: "toPack", paidAt: 1, refund })), JSON.stringify(refund)).toBe(
        true,
      );
    }
  });

  it("answers the same through the plain-values door, and reads no refund as none", () => {
    expect(orderHoldsJarsFrom("refunded", 1, PLAIN)).toBe(false);
    expect(orderSpentAllowanceFrom("refunded", 1, PLAIN)).toBe(false);
    expect(orderHoldsJarsFrom("refunded", 1, REFUSAL)).toBe(false);
    expect(orderSpentAllowanceFrom("refunded", 1, REFUSAL)).toBe(true);
    // Every order written before M4.5 has no `refund` at all, and must read
    // exactly as it did before: A241's behaviour, unchanged, on both.
    expect(tookJarsFrom("refunded", 1)).toBe(true);
    expect(tookJarsFrom("refunded", 1, undefined)).toBe(true);
  });
});
