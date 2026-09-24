/**
 * `createCounterSale` and `voidCounterSale` against the emulators: the real
 * callables, over real HTTP, with real ID tokens carrying real role claims,
 * and real transactions on real documents.
 *
 * The one that matters most is "the last jar at the counter": two callers,
 * one jar, and exactly one of them wins. Everything else in this file is a
 * line of brief 7A.1 or 7A.6 checked where it is actually enforced, which is
 * the server, not the screen. A screen with no discount box on it proves
 * nothing: the Kitchen's phone can post straight to the callable, so these
 * tests do exactly that.
 */

import { liveHeldJars, PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE } from "@lailark/shared";
import { beforeAll, describe, expect, it } from "vitest";

import {
  batchDoc,
  callFunction,
  clearFirestore,
  db,
  mustTransition,
  setPaidCount,
  waitForState,
  type Who,
} from "./emulator";

const PRODUCT = "prawns-pickle";
const PRODUCT_NAME = "Prawns and dates";

const ASHA = "+919000001111";
const RAVI = "+919000002222";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

async function seedProduct(customLines: Array<{ description: string; amountPaise: number }> = []) {
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
      customLines,
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

/** Sets the count so exactly `free` jars are left in stock on `ref`. */
async function leaveJarsFree(ref: string, free: number): Promise<void> {
  const bottledJars = (await batchDoc(ref)).bottledJars as number;
  await db().collection("batches").doc(ref).update({ paidCount: bottledJars - free, heldJars: {} });
}

function saleData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerPhone: ASHA,
    customerName: "Asha",
    confirmNewCustomer: false,
    line: { kind: "product", productSlug: PRODUCT, batchRef: null, qty: 1 },
    discountPaise: 0,
    discountReason: "",
    fulfilment: "handedOver",
    paymentMethod: "cash",
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    ...overrides,
  };
}

function sell(who: Who | null, overrides: Record<string, unknown> = {}) {
  return callFunction("createCounterSale", who, saleData(overrides));
}

async function mustSell(who: Who, overrides: Record<string, unknown> = {}) {
  const out = await sell(who, overrides);
  if (!out.result) throw new Error(`createCounterSale failed: ${JSON.stringify(out.error)}`);
  return out.result as Record<string, unknown>;
}

async function orderDoc(orderId: string) {
  const snap = await db().collection("orders").doc(orderId).get();
  const data = snap.data();
  if (!data) throw new Error(`no order ${orderId}`);
  return data;
}

/**
 * Every paise figure an order carries, by name: the line prices, the totals,
 * the shipping fee, the discount and the payment. Nothing else on the
 * document is money, so nothing else belongs in a check about money.
 */
function moneyFieldsOf(order: Record<string, unknown>): number[] {
  const payment = (order.payment ?? {}) as Record<string, unknown>;
  const discount = (order.discount ?? null) as Record<string, unknown> | null;
  const lines = (order.lines ?? []) as Array<Record<string, unknown>>;
  return [
    ...lines.map((line) => line.unitPrice),
    order.total,
    order.shippingFee,
    payment.amount,
    payment.refundedAmount,
    discount?.amount,
  ].filter((value): value is number => typeof value === "number");
}

async function auditFor(object: string) {
  const found = await db().collection("audit").where("object", "==", object).get();
  return found.docs.map((doc) => doc.data());
}

/* -------------------------------------------------------------------------- */
/* The whole of the done-when, on the server                                  */
/* -------------------------------------------------------------------------- */

