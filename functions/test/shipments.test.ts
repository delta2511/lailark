/**
 * `packOrder`, `shipOrder` and `deliverOrder` against the emulators: the real
 * callables, over real HTTP, with real ID tokens carrying real role claims,
 * and real transactions on real documents.
 *
 * M4.1's own done-when: "an order walks To pack -> Delivered as Kitchen." The
 * one that matters most beyond that walk is jar numbers under contention:
 * CLAUDE.md section 3 says counts change only inside a transaction, and A228
 * says a numbered resource is only ever consumed and its counter advanced
 * together, so two Kitchen phones packing two different orders out of the
 * same batch at the same moment must never be handed the same jar number.
 */

import { PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE } from "@lailark/shared";
import { beforeAll, describe, expect, it } from "vitest";

import { batchDoc, callFunction, clearFirestore, db, mustTransition, setPaidCount, waitForState, type Who } from "./emulator";

const PRODUCT = "prawns-pickle";
const PRODUCT_NAME = "Prawns and dates";
const ASHA = "+919000001111";

async function seedProduct() {
  await db()
    .collection("products")
    .doc(PRODUCT)
    .set({
      name: PRODUCT_NAME,
      type: "hero",
      veg: false,
      hsn: "16052900",
      priceInStock: PRICE_IN_STOCK_PAISE,
      priceOpen: PRICE_OPEN_PAISE,
      jarGrams: 200,
      shippingRule: "free",
      seasonStart: null,
      seasonEnd: null,
      active: true,
      customLines: [],
    });
}

async function seedCustomer(phone: string, name: string) {
  await db()
    .collection("customers")
    .doc(phone)
    .set({
      name,
      email: null,
      country: "IN",
      consents: {
        updates: { given: false, at: null, by: null },
        marketing: { given: false, at: null, by: null },
      },
      shareCode: null,
      stats: { orders: 0, jars: 0, lastOrderAt: null },
      createdAt: new Date(),
      createdBy: "seed",
      updatedAt: new Date(),
      updatedBy: "seed",
    });
}

/** Walks a fresh batch all the way to a bottled, in-stock batch. */
async function inStockBatch(slug: string, jarCount = 22): Promise<string> {
  const created = await mustTransition("owner", {
    to: "draft",
    data: {
      productSlug: slug,
      recipeId: `${slug}-v1`,
      plannedJars: 22,
      priceOpen: PRICE_OPEN_PAISE,
      priceInStock: PRICE_IN_STOCK_PAISE,
    },
  });
  const ref: string = created.ref;
  await mustTransition("owner", { ref, to: "open", data: {} });
  await setPaidCount(ref, 10);
  await waitForState(ref, "halfReached");
  await mustTransition("owner", { ref, to: "sourcing", data: {} });
  await mustTransition("kitchen", {
    ref,
    to: "cooking",
    data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
  });
  await mustTransition("kitchen", {
    ref,
    to: "bottled",
    data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount, packedOn: "2026-09-04" },
  });
  await waitForState(ref, "inStock", "bottled", "soldOut");
  return ref;
}

/**
 * Every sale below names its own batch reference explicitly (never `null`,
 * "let the planner choose") because several tests share one product slug and
 * one customer across a single `beforeAll`: an auto-chosen batch would let
 * one test's jars count against another test's per-person limit the moment
 * two in-stock batches of the same product are on sale at once, which is
 * exactly what brief 7.2 step 3's "across all their orders in this batch"
 * cap is for. Naming the batch keeps each test's jars in its own batch.
 */
function saleData(batchRef: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerPhone: ASHA,
    customerName: "Asha",
    confirmNewCustomer: false,
    line: { kind: "product", productSlug: PRODUCT, batchRef, qty: 1 },
    discountPaise: 0,
    discountReason: "",
    fulfilment: "ship",
    deliveryContact: {
      name: "Asha",
      phone: "9000001111",
      lines: ["12 Beach Road"],
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673001",
    },
    paymentMethod: "cash",
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    ...overrides,
  };
}

async function sellToPack(who: Who, batchRef: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const out = await callFunction("createCounterSale", who, saleData(batchRef, overrides));
  if (!out.result) throw new Error(`createCounterSale failed: ${JSON.stringify(out.error)}`);
  const result = out.result as Record<string, unknown>;
  return result.orderId as string;
}

async function orderDoc(orderId: string) {
  const snap = await db().collection("orders").doc(orderId).get();
  return snap.data() as Record<string, unknown>;
}

