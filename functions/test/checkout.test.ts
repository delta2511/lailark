/**
 * `createCheckout` and the hold sweep against the emulators: the real
 * callable, over real HTTP, with no sign-in at all (brief §5), and real
 * transactions on real documents.
 *
 * The one that matters most is the race: two checkouts, one jar, and exactly
 * one of them wins. Everything else here is a line of brief §6.1, §7.2, §9.3
 * or §11.5 checked where it is actually enforced, which is the server. The
 * checkout page's own validation proves nothing: a script can post straight
 * at the callable, so these tests do exactly that.
 *
 * Razorpay is never called. With no key in `functions/.secret.local` the
 * emulator branch of `razorpay.ts` hands back `order_emulator_<id>` and makes
 * no network request, which is what keeps this suite offline.
 */

import {
  effectiveShippingSwitch,
  liveHeldJars,
  PRICE_IN_STOCK_PAISE,
  PRICE_OPEN_PAISE,
  shippingFeeFor,
} from "@lailark/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

import { computeCounts } from "../src/api/counts";
import { readStockRelease, writeStockRelease } from "../src/batches/holds";
import { sweepExpiredHolds, sweepHolds } from "../src/orders/sweepHolds";
import {
  batchDoc,
  callFunction,
  clearFirestore,
  db,
  mustTransition,
  setPaidCount,
  waitForState,
} from "./emulator";

const PRODUCT = "prawns-and-dates";
const PRODUCT_NAME = "Prawns and dates";
const ASHA = "+919000003333";
const RAVI = "+919000004444";

async function seedProduct(over: Record<string, unknown> = {}) {
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
      ...over,
    });
}

async function openBatch(slug: string): Promise<string> {
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
  return ref;
}

/** A batch walked all the way to bottled, so it is in stock on the site. */
async function inStockBatch(slug: string, jarCount = 22): Promise<string> {
  const ref = await openBatch(slug);
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

/** Sets the count so exactly `free` jars are left on `ref`. */
async function leaveJarsFree(ref: string, free: number): Promise<void> {
  const data = await batchDoc(ref);
  const capacity = (data.bottledJars as number) ?? (data.bookableJars as number);
  await db().collection("batches").doc(ref).update({ paidCount: capacity - free, heldJars: {} });
}

function checkoutData(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productSlug: PRODUCT,
    qty: 1,
    customerName: "Asha",
    customerPhone: ASHA,
    address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    clientRef: `cr-${Math.random().toString(36).slice(2)}`,
    ...over,
  };
}

function checkout(data: Record<string, unknown>) {
  return callFunction("createCheckout", null, data);
}

/* -------------------------------------------------------------------------- */