describe("a jar sold for cash", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 5);
  });

  it("writes the order, moves the batch count, and leaves a trail on all three", async () => {
    const before = await batchDoc(ref);
    const sale = await mustSell("kitchen", { line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 } });

    expect(sale.total).toBe(PRICE_IN_STOCK_PAISE);
    expect(sale.paid).toBe(true);
    expect(sale.batchRef).toBe(ref);

    // The order.
    const order = await orderDoc(sale.orderId as string);
    expect(order.channel).toBe("counter");
    expect(order.state).toBe("delivered");
    expect(order.customerPhone).toBe(ASHA);
    expect(order.total).toBe(PRICE_IN_STOCK_PAISE);
    expect(order.batchRefs).toEqual([ref]);
    expect((order.payment as Record<string, unknown>).status).toBe("captured");
    expect((order.payment as Record<string, unknown>).amount).toBe(PRICE_IN_STOCK_PAISE);
    expect(order.paidAt).toBeTruthy();
    expect(order.billSentAt).toBeNull();

    // The batch count, moved by exactly one jar.
    const after = await batchDoc(ref);
    expect(after.paidCount).toBe((before.paidCount as number) + 1);

    // The customer.
    const customer = (await db().collection("customers").doc(ASHA).get()).data() ?? {};
    expect((customer.stats as Record<string, number>).orders).toBe(1);
    expect((customer.stats as Record<string, number>).jars).toBe(1);
    expect(((customer.consents as Record<string, Record<string, unknown>>).updates).given).toBe(true);

    // The trail, on all three documents, all from the same commit.
    expect(await auditFor(`orders/${sale.orderId}`)).toHaveLength(1);
    expect((await auditFor(`customers/${ASHA}`))[0].action).toBe("counterSale");
    const batchTrail = await auditFor(`batches/${ref}`);
    const sold = batchTrail.filter((entry) => entry.action === "counterSale");
    expect(sold).toHaveLength(1);
    expect((sold[0].after as Record<string, number>).paidCount).toBe(after.paidCount);
  });

  it("writes nothing to orders/{id}/events, because Q14 is open", async () => {
    const orders = await db().collection("orders").limit(1).get();
    const events = await orders.docs[0].ref.collection("events").get();
    expect(events.empty).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The race: two callers, one jar                                             */
/* -------------------------------------------------------------------------- */

describe("the last jar at the counter", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    await seedCustomer(RAVI, "Ravi");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 1);
  });

  it("is sold to exactly one of two people saving at the same moment", async () => {
    const both = await Promise.all([
      sell("kitchen", {
        customerPhone: ASHA,
        line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
      }),
      sell("owner", {
        customerPhone: RAVI,
        customerName: "Ravi",
        line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
      }),
    ]);

    const won = both.filter((out) => out.result);
    const lost = both.filter((out) => !out.result);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    // Brief 7A.1 step 7: a line a person can act on, not an error code.
    const message = lost[0].error?.message ?? "";
    expect(message).toMatch(/someone just bought the last one|someone took the last jar/i);
    // Either branch of the race reads as one sentence about the jar that has
    // gone, never as a switch being off: "someone just bought the last one"
    // if the batch is still in stock when the loser retries, "someone took
    // the last jar" once the automatic row in brief 8.2 has moved it to sold
    // out. Nothing a person reads is ever a code or a count on its own.
    expect(message).not.toMatch(/ABORTED|INTERNAL|undefined|NaN/);

    // The count never went past what the batch had.
    const after = await batchDoc(ref);
    const held = liveHeldJars(after.heldJars as never, Date.now());
    expect((after.paidCount as number) + held).toBeLessThanOrEqual(
      (after.bottledJars as number) - (after.writtenOff as number),
    );

    // Exactly one order exists, and it is the winner's.
    const orders = await db().collection("orders").get();
    expect(orders.size).toBe(1);
    expect(orders.docs[0].id).toBe((won[0].result as Record<string, unknown>).orderId);

    // And the loser wrote nothing at all: no order, and no half-made
    // customer either.
    const trail = await auditFor(`batches/${ref}`);
    expect(trail.filter((entry) => entry.action === "counterSale")).toHaveLength(1);
  });

  it("refuses the next sale outright, with the same plain line", async () => {
    const out = await sell("kitchen", {
      customerPhone: ASHA,
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(
      /someone just bought the last one|sold out: someone took the last jar/i,
    );
  });

});

/**
 * The other half of the same sentence. A batch that still has jars, but fewer
 * than were asked for, counts them out loud and counts them in English: the
 * line this replaced read "This batch has 1 jars free", which is the sort of
 * sentence that makes a person distrust the rest of the screen.
 */
describe("a batch with fewer jars than were asked for", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 1);
  });

  it("says how many it does have, in words that read", async () => {
    const out = await sell("kitchen", {
      customerPhone: ASHA,
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 2 },
    });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toBe("There is only 1 jar free on this batch.");
  });
});

