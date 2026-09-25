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

function product(slug: string, active = true, over: Record<string, unknown> = {}) {
  // Every product `seed-products.mjs` writes carries a `shippingRule`, so
  // "free" is the fixture and a missing rule is the exception.
  return { id: slug, active, name: slug, shippingRule: "free", ...over };
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
      available: 5,
      priceInStockPaise: 64_900,
      packedOn: "2026-09-04",
      bestBefore: "2027-03-04",
      saleStopOn: "2027-01-02",
      // M3.5, brief 4.1: two jars per person online on an in-stock batch.
      perPersonLimit: 2,
      shippingRule: "free",
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
      // D3: the marks total is the bookable jars, and `count` is the paid
      // ones, so `available` is the only field that knows what is free.
      total: 13,
      available: 8,
      priceOpenPaise: 59_900,
      // M3.5, D52: nothing was stamped on this batch and nothing was typed,
      // so it resolves to nothing, exactly as the hold resolves it. There is
      // no floor of one here: a floor only on this side promised a jar the
      // transaction was about to refuse.
      perPersonLimit: 0,
      shippingRule: "free",
    });
  });

  it("an in-stock entry lets the Owner's typed cap stand, above two and below it (D52)", async () => {
    const base = {
      id: "b1",
      productSlug: "prawns-and-dates" as const,
      state: "inStock" as const,
      bottledJars: 22,
      paidCount: 0,
      priceInStock: 64_900,
      perPersonLimit: 4,
      packedOn: "2026-09-04",
      bestBefore: "2027-03-04",
      saleStopOn: "2027-01-02",
    };
    const limitFor = async (perPersonLimitOverride: unknown) => {
      const payload = await computeCounts(
        fakeDb([product("prawns-and-dates")], [{ ...base, perPersonLimitOverride }]),
      );
      return payload.products["prawns-and-dates"].perPersonLimit;
    };

    // The number typed in the admin governs the site, in both directions.
    expect(await limitFor(5)).toBe(5);
    expect(await limitFor(1)).toBe(1);
    expect(await limitFor(2)).toBe(2);
    // Blank, or junk, is brief 4.1's two jars, never the quarter of 4.
    for (const blank of [null, undefined, 0, -5, 1.5, "lots"]) {
      expect(await limitFor(blank), `override ${JSON.stringify(blank)}`).toBe(2);
    }
  });

  it("an open entry carries the batch's own per-person cap, override and all (D44)", async () => {
    const base = {
      id: "b2",
      productSlug: "squid-and-dates",
      state: "open" as const,
      bookableJars: 18,
      paidCount: 5,
      priceOpen: 59_900,
    };
    const computed = await computeCounts(
      fakeDb([product("squid-and-dates")], [{ ...base, perPersonLimit: 4 }]),
    );
    expect(computed.products["squid-and-dates"].perPersonLimit).toBe(4);

    const overridden = await computeCounts(
      fakeDb(
        [product("squid-and-dates")],
        [{ ...base, perPersonLimit: 4, perPersonLimitOverride: 2 }],
      ),
    );
    expect(overridden.products["squid-and-dates"].perPersonLimit).toBe(2);
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
          packedOn: "2026-09-04",
          saleStopOn: "2099-01-01",
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
    expect(payload.shipping).toEqual({ rule: "free", flatFeePaise: 6_000, freeFromJars: 2 });
  });

  it("shipping reads the switch and the editable fee when the settings document says so", async () => {
    const db = fakeDb([], [], { shipping: { rule: "flatFee", flatFee: 6_000 } });
    const payload = await computeCounts(db);
    expect(payload.shipping).toEqual({ rule: "flatFee", flatFeePaise: 6_000, freeFromJars: 2 });
  });

  it("shipping carries the freeOnTwo threshold the Owner set, so the page's sum matches the server's", async () => {
    const db = fakeDb([], [], {
      shipping: { rule: "freeOnTwo", flatFee: 6_000, freeFromJars: 3 },
    });
    const payload = await computeCounts(db);
    expect(payload.shipping).toEqual({
      rule: "freeOnTwo",
      flatFeePaise: 6_000,
      freeFromJars: 3,
    });
  });

  /* ------------------------------------------------------------------ */
  /* M3.5 round 2: the three places the page and the server could drift  */
  /* ------------------------------------------------------------------ */

  it("publishes the product's own shipping rule, which is what the server enforces", async () => {
    const db = fakeDb(
      [product("beef-and-dates", true, { shippingRule: "flatFee" })],
      [
        {
          id: "b1",
          productSlug: "beef-and-dates",
          state: "inStock",
          bottledJars: 8,
          paidCount: 0,
          saleStopOn: "2099-01-01",
        },
      ],
    );
    const payload = await computeCounts(db);
    // `createCheckout` reads `products/{slug}.shippingRule` and refuses any
    // order whose total differs from the page's. Without this field the page
    // computed the global rule for every product, so the day the global
    // switch left "free" every order on a product with a rule of its own was
    // refused at the Pay button (brief 4.2).
    expect(payload.products["beef-and-dates"].shippingRule).toBe("flatFee");
  });

  it("hands on no rule at all for a product that carries none, rather than inventing one", async () => {
    const db = fakeDb(
      [{ id: "koorka", active: true, name: "Koorka" }],
      [{ id: "b1", productSlug: "koorka", state: "open", bookableJars: 8, paidCount: 0 }],
    );
    const payload = await computeCounts(db);
    expect(payload.products.koorka.shippingRule).toBeNull();
  });

  it("does not show a batch the checkout would refuse to sell, brief 6.2", async () => {
    // The in-stock batch is past its shelf-life stop, so `chooseWebBatch`
    // will not sell it and the hold lands in the open batch behind it. The
    // count has to belong to the same batch, or the customer reads one
    // batch's jars, price and dates and is sold another's.
    const db = fakeDb(
      [product("prawns-and-dates")],
      [
        {
          id: "stale",
          productSlug: "prawns-and-dates",
          state: "inStock",
          bottledJars: 9,
          paidCount: 0,
          packedOn: "2026-01-01",
          saleStopOn: "2026-02-01",
        },
        {
          id: "open1",
          productSlug: "prawns-and-dates",
          state: "open",
          bookableJars: 9,
          paidCount: 1,
          perPersonLimit: 2,
        },
      ],
    );
    const payload = await computeCounts(db);
    expect(payload.products["prawns-and-dates"]).toMatchObject({ mode: "open", count: 1 });
  });

  it("still draws the only batch there is when none of them may be sold online", async () => {
    // Nothing left to sell, but the page still needs this batch's dates and
    // its count to say so. `canBuyToday` is what hides the Buy control.
    const db = fakeDb(
      [product("prawns-and-dates")],
      [
        {
          id: "stale",
          productSlug: "prawns-and-dates",
          state: "inStock",
          bottledJars: 9,
          paidCount: 0,
          packedOn: "2026-01-01",
          bestBefore: "2026-07-01",
          saleStopOn: "2026-02-01",
        },
      ],
    );
    const payload = await computeCounts(db);
    expect(payload.products["prawns-and-dates"]).toMatchObject({
      mode: "inStock",
      count: 9,
      saleStopOn: "2026-02-01",
    });
  });

  it("counts a live hold out of an open batch's available, not only out of its paid marks", async () => {
    const db = fakeDb(
      [product("squid-and-dates")],
      [
        {
          id: "b2",
          productSlug: "squid-and-dates",
          state: "open",
          bookableJars: 19,
          paidCount: 17,
          perPersonLimit: 4,
          heldJars: { "ord-1": { qty: 1, expiresAt: Date.now() + 60_000 } },
        },
      ],
    );
    const payload = await computeCounts(db);
    // 19 bookable, 17 paid, one being paid for right now: one jar is free,
    // not two. The marks still read 17 of 19 (D3).
    expect(payload.products["squid-and-dates"]).toMatchObject({
      count: 17,
      total: 19,
      available: 1,
    });
  });

  it("shipping ignores a garbage rule and falls back to free rather than guessing", async () => {
    const db = fakeDb([], [], { shipping: { rule: "surprise-charge" } });
    const payload = await computeCounts(db);
    expect(payload.shipping.rule).toBe("free");
  });
});
