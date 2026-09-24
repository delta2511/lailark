/**
 * D41 (M2.19): Sourcing to Cooking asks for a weight and a cost per main
 * ingredient, each named, and writes one line document each.
 *
 * Brief 14.1 says "the main ingredient's" raw weight and price, which
 * assumes there is one. Batch 001's recipe names two, prawns and dates
 * (both are in the product name, so 5(2)(g) owes each a percentage), and the
 * step recorded only the first: the dates bought for the batch were never
 * costed here at all. These tests walk the real callable against the
 * emulator with a recipe of each shape behind it.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  batchDoc,
  clearFirestore,
  db,
  mustTransition,
  setPaidCount,
  transition,
  waitForState,
} from "./emulator";

const PRICE_OPEN = 59_900;
const PRICE_IN_STOCK = 64_900;

const PRAWNS = "d41-prawns";
const DATES = "d41-dates";
const VINEGAR = "d41-vinegar";

const RECIPE_TWO_MAIN = "d41-two-main";
const RECIPE_ONE_MAIN = "d41-one-main";
const RECIPE_NO_MAIN = "d41-no-main";

async function seedRecipes(): Promise<void> {
  await db()
    .collection("recipes")
    .doc(RECIPE_TWO_MAIN)
    .set({
      productSlug: "prawns-pickle",
      version: 1,
      lines: [
        { ingredientId: PRAWNS, qty: 1550, unit: "g", isMain: true },
        { ingredientId: DATES, qty: 1000, unit: "g", isMain: true },
        { ingredientId: VINEGAR, qty: 2, unit: "l", isMain: false },
      ],
    });
  await db()
    .collection("recipes")
    .doc(RECIPE_ONE_MAIN)
    .set({
      productSlug: "prawns-pickle",
      version: 1,
      lines: [
        { ingredientId: PRAWNS, qty: 1550, unit: "g", isMain: true },
        { ingredientId: VINEGAR, qty: 2, unit: "l", isMain: false },
      ],
    });
  await db()
    .collection("recipes")
    .doc(RECIPE_NO_MAIN)
    .set({
      productSlug: "prawns-pickle",
      version: 1,
      lines: [{ ingredientId: VINEGAR, qty: 2, unit: "l", isMain: false }],
    });
}

let productN = 0;

/**
 * A batch of this recipe, walked as far as Sourcing and waiting for the pot.
 *
 * Each one is a product of its own: D15 allows only one open batch per
 * product at a time, and these tests need several batches in flight.
 */
async function batchInSourcing(recipeId: string): Promise<string> {
  productN += 1;
  const created = await mustTransition("owner", {
    to: "draft",
    data: {
      productSlug: `d41-product-${productN}`,
      recipeId,
      plannedJars: 22,
      priceOpen: PRICE_OPEN,
      priceInStock: PRICE_IN_STOCK,
    },
  });
  const ref = created.ref as string;
  await mustTransition("owner", { ref, to: "open", data: {} });
  await setPaidCount(ref, 10);
  await waitForState(ref, "halfReached");
  await mustTransition("owner", { ref, to: "sourcing", data: {} });
  return ref;
}

async function lines(ref: string): Promise<Record<string, unknown>[]> {
  const snap = await db().collection("batches").doc(ref).collection("lines").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

describe("Sourcing to Cooking, with a main ingredient count", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedRecipes();
  });

  it("writes one line per main ingredient for batch 001's shape", async () => {
    const ref = await batchInSourcing(RECIPE_TWO_MAIN);

    await mustTransition("kitchen", {
      ref,
      to: "cooking",
      data: {
        landedOn: "2026-09-01",
        source: "Beypore harbour",
        mains: [
          { ingredientId: PRAWNS, weightRaw: 12_000, costRaw: 480_000 },
          { ingredientId: DATES, weightRaw: 1_000, costRaw: 30_000 },
        ],
      },
    });

    const written = await lines(ref);
    expect(written).toHaveLength(2);
    expect(written.find((line) => line.id === PRAWNS)).toMatchObject({
      ingredientId: PRAWNS,
      qtyActual: 12_000,
      costActual: 480_000,
    });
    expect(written.find((line) => line.id === DATES)).toMatchObject({
      ingredientId: DATES,
      qtyActual: 1_000,
      costActual: 30_000,
    });
    // Nothing under the id the two main lines used to share.
    expect(written.some((line) => line.id === "main")).toBe(false);

    const batch = await batchDoc(ref);
    expect(batch.state).toBe("cooking");
    // The batch's own raw weight is what was bought for it, in total.
    expect(batch.weightRaw).toBe(13_000);
  });

  it("refuses one unnamed pair of figures for a recipe with two main lines", async () => {
    const ref = await batchInSourcing(RECIPE_TWO_MAIN);

    const refused = await transition("kitchen", {
      ref,
      to: "cooking",
      data: {
        landedOn: "2026-09-01",
        source: "Beypore harbour",
        weightRaw: 12_000,
        costRaw: 480_000,
      },
    });
    expect(refused.result).toBeUndefined();
    expect(JSON.stringify(refused.error)).toContain(DATES);

    // Refused means refused: no state move and no money written anywhere.
    expect((await batchDoc(ref)).state).toBe("sourcing");
    expect(await lines(ref)).toEqual([]);
  });

  /**
   * The half of D41 most likely to break quietly. A one main recipe is every
   * batch before this task, and both shapes have to leave the same document
   * behind.
   */
  it("writes exactly what it always did for a recipe with one main ingredient", async () => {
    const flatRef = await batchInSourcing(RECIPE_ONE_MAIN);
    await mustTransition("kitchen", {
      ref: flatRef,
      to: "cooking",
      data: {
        landedOn: "2026-09-01",
        source: "Beypore harbour",
        weightRaw: 12_000,
        costRaw: 480_000,
      },
    });

    const namedRef = await batchInSourcing(RECIPE_ONE_MAIN);
    await mustTransition("kitchen", {
      ref: namedRef,
      to: "cooking",
      data: {
        landedOn: "2026-09-01",
        source: "Beypore harbour",
        mains: [{ ingredientId: PRAWNS, weightRaw: 12_000, costRaw: 480_000 }],
      },
    });

    for (const ref of [flatRef, namedRef]) {
      const written = await lines(ref);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        id: PRAWNS,
        ingredientId: PRAWNS,
        qtyActual: 12_000,
        costActual: 480_000,
      });
      expect((await batchDoc(ref)).weightRaw).toBe(12_000);
    }
  });

  /**
   * Q16 is open on whether this transition should be refused for a recipe
   * that names no main ingredient. Until it is answered the behaviour is the
   * one M2.13 left: the transition is allowed and the money is recorded
   * against the placeholder line, which the actuals screen shows as recorded
   * against nothing in the recipe.
   */
  it("still records the placeholder line for a recipe with no main ingredient", async () => {
    const ref = await batchInSourcing(RECIPE_NO_MAIN);

    await mustTransition("kitchen", {
      ref,
      to: "cooking",
      data: {
        landedOn: "2026-09-01",
        source: "Beypore harbour",
        weightRaw: 12_000,
        costRaw: 480_000,
      },
    });

    expect(await lines(ref)).toMatchObject([
      { id: "main", ingredientId: "main", qtyActual: 12_000, costActual: 480_000 },
    ]);
    expect((await batchDoc(ref)).state).toBe("cooking");
  });
});