/* -------------------------------------------------------------------------- */
/* The discount cap, decision D17, enforced on the server                     */
/* -------------------------------------------------------------------------- */

describe("the discount cap, on the server and not on the screen", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 10);
  });

  const discounted = (discountPaise: number) => ({
    line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    discountPaise,
    discountReason: "regular customer",
    expectedTotalPaise: PRICE_IN_STOCK_PAISE - discountPaise,
  });

  it("refuses the Kitchen any discount while no cap is set (D17 ships empty)", async () => {
    const out = await sell("kitchen", discounted(5_000));
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/has not set a discount cap/);
  });

  it("lets the Kitchen go up to the cap once the Owner sets one", async () => {
    await db().collection("settings").doc("discountCap").set({ kitchenCap: 5_000, reasonRequired: true });
    const sale = await mustSell("kitchen", discounted(5_000));
    expect(sale.total).toBe(PRICE_IN_STOCK_PAISE - 5_000);
    const order = await orderDoc(sale.orderId as string);
    expect(order.discount).toMatchObject({ amount: 5_000, reason: "regular customer" });
  });

  it("stops the Kitchen one paisa past the cap, called straight at the callable", async () => {
    const out = await sell("kitchen", discounted(5_001));
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/discount cap is ₹50/);
  });

  it("cannot be widened by the request: the cap is read from Settings", async () => {
    const out = await callFunction("createCounterSale", "kitchen", {
      ...saleData(discounted(50_000)),
      // Every shape somebody might try to smuggle a bigger cap in with.
      kitchenCap: 60_000,
      discountCap: 60_000,
      rights: { maxDiscount: null },
      role: "owner",
    });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/discount cap is ₹50/);
  });

  it("lets the Owner give more than the cap, with a reason", async () => {
    const sale = await mustSell("owner", discounted(20_000));
    expect(sale.discount).toBe(20_000);
  });

  it("refuses even the Owner a discount with no reason", async () => {
    const out = await sell("owner", { ...discounted(20_000), discountReason: "" });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/say why/);
  });
});

/* -------------------------------------------------------------------------- */
/* Payment link: an Awaiting payment order, and no money                      */
/* -------------------------------------------------------------------------- */

describe("a payment link", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 5);
  });

  it("holds the jar and takes nothing, waiting as Awaiting payment", async () => {
    const before = await batchDoc(ref);
    const sale = await mustSell("kitchen", {
      paymentMethod: "paymentLink",
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });

    expect(sale.paid).toBe(false);
    expect(sale.state).toBe("awaitingPayment");

    const order = await orderDoc(sale.orderId as string);
    expect((order.payment as Record<string, unknown>).amount).toBe(0);
    expect((order.payment as Record<string, unknown>).status).toBe("created");
    expect(order.paidAt).toBeUndefined();
    expect(order.holdExpiresAt).toBeTruthy();

    // The jar is out of the count, but as a hold, not as money in.
    const after = await batchDoc(ref);
    expect(after.paidCount).toBe(before.paidCount);
    expect(liveHeldJars(after.heldJars as never, Date.now())).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* A number typed wrong, brief 7A.1 step 1                                    */
/* -------------------------------------------------------------------------- */

describe("a number that has never bought from us", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    const ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 5);
  });

  it("stops the sale and names the customer it is one digit from", async () => {
    // ASHA is +919000001111; this is the same with one digit changed.
    const out = await sell("kitchen", { customerPhone: "+919000001112", customerName: "Asha" });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/one digit from Asha/);
    expect(out.error?.message).toContain(ASHA);
    // Nothing at all was written: no stranger, and no stock moved.
    expect((await db().collection("customers").doc("+919000001112").get()).exists).toBe(false);
    expect((await db().collection("orders").get()).empty).toBe(true);
  });

  it("stops the sale even when there is nothing near it", async () => {
    const out = await sell("kitchen", { customerPhone: "+918888777766", customerName: "Someone" });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/never bought from us/);
  });

  it("creates the customer once the person says it really is new", async () => {
    const sale = await mustSell("kitchen", {
      customerPhone: "+919000001112",
      customerName: "Aisha",
      confirmNewCustomer: true,
    });
    expect(sale.customerCreated).toBe(true);
    const created = (await db().collection("customers").doc("+919000001112").get()).data() ?? {};
    expect(created.name).toBe("Aisha");
    expect((created.stats as Record<string, number>).jars).toBe(1);
  });

  it("still refuses a new number with no name at all", async () => {
    const out = await sell("kitchen", {
      customerPhone: "+919000003333",
      customerName: "",
      confirmNewCustomer: true,
    });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/give their name/);
  });
});