async function shipmentDoc(orderId: string) {
  const snap = await db().collection("shipments").doc(orderId).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

describe("packOrder, shipOrder, deliverOrder", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
  });

  it("walks an order To pack -> Packed -> Shipped -> Delivered, as Kitchen (M4.1 done-when)", async () => {
    const ref = await inStockBatch(PRODUCT);
    const orderId = await sellToPack("kitchen", ref);

    const before = await orderDoc(orderId);
    expect(before.state).toBe("toPack");

    const packed = await callFunction("packOrder", "kitchen", { orderId, packingCostPaise: 5000 });
    expect(packed.result).toMatchObject({ state: "packed" });

    const afterPack = await orderDoc(orderId);
    expect(afterPack.state).toBe("packed");
    const lines = afterPack.lines as Array<{ jarNumbers: number[] }>;
    expect(lines[0].jarNumbers.length).toBe(1);
    expect(lines[0].jarNumbers[0]).toBeGreaterThan(0);

    const shipment = await shipmentDoc(orderId);
    expect(shipment).toMatchObject({ packingCost: 5000, status: "created", courier: "indiaPost" });

    const shipped = await callFunction("shipOrder", "kitchen", {
      orderId,
      consignmentNumber: "EE123456789IN",
    });
    expect(shipped.result).toMatchObject({ state: "shipped", awb: "EE123456789IN" });

    const afterShip = await orderDoc(orderId);
    expect(afterShip.state).toBe("shipped");
    const shipmentAfterShip = await shipmentDoc(orderId);
    expect(shipmentAfterShip).toMatchObject({ awb: "EE123456789IN", status: "picked" });

    const delivered = await callFunction("deliverOrder", "kitchen", { orderId });
    expect(delivered.result).toMatchObject({ state: "delivered" });

    const afterDeliver = await orderDoc(orderId);
    expect(afterDeliver.state).toBe("delivered");
    const shipmentAfterDeliver = await shipmentDoc(orderId);
    expect(shipmentAfterDeliver?.status).toBe("delivered");
    expect(shipmentAfterDeliver?.deliveredAt).toBeTruthy();
  });

  it("delivers a hand-delivered order straight from packed, with no courier at all", async () => {
    const ref = await inStockBatch(PRODUCT);
    const orderId = await sellToPack("owner", ref, { fulfilment: "handedOver", deliveryContact: null });

    // handedOver pays into "delivered" directly at the counter sale (brief
    // 7A.2), so this order never sees "packed" through a normal sale. To
    // exercise the packed -> delivered hand-delivery path this test packs it
    // by hand first (state forced to toPack), which is a fixture concern, not
    // a claim about a real order ever needing it.
    await db().collection("orders").doc(orderId).update({ state: "toPack", fulfilment: "handedOver" });
    await callFunction("packOrder", "owner", { orderId });
    const delivered = await callFunction("deliverOrder", "owner", { orderId });
    expect(delivered.result).toMatchObject({ state: "delivered" });
  });

  it("refuses a bad India Post consignment number", async () => {
    const ref = await inStockBatch(PRODUCT);
    const orderId = await sellToPack("kitchen", ref);
    await callFunction("packOrder", "kitchen", { orderId });
    const out = await callFunction("shipOrder", "kitchen", { orderId, consignmentNumber: "not-a-number" });
    expect(out.result).toBeUndefined();
    expect(out.error?.status).toBe("INVALID_ARGUMENT");
  });

  it("refuses a Viewer: packing is a staff job", async () => {
    const ref = await inStockBatch(PRODUCT);
    const orderId = await sellToPack("kitchen", ref);
    const out = await callFunction("packOrder", "viewer", { orderId });
    expect(out.result).toBeUndefined();
  });

  it("two Kitchen phones packing two different orders out of the same batch never share a jar number", async () => {
    const ref = await inStockBatch(PRODUCT, 22);
    const orderA = await sellToPack("kitchen", ref);
    const orderB = await sellToPack("kitchen", ref);

    const [a, b] = await Promise.all([
      callFunction("packOrder", "kitchen", { orderId: orderA, packingCostPaise: 1000 }),
      callFunction("packOrder", "kitchen", { orderId: orderB, packingCostPaise: 1000 }),
    ]);

    expect(a.result).toBeTruthy();
    expect(b.result).toBeTruthy();

    const orderADoc = await orderDoc(orderA);
    const orderBDoc = await orderDoc(orderB);
    const jarsA = (orderADoc.lines as Array<{ jarNumbers: number[] }>).flatMap((l) => l.jarNumbers);
    const jarsB = (orderBDoc.lines as Array<{ jarNumbers: number[] }>).flatMap((l) => l.jarNumbers);

    expect(jarsA.length).toBe(1);
    expect(jarsB.length).toBe(1);
    // The one property that must hold under contention: no jar number twice.
    expect(new Set([...jarsA, ...jarsB]).size).toBe(2);

    const batch = await batchDoc(ref);
    expect(batch.jarsAssigned).toBe(2);
  });
});
