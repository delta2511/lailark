/**
 * The two functions that must agree on "how many jars is this line".
 *
 * `jarsInBatch` (here) attributes an order's jars to one batch, and
 * `jarsByBatch` (`money/refundPlan.ts`) decides which jars a refund gives back.
 * `orderHoldsJars` is a **whole-order** predicate that every caller consumes
 * **per batch**, so a disagreement between these two does not cancel out: the
 * refund moves what one batch's holders list says without moving that batch's
 * count, and the batch is left holding jars no order in the list claims. That is
 * the brief section 7.7 shortfall harm the M4.5 predicate split exists to stop.
 *
 * Found by the M4.5 round-1 tester, latent rather than live (`createCounterSale`
 * and `createCheckout` both validate `qty`, and no client may write `orders`),
 * and closed by putting the one test in `orders/paid.ts` so the agreement is by
 * construction. This file is what fails if either side stops reading it.
 */
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { jarsByBatch, type RefundableLine } from "../money/refundPlan";
import { jarsOnLine } from "../orders/paid";
import { jarsInBatch } from "./store";

const BATCH = "b-7f3a2c";

/** A `DocumentSnapshot` as far as `jarsInBatch` reads one. */
function orderWith(lines: ReadonlyArray<Record<string, unknown>>): DocumentSnapshot {
  return {
    id: "o-7f3a2c",
    get: (path: string) => (path === "lines" ? lines : undefined),
  } as unknown as DocumentSnapshot;
}

function refundableLine(overrides: Partial<RefundableLine>): RefundableLine {
  return {
    batchRef: BATCH,
    qty: 1,
    jarNumbers: [],
    productSlug: "prawns-and-dates",
    customDescription: null,
    unitPrice: 64_900,
    ...overrides,
  };
}

/** Every shape a `qty` read off Firestore can be, sound and unsound. */
const QUANTITIES: readonly unknown[] = [
  1,
  2,
  22,
  0,
  -1,
  -2,
  1.5,
  0.5,
  64_900.0001,
  NaN,
  Infinity,
  -Infinity,
  "1",
  "abc",
  null,
  undefined,
  true,
  {},
  [],
];

describe("jarsOnLine, the one test both sides read", () => {
  it("counts a whole positive number of jars and nothing else", () => {
    expect(jarsOnLine(1)).toBe(1);
    expect(jarsOnLine(22)).toBe(22);
  });

  it("counts nothing for anything that is not a whole positive number", () => {
    // A jar is a whole jar, and the strict direction is the one that cannot
    // invent stock out of a malformed line.
    for (const qty of [0, -1, 1.5, NaN, Infinity, "1", null, undefined, true, {}, []]) {
      expect(jarsOnLine(qty), JSON.stringify(qty) ?? String(qty)).toBe(0);
    }
  });
});

describe("jarsInBatch and jarsByBatch agree, line for line", () => {
  it("agrees on every shape a qty can arrive as", () => {
    for (const qty of QUANTITIES) {
      const perBatch = jarsInBatch(orderWith([{ batchRef: BATCH, qty }]), BATCH);
      const refunded = jarsByBatch([refundableLine({ qty: qty as number })])[0]?.qty ?? 0;
      expect(
        perBatch,
        `qty ${JSON.stringify(qty) ?? String(qty)}: the holders list says ${perBatch} jars and the refund says ${refunded}`,
      ).toBe(refunded);
    }
  });

  it("agrees on the mixed order the round-1 tester built", () => {
    // One sound line on batch A, one line whose qty is a fraction on batch B.
    // Before the fix the holders list credited batch B with 1.5 jars while the
    // refund gave none of them back, so recording the refund silently changed
    // what B's list said without moving B's count.
    const a = "b-aaaaaa";
    const b = "b-bbbbbb";
    const lines = [
      { batchRef: a, qty: 1 },
      { batchRef: b, qty: 1.5 },
    ];
    const doc = orderWith(lines);
    const refunded = new Map(
      jarsByBatch([
        refundableLine({ batchRef: a, qty: 1 }),
        refundableLine({ batchRef: b, qty: 1.5 }),
      ]).map((r) => [r.batchRef, r.qty]),
    );

    expect(jarsInBatch(doc, a)).toBe(1);
    expect(refunded.get(a) ?? 0).toBe(1);
    // Zero on both sides now, so nothing about batch B changes when the refund
    // on batch A is recorded.
    expect(jarsInBatch(doc, b)).toBe(0);
    expect(refunded.get(b) ?? 0).toBe(0);
  });

  it("adds several sound lines on one batch the same way on both sides", () => {
    const doc = orderWith([
      { batchRef: BATCH, qty: 1 },
      { batchRef: BATCH, qty: 2 },
      { batchRef: "b-other", qty: 5 },
      { batchRef: null, qty: 3 },
    ]);
    expect(jarsInBatch(doc, BATCH)).toBe(3);
    expect(
      jarsByBatch([
        refundableLine({ qty: 1 }),
        refundableLine({ qty: 2 }),
        refundableLine({ batchRef: "b-other", qty: 5 }),
        refundableLine({ batchRef: null, qty: 3 }),
      ]).find((r) => r.batchRef === BATCH)?.qty,
    ).toBe(3);
  });
});