/* -------------------------------------------------------------------------- */
/* Roles, brief 7A.6 and 17.12                                                */
/* -------------------------------------------------------------------------- */

describe("who may sell at the counter", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct([{ description: "Tasting pot", amountPaise: 15_000 }]);
    await seedCustomer(ASHA, "Asha");
    const ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 10);
  });

  it("refuses a Viewer", async () => {
    const out = await sell("viewer");
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/Viewer/);
  });

  it("refuses an account with no role", async () => {
    const out = await sell("noRole");
    expect(out.result).toBeUndefined();
  });

  it("refuses nobody at all", async () => {
    const out = await sell(null);
    expect(out.result).toBeUndefined();
  });

  it("lets the Kitchen sell a custom line the Owner set, at his amount", async () => {
    const sale = await mustSell("kitchen", {
      line: {
        kind: "custom",
        productSlug: PRODUCT,
        batchRef: null,
        qty: 1,
        customDescription: "Tasting pot",
        amountPaise: 15_000,
      },
      expectedTotalPaise: 15_000,
    });
    expect(sale.total).toBe(15_000);
    expect(sale.batchRef).toBeNull();
  });

  it("refuses the Kitchen a custom line at an amount the Owner never set", async () => {
    const out = await sell("kitchen", {
      line: {
        kind: "custom",
        productSlug: PRODUCT,
        batchRef: null,
        qty: 1,
        customDescription: "Tasting pot",
        amountPaise: 1_000,
      },
      expectedTotalPaise: 1_000,
    });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/not one of the custom lines/);
  });

  /**
   * Brief 7A.6 and 17.12: "Override the per-person limit" is the Owner's row
   * alone. The Kitchen's phone can put the flag on the request with no screen
   * in the way, so this posts exactly that, and expects it refused whether or
   * not the limit would have bitten. A right that is only absent from a form
   * is not a right that is enforced.
   */
  it("refuses the Kitchen the per-person limit override, flag and all", async () => {
    const before = await db().collection("orders").get();
    const out = await sell("kitchen", { overrideLimit: true });
    expect(out.result).toBeUndefined();
    expect(out.error?.status).toBe("PERMISSION_DENIED");
    expect(out.error?.message).toMatch(/per-person limit/);
    // And the refusal left nothing behind: no order, and no jar off the batch.
    expect((await db().collection("orders").get()).size).toBe(before.size);
  });

  it("lets the Owner take it, and the order says he did", async () => {
    const sale = await mustSell("owner", { overrideLimit: true });
    expect(sale.limitOverridden).toBe(true);
    const order = await orderDoc(sale.orderId as string);
    expect(order.limitOverridden).toBe(true);
  });

  it("refuses the Kitchen a price change, even to a lower price", async () => {
    const out = await sell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: null, qty: 1, unitPricePaise: 50_000 },
      expectedTotalPaise: 50_000,
    });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/Only Shefin can change a jar's price/);
  });
});

/* -------------------------------------------------------------------------- */
/* No surprise charge                                                         */
/* -------------------------------------------------------------------------- */