describe("createCheckout, brief 6.1 and 7.2", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch(PRODUCT);
  });

  beforeEach(async () => {
    await leaveJarsFree(ref, 6);
  });

  it("takes a fifteen minute hold and hands back what Checkout needs", async () => {
    const out = await checkout(checkoutData());
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();

    expect(out.result.totalPaise).toBe(PRICE_IN_STOCK_PAISE);
    expect(out.result.unitPricePaise).toBe(PRICE_IN_STOCK_PAISE);
    expect(out.result.shippingFeePaise).toBe(0);
    expect(out.result.razorpayOrderId).toMatch(/^order_emulator_o-/);
    // The secret never leaves the server: only the key id comes back.
    expect(JSON.stringify(out.result)).not.toContain("KEY_SECRET");

    const minutes = (out.result.holdExpiresAtMillis - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(13);
    expect(minutes).toBeLessThanOrEqual(15);

    const order = (await db().collection("orders").doc(out.result.orderId).get()).data() ?? {};
    expect(order.state).toBe("held");
    expect(order.channel).toBe("web");
    expect(order.payment.status).toBe("created");
    expect(order.payment.razorpayIds.orderId).toBe(out.result.razorpayOrderId);
    // D36: a hold that may expire never spends a bill number.
    expect(order.billNumber).toBeNull();
    expect((await db().collection("documents").get()).size).toBe(0);

    // The jar really left the count, inside the batch transaction.
    const batch = await batchDoc(ref);
    expect(liveHeldJars(batch.heldJars, Date.now())).toBe(1);

    // The customer exists, with the consent they ticked and no jar credited.
    const customer = (await db().collection("customers").doc(ASHA).get()).data() ?? {};
    expect(customer.consents.updates.given).toBe(true);
    expect(customer.consents.marketing.given).toBe(false);
    expect(customer.stats).toBeUndefined();
  });

  it("charges one customer only for what the page showed", async () => {
    const out = await checkout(checkoutData({ expectedTotalPaise: 1_00 }));
    expect(out.result).toBeFalsy();
    expect(out.error.message).toContain("₹649");
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(0);
  });

  it("refuses without the WhatsApp updates tick, brief 5", async () => {
    const out = await checkout(
      checkoutData({ consents: { updates: false, marketing: false } }),
    );
    expect(out.result).toBeFalsy();
    expect(out.error.message).toContain("tick that box");
  });

  it("holds two jars and then refuses a third, brief 4.1's online cap", async () => {
    const first = await checkout(
      checkoutData({ qty: 2, expectedTotalPaise: PRICE_IN_STOCK_PAISE * 2 }),
    );
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();

    const third = await checkout(checkoutData());
    expect(third.result).toBeFalsy();
    expect(third.error.message).toMatch(/limited to 2 jars/);

    // Somebody else is not affected by Asha's cap.
    const other = await checkout(checkoutData({ customerPhone: RAVI, customerName: "Ravi" }));
    expect(other.result, JSON.stringify(other.error)).toBeTruthy();
  });

  it("refuses a pincode the Owner has switched the list on for, brief 11.5", async () => {
    await db().collection("settings").doc("pincodes").set({
      serviceable: ["682001"],
      enforce: true,
      source: "manual",
      count: 1,
    });
    try {
      const out = await checkout(checkoutData());
      expect(out.result).toBeFalsy();
      expect(out.error.message).toContain("673571");
      expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(0);
    } finally {
      await db().collection("settings").doc("pincodes").delete();
    }
  });

  it("refuses a product whose own rule excludes the address, brief 11.5", async () => {
    await seedProduct({ excludedPincodes: ["673571"] });
    try {
      const out = await checkout(checkoutData());
      expect(out.result).toBeFalsy();
      expect(out.error.message).toContain("Prawns and dates");
    } finally {
      await seedProduct();
    }
  });

  it("charges the shipping fee once the Owner moves the switch off free", async () => {
    await db().collection("settings").doc("shipping").set({ rule: "flatFee", flatFee: 6_000 });
    // A product carrying no rule of its own follows the global switch.
    await seedProduct({ shippingRule: null });
    try {
      const out = await checkout(
        checkoutData({ expectedTotalPaise: PRICE_IN_STOCK_PAISE + 6_000 }),
      );
      expect(out.result, JSON.stringify(out.error)).toBeTruthy();
      expect(out.result.shippingFeePaise).toBe(6_000);
    } finally {
      await db().collection("settings").doc("shipping").delete();
      await seedProduct();
    }
  });

  /**
   * The drift this suite missed the first time round, and the reason the
   * fixture above is not the whole story: it seeded `shippingRule: null`,
   * while `seed-products.mjs` gives every hero a rule of its own ("free" for
   * three of them, "flatFee" for beef). With a rule on the product, the
   * server's total and the page's were computed from two different switches
   * the moment the global switch left "free", and brief 4.2 says the
   * customer then meets a refusal at the Pay button.
   *
   * So this asks for the total the way the page asks for it: off the payload
   * `/api/counts` actually serves, through the same `@lailark/shared` sum.
   * If the endpoint stops publishing `shippingRule`, this fails.
   */
  async function totalTheCheckoutPageWouldPrint(qty: number): Promise<number> {
    const counts = await computeCounts(getFirestore());
    const entry = counts.products[PRODUCT];
    const ship = effectiveShippingSwitch(
      {
        rule: counts.shipping.rule,
        flatFee: counts.shipping.flatFeePaise,
        freeFromJars: counts.shipping.freeFromJars,
      },
      entry.shippingRule ?? null,
    );
    return (entry.priceInStockPaise ?? 0) * qty + shippingFeeFor(ship, qty);
  }

  it("charges exactly the figure the page printed, product rule and all, brief 4.2", async () => {
    await db()
      .collection("settings")
      .doc("shipping")
      .set({ rule: "freeOnTwo", flatFee: 6_000, freeFromJars: 2 });
    try {
      // Seeded "free", as three of the four heroes are: nothing is charged
      // even with the global switch off free.
      const free = await totalTheCheckoutPageWouldPrint(1);
      expect(free).toBe(PRICE_IN_STOCK_PAISE);
      const kept = await checkout(checkoutData({ expectedTotalPaise: free }));
      expect(kept.result, JSON.stringify(kept.error)).toBeTruthy();
      expect(kept.result.shippingFeePaise).toBe(0);

      // Beef's rule: a flat fee whatever the jar count, so one jar pays it.
      await seedProduct({ shippingRule: "flatFee" });
      const charged = await totalTheCheckoutPageWouldPrint(1);
      expect(charged).toBe(PRICE_IN_STOCK_PAISE + 6_000);
      const paid = await checkout(
        checkoutData({ customerPhone: RAVI, customerName: "Ravi", expectedTotalPaise: charged }),
      );
      expect(paid.result, JSON.stringify(paid.error)).toBeTruthy();
      expect(paid.result.shippingFeePaise).toBe(6_000);
    } finally {
      await db().collection("settings").doc("shipping").delete();
      await seedProduct();
    }
  });

  it("charges what the page printed even on a shipping switch nobody validated", async () => {
    // Nothing constrains these fields where they are written: no admin
    // screen, no rule, no seed script. The endpoint floored `freeFromJars`
    // and the server did not, so the page showed two jars shipped free and
    // the server charged ₹60 and refused the order for the difference.
    await db()
      .collection("settings")
      .doc("shipping")
      .set({ rule: "freeOnTwo", flatFee: 6_000.7, freeFromJars: 3.5 });
    // A product with no rule of its own, so the global switch is what runs.
    await seedProduct({ shippingRule: null });
    try {
      const total = await totalTheCheckoutPageWouldPrint(2);
      // Floored to three jars and to whole paise, on both sides.
      expect(total).toBe(PRICE_IN_STOCK_PAISE * 2 + 6_000);
      const out = await checkout(
        checkoutData({ qty: 2, expectedTotalPaise: total }),
      );
      expect(out.result, JSON.stringify(out.error)).toBeTruthy();
      expect(out.result.shippingFeePaise).toBe(6_000);
    } finally {
      await db().collection("settings").doc("shipping").delete();
      await seedProduct();
    }
  });

  it("shows the same batch the hold lands in", async () => {
    // `/api/counts` and `createCheckout` pick through the same
    // `chooseWebBatch`, so the jars, price and dates the customer read
    // belong to the batch the jar comes out of.
    const counts = await computeCounts(getFirestore());
    expect(counts.products[PRODUCT].mode).toBe("inStock");
    const out = await checkout(checkoutData());
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();
    expect(out.result.batchRef).toBe(ref);
  });

  it("writes one order when the same checkout arrives twice", async () => {
    const data = checkoutData();
    const [first, second] = await Promise.all([checkout(data), checkout(data)]);
    const ok = [first, second].filter((r) => r.result);
    expect(ok.length).toBeGreaterThanOrEqual(1);

    const orders = await db().collection("orders").where("clientRef", "==", data.clientRef).get();
    expect(orders.size).toBe(1);
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(1);
  });

  /* ---- M3.5 round 3: the same clientRef, fifteen minutes later ------- */

  it("hands a live hold straight back to a second tap, with everything the page needs", async () => {
    const data = checkoutData();
    const first = await checkout(data);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();

    const again = await checkout(data);
    expect(again.result, JSON.stringify(again.error)).toBeTruthy();
    expect(again.result.alreadyStarted).toBe(true);
    expect(again.result.orderId).toBe(first.result.orderId);
    expect(again.result.razorpayOrderId).toBe(first.result.razorpayOrderId);
    // Both used to come back empty, and the page then opened Razorpay with
    // `key: ""` and could only say the payment window had failed.
    expect(again.result.razorpayKeyId).not.toBe("");
    expect(again.result.lineDescription).toBe(first.result.lineDescription);
    expect(again.result.batchNo).toBe(first.result.batchNo);
    // One hold for the two taps, which is what the clientRef is for.
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(1);
  });

  it("refuses a tap that comes back after the hold lapsed, rather than selling nothing", async () => {
    // The severe one. `clientRef` is minted once when the page mounts and
    // sent by every later tap, so a tab left open past fifteen minutes came
    // back here with it. The order was handed straight back, Razorpay order
    // id and total and all, without a look at the jars: the customer paid
    // for a hold that had lapsed and a count that had already given the jars
    // away. Leave the tab open and tap Pay. No race needed.
    const data = checkoutData();
    const first = await checkout(data);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();
    const orderId: string = first.result.orderId;

    // Age the hold past its expiry and let the sweep do its work, exactly as
    // it would fifteen minutes later.
    const held = (await batchDoc(ref)).heldJars as Record<string, Record<string, unknown>>;
    const aged: Record<string, unknown> = {};
    for (const [id, hold] of Object.entries(held)) {
      aged[id] = { ...hold, expiresAt: Timestamp.fromMillis(Date.now() - 60_000) };
    }
    await db().collection("batches").doc(ref).update({ heldJars: aged });
    await sweepExpiredHolds(db(), Date.now());

    const order = (await db().collection("orders").doc(orderId).get()).data() ?? {};
    expect(order.state).toBe("expired");
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(0);

    const retry = await checkout(data);
    expect(retry.result).toBeFalsy();
    expect(retry.error.message).toContain("that time has passed");
    // The whole client contract: the page mints a fresh `clientRef` on this
    // reason and on no other. Without it the customer taps into the same
    // refusal for as long as the tab is open.
    expect(retry.error.details.reason).toBe("holdLapsed");
    // And nothing was taken, or given, on the way out.
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(0);
    expect((await db().collection("orders").doc(orderId).get()).get("state")).toBe("expired");
  });

  it("refuses a changed jar count rather than charging for the first one", async () => {
    // The overcharge, end to end and with no race in it. `ondismiss` leaves
    // the form live and the jar picker on the page, and the `clientRef` is
    // minted once per page mount: pick one jar, tap Pay, close the Razorpay
    // window, pick two, tap Pay. The page said two jars and ₹1,298 and the
    // customer was charged ₹649 and sent one jar.
    const data = checkoutData();
    const first = await checkout(data);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();
    expect(first.result.qty).toBe(1);
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(1);

    const changed = await checkout({
      ...data,
      qty: 2,
      expectedTotalPaise: PRICE_IN_STOCK_PAISE * 2,
    });
    expect(changed.result).toBeFalsy();
    expect(changed.error.details.reason).toBe("orderChanged");
    expect(changed.error.message).toContain("put the first jars back");

    // The first hold really went back, so the customer's own jar does not
    // then refuse the two-jar order the page is showing them (brief 4.1).
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(0);
    expect((await db().collection("orders").doc(first.result.orderId).get()).get("state")).toBe(
      "expired",
    );

    // And the next tap, with the fresh reference the page mints, buys what
    // the page is actually showing.
    const again = await checkout({
      ...data,
      clientRef: `cr-${Math.random().toString(36).slice(2)}`,
      qty: 2,
      expectedTotalPaise: PRICE_IN_STOCK_PAISE * 2,
    });
    expect(again.result, JSON.stringify(again.error)).toBeTruthy();
    expect(again.result.qty).toBe(2);
    expect(again.result.totalPaise).toBe(PRICE_IN_STOCK_PAISE * 2);
  });

  it("gives a different phone on the same reference nothing of the first customer's", async () => {
    // Needs a guessed `crypto.randomUUID`, so it is a design weakness rather
    // than a live exploit. It used to answer with the first customer's name,
    // phone and total on it.
    const data = checkoutData();
    const first = await checkout(data);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();

    const other = await checkout({ ...data, customerPhone: RAVI, customerName: "Ravi" });
    expect(other.result).toBeFalsy();
    expect(JSON.stringify(other.error)).not.toContain("Asha");
    expect(JSON.stringify(other.error)).not.toContain("9000003333");
    expect(other.error.details.reason).toBe("startAgain");
    // Nothing of theirs was touched on the way out.
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(1);
  });

  it("refuses a different pickle on the same reference", async () => {
    const data = checkoutData();
    const first = await checkout(data);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();

    const other = await checkout({ ...data, productSlug: "squid-and-dates" });
    expect(other.result).toBeFalsy();
    expect(other.error.details.reason).toBe("orderChanged");
  });

  it("does not ask a customer whose payment already landed to start again", async () => {
    const data = checkoutData();
    const first = await checkout(data);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();
    // Brief 9.2: the webhook is what moves this, and M3.6 writes it.
    await db()
      .collection("orders")
      .doc(first.result.orderId)
      .update({ state: "paidWaiting", "payment.status": "captured" });

    const retry = await checkout(data);
    expect(retry.result).toBeFalsy();
    expect(retry.error.message).toContain("already paid for");
    // Never `holdLapsed`: that is the one reason the page starts a fresh
    // checkout on, and a fresh checkout here is a second jar for an order
    // that is already paid for.
    expect(retry.error.details.reason).toBe("alreadyPaid");
  });

  it("calls a paid order paid even when the payment map says nothing", async () => {
    const data = checkoutData();
    const first = await checkout(data);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();
    await db()
      .collection("orders")
      .doc(first.result.orderId)
      .update({ state: "toPack", payment: FieldValue.delete() });

    const retry = await checkout(data);
    expect(retry.result).toBeFalsy();
    expect(retry.error.details.reason).toBe("alreadyPaid");
  });

  it("refuses a batch past its shelf-life stop, brief 6.2", async () => {
    await db().collection("batches").doc(ref).update({ saleStopOn: "2020-01-01" });
    try {
      const out = await checkout(checkoutData());
      expect(out.result).toBeFalsy();
      expect(out.error.message).toContain("no longer sold online");
    } finally {
      const packed = await batchDoc(ref);
      await db()
        .collection("batches")
        .doc(ref)
        .update({ saleStopOn: packed.saleStopOn === "2020-01-01" ? "2027-01-02" : packed.saleStopOn });
    }
  });
});

