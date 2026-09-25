/**
 * Who a batch message is for (D32), and the one thing this list must never
 * do: put somebody on it whose payment bought no jar (A203).
 */

import { describe, expect, it } from "vitest";
import type { DocumentSnapshot } from "firebase-admin/firestore";

import { orderTookJars, planRecipients } from "./recipients";

const BATCH = "b-abc123";

/** A `DocumentSnapshot` as far as these two functions read one. */
function order(fields: Record<string, unknown>): DocumentSnapshot {
  const data: Record<string, unknown> = {
    state: "paidWaiting",
    customerPhone: "+919446587027",
    lines: [{ batchRef: BATCH, qty: 1 }],
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
    // sits in `held` with a concern against it. Telling that customer "half
    // the batch is paid for" would be telling them something untrue.
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

describe("the sending list", () => {
  it("is one row per customer, with their jars added up", () => {
    const rows = planRecipients(
      [
        order({ customerPhone: "+919446587027", lines: [{ batchRef: BATCH, qty: 2 }] }),
        order({ customerPhone: "+919446587027", lines: [{ batchRef: BATCH, qty: 1 }] }),
        order({ customerPhone: "+919446587028", lines: [{ batchRef: BATCH, qty: 1 }] }),
      ],
      BATCH,
      new Map([["+919446587027", "Asha"]]),
    );
    expect(rows).toEqual([
      { phone: "+919446587027", name: "Asha", jars: 3, sentAt: null },
      { phone: "+919446587028", name: "", jars: 1, sentAt: null },
    ]);
  });

  it("counts only the jars in this batch", () => {
    const rows = planRecipients(
      [order({ lines: [{ batchRef: BATCH, qty: 2 }, { batchRef: "b-other", qty: 5 }] })],
      BATCH,
      new Map(),
    );
    expect(rows[0]?.jars).toBe(2);
  });

  it("leaves out everyone who has not paid, and everyone with no number", () => {
    const rows = planRecipients(
      [
        order({ state: "held" }),
        order({ state: "held", payment: { status: "captured" } }),
        order({ customerPhone: "" }),
      ],
      BATCH,
      new Map(),
    );
    expect(rows).toEqual([]);
  });

  it("starts every row unticked: nothing has been sent", () => {
    const rows = planRecipients([order({})], BATCH, new Map());
    expect(rows[0]?.sentAt).toBeNull();
  });
});
