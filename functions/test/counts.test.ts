/**
 * `/api/counts` against the emulator: the real HTTP route, the real
 * Firestore reads, seeded batches in real states.
 *
 * `src/api/counts.test.ts` covers `computeCounts`'s own logic (tiering,
 * holds, the total floor) against a fake Firestore and needs no emulator.
 * This file is the one that proves the whole path: Hosting rewrite shape,
 * `stripLeadingApiSegment`, the real `products`/`batches` collections, and
 * the CDN cache header, end to end.
 */
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import { clearFirestore, db, FUNCTIONS_HOST, PROJECT } from "./emulator";

async function getCounts(): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${FUNCTIONS_HOST}/${PROJECT}/asia-south1/api/counts`);
  const body = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body };
}

async function seedProduct(slug: string, active = true) {
  await db()
    .collection("products")
    .doc(slug)
    .set({
      name: slug,
      type: "hero",
      veg: false,
      hsn: "16",
      priceInStock: 64_900,
      priceOpen: 59_900,
      jarGrams: 200,
      shippingRule: "free",
      seasonStart: null,
      seasonEnd: null,
      active,
      customLines: [],
    });
}

async function seedBatch(ref: string, fields: Record<string, unknown>) {
  await db()
    .collection("batches")
    .doc(ref)
    .set({
      batchNo: null,
      productName: null,
      recipeId: "v1",
      mainIngredientName: null,
      plannedJars: 22,
      bookableJars: 19,
      perPersonLimit: 4,
      perPersonLimitOverride: null,
      priceOpen: 59_900,
      priceInStock: 64_900,
      paidCount: 0,
      heldJars: {},
      bottledJars: 0,
      writtenOff: 0,
      source: null,
      landedOn: null,
      cookedOn: null,
      packedOn: null,
      bestBefore: null,
      saleStopOn: null,
      weightRaw: null,
      weightCleaned: null,
      weightCooked: null,
      halfReachedAt: null,
      halfApprovedAt: null,
      fullReachedAt: null,
      fullApprovedAt: null,
      pausedReason: null,
      pausedFrom: null,
      costs: { jarsLids: 0, boxInserts: 0, labelling: 0, gasPower: 0 },
      pnl: {
        revenue: 0,
        ingredientCost: 0,
        packagingCost: 0,
        shippingCost: 0,
        gatewayFees: 0,
        writeOffCost: 0,
        margin: 0,
      },
      ...fields,
    });
}

describe("/api/counts, against the emulator", () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it("200s with an empty catalogue, and shipping falls back to free", async () => {
    const { status, body, headers } = await getCounts();
    expect(status).toBe(200);
    expect(body).toEqual({
      products: {},
      shipping: { rule: "free", flatFeePaise: 6_000, freeFromJars: 2 },
    });
    expect(headers.get("cache-control")).toBe("public, max-age=15, s-maxage=15");
  });

  it("reads the shipping switch from settings/shipping", async () => {
    await db().collection("settings").doc("shipping").set({ rule: "flatFee", flatFee: 6_000 });
    const { body } = await getCounts();
    expect((body as { shipping: unknown }).shipping).toEqual({
      rule: "flatFee",
      flatFeePaise: 6_000,
      freeFromJars: 2,
    });
  });

  it("reports an active product with no live batch as mode none", async () => {
    await seedProduct("koorka");
    const { body } = await getCounts();
    expect((body as { products: unknown }).products).toEqual({ koorka: { mode: "none" } });
  });

  it("reports the real, computed in-stock count for a bottled batch (never typed)", async () => {
    await seedProduct("prawns-and-dates");
    await seedBatch("b-inst01", {
      productSlug: "prawns-and-dates",
      state: "inStock",
      bottledJars: 22,
      paidCount: 3,
      packedOn: "2026-09-04",
      bestBefore: "2027-03-04",
      saleStopOn: "2027-01-02",
    });

    const { status, body } = await getCounts();
    expect(status).toBe(200);
    const entry = (body as { products: Record<string, unknown> }).products["prawns-and-dates"];
    expect(entry).toEqual({
      mode: "inStock",
      count: 19,
      total: 22,
      available: 19,
      priceInStockPaise: 64_900,
      packedOn: "2026-09-04",
      bestBefore: "2027-03-04",
      saleStopOn: "2027-01-02",
      // M3.5, brief 4.1: two jars per person online on an in-stock batch.
      perPersonLimit: 2,
      // M3.5: the product's own fee rule, which `createCheckout` enforces.
      // The checkout page has to compute the same total the server charges.
      shippingRule: "free",
    });
  });

  it("reports the real, computed open-batch count for an open batch", async () => {
    await seedProduct("squid-and-dates");
    await seedBatch("b-open01", {
      productSlug: "squid-and-dates",
      state: "open",
      bookableJars: 13,
      paidCount: 5,
    });

    const { body } = await getCounts();
    const entry = (body as { products: Record<string, unknown> }).products["squid-and-dates"];
    // M3.5: `seedBatch` stamps perPersonLimit 4, which is what the checkout
    // offers as the jar picker's ceiling on this batch (D44).
    expect(entry).toEqual({
      mode: "open",
      count: 5,
      total: 13,
      // D3: the marks are 5 paid of 13 bookable, so the free figure has to
      // be carried on its own or the jar picker offers jars that are gone.
      available: 8,
      priceOpenPaise: 59_900,
      perPersonLimit: 4,
      shippingRule: "free",
    });
  });

  it("publishes each product's own shipping rule, the one the checkout enforces", async () => {
    await seedProduct("beef-and-dates");
    await db().collection("products").doc("beef-and-dates").update({ shippingRule: "flatFee" });
    await seedBatch("b-beef01", {
      productSlug: "beef-and-dates",
      state: "inStock",
      bottledJars: 10,
      packedOn: "2026-09-04",
      saleStopOn: "2099-01-01",
    });

    const { body } = await getCounts();
    const entry = (body as { products: Record<string, { shippingRule?: string }> }).products[
      "beef-and-dates"
    ];
    expect(entry.shippingRule).toBe("flatFee");
  });

  it("a live hold is out of the available figure, on the open batch too", async () => {
    await seedProduct("squid-and-dates");
    await seedBatch("b-open02", {
      productSlug: "squid-and-dates",
      state: "open",
      bookableJars: 19,
      paidCount: 17,
      heldJars: { "o-1": { qty: 1, expiresAt: Timestamp.fromMillis(Date.now() + 60_000) } },
    });

    const { body } = await getCounts();
    const entry = (body as { products: Record<string, Record<string, unknown>> }).products[
      "squid-and-dates"
    ];
    expect(entry).toMatchObject({ count: 17, total: 19, available: 1 });
  });

  it("never leaks an inactive (pipeline) product", async () => {
    await seedProduct("duck", false);
    await seedBatch("b-duck01", { productSlug: "duck", state: "inStock", bottledJars: 5 });

    const { body } = await getCounts();
    expect((body as { products: Record<string, unknown> }).products.duck).toBeUndefined();
  });
});