describe("what the screen showed", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    const ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 5);
  });

  it("refuses the sale rather than charging a number nobody was shown", async () => {
    const out = await sell("kitchen", { expectedTotalPaise: 10_000 });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/This now comes to ₹649, not ₹100/);
    expect((await db().collection("orders").get()).empty).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The batch the server suggests, brief 7A.1 step 2                           */
/* -------------------------------------------------------------------------- */

describe("which batch the jar comes from", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
  });

  it("takes the oldest in-stock batch when the screen names none", async () => {
    const newer = await inStockBatch(PRODUCT, 20);
    const older = await inStockBatch(PRODUCT, 18);
    await db().collection("batches").doc(newer).update({ packedOn: "2026-12-01" });
    await db().collection("batches").doc(older).update({ packedOn: "2026-09-04" });
    await leaveJarsFree(newer, 5);
    await leaveJarsFree(older, 5);

    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: null, qty: 1 },
    });
    expect(sale.batchRef).toBe(older);
  });

  it("never quietly books an open batch when nothing is in stock", async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    const created = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: PRODUCT,
        recipeId: `${PRODUCT}-v1`,
        plannedJars: 22,
        priceOpen: PRICE_OPEN_PAISE,
        priceInStock: PRICE_IN_STOCK_PAISE,
      },
    });
    await mustTransition("owner", { ref: created.ref, to: "open", data: {} });

    const out = await sell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: null, qty: 1 },
    });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/no Prawns and dates in stock/);
    expect(out.error?.message).toMatch(/booked at the open price instead/);
  });
});

/* -------------------------------------------------------------------------- */
/* Voiding, brief 7A.6                                                        */
/* -------------------------------------------------------------------------- */

describe("voiding a sale entered by mistake", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 5);
  });

  it("puts the jar back, and both the sale and the void are in the trail", async () => {
    const before = await batchDoc(ref);
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    expect((await batchDoc(ref)).paidCount).toBe((before.paidCount as number) + 1);

    const voided = await callFunction("voidCounterSale", "kitchen", {
      orderId: sale.orderId,
      reason: "wrong number typed",
    });
    expect(voided.result, JSON.stringify(voided.error)).toBeTruthy();
    expect((voided.result as Record<string, unknown>).jarsReturned).toBe(1);

    // The jar is back.
    expect((await batchDoc(ref)).paidCount).toBe(before.paidCount);

    // The order says it was voided, and why.
    const order = await orderDoc(sale.orderId as string);
    expect(order.state).toBe("voided");
    expect(order.voidReason).toBe("wrong number typed");
    expect(order.voidedAt).toBeTruthy();
    // The payment block is untouched: it is the record of what happened.
    expect((order.payment as Record<string, unknown>).status).toBe("captured");

    // The customer's history is back where it was.
    const customer = (await db().collection("customers").doc(ASHA).get()).data() ?? {};
    expect((customer.stats as Record<string, number>).orders).toBe(0);
    expect((customer.stats as Record<string, number>).jars).toBe(0);

    // Both the sale and the void are on the trail. Nothing was rewritten.
    const orderTrail = await auditFor(`orders/${sale.orderId}`);
    expect(orderTrail.map((entry) => entry.action).sort()).toEqual(["counterSale", "counterSaleVoid"]);
    const batchTrail = await auditFor(`batches/${ref}`);
    expect(batchTrail.filter((entry) => entry.action === "counterSale")).toHaveLength(1);
    expect(batchTrail.filter((entry) => entry.action === "counterSaleVoid")).toHaveLength(1);
  });

  it("refuses a second void", async () => {
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    const first = await callFunction("voidCounterSale", "kitchen", { orderId: sale.orderId, reason: "mistake" });
    expect(first.result).toBeTruthy();
    const second = await callFunction("voidCounterSale", "kitchen", { orderId: sale.orderId, reason: "mistake" });
    expect(second.result).toBeUndefined();
    expect(second.error?.message).toMatch(/already voided/);
  });

  it("refuses a void with no reason", async () => {
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    const out = await callFunction("voidCounterSale", "kitchen", { orderId: sale.orderId, reason: "  " });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/say why/);
    await callFunction("voidCounterSale", "kitchen", { orderId: sale.orderId, reason: "tidy up" });
  });

  it("refuses once the bill has gone to the customer", async () => {
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    await db().collection("orders").doc(sale.orderId as string).update({ billSentAt: new Date() });
    const out = await callFunction("voidCounterSale", "kitchen", { orderId: sale.orderId, reason: "mistake" });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/credit note/);
  });

  it("refuses a sale entered on an earlier day", async () => {
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db().collection("orders").doc(sale.orderId as string).update({ createdAt: twoDaysAgo });
    const out = await callFunction("voidCounterSale", "kitchen", { orderId: sale.orderId, reason: "mistake" });
    expect(out.result).toBeUndefined();
    expect(out.error?.message).toMatch(/voided on the day it was entered/);
  });

  it("releases the hold on an unpaid payment link", async () => {
    const sale = await mustSell("kitchen", {
      paymentMethod: "paymentLink",
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    expect(liveHeldJars((await batchDoc(ref)).heldJars as never, Date.now())).toBeGreaterThan(0);
    const out = await callFunction("voidCounterSale", "kitchen", { orderId: sale.orderId, reason: "changed their mind" });
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();
    const after = await batchDoc(ref);
    expect((after.heldJars as Record<string, unknown>)[sale.orderId as string]).toBeUndefined();
  });

  it("refuses a Viewer", async () => {
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    const out = await callFunction("voidCounterSale", "viewer", { orderId: sale.orderId, reason: "mistake" });
    expect(out.result).toBeUndefined();
    await callFunction("voidCounterSale", "kitchen", { orderId: sale.orderId, reason: "tidy up" });
  });
});

