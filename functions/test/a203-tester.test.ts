/**
 * Added by the M3.6c adversarial tester, not by the builder.
 *
 * The builder's own A203 block in `webhook.test.ts` drives one refusal
 * branch (`hold-gone`) and then re-checks out against a **live** hold, which
 * takes `readHoldToPaid`'s `live-hold` door and never calls
 * `customerJarsInBatch`. That leaves two of the three consumers of
 * `ordersInBatch` undriven against the emulator:
 *
 *  - `customerJarsInBatch`, the per-person limit on the **reclaim** path;
 *  - the `amount-mismatch` refusal branch, which is the other writer of
 *    `writePaymentOnly` and reaches it before the batch is ever read.
 *
 * Both halves are asserted in each test: the refusal must not cost the
 * customer an allowance (too loose refuses a paying customer), and a real
 * sale must still cost them one (too tight oversells the batch).
 */

import { PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE, liveHeldJars } from "@lailark/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyCapturedPayment } from "../src/webhooks/capture";
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

let customerSeq = 0;
function nextCustomer(): string {
  return `+91955${String(++customerSeq).padStart(7, "0")}`;
}

async function seedProduct() {
  await db().collection("products").doc(PRODUCT).set({
    name: "Prawns and dates",
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

async function inStockBatch(): Promise<string> {
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
    data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount: 22, packedOn: "2026-09-04" },
  });
  await waitForState(ref, "inStock", "bottled", "soldOut");
  return ref;
}

async function leaveJarsFree(ref: string, free: number): Promise<void> {
  const data = await batchDoc(ref);
  const capacity = (data.bottledJars as number) ?? (data.bookableJars as number);
  await db().collection("batches").doc(ref).update({ paidCount: capacity - free, heldJars: {} });
}

async function attemptCheckout(over: Record<string, unknown> = {}) {
  return callFunction("createCheckout", null, {
    productSlug: PRODUCT,
    qty: 1,
    customerName: "Asha",
    customerPhone: nextCustomer(),
    address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    clientRef: `cr-${Math.random().toString(36).slice(2)}`,
    ...over,
  });
}

async function startCheckout(over: Record<string, unknown> = {}) {
  const out = await attemptCheckout(over);
  if (!out.result) throw new Error(`checkout failed: ${JSON.stringify(out.error)}`);
  return out.result as { orderId: string; razorpayOrderId: string; totalPaise: number };
}

async function orderDoc(orderId: string) {
  return (await db().collection("orders").doc(orderId).get()).data() ?? {};
}

