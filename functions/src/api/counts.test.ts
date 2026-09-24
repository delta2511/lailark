import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

import { computeCounts } from "./counts";

/**
 * A fake `Firestore` covering exactly the surface `computeCounts` calls:
 * `collection(name).where(field, op, value).get()` for `products`/`batches`,
 * and `collection("settings").doc("shipping").get()` for the shipping
 * switch. No emulator needed for this file; the real Firestore is exercised
 * by `functions/test/counts.test.ts`.
 */
function fakeDb(
  products: readonly Record<string, unknown>[],
  batches: readonly Record<string, unknown>[],
  settings: Readonly<Record<string, Record<string, unknown>>> = {},
): Firestore {
  function collection(name: string) {
    const docs = name === "products" ? products : name === "batches" ? batches : [];
    return {
      where(field: string, op: string, value: unknown) {
        const filtered = docs.filter((d) => {
          if (op === "==") return d[field] === value;
          if (op === "in") return Array.isArray(value) && value.includes(d[field]);
          throw new Error(`unsupported op ${op}`);
        });
        return {
          get: async () => ({
            empty: filtered.length === 0,
            docs: filtered.map((d) => ({ id: d.id as string, data: () => d })),
          }),
        };
      },
      doc(id: string) {
        const data = settings[id];
        return {
          get: async () => ({
            exists: data !== undefined,
            get: (field: string) => data?.[field],
          }),
        };
      },
    };
  }
  return { collection } as unknown as Firestore;
}

function product(slug: string, active = true) {
  return { id: slug, active };
}