/* -------------------------------------------------------------------------- */
/* The same sale arriving twice                                               */
/* -------------------------------------------------------------------------- */

describe("a sale that arrives twice", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 5);
  });

  /**
   * A tap delivered twice, a response lost on a slow connection after the
   * transaction had already committed, or M2.10 finalising an offline draft
   * again. All of them come back with the same `clientRef`, and all of them
   * must find the sale already made rather than make a second one.
   */
  it("is written once, whatever the reason it came back", async () => {
    const before = await batchDoc(ref);
    const clientRef = "sale-probe-once";

    const first = await mustSell("kitchen", {
      clientRef,
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    const second = await mustSell("kitchen", {
      clientRef,
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });

    expect(second.orderId).toBe(first.orderId);
    expect(second.alreadySold).toBe(true);
    expect(second.total).toBe(first.total);

    // One jar left the batch, not two.
    expect((await batchDoc(ref)).paidCount).toBe((before.paidCount as number) + 1);

    const orders = await db().collection("orders").where("clientRef", "==", clientRef).get();
    expect(orders.size).toBe(1);

    // The customer was charged once and counted once.
    const customer = (await db().collection("customers").doc(ASHA).get()).data() ?? {};
    expect((customer.stats as Record<string, unknown>).orders).toBe(1);
  });

  it("still writes two orders for two genuinely different sales", async () => {
    const before = await batchDoc(ref);
    const a = await mustSell("kitchen", {
      clientRef: "sale-probe-a",
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    const b = await mustSell("kitchen", {
      clientRef: "sale-probe-b",
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    expect(b.orderId).not.toBe(a.orderId);
    expect(b.alreadySold).toBe(false);
    expect((await batchDoc(ref)).paidCount).toBe((before.paidCount as number) + 2);
  });
});

/* -------------------------------------------------------------------------- */
/* A custom line that takes jars: what goes out must come back                */
/* -------------------------------------------------------------------------- */

describe("a custom line tied to a batch", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 5);
  });

  /**
   * Brief 7A.1 step 2: "a custom line can be tied to a batch so jars still
   * leave the count". The sale and its own undo have to agree about that,
   * or voiding takes jars off the customer's history that the sale never put
   * on, and the number the seller reads before greeting them drifts down for
   * good.
   */
  it("counts the same jars on the way in as the void gives back", async () => {
    const beforeBatch = await batchDoc(ref);

    // The Owner sells it: a custom line at an amount typed on the spot is his
    // to set (7A.6), and the jar accounting is what this test is about.
    const sale = await mustSell("owner", {
      line: {
        kind: "custom",
        productSlug: PRODUCT,
        batchRef: ref,
        qty: 2,
        customDescription: "Two jars, agreed price",
        amountPaise: 50_000,
      },
      expectedTotalPaise: 100_000,
    });

    expect(sale.jars).toBe(2);
    expect((await batchDoc(ref)).paidCount).toBe((beforeBatch.paidCount as number) + 2);

    const afterSale = (await db().collection("customers").doc(ASHA).get()).data() ?? {};
    const soldJars = (afterSale.stats as Record<string, unknown>).jars as number;
    expect(soldJars).toBe(2);

    const voided = await callFunction("voidCounterSale", "owner", {
      orderId: sale.orderId,
      reason: "entered on the wrong customer",
    });
    expect(voided.result, JSON.stringify(voided.error)).toBeTruthy();

    // The batch is whole again, and so is the customer.
    expect((await batchDoc(ref)).paidCount).toBe(beforeBatch.paidCount);
    const afterVoid = (await db().collection("customers").doc(ASHA).get()).data() ?? {};
    expect((afterVoid.stats as Record<string, unknown>).jars).toBe(0);
  });

  it("leaves the date of their last order alone when a sale is taken back", async () => {
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    const sold = (await db().collection("customers").doc(ASHA).get()).data() ?? {};
    expect((sold.stats as Record<string, unknown>).lastOrderAt).toBeTruthy();

    await callFunction("voidCounterSale", "kitchen", {
      orderId: sale.orderId,
      reason: "wrong jar",
    });

    const after = (await db().collection("customers").doc(ASHA).get()).data() ?? {};
    expect((after.stats as Record<string, unknown>).lastOrderAt).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* D40: editing a batch's price never reprices an order already placed        */
/* -------------------------------------------------------------------------- */

/**
 * The Owner may change a batch's two prices at any time, on any batch, in any
 * state, with no lock (D40, M2.16). The one thing that must hold is that an
 * order already placed keeps the price it was actually charged.
 *
 * It holds by construction: an order line carries its own `unitPrice`, written
 * once when the line is priced (`planLine`, `functions/src/orders/sale.ts`),
 * and every total, bill and receipt is arithmetic on that stored line
 * (`functions/src/money/plan.ts`). Nothing anywhere reads a batch's price back
 * for an order that exists. This test is what makes that a fact rather than a
 * reading of the code: it sells a jar, moves the batch's price under it, and
 * looks at the order again.
 */
describe("a batch whose price changes after a jar has been sold", () => {
  let ref = "";
  let orderId = "";
  const NEW_PRICE_PAISE = 50_000;

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 5);
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    });
    orderId = sale.orderId as string;
    // The Owner retypes the price on the batch screen. This is the same
    // document write that screen makes, minus the audit entry beside it.
    await db().collection("batches").doc(ref).update({ priceInStock: NEW_PRICE_PAISE });
  });

  it("leaves the sold order's recorded price and every total exactly where they were", async () => {
    const order = await orderDoc(orderId);
    const lines = order.lines as Array<Record<string, unknown>>;

    expect(lines).toHaveLength(1);
    expect(lines[0].unitPrice).toBe(PRICE_IN_STOCK_PAISE);
    expect(order.total).toBe(PRICE_IN_STOCK_PAISE);
    expect((order.payment as Record<string, unknown>).amount).toBe(PRICE_IN_STOCK_PAISE);

    // ...and no *money* field anywhere on the order carries the new number.
    // Named field by field on purpose. An earlier draft of this swept
    // `JSON.stringify(order)` for the price as a substring, which read as a
    // stronger check and was in fact a weaker one: it matched a timestamp's
    // nanoseconds as readily as a price (an emulator stamp is millisecond
    // aligned, so any millisecond ending in 5 prints "50000" inside its
    // `_nanoseconds`, which is 111 of every 1000), so a lucky stamp could
    // not be told from a genuinely repriced order. This says what it means.
    expect(moneyFieldsOf(order)).not.toContain(NEW_PRICE_PAISE);
  });

  it("leaves the bill that was issued for it alone too", async () => {
    const bills = await db().collection("documents").where("orderId", "==", orderId).get();
    for (const bill of bills.docs) {
      const data = bill.data();
      expect(data.total).toBe(PRICE_IN_STOCK_PAISE);
      for (const line of (data.lines ?? []) as Array<Record<string, unknown>>) {
        expect(line.unitPrice).toBe(PRICE_IN_STOCK_PAISE);
      }
    }
  });

  it("charges the new price for the next jar, which is the whole point of the edit", async () => {
    const sale = await mustSell("kitchen", {
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
      expectedTotalPaise: NEW_PRICE_PAISE,
    });
    expect(sale.total).toBe(NEW_PRICE_PAISE);
    const order = await orderDoc(sale.orderId as string);
    expect((order.lines as Array<Record<string, unknown>>)[0].unitPrice).toBe(NEW_PRICE_PAISE);
  });
});