describe("booking an open batch from the website, brief 7", () => {
  it("books at the open price and inside the 90% cap", async () => {
    await clearFirestore();
    await seedProduct();
    const ref = await openBatch(PRODUCT);

    // 22 planned is 19 bookable (D3). Eighteen paid leaves one.
    await db().collection("batches").doc(ref).update({ paidCount: 18, heldJars: {} });
    await waitForState(ref, "open", "halfReached");

    const out = await checkout(checkoutData({ expectedTotalPaise: PRICE_OPEN_PAISE }));
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();
    expect(out.result.unitPricePaise).toBe(PRICE_OPEN_PAISE);

    const batch = await batchDoc(ref);
    expect(batch.paidCount + liveHeldJars(batch.heldJars, Date.now())).toBeLessThanOrEqual(
      batch.bookableJars as number,
    );

    // The twentieth jar does not exist: the 10% buffer is not for sale.
    const over = await checkout(
      checkoutData({ customerPhone: RAVI, customerName: "Ravi", expectedTotalPaise: PRICE_OPEN_PAISE }),
    );
    expect(over.result).toBeFalsy();
    expect(over.error.message).toMatch(/last jar|last one|no jars free/i);
  });
});

describe("the last jar on the website, brief 9.3", () => {
  it("is held by one of two simultaneous checkouts, never by both", async () => {
    await clearFirestore();
    await seedProduct();
    const ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 1);

    const [a, b] = await Promise.all([
      checkout(checkoutData({ customerPhone: ASHA, customerName: "Asha" })),
      checkout(checkoutData({ customerPhone: RAVI, customerName: "Ravi" })),
    ]);

    const won = [a, b].filter((r) => r.result);
    const lost = [a, b].filter((r) => !r.result);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // Brief 9.3, word for word: a jar that is held is not a jar that has
    // gone, and the loser is told which.
    expect(lost[0].error.message).toBe(
      "Someone is paying for the last jar, check back in 15 minutes.",
    );

    // Never oversold: paid plus live holds never passed the count.
    const batch = await batchDoc(ref);
    const held = liveHeldJars(batch.heldJars, Date.now());
    expect(held).toBe(1);
    expect((batch.paidCount as number) + held).toBeLessThanOrEqual(batch.bottledJars as number);

    // And exactly one order exists for it.
    const orders = await db().collection("orders").where("state", "==", "held").get();
    expect(orders.size).toBe(1);
  });

  it("gives six simultaneous checkouts exactly the three jars there are", async () => {
    await clearFirestore();
    await seedProduct();
    const ref = await inStockBatch(PRODUCT);
    await leaveJarsFree(ref, 3);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        checkout(checkoutData({ customerPhone: `+9190000055${10 + i}`, customerName: `Buyer ${i}` })),
      ),
    );
    const won = results.filter((r) => r.result);
    expect(won).toHaveLength(3);

    const batch = await batchDoc(ref);
    expect(liveHeldJars(batch.heldJars, Date.now())).toBe(3);
    expect((batch.paidCount as number) + 3).toBe(batch.bottledJars as number);
  });
});