describe("computeCounts", () => {
  it("returns mode none for an active product with no live batch", async () => {
    const db = fakeDb([product("koorka")], []);
    const payload = await computeCounts(db);
    expect(payload.products).toEqual({ koorka: { mode: "none" } });
  });

  it("leaves out an inactive product entirely", async () => {
    const db = fakeDb([product("duck", false)], [
      { id: "b1", productSlug: "duck", state: "inStock", bottledJars: 5, paidCount: 0 },
    ]);
    const payload = await computeCounts(db);
    expect(payload.products).toEqual({});
  });

  it("computes an in-stock entry: count is jars left, total is jars bottled", async () => {
    const db = fakeDb(
      [product("prawns-and-dates")],
      [
        {
          id: "b1",
          productSlug: "prawns-and-dates",
          state: "inStock",
          bottledJars: 8,
          paidCount: 3,
          writtenOff: 0,
          priceInStock: 64_900,
          packedOn: "2026-09-04",
          bestBefore: "2027-03-04",
          saleStopOn: "2027-01-02",
        },
      ],
    );
    const payload = await computeCounts(db);
    expect(payload.products["prawns-and-dates"]).toEqual({
      mode: "inStock",
      count: 5,
      total: 8,
      priceInStockPaise: 64_900,
      packedOn: "2026-09-04",
      bestBefore: "2027-03-04",
      saleStopOn: "2027-01-02",
    });
  });

  it("computes an open entry: count is jars paid, total is bookable jars", async () => {
    const db = fakeDb(
      [product("squid-and-dates")],
      [
        {
          id: "b2",
          productSlug: "squid-and-dates",
          state: "open",
          bookableJars: 13,
          paidCount: 5,
          priceOpen: 59_900,
        },
      ],
    );
    const payload = await computeCounts(db);
    expect(payload.products["squid-and-dates"]).toEqual({
      mode: "open",
      count: 5,
      total: 13,
      priceOpenPaise: 59_900,
    });
  });

  it("a live hold takes a jar out of the shown in-stock count", async () => {
    const future = Date.now() + 60_000;
    const db = fakeDb(
      [product("beef-and-dates")],
      [
        {
          id: "b3",
          productSlug: "beef-and-dates",
          state: "bottled",
          bottledJars: 10,
          paidCount: 2,
          heldJars: { "ord-1": { qty: 3, expiresAt: future } },
        },
      ],
    );
    const payload = await computeCounts(db);
    expect(payload.products["beef-and-dates"]).toMatchObject({ mode: "inStock", count: 5, total: 10 });
  });

  it("an expired hold no longer counts against availability", async () => {
    const past = Date.now() - 60_000;
    const db = fakeDb(
      [product("beef-and-dates")],
      [
        {
          id: "b3",
          productSlug: "beef-and-dates",
          state: "bottled",
          bottledJars: 10,
          paidCount: 2,
          heldJars: { "ord-1": { qty: 3, expiresAt: past } },
        },
      ],
    );
    const payload = await computeCounts(db);
    expect(payload.products["beef-and-dates"]).toMatchObject({ count: 8 });
  });

  it("sold out is a real count and still draws: zero available, not none", async () => {
    const db = fakeDb(
      [product("koorka")],
      [{ id: "b4", productSlug: "koorka", state: "soldOut", bottledJars: 15, paidCount: 15 }],
    );
    const payload = await computeCounts(db);
    // soldOut is not in BATCH_STATES_IN_STOCK or OPEN_FOR_BOOKING, so it is
    // not a "visible" state at all: brief 6.2/D3 say the card flips to the
    // next batch, which for a product with only a sold-out batch left is
    // "none" rather than a stale zero from a batch already closed out.
    expect(payload.products.koorka).toEqual({ mode: "none" });
  });

  it("an in-stock batch outranks an open batch for the same product", async () => {
    const db = fakeDb(
      [product("prawns-and-dates")],
      [
        { id: "open1", productSlug: "prawns-and-dates", state: "open", bookableJars: 9, paidCount: 1 },
        {
          id: "stock1",
          productSlug: "prawns-and-dates",
          state: "inStock",
          bottledJars: 4,
          paidCount: 0,
        },
      ],
    );
    const payload = await computeCounts(db);
    expect(payload.products["prawns-and-dates"].mode).toBe("inStock");
  });

  it("between two same-tier batches, the one with more available wins", async () => {
    const db = fakeDb(
      [product("prawns-and-dates")],
      [
        { id: "a", productSlug: "prawns-and-dates", state: "bottled", bottledJars: 5, paidCount: 5 },
        { id: "b", productSlug: "prawns-and-dates", state: "inStock", bottledJars: 6, paidCount: 1 },
      ],
    );
    const payload = await computeCounts(db);
    expect(payload.products["prawns-and-dates"]).toMatchObject({ count: 5, total: 6 });
  });

  it("never returns a total below 1, even for a zero-jar batch", async () => {
    const db = fakeDb(
      [product("prawns-and-dates")],
      [{ id: "a", productSlug: "prawns-and-dates", state: "open", bookableJars: 0, paidCount: 0 }],
    );
    const payload = await computeCounts(db);
    expect(payload.products["prawns-and-dates"].total).toBe(1);
  });

  it("returns {} with no products read at all when nothing is active", async () => {
    const db = fakeDb([], []);
    const payload = await computeCounts(db);
    expect(payload.products).toEqual({});
  });

  it("shipping falls back to free with no settings/shipping document at all", async () => {
    const db = fakeDb([], []);
    const payload = await computeCounts(db);
    expect(payload.shipping).toEqual({ rule: "free", flatFeePaise: 6_000 });
  });

  it("shipping reads the switch and the editable fee when the settings document says so", async () => {
    const db = fakeDb([], [], { shipping: { rule: "flatFee", flatFee: 6_000 } });
    const payload = await computeCounts(db);
    expect(payload.shipping).toEqual({ rule: "flatFee", flatFeePaise: 6_000 });
  });

  it("shipping ignores a garbage rule and falls back to free rather than guessing", async () => {
    const db = fakeDb([], [], { shipping: { rule: "surprise-charge" } });
    const payload = await computeCounts(db);
    expect(payload.shipping.rule).toBe("free");
  });
});