describe("A203, tester: the two consumers the builder's block did not drive", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
  }, 120_000);

  beforeEach(async () => {
    ref = await inStockBatch();
  }, 120_000);

  afterAll(async () => {
    for (const doc of (await db().collection("concerns").get()).docs) await doc.ref.delete();
  }, 60_000);

  async function lapse(orderId: string): Promise<void> {
    await db()
      .collection("batches")
      .doc(ref)
      .update({ [`heldJars.${orderId}.expiresAt`]: new Date(Date.now() - 60_000) });
  }

  function capture(
    started: { orderId: string; razorpayOrderId: string; totalPaise: number },
    paymentId: string,
    amountPaise?: number,
  ) {
    return applyCapturedPayment(db(), {
      paymentId,
      razorpayOrderId: started.razorpayOrderId,
      amountPaise: amountPaise ?? started.totalPaise,
      orderId: started.orderId,
      method: "upi",
    });
  }

  async function assertNeverOversold(): Promise<void> {
    const batch = await batchDoc(ref);
    const capacity = (batch.bottledJars as number) ?? (batch.bookableJars as number);
    expect((batch.paidCount as number) + liveHeldJars(batch.heldJars, Date.now()))
      .toBeLessThanOrEqual(capacity);
  }

  it("lets the reclaim path give a jar to a customer whose earlier capture was refused", async () => {
    // The `customerJarsInBatch` door, which `readHoldToPaid` only opens when
    // the hold has lapsed and a jar has to be claimed afresh.
    await leaveJarsFree(ref, 1);
    await db().collection("batches").doc(ref).update({ perPersonLimitOverride: 1 });
    const customerPhone = nextCustomer();

    // Refusal one: hold lapses, somebody else takes the jar, capture lands.
    const first = await startCheckout({ batchRef: ref, customerPhone });
    await lapse(first.orderId);
    const thief = await startCheckout({ batchRef: ref });
    const refused = await capture(first, "pay_t203_refused");
    expect(refused.outcome).toBe("hold-gone");
    expect((await orderDoc(first.orderId)).paidAt ?? null).toBeNull();

    // The thief's hold lapses, so the jar is free again, but this time the
    // customer's own hold lapses too before their money arrives: the capture
    // has to claim a jar afresh, which is the reclaim path.
    await lapse(thief.orderId);
    const second = await attemptCheckout({ batchRef: ref, customerPhone });
    expect(second.result, JSON.stringify(second.error)).toBeTruthy();
    const started = second.result as {
      orderId: string;
      razorpayOrderId: string;
      totalPaise: number;
    };
    await lapse(started.orderId);

    const applied = await capture(started, "pay_t203_reclaim");
    // Before M3.6c the phantom jar on the refused order made
    // `customerJarsInBatch` answer 1 against a limit of 1, and this came back
    // `over-limit` with a concern for the Owner instead of a sale.
    expect(applied.outcome).toBe("applied");
    expect(applied.jars).toBe(1);
    const paid = await orderDoc(started.orderId);
    expect(paid.state).toBe("toPack");
    expect(paid.paidAt).toBeTruthy();
    await assertNeverOversold();
  }, 180_000);

  it("leaves the allowance alone after an amount-mismatch refusal, and still counts the real sale", async () => {
    // The other `writePaymentOnly` branch: it is reached before the batch is
    // read at all, so the order keeps its live hold and a captured payment.
    await leaveJarsFree(ref, 3);
    await db().collection("batches").doc(ref).update({ perPersonLimitOverride: 1 });
    const customerPhone = nextCustomer();

    const first = await startCheckout({ batchRef: ref, customerPhone });
    const mismatch = await capture(first, "pay_t203_amount", first.totalPaise + 100);
    expect(mismatch.outcome).toBe("amount-mismatch");
    const wrong = await orderDoc(first.orderId);
    expect(wrong.state).toBe("held");
    expect((wrong.payment as { status: string }).status).toBe("captured");
    expect(wrong.paidAt ?? null).toBeNull();

    // A jar they do not own must not use up their one-per-person allowance.
    await lapse(first.orderId);
    const second = await attemptCheckout({ batchRef: ref, customerPhone });
    expect(second.result, JSON.stringify(second.error)).toBeTruthy();
    const started = second.result as {
      orderId: string;
      razorpayOrderId: string;
      totalPaise: number;
    };
    const applied = await capture(started, "pay_t203_amount_ok");
    expect(applied.outcome).toBe("applied");

    // And now they really do own one, so the limit must bite: this is the
    // undercount half, which is the half that could oversell a batch.
    const third = await attemptCheckout({ batchRef: ref, customerPhone });
    expect(third.result).toBeFalsy();
    expect(third.error.message).toMatch(/already have 1/);
    await assertNeverOversold();
  }, 180_000);

  it("does not let an over-limit reclaim refusal become a second phantom claim", async () => {
    // The refusal branch A203 names that nothing else drives: the reclaim is
    // refused *because of* the per-person count, and then writes the same
    // captured payment onto a held order. If that refusal counted, one
    // genuine jar plus one refusal would read as two.
    await leaveJarsFree(ref, 4);
    await db().collection("batches").doc(ref).update({ perPersonLimitOverride: 1 });
    const customerPhone = nextCustomer();

    // One jar genuinely bought.
    const bought = await startCheckout({ batchRef: ref, customerPhone });
    expect((await capture(bought, "pay_t203_limit_real")).outcome).toBe("applied");

    // A second order, taken with the limit overridden at the counter would be
    // the honest way in; here the hold is written straight onto the batch so
    // the capture has to reclaim, and the reclaim must refuse for the limit.
    const second = await attemptCheckout({
      batchRef: ref,
      customerPhone,
      // `createCheckout` would refuse this outright, so the order is made by
      // a different customer and then re-pointed at this one: what is under
      // test is the capture's own limit check, not the checkout's.
      customerName: "Asha",
    });
    expect(second.result).toBeFalsy();
    const other = await startCheckout({ batchRef: ref });
    await db().collection("orders").doc(other.orderId).update({ customerPhone });
    await db()
      .collection("batches")
      .doc(ref)
      .update({ [`heldJars.${other.orderId}.customerPhone`]: customerPhone });
    await lapse(other.orderId);

    const refused = await capture(other, "pay_t203_limit_refused");
    expect(refused.outcome).toBe("over-limit");
    const held = await orderDoc(other.orderId);
    expect(held.state).toBe("held");
    expect((held.payment as { status: string }).status).toBe("captured");
    expect(held.paidAt ?? null).toBeNull();

    // The count the Owner and the checkout read is still exactly one jar:
    // the refusal added nothing. Raising the cap to two must therefore let
    // this customer buy exactly one more, not zero.
    await db().collection("batches").doc(ref).update({ perPersonLimitOverride: 2 });
    const third = await attemptCheckout({ batchRef: ref, customerPhone });
    expect(third.result, JSON.stringify(third.error)).toBeTruthy();
    const applied = await capture(
      third.result as { orderId: string; razorpayOrderId: string; totalPaise: number },
      "pay_t203_limit_second",
    );
    expect(applied.outcome).toBe("applied");

    // And now two are genuinely owned, so the cap of two must bite.
    const fourth = await attemptCheckout({ batchRef: ref, customerPhone });
    expect(fourth.result).toBeFalsy();
    expect(fourth.error.message).toMatch(/already have 2/);
    await assertNeverOversold();
  }, 180_000);

  it("does not count a held order whose `paidAt` was written as null", async () => {
    // The shape the predicate has to be defensive about: `paidAt: null` is a
    // field that exists, so `!== undefined` alone would read it as a sale.
    await leaveJarsFree(ref, 2);
    await db().collection("batches").doc(ref).update({ perPersonLimitOverride: 1 });
    const customerPhone = nextCustomer();

    const first = await startCheckout({ batchRef: ref, customerPhone });
    await db()
      .collection("orders")
      .doc(first.orderId)
      .update({ paidAt: null, payment: { status: "captured" } });
    await lapse(first.orderId);

    const again = await attemptCheckout({ batchRef: ref, customerPhone });
    expect(again.result, JSON.stringify(again.error)).toBeTruthy();
    await assertNeverOversold();
  }, 180_000);

  it("still counts a voided counter sale as nothing, and a live one as one jar", async () => {
    // Brief §7A.6 through the counter, not through a hand-written document:
    // the void gives the jar back and must give the allowance back with it.
    await leaveJarsFree(ref, 4);
    await db().collection("batches").doc(ref).update({ perPersonLimitOverride: 1 });
    const customerPhone = nextCustomer();

    const sale = await callFunction("createCounterSale", "owner", {
      customerPhone,
      customerName: "Asha",
      confirmNewCustomer: true,
      line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
      paymentMethod: "cash",
      fulfilment: "handedOver",
      discountPaise: 0,
      discountReason: "",
      consents: { updates: true, marketing: false },
      expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    });
    expect(sale.result, JSON.stringify(sale.error)).toBeTruthy();
    const orderId = (sale.result as { orderId: string }).orderId;
    expect((await orderDoc(orderId)).paidAt).toBeTruthy();

    // One jar owned, one allowed: the web must refuse them.
    const blocked = await attemptCheckout({ batchRef: ref, customerPhone });
    expect(blocked.result).toBeFalsy();
    expect(blocked.error.message).toMatch(/already have 1/);

    const voided = await callFunction("voidCounterSale", "owner", {
      orderId,
      reason: "Typed the wrong number.",
    });
    expect(voided.result, JSON.stringify(voided.error)).toBeTruthy();
    expect((await orderDoc(orderId)).state).toBe("voided");

    // The void did not happen, so the allowance is theirs again.
    const allowed = await attemptCheckout({ batchRef: ref, customerPhone });
    expect(allowed.result, JSON.stringify(allowed.error)).toBeTruthy();
    await assertNeverOversold();
  }, 180_000);
});