describe("the limit the Owner typed governs the website too, D52", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch(PRODUCT);
  });

  beforeEach(async () => {
    await leaveJarsFree(ref, 12);
  });

  /** Sets, or clears, the Owner's typed cap on the batch. */
  async function typeLimit(value: unknown) {
    await db().collection("batches").doc(ref).update({ perPersonLimitOverride: value });
  }

  async function ask(jars: number, phone = ASHA) {
    return checkout(
      checkoutData({
        qty: jars,
        customerPhone: phone,
        expectedTotalPaise: PRICE_IN_STOCK_PAISE * jars,
      }),
    );
  }

  it("lets a web buyer take five when the Owner typed five, not two", async () => {
    // The bug this test was written for: the customer was told "This batch
    // is limited to 2 jars per person" on a batch the Owner had typed 5 on.
    await typeLimit(5);
    const out = await ask(5);
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();
    expect(out.result.qty).toBe(5);
  });

  it("stops a web buyer at one when the Owner typed one", async () => {
    await typeLimit(1);
    const two = await ask(2);
    expect(two.result).toBeFalsy();
    expect(two.error.message).toContain("limited to 1 jar per person");

    const one = await ask(1);
    expect(one.result, JSON.stringify(one.error)).toBeTruthy();
  });

  it("means exactly two when the Owner typed two", async () => {
    await typeLimit(2);
    expect((await ask(2)).result).toBeTruthy();
    const third = await ask(1);
    expect(third.result).toBeFalsy();
    expect(third.error.message).toContain("limited to 2 jars per person");
  });

  it("falls back to two on a blank box, not to the batch's quarter of four", async () => {
    await typeLimit(null);
    const three = await ask(3);
    expect(three.result).toBeFalsy();
    expect(three.error.message).toContain("limited to 2 jars per person");
    expect((await ask(2)).result).toBeTruthy();
  });

  it("treats junk in the box as blank, and never as a cap nobody meant", async () => {
    for (const junk of [0, -5, 1.5, "lots"]) {
      await typeLimit(junk);
      await leaveJarsFree(ref, 12);
      const three = await ask(3);
      expect(three.result, `override ${JSON.stringify(junk)}`).toBeFalsy();
      expect(three.error.message).toContain("limited to 2 jars per person");
      const two = await ask(2);
      expect(two.result, `override ${JSON.stringify(junk)}`).toBeTruthy();
    }
  });

  it("says the same number on /api/counts as the transaction enforces", async () => {
    for (const typed of [5, 1, 2, null]) {
      await typeLimit(typed);
      const payload = await computeCounts(db());
      const shown = payload.products[PRODUCT].perPersonLimit;
      expect(shown, `override ${JSON.stringify(typed)}`).toBe(typed ?? 2);

      // And the transaction refuses exactly one more than what is shown.
      await leaveJarsFree(ref, 12);
      const over = await ask(shown + 1, "+919000009999");
      expect(over.result, `override ${JSON.stringify(typed)}`).toBeFalsy();
      expect(over.error.message).toContain(`limited to ${shown} jar`);
    }
  });
});

describe("the hold expiry sweep, brief 6.1 step 6 and 9.3", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch(PRODUCT);
  });

  beforeEach(async () => {
    await leaveJarsFree(ref, 6);
    for (const doc of (await db().collection("orders").get()).docs) await doc.ref.delete();
  });

  it("gives the jars back and marks the order expired", async () => {
    const out = await checkout(checkoutData());
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();
    const orderId: string = out.result.orderId;

    // Fifteen minutes later, without waiting fifteen minutes.
    const later = Date.now() + 16 * 60_000;
    const report = await sweepExpiredHolds(db(), later);
    expect(report.holdsDropped).toBe(1);
    expect(report.jarsReturned).toBe(1);
    expect(report.ordersExpired).toBe(1);

    const batch = await batchDoc(ref);
    expect(Object.keys(batch.heldJars ?? {})).toHaveLength(0);
    expect(liveHeldJars(batch.heldJars, later)).toBe(0);

    const order = (await db().collection("orders").doc(orderId).get()).data() ?? {};
    expect(order.state).toBe("expired");
    expect(order.holdExpiresAt).toBeNull();
  });

  it("does nothing at all the second time it runs", async () => {
    await checkout(checkoutData());
    const later = Date.now() + 16 * 60_000;

    const first = await sweepExpiredHolds(db(), later);
    expect(first.holdsDropped).toBe(1);

    const before = JSON.stringify((await batchDoc(ref)).heldJars ?? {});
    const second = await sweepExpiredHolds(db(), later);
    expect(second).toEqual({
      batchesTouched: 0,
      holdsDropped: 0,
      jarsReturned: 0,
      ordersExpired: 0,
    });
    expect(JSON.stringify((await batchDoc(ref)).heldJars ?? {})).toBe(before);
  });

  it("leaves a hold that has not expired exactly where it is", async () => {
    const out = await checkout(checkoutData());
    const report = await sweepExpiredHolds(db(), Date.now());
    expect(report.holdsDropped).toBe(0);
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(1);
    const order = (await db().collection("orders").doc(out.result.orderId).get()).data() ?? {};
    expect(order.state).toBe("held");
  });

  it("never walks over an order whose payment landed just after the hold lapsed", async () => {
    const out = await checkout(checkoutData());
    const orderId: string = out.result.orderId;
    // Brief 9.3's rare case: the webhook got in first.
    await db()
      .collection("orders")
      .doc(orderId)
      .update({ state: "paidWaiting", "payment.status": "captured" });

    const report = await sweepExpiredHolds(db(), Date.now() + 16 * 60_000);
    // The dead key still goes, because the jar is paid for now, not held.
    expect(report.holdsDropped).toBe(1);
    expect(report.ordersExpired).toBe(0);

    const order = (await db().collection("orders").doc(orderId).get()).data() ?? {};
    expect(order.state).toBe("paidWaiting");
  });

  /**
   * Plants holds on the batch by hand, so a test can have several at once
   * with only some of them lapsed. `expiresAt` is a real `Timestamp`,
   * exactly as `writeStockClaim` writes it.
   */
  async function plantHolds(holds: Record<string, { qty: number; minutes: number }>) {
    const heldJars: Record<string, unknown> = {};
    for (const [orderId, hold] of Object.entries(holds)) {
      heldJars[orderId] = {
        qty: hold.qty,
        expiresAt: Timestamp.fromMillis(Date.now() + hold.minutes * 60_000),
        customerPhone: RAVI,
      };
    }
    await db().collection("batches").doc(ref).update({ heldJars });
  }

  async function heldKeys(): Promise<string[]> {
    return Object.keys((await batchDoc(ref)).heldJars ?? {}).sort();
  }

  it("drops the lapsed key and keeps the live one, with two holds on the batch", async () => {
    // The bug this test was written for: `set({ merge: true })` merges a map
    // leaf by leaf, so a key left out of the new map was kept, not removed.
    // Every earlier test left exactly one hold, so the map came out `{}` and
    // Firestore wrote that whole, which hid it.
    await plantHolds({
      "o-live01": { qty: 1, minutes: 10 },
      "o-lapsed1": { qty: 1, minutes: -1 },
    });

    const report = await sweepExpiredHolds(db(), Date.now());
    expect(report.holdsDropped).toBe(1);
    expect(report.jarsReturned).toBe(1);
    expect(await heldKeys()).toEqual(["o-live01"]);
  });

  it("drops one of three, and leaves the other two exactly as they were", async () => {
    await plantHolds({
      "o-live01": { qty: 2, minutes: 10 },
      "o-lapsed1": { qty: 3, minutes: -5 },
      "o-live02": { qty: 1, minutes: 30 },
    });
    const before = (await batchDoc(ref)).heldJars as Record<string, { qty: number }>;

    const report = await sweepExpiredHolds(db(), Date.now());
    expect(report.holdsDropped).toBe(1);
    expect(report.jarsReturned).toBe(3);
    expect(await heldKeys()).toEqual(["o-live01", "o-live02"]);

    const after = (await batchDoc(ref)).heldJars as Record<string, { qty: number }>;
    expect(after["o-live01"].qty).toBe(before["o-live01"].qty);
    expect(after["o-live02"].qty).toBe(before["o-live02"].qty);
  });

  it("really is idempotent beside a live hold, and writes nothing the second time", async () => {
    await plantHolds({
      "o-live01": { qty: 1, minutes: 10 },
      "o-lapsed1": { qty: 1, minutes: -1 },
    });

    const first = await sweepExpiredHolds(db(), Date.now());
    expect(first.holdsDropped).toBe(1);
    const auditAfterFirst = (await db().collection("audit").get()).size;

    for (let run = 0; run < 3; run += 1) {
      const again = await sweepExpiredHolds(db(), Date.now());
      expect(again, `run ${run + 2}`).toEqual({
        batchesTouched: 0,
        holdsDropped: 0,
        jarsReturned: 0,
        ordersExpired: 0,
      });
    }
    expect(await heldKeys()).toEqual(["o-live01"]);
    // No perpetual write: the trail stopped growing once the key was gone.
    expect((await db().collection("audit").get()).size).toBe(auditAfterFirst);
  });

  it("survives two sweeps at the same moment, and the key still goes", async () => {
    await plantHolds({
      "o-live01": { qty: 1, minutes: 10 },
      "o-lapsed1": { qty: 1, minutes: -1 },
    });
    const now = Date.now();
    await Promise.all([sweepExpiredHolds(db(), now), sweepExpiredHolds(db(), now)]);
    expect(await heldKeys()).toEqual(["o-live01"]);
  });

  /**
   * The scheduled wrapper itself, not just the function it calls. Everything
   * above runs `sweepExpiredHolds` directly with a fake clock, so nothing
   * proved that the thing Cloud Scheduler actually invokes is wired to it,
   * in the right region, with a ceiling on its instances (CLAUDE.md 3), and
   * reading the real clock.
   */
  it("the scheduled wrapper runs the sweep, and is deployed where it should be", async () => {
    const endpoint = (sweepHolds as unknown as { __endpoint: Record<string, unknown> })
      .__endpoint;
    expect(endpoint.region).toEqual(["asia-south1"]);
    expect(endpoint.maxInstances).toBe(3);
    expect(endpoint.scheduleTrigger).toMatchObject({
      schedule: "every 5 minutes",
      timeZone: "Asia/Kolkata",
      retryConfig: { retryCount: 0 },
    });

    // A hold that lapsed a minute ago, so the wrapper's own `Date.now()`
    // finds it without any clock passed in.
    await plantHolds({ "o-live01": { qty: 1, minutes: 10 }, "o-lapsed1": { qty: 1, minutes: -1 } });
    await (sweepHolds as unknown as { run: (event: unknown) => Promise<void> }).run({
      scheduleTime: new Date().toISOString(),
      jobName: "sweepHolds",
    });
    expect(await heldKeys()).toEqual(["o-live01"]);

    // Idempotent through the wrapper too: a second run finds nothing.
    await (sweepHolds as unknown as { run: (event: unknown) => Promise<void> }).run({
      scheduleTime: new Date().toISOString(),
      jobName: "sweepHolds",
    });
    expect(await heldKeys()).toEqual(["o-live01"]);
  });

  it("frees the jar for the next buyer even before the sweep runs", async () => {
    // Brief 9.3: "a lapsed hold frees the jar even if the clean-up job is
    // late." Every jar held, all of them already expired.
    await db().collection("batches").doc(ref).update({
      heldJars: {
        "o-stale1": { qty: 6, expiresAt: new Date(Date.now() - 60_000), customerPhone: RAVI },
      },
    });
    const out = await checkout(checkoutData());
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();
  });
});

describe("putting a hold back beside another one, M3.5's release path", () => {
  it("removes only the released key, never merging it back in", async () => {
    // `createCheckout` calls this when Razorpay refuses, so a jar is not
    // left out of the count because a gateway was down. It had the same
    // leaf-merge bug the sweep did: the released key survived whenever
    // another hold was on the batch.
    await clearFirestore();
    await seedProduct();
    const ref = await inStockBatch(PRODUCT);
    await db()
      .collection("batches")
      .doc(ref)
      .update({
        paidCount: 0,
        heldJars: {
          "o-keepme": {
            qty: 1,
            expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
            customerPhone: RAVI,
          },
          "o-goaway": {
            qty: 2,
            expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
            customerPhone: ASHA,
          },
        },
      });

    const store = getFirestore();
    await store.runTransaction(async (tx) => {
      const release = await readStockRelease(tx, store, {
        batchRef: ref,
        orderId: "o-goaway",
        qty: 2,
        mode: "hold",
      });
      expect(release.qtyReturned).toBe(2);
      writeStockRelease(tx, store, release, "test");
    });

    const held = (await batchDoc(ref)).heldJars as Record<string, unknown>;
    expect(Object.keys(held)).toEqual(["o-keepme"]);
    expect(liveHeldJars(held, Date.now())).toBe(1);
  });
});
