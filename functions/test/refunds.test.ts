/**
 * Recording a refund, against the emulators: the real `recordRefund` and
 * `markOrderRefusal` callables over real HTTP with a real role claim, real
 * transactions, a real `counters/{series}` document, a real refund note or
 * credit note in `documents`, and a real `paidCount` on a real batch.
 *
 * M4.5's done-when asks for three refunds recorded on staging (dashboard, UPI,
 * cash) with their documents existing. A deploy to staging is Shefin's, so the
 * same three walks are driven here instead, end to end, through the same code
 * a staging deploy would run.
 *
 * What is proved here and nowhere else:
 *
 *  - the money arithmetic and the count move in **one** commit (CLAUDE.md §3);
 *  - the same refund cannot be recorded twice, which is what `tx.create` on
 *    `refunds/{id}` is for;
 *  - **the race**: two callers, one jar. Two simultaneous full refunds on one
 *    order put exactly one jar back, not two;
 *  - **D65's two limbs**: a plain refund frees the customer's allowance so they
 *    may buy again, a refund marked a refusal does not, and the jar goes back
 *    in both cases;
 *  - Owner only, where it is enforced, which is the server: a screen with no
 *    button on it proves nothing.
 */

import { PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE, toDocumentId } from "@lailark/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ordersInBatch } from "../src/batches/store";
import { matchRefundToOrder } from "../src/webhooks/refund";
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
  return `+91977${String(++customerSeq).padStart(7, "0")}`;
}

/** The financial year this run falls in, so it reads its own numbers. */
function fyLabel(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() + 1 >= 4 ? y : y - 1;
  const two = (value: number) => String(value % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
}
const FY = fyLabel();

async function seedProduct(): Promise<void> {
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

/** A real batch, walked to In stock by the real state machine. */
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
  await db().collection("batches").doc(ref).update({ paidCount: 0, heldJars: {} });
  return ref;
}

/**
 * A real counter sale: one jar, paid in cash, to be collected later. `collect`
 * rather than `handedOver` on purpose, so the order lands in
 * `readyForCollection` and its jars are still on the shelf with no numbers
 * written: brief §12.3's "if not packed", which is the case the refund is
 * meant to give a jar back in.
 */
async function sellOneJar(
  ref: string,
  customerPhone: string,
): Promise<{ orderId: string; billNumber: string; total: number }> {
  const out = await callFunction("createCounterSale", "owner", {
    customerPhone,
    customerName: "Asha",
    confirmNewCustomer: true,
    line: { kind: "product", productSlug: PRODUCT, batchRef: ref, qty: 1 },
    discountPaise: 0,
    discountReason: "",
    fulfilment: "collect",
    paymentMethod: "cash",
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_IN_STOCK_PAISE,
  });
  if (!out.result) throw new Error(`sale failed: ${JSON.stringify(out.error)}`);
  const sale = out.result as { orderId: string; billNumber: string; total: number };
  return sale;
}

async function orderDoc(orderId: string): Promise<Record<string, unknown>> {
  return (await db().collection("orders").doc(orderId).get()).data() ?? {};
}

async function refundDoc(id: string): Promise<Record<string, unknown> | null> {
  const snap = await db().collection("refunds").doc(id).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

async function documentByNumber(number: string): Promise<Record<string, unknown> | null> {
  const snap = await db().collection("documents").doc(toDocumentId(number)).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

function record(who: "owner" | "kitchen" | "viewer" | null, data: Record<string, unknown>) {
  return callFunction("recordRefund", who, data);
}

async function mustRecord(data: Record<string, unknown>) {
  const out = await record("owner", data);
  if (!out.result) throw new Error(`refund refused: ${JSON.stringify(out.error)}`);
  return out.result as {
    refundId: string;
    fullyRefunded: boolean;
    jarsReturned: number;
    jarsHeldBackBecause: string | null;
    documentKind: string;
    documentNumber: string;
    orderState: string;
    paymentStatus: string;
    refundedTotal: number;
  };
}

async function paidCount(ref: string): Promise<number> {
  return ((await batchDoc(ref)).paidCount as number) ?? 0;
}

/**
 * **The invariant M4.5 round 1 broke.** `batch.paidCount` is a count of jars
 * that have left the shelf and not come back, and `ordersInBatch(...).holdsJars`
 * is the list of orders holding them. Brief §7.7 subtracts one from the other
 * (`jarsShort = paidCount - jarCount`) and then allocates the difference over
 * the other, so if the two ever describe different sets the yield shortfall
 * lands on the wrong customer. D65's refusal mark is exactly what pulled them
 * apart, by keeping a refunded order in the list while its jar went back.
 *
 * Asserted through the real `ordersInBatch` in a real transaction, not through
 * the predicate on its own, because the list is what `transitions.ts` is handed.
 */
async function assertCountMatchesHolders(ref: string, where: string): Promise<void> {
  const [batch, orders] = await Promise.all([
    batchDoc(ref),
    db().runTransaction((tx) => ordersInBatch(tx, db(), ref)),
  ]);
  const held = orders.holdsJars.reduce((sum, order) => sum + order.jars, 0);
  expect(
    held,
    `${where}: paidCount ${String(batch.paidCount)} must equal the jars held by ${JSON.stringify(
      orders.holdsJars,
    )}`,
  ).toBe(batch.paidCount as number);
}

async function refundsFor(orderId: string): Promise<Array<Record<string, unknown>>> {
  const found = await db().collection("refunds").where("orderId", "==", orderId).get();
  return found.docs.map((doc) => doc.data() as Record<string, unknown>);
}

/* ══ the three methods of brief §12.3 ═════════════════════════════════════ */

describe("brief §12.3's three refunds, each recorded with its own document", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  it("cash, handed back with a note", async () => {
    const phone = nextCustomer();
    const sale = await sellOneJar(ref, phone);
    expect(await paidCount(ref)).toBe(1);

    const result = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "Changed their mind at the door",
    });

    expect(result.fullyRefunded).toBe(true);
    expect(result.jarsReturned).toBe(1);
    // The jar and the books moved in the same commit.
    expect(await paidCount(ref)).toBe(0);

    const order = await orderDoc(sale.orderId);
    expect(order.state).toBe("refunded");
    expect((order.payment as Record<string, unknown>).status).toBe("refunded");
    expect((order.payment as Record<string, unknown>).refundedAmount).toBe(PRICE_IN_STOCK_PAISE);
    expect((order.refund as Record<string, unknown>).fullyRefunded).toBe(true);
    expect((order.refund as Record<string, unknown>).refusal ?? null).toBeNull();

    // `refunds/{id}` exists, keyed so a second cash refund is a second event.
    expect(await refundDoc(`cash-${sale.orderId}-1`)).toMatchObject({
      method: "cash",
      amount: PRICE_IN_STOCK_PAISE,
      status: "processed",
      note: "Changed their mind at the door",
    });

    // Brief §13.1: a bill was issued at save, so a refund after it is a credit
    // note, and it says which bill it reverses.
    expect(result.documentKind).toBe("creditNote");
    expect(result.documentNumber).toBe(`LKC/${FY}/0001`);
    const note = await documentByNumber(result.documentNumber);
    expect(note).toMatchObject({ kind: "creditNote", total: PRICE_IN_STOCK_PAISE, voids: sale.billNumber });
  }, 120_000);

  it("UPI to their account, with its reference", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    const result = await mustRecord({
      orderId: sale.orderId,
      method: "upi",
      amountPaise: PRICE_IN_STOCK_PAISE,
      reference: "UPI445566778899",
    });
    expect(result.documentNumber).toBe(`LKC/${FY}/0002`);
    expect(await refundDoc("upi-UPI445566778899")).toMatchObject({
      method: "upi",
      reference: "UPI445566778899",
      orderId: sale.orderId,
    });
    expect(await documentByNumber(result.documentNumber)).toMatchObject({ kind: "creditNote" });
  }, 120_000);

  it("a refund already made in the Razorpay dashboard, by its refund id", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    const result = await mustRecord({
      orderId: sale.orderId,
      method: "razorpay",
      amountPaise: PRICE_IN_STOCK_PAISE,
      razorpayRefundId: "rfnd_M45DASH01",
    });
    expect(result.documentNumber).toBe(`LKC/${FY}/0003`);
    expect(await refundDoc("razorpay-rfnd_M45DASH01")).toMatchObject({
      method: "razorpay",
      razorpayRefundId: "rfnd_M45DASH01",
    });
    expect(await documentByNumber(result.documentNumber)).toMatchObject({ kind: "creditNote" });
  }, 120_000);

  it("issues a refund note, not a credit note, when no bill was ever issued", async () => {
    // Brief §13.1's other row: "Refund note: refund where no bill exists yet."
    const phone = nextCustomer();
    const sale = await sellOneJar(ref, phone);
    await db().collection("orders").doc(sale.orderId).update({ billNumber: null });

    const result = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "No bill on this one",
    });
    expect(result.documentKind).toBe("refundNote");
    expect(result.documentNumber).toBe(`LKF/${FY}/0001`);
    expect(await documentByNumber(result.documentNumber)).toMatchObject({
      kind: "refundNote",
      voids: null,
    });
  }, 120_000);
});

/* ══ refunding twice ══════════════════════════════════════════════════════ */

describe("the same refund is never recorded twice", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  it("refuses a second refund on an order already refunded in full", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    await mustRecord({ orderId: sale.orderId, method: "cash", amountPaise: PRICE_IN_STOCK_PAISE, note: "one" });

    const again = await record("owner", {
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "two",
    });
    expect(again.result).toBeUndefined();
    expect(again.error?.message ?? "").toContain("already been refunded in full");
    // And the count did not move a second time.
    expect(await paidCount(ref)).toBe(0);
  }, 120_000);

  it("refuses the same gateway refund id on a second order, because it is one refund", async () => {
    const a = await sellOneJar(ref, nextCustomer());
    const b = await sellOneJar(ref, nextCustomer());
    await mustRecord({
      orderId: a.orderId,
      method: "razorpay",
      amountPaise: PRICE_IN_STOCK_PAISE,
      razorpayRefundId: "rfnd_ONCE",
    });
    const twice = await record("owner", {
      orderId: b.orderId,
      method: "razorpay",
      amountPaise: PRICE_IN_STOCK_PAISE,
      razorpayRefundId: "rfnd_ONCE",
    });
    expect(twice.result).toBeUndefined();
    // `tx.create` on `refunds/razorpay-rfnd_ONCE` is what refuses it, so the
    // second order is untouched: no count moved, no number burned.
    expect((await orderDoc(b.orderId)).state).toBe("readyForCollection");
  }, 120_000);

  it("refuses more than what was actually paid, to the paise", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    const over = await record("owner", {
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE + 1,
      note: "one rupee too many",
    });
    expect(over.result).toBeUndefined();
    expect(over.error?.message ?? "").toContain("Only");
  }, 120_000);
});

/* ══ a partial refund ═════════════════════════════════════════════════════ */

describe("a partial refund is not a reversal", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  it("records the money, moves no count, and leaves the order where it was", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    const part = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: 20_000,
      note: "a bit back for the broken lid",
    });

    expect(part.fullyRefunded).toBe(false);
    expect(part.jarsReturned).toBe(0);
    expect(part.jarsHeldBackBecause).toBe("partial-refund");
    expect(await paidCount(ref)).toBe(1);

    const order = await orderDoc(sale.orderId);
    // The customer is still owed the jar, so the order stays in its own state
    // and the Kitchen keeps working it.
    expect(order.state).toBe("readyForCollection");
    expect((order.payment as Record<string, unknown>).status).toBe("partlyRefunded");
    expect((order.payment as Record<string, unknown>).refundedAmount).toBe(20_000);

    // The rest of the money finishes the job, and then the jar goes back.
    const rest = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE - 20_000,
      note: "the rest",
    });
    expect(rest.fullyRefunded).toBe(true);
    expect(rest.jarsReturned).toBe(1);
    expect(await paidCount(ref)).toBe(0);
    expect((await orderDoc(sale.orderId)).state).toBe("refunded");
    // Two refunds, two documents, both in the series.
    expect(rest.documentNumber).not.toBe(part.documentNumber);
  }, 120_000);
});

/* ══ D65, both limbs ══════════════════════════════════════════════════════ */

describe("D65: the refund frees the allowance, unless it was a refusal", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
  }, 180_000);

  beforeEach(async () => {
    ref = await inStockBatch();
    // One jar each, so a second attempt by the same person is refused unless
    // the refund really handed the allowance back.
    await db().collection("batches").doc(ref).update({ perPersonLimitOverride: 1 });
  }, 180_000);

  function buyAgain(customerPhone: string) {
    return callFunction("createCheckout", null, {
      productSlug: PRODUCT,
      qty: 1,
      batchRef: ref,
      customerName: "Asha",
      customerPhone,
      address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
      consents: { updates: true, marketing: false },
      expectedTotalPaise: PRICE_IN_STOCK_PAISE,
      clientRef: `cr-${Math.random().toString(36).slice(2)}`,
    });
  }

  it("a plain refund lets the same person buy from the batch again", async () => {
    const phone = nextCustomer();
    const sale = await sellOneJar(ref, phone);

    // Their allowance is spent while they hold the jar.
    const blocked = await buyAgain(phone);
    expect(blocked.result).toBeUndefined();

    const result = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "full refund, no refusal",
    });
    expect(result.jarsReturned).toBe(1);
    expect(await paidCount(ref)).toBe(0);

    // The jar went back and so did the allowance: they may buy again.
    const allowed = await buyAgain(phone);
    expect(allowed.result, JSON.stringify(allowed.error)).toBeTruthy();
  }, 240_000);

  it("a refund marked a refusal puts the jar back and keeps the allowance spent", async () => {
    const phone = nextCustomer();
    const sale = await sellOneJar(ref, phone);

    const result = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "sent it back",
      refusalReason: "Abusive on the phone",
    });

    // The jar still goes back: refusing a person is not a reason to lose a jar
    // out of a 15-to-40 jar batch.
    expect(result.jarsReturned).toBe(1);
    expect(await paidCount(ref)).toBe(0);
    expect(result.refusalReason).toBe("Abusive on the phone");

    // The allowance stays spent, so they cannot simply buy it again.
    const blocked = await buyAgain(phone);
    expect(blocked.result).toBeUndefined();
  }, 240_000);

  it("the mark may be added after the refund, and taken off again", async () => {
    const phone = nextCustomer();
    const sale = await sellOneJar(ref, phone);
    await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "refunded first, understood later",
    });

    // Refunded plainly, so they may buy again.
    const first = await buyAgain(phone);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();
    // Clear that hold so the next attempt is about the allowance, not the jar.
    await db()
      .collection("batches")
      .doc(ref)
      .update({ heldJars: {} });

    // The Owner understands afterwards that this was a refusal.
    const marked = await callFunction("markOrderRefusal", "owner", {
      orderId: sale.orderId,
      reason: "Understood later",
    });
    expect(marked.result, JSON.stringify(marked.error)).toBeTruthy();
    expect((marked.result as { allowanceSpent: boolean }).allowanceSpent).toBe(true);
    const blocked = await buyAgain(phone);
    expect(blocked.result).toBeUndefined();

    // And off again: a mark made in error must not lock a customer out of the
    // batch for its life.
    const cleared = await callFunction("markOrderRefusal", "owner", {
      orderId: sale.orderId,
      reason: null,
    });
    expect((cleared.result as { allowanceSpent: boolean }).allowanceSpent).toBe(false);
    const allowed = await buyAgain(phone);
    expect(allowed.result, JSON.stringify(allowed.error)).toBeTruthy();
  }, 240_000);
});

/* ══ the race: two callers, one jar ═══════════════════════════════════════ */

describe("two callers at the same moment, one jar", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  it("records one refund and puts one jar back, not two", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    expect(await paidCount(ref)).toBe(1);

    // Two phones, or one phone twice, holding the button at the same moment.
    // Both transactions read the order and the batch in their own read set, so
    // the second is retried against the first one's write and then refuses on
    // `fullyRefunded`.
    const [a, b] = await Promise.all([
      record("owner", {
        orderId: sale.orderId,
        method: "cash",
        amountPaise: PRICE_IN_STOCK_PAISE,
        note: "phone one",
      }),
      record("owner", {
        orderId: sale.orderId,
        method: "cash",
        amountPaise: PRICE_IN_STOCK_PAISE,
        note: "phone two",
      }),
    ]);

    const succeeded = [a, b].filter((out) => out.result !== undefined);
    expect(succeeded.length, JSON.stringify([a.error, b.error])).toBe(1);

    // One jar back, never two, and the count never goes below zero.
    expect(await paidCount(ref)).toBe(0);
    const order = await orderDoc(sale.orderId);
    expect((order.payment as Record<string, unknown>).refundedAmount).toBe(PRICE_IN_STOCK_PAISE);
    expect((order.refund as Record<string, unknown>).jarsReturned).toBe(1);

    // One `refunds/{id}` and one document, so no number was burned twice.
    const refunds = await db().collection("refunds").where("orderId", "==", sale.orderId).get();
    expect(refunds.size).toBe(1);
    const documents = await db()
      .collection("documents")
      .where("orderId", "==", sale.orderId)
      .where("kind", "==", "creditNote")
      .get();
    expect(documents.size).toBe(1);
  }, 180_000);
});

/* ══ who may record one ═══════════════════════════════════════════════════ */

describe("only the Owner records a refund", () => {
  let ref = "";
  let orderId = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
    orderId = (await sellOneJar(ref, nextCustomer())).orderId;
  }, 180_000);

  it("refuses Kitchen, a Viewer and a caller with no token, and moves nothing", async () => {
    for (const who of ["kitchen", "viewer", null] as const) {
      const out = await record(who, {
        orderId,
        method: "cash",
        amountPaise: PRICE_IN_STOCK_PAISE,
        note: "not mine to do",
      });
      expect(out.result, String(who)).toBeUndefined();
    }
    expect(await paidCount(ref)).toBe(1);
    expect((await orderDoc(orderId)).refund ?? null).toBeNull();
  }, 120_000);

  it("refuses the refusal mark to Kitchen, a Viewer and a caller with no token", async () => {
    // D65's mark decides whether a customer's allowance for the batch stays
    // spent, so it is as much the Owner's as the refund is.
    for (const who of ["kitchen", "viewer", null] as const) {
      const out = await callFunction("markOrderRefusal", who, { orderId, reason: "no" });
      expect(out.result, String(who)).toBeUndefined();
    }
    expect((await orderDoc(orderId)).refund ?? null).toBeNull();
  }, 120_000);

  it("lets the Owner do it", async () => {
    const out = await record("owner", {
      orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "mine to do",
    });
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();
  }, 120_000);
});

/* ══ M3.6's hook: a gateway refund the Owner still has to record ══════════ */

describe("a refund.processed webhook leaves the Owner something to record", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  afterAll(async () => {
    for (const doc of (await db().collection("concerns").get()).docs) await doc.ref.delete();
  }, 60_000);

  it("writes the to-do marker on the order, and no money", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    await db()
      .collection("orders")
      .doc(sale.orderId)
      .update({ "payment.razorpayIds.paymentId": "pay_M45HOOK" });

    const matched = await matchRefundToOrder(db(), {
      refundId: "rfnd_M45HOOK",
      paymentId: "pay_M45HOOK",
      amountPaise: PRICE_IN_STOCK_PAISE,
      orderId: "",
    });
    expect(matched.orderId).toBe(sale.orderId);
    expect(matched.recorded).toBe(false);

    const order = await orderDoc(sale.orderId);
    const pending = (order.refund as Record<string, unknown>).gatewayPending as Record<string, unknown>;
    expect(pending).toMatchObject({
      razorpayRefundId: "rfnd_M45HOOK",
      razorpayPaymentId: "pay_M45HOOK",
      amount: PRICE_IN_STOCK_PAISE,
    });
    // A to-do marker is not a ledger entry: no money on the order moved, no
    // count moved, no document was issued.
    expect((order.payment as Record<string, unknown>).status).toBe("captured");
    expect((order.payment as Record<string, unknown>).refundedAmount).toBe(0);
    expect(order.state).toBe("readyForCollection");
    expect(await paidCount(ref)).toBe(1);

    // Recording it clears the marker.
    const result = await mustRecord({
      orderId: sale.orderId,
      method: "razorpay",
      amountPaise: PRICE_IN_STOCK_PAISE,
      razorpayRefundId: "rfnd_M45HOOK",
    });
    expect(result.jarsReturned).toBe(1);
    const after = await orderDoc(sale.orderId);
    expect((after.refund as Record<string, unknown>).gatewayPending ?? null).toBeNull();

    // A webhook redelivered after the refund was recorded asks for nothing.
    const again = await matchRefundToOrder(db(), {
      refundId: "rfnd_M45HOOK",
      paymentId: "pay_M45HOOK",
      amountPaise: PRICE_IN_STOCK_PAISE,
      orderId: "",
    });
    expect(again.recorded).toBe(true);
    expect((await orderDoc(sale.orderId)).refund).toMatchObject({ gatewayPending: null });
  }, 180_000);
});

/* ══ the invariant between paidCount and the holds-jars list ══════════════ */

describe("paidCount and the orders holding jars stay the same set", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
  }, 180_000);

  beforeEach(async () => {
    ref = await inStockBatch();
  }, 180_000);

  it("holds through a plain refund and through a refusal-marked one", async () => {
    const a = await sellOneJar(ref, nextCustomer());
    const b = await sellOneJar(ref, nextCustomer());
    await assertCountMatchesHolders(ref, "two paid sales");

    await mustRecord({ orderId: a.orderId, method: "cash", amountPaise: PRICE_IN_STOCK_PAISE, note: "plain" });
    await assertCountMatchesHolders(ref, "after a plain refund");

    await mustRecord({
      orderId: b.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "refused",
      refusalReason: "Abusive on the phone",
    });
    // The case that used to fail: the refusal kept `b` in the list while its jar
    // went back, so `paidCount` said 0 and the list said 1 jar.
    await assertCountMatchesHolders(ref, "after a refusal-marked refund");
    expect(await paidCount(ref)).toBe(0);
  }, 240_000);

  it("holds through a partial refund, which moves neither", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    await mustRecord({ orderId: sale.orderId, method: "cash", amountPaise: 20_000, note: "part" });
    await assertCountMatchesHolders(ref, "after a partial refund");
    expect(await paidCount(ref)).toBe(1);
  }, 180_000);

  it("keeps a packed order in the list, because its jars did not come back", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    // Packed and shipped: brief §12.3's "if not packed" means nothing returns,
    // so `paidCount` stays 1 and the order stays in the list. The allowance is
    // still freed, which the D65 block covers.
    await db()
      .collection("orders")
      .doc(sale.orderId)
      .update({ state: "shipped", lines: [{ ...(await orderDoc(sale.orderId)).lines?.[0] as object, jarNumbers: [3] }] });
    await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "gone in a box",
    });
    expect(await paidCount(ref)).toBe(1);
    await assertCountMatchesHolders(ref, "after refunding a shipped order");
  }, 180_000);

  it("a refusal-marked refund sends its yield shortfall to the customer still holding a jar", async () => {
    // Brief §7.7, through the real bottling transition: two paid sales, the
    // newer one refunded and marked a refusal, then the batch bottles one jar
    // short. Round 1 allocated the shortfall to the refunded, refused customer,
    // who is owed nothing, and told the customer holding a real jar nothing.
    const keeps = await sellOneJar(ref, nextCustomer());
    const refused = await sellOneJar(ref, nextCustomer());
    await mustRecord({
      orderId: refused.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "sent it back",
      refusalReason: "Abusive on the phone",
    });

    const orders = await db().runTransaction((tx) => ordersInBatch(tx, db(), ref));
    expect(orders.holdsJars.map((o) => o.id)).toEqual([keeps.orderId]);
    // And the allowance list still carries the refused order, which is D65.
    expect(orders.spentAllowance.map((o) => o.id).sort()).toEqual(
      [keeps.orderId, refused.orderId].sort(),
    );
  }, 240_000);
});

/* ══ two partial refunds: the cumulative total, and the three stores ══════ */

describe("two partial refunds on one order", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  it("adds up, and never pays out more than arrived", async () => {
    // The mutation this catches: `refundedAmount: plan.amount` instead of
    // `plan.refundedTotal`. `refundedSoFar` is read from that field and nowhere
    // else, so with it wrong three refunds of 300, 300 and 349 rupees walk
    // straight through the ceiling and hand back 949 on a 649 order.
    const sale = await sellOneJar(ref, nextCustomer());

    const first = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: 30_000,
      note: "first part",
    });
    expect(first.refundedTotal).toBe(30_000);
    expect(((await orderDoc(sale.orderId)).payment as Record<string, unknown>).refundedAmount).toBe(30_000);

    const second = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: 30_000,
      note: "second part",
    });
    expect(second.refundedTotal).toBe(60_000);
    expect(((await orderDoc(sale.orderId)).payment as Record<string, unknown>).refundedAmount).toBe(60_000);
    expect(second.fullyRefunded).toBe(false);
    expect(await paidCount(ref)).toBe(1);

    // A third that would overshoot is refused to the paise, which is only true
    // because the second one accumulated.
    const over = await record("owner", {
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE - 60_000 + 1,
      note: "one paisa too many",
    });
    expect(over.result).toBeUndefined();

    const rest = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE - 60_000,
      note: "the rest",
    });
    expect(rest.refundedTotal).toBe(PRICE_IN_STOCK_PAISE);
    expect(rest.fullyRefunded).toBe(true);
    expect(await paidCount(ref)).toBe(0);
  }, 240_000);

  it("keeps its three stores of the same number in agreement", async () => {
    // `payment.refundedAmount`, `refund.totalPaise` and the sum of the
    // `refunds` documents are three records of one figure and nothing in the
    // code reconciles them, so this does.
    const sale = await sellOneJar(ref, nextCustomer());
    for (const amountPaise of [10_000, 20_000, PRICE_IN_STOCK_PAISE - 30_000]) {
      await mustRecord({ orderId: sale.orderId, method: "cash", amountPaise, note: `part ${amountPaise}` });
    }

    const order = await orderDoc(sale.orderId);
    const payment = order.payment as Record<string, unknown>;
    const block = order.refund as Record<string, unknown>;
    const documents = await refundsFor(sale.orderId);
    const summed = documents.reduce((total, row) => total + (row.amount as number), 0);

    expect(documents).toHaveLength(3);
    expect(payment.refundedAmount).toBe(PRICE_IN_STOCK_PAISE);
    expect(block.totalPaise).toBe(PRICE_IN_STOCK_PAISE);
    expect(summed).toBe(PRICE_IN_STOCK_PAISE);
  }, 240_000);
});

/* ══ the gateway fee, in paise, on both documents ═════════════════════════ */

describe("the unreturned gateway fee is recorded for the batch P&L", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  /** A counter sale, then its payment rewritten as an online one. */
  async function onlineSale(): Promise<string> {
    const sale = await sellOneJar(ref, nextCustomer());
    await db()
      .collection("orders")
      .doc(sale.orderId)
      .update({ "payment.method": "razorpay", "payment.razorpayIds.paymentId": `pay_${sale.orderId}` });
    return sale.orderId;
  }

  it("is written in paise on the refund and on the order, to the value given", async () => {
    // Asserted by value, not by presence: a rupee/paise confusion in this one
    // number is the whole of what it adds to the P&L.
    const orderId = await onlineSale();
    const result = await mustRecord({
      orderId,
      method: "razorpay",
      amountPaise: 30_000,
      razorpayRefundId: "rfnd_FEE1",
      gatewayFeeUnreturnedPaise: 1_532,
    });
    expect(result.fullyRefunded).toBe(false);

    expect((await refundDoc("razorpay-rfnd_FEE1"))?.gatewayFeeUnreturned).toBe(1_532);
    const block = (await orderDoc(orderId)).refund as Record<string, unknown>;
    expect(block.gatewayFeeUnreturned).toBe(1_532);
  }, 180_000);

  it("accumulates, and a later refund naming no fee does not wipe it", async () => {
    const orderId = await onlineSale();
    await mustRecord({
      orderId,
      method: "razorpay",
      amountPaise: 20_000,
      razorpayRefundId: "rfnd_FEE2A",
      gatewayFeeUnreturnedPaise: 1_532,
    });
    await mustRecord({
      orderId,
      method: "razorpay",
      amountPaise: 20_000,
      razorpayRefundId: "rfnd_FEE2B",
      gatewayFeeUnreturnedPaise: 1_200,
    });
    let block = (await orderDoc(orderId)).refund as Record<string, unknown>;
    expect(block.gatewayFeeUnreturned).toBe(2_732);

    // The third names no fee. The recorded cost must survive it.
    await mustRecord({
      orderId,
      method: "razorpay",
      amountPaise: PRICE_IN_STOCK_PAISE - 40_000,
      razorpayRefundId: "rfnd_FEE2C",
    });
    block = (await orderDoc(orderId)).refund as Record<string, unknown>;
    expect(block.gatewayFeeUnreturned).toBe(2_732);
    // And the per-refund record still says this one cost nothing it knows of.
    expect((await refundDoc("razorpay-rfnd_FEE2C"))?.gatewayFeeUnreturned).toBeNull();
  }, 240_000);

  it("refuses a fee larger than what was paid, and records nothing", async () => {
    const orderId = await onlineSale();
    const out = await record("owner", {
      orderId,
      method: "razorpay",
      amountPaise: PRICE_IN_STOCK_PAISE,
      razorpayRefundId: "rfnd_FEE3",
      gatewayFeeUnreturnedPaise: 500_000_000,
    });
    expect(out.result).toBeUndefined();
    expect(out.error?.message ?? "").toContain("more than the");
    expect(await refundDoc("razorpay-rfnd_FEE3")).toBeNull();
  }, 180_000);
});

/* ══ the refund note's own arithmetic, on a real document ═════════════════ */

describe("the refund note that reaches a customer adds up", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  /**
   * The **stored** document's own arithmetic, in the shape `documents/{id}`
   * actually has.
   *
   * `documentLines` (`money/plan.ts`) pushes the shipping fee **into `lines`**
   * as a line of its own, and the document also carries `shippingFee` as a
   * field. So adding both would count shipping twice. The first version of this
   * helper did exactly that and was invisible only because every order in this
   * file had no shipping; the round-2 tester caught it before item A's orders
   * made it lie. The stored relation is:
   *
   *     sum(lines[].amount) - discount === total
   *
   * Not to be confused with `refundPlan.test.ts`'s own `closes`, which checks
   * the **source** body `planRefundDocumentBody` returns, where shipping is
   * still a separate field and has not been folded into `lines` yet, so there
   * the sum does include it.
   */
  function closes(document: Record<string, unknown>): void {
    const lines = document.lines as Array<Record<string, number>>;
    const goods = lines.reduce((sum, line) => sum + line.amount, 0);
    expect(
      goods - (document.discount as number),
      `lines ${JSON.stringify(lines)} less discount ${String(document.discount)} must equal total ${String(document.total)}`,
    ).toBe(document.total as number);
  }

  /**
   * A sale carrying a shipping fee or a discount, which a counter sale in this
   * file never does: brief §4.2's shipping switch is `free` at launch, and
   * `seedProduct` sets `shippingRule: "free"`.
   *
   * So the sale is made for real and then the three figures that travel
   * together are patched consistently, exactly as a `flatFee` web order or a
   * discounted counter sale would have written them: the fee or the discount,
   * the order `total`, and `payment.amount`, which is what the refund ceiling is
   * measured against. Patching only one of them would make the full refund fail
   * to reconcile for the wrong reason and quietly test nothing.
   */
  async function saleCarrying(
    extra: { readonly shippingFee?: number; readonly discountPaise?: number },
  ): Promise<{ readonly orderId: string; readonly total: number }> {
    const sale = await sellOneJar(ref, nextCustomer());
    const shippingFee = extra.shippingFee ?? 0;
    const discountPaise = extra.discountPaise ?? 0;
    const total = PRICE_IN_STOCK_PAISE + shippingFee - discountPaise;
    await db()
      .collection("orders")
      .doc(sale.orderId)
      .update({
        shippingFee,
        discount:
          discountPaise === 0 ? null : { amount: discountPaise, reason: "Regular customer", by: "owner" },
        total,
        "payment.amount": total,
      });
    return { orderId: sale.orderId, total };
  }

  it("a partial refund's credit note reads the amount refunded, not the jar's price", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    const part = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: 30_000,
      note: "part back",
    });
    const note = (await documentByNumber(part.documentNumber)) as Record<string, unknown>;
    expect(note.total).toBe(30_000);
    closes(note);
    const lines = note.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe("Part refund, Prawns and dates, batch 001");
    // Never the product slug, which is a developer's string.
    expect(String(lines[0].description)).not.toContain("prawns-and-dates");
  }, 180_000);

  it("a full refund's credit note itemises the sale and still closes", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    const full = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "all back",
    });
    const note = (await documentByNumber(full.documentNumber)) as Record<string, unknown>;
    expect(note.total).toBe(PRICE_IN_STOCK_PAISE);
    closes(note);
    const lines = note.lines as Array<Record<string, unknown>>;
    expect(lines[0].description).toBe("Prawns and dates, batch 001");
    expect(lines[0].batchNo).toBe("001");
  }, 180_000);

  /* ---- an order carrying delivery, brief §4.2's shipping switch ---- */

  it("a full refund of an order with shipping itemises the shipping line too", async () => {
    const sale = await saleCarrying({ shippingFee: 8_000 });
    const full = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: sale.total,
      note: "all back, delivery included",
    });
    const note = (await documentByNumber(full.documentNumber)) as Record<string, unknown>;
    expect(note.total).toBe(72_900);
    closes(note);
    // The jar and the delivery, both reversed, because the customer paid for
    // both and is getting both back.
    const lines = note.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0].description).toBe("Prawns and dates, batch 001");
    expect(lines[1].description).toBe("Shipping");
    expect(lines[1].amount).toBe(8_000);
    expect(note.shippingFee).toBe(8_000);
  }, 180_000);

  it("a partial refund of an order with shipping folds the shipping away", async () => {
    // **The mutation this closes.** With `shippingFee: args.shippingFee` in
    // `planRefundDocumentBody`'s one-line branch, this note reads 380 rupees of
    // goods against a 300 rupee total, and no test in this file could see it
    // because every other order here carries no delivery.
    const sale = await saleCarrying({ shippingFee: 8_000 });
    const part = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: 30_000,
      note: "part back",
    });
    const note = (await documentByNumber(part.documentNumber)) as Record<string, unknown>;
    expect(note.total).toBe(30_000);
    closes(note);
    const lines = note.lines as Array<Record<string, unknown>>;
    // One line and no shipping line: 300 rupees came back, not 300 plus the
    // delivery the customer still had.
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(30_000);
    expect(note.shippingFee).toBe(0);
  }, 180_000);

  /* ---- an order carrying a discount, D17 and brief §7A.1 ---- */

  it("a full refund of a discounted order itemises the discount too", async () => {
    const sale = await saleCarrying({ discountPaise: 5_000 });
    const full = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: sale.total,
      note: "all back, as discounted",
    });
    const note = (await documentByNumber(full.documentNumber)) as Record<string, unknown>;
    expect(note.total).toBe(59_900);
    closes(note);
    // The goods column reads the list price and the discount comes off under
    // it, once, which is how the bill it reverses read (brief §13.2).
    const lines = note.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(PRICE_IN_STOCK_PAISE);
    expect(note.discount).toBe(5_000);
    expect(note.discountReason).toBe("Regular customer");
  }, 180_000);

  it("a partial refund of a discounted order folds the discount away", async () => {
    // The sibling mutation: `discount: args.discount` in the one-line branch
    // would read 300 rupees of goods less a 50 rupee discount against a 300
    // rupee total.
    const sale = await saleCarrying({ discountPaise: 5_000 });
    const part = await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: 30_000,
      note: "part back",
    });
    const note = (await documentByNumber(part.documentNumber)) as Record<string, unknown>;
    expect(note.total).toBe(30_000);
    closes(note);
    expect(note.discount).toBe(0);
    expect(note.discountReason).toBeNull();
    expect((note.lines as Array<Record<string, unknown>>)[0].amount).toBe(30_000);
  }, 180_000);
});

/* ══ a duplicate refund is refused in words, not with a 500 ═══════════════ */

describe("the same refund offered twice is refused in words", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  it("answers a duplicate gateway refund id with a sentence, not INTERNAL", async () => {
    const a = await sellOneJar(ref, nextCustomer());
    const b = await sellOneJar(ref, nextCustomer());
    await mustRecord({
      orderId: a.orderId,
      method: "razorpay",
      amountPaise: PRICE_IN_STOCK_PAISE,
      razorpayRefundId: "rfnd_TWICE",
    });
    const again = await record("owner", {
      orderId: b.orderId,
      method: "razorpay",
      amountPaise: PRICE_IN_STOCK_PAISE,
      razorpayRefundId: "rfnd_TWICE",
    });
    expect(again.result).toBeUndefined();
    // The Owner is told what happened, rather than being asked to read a reason
    // that is not there.
    expect(again.error?.status).toBe("FAILED_PRECONDITION");
    expect(again.error?.message ?? "").toContain("already recorded");
    expect((await orderDoc(b.orderId)).state).toBe("readyForCollection");
  }, 180_000);

  it("answers a UPI reference typed twice the same way", async () => {
    const a = await sellOneJar(ref, nextCustomer());
    const b = await sellOneJar(ref, nextCustomer());
    await mustRecord({
      orderId: a.orderId,
      method: "upi",
      amountPaise: PRICE_IN_STOCK_PAISE,
      reference: "UPISAME99",
    });
    const again = await record("owner", {
      orderId: b.orderId,
      method: "upi",
      amountPaise: PRICE_IN_STOCK_PAISE,
      reference: "UPISAME99",
    });
    expect(again.error?.status).toBe("FAILED_PRECONDITION");
    expect(again.error?.message ?? "").toContain("already recorded");
  }, 180_000);
});

/* ══ the marker on an order settled another way ═══════════════════════════ */

describe("the webhook leaves no to-do on an order that is already settled", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 180_000);

  afterAll(async () => {
    for (const doc of (await db().collection("concerns").get()).docs) await doc.ref.delete();
  }, 60_000);

  it("writes nothing when the refund was recorded as cash before the webhook arrived", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    await db()
      .collection("orders")
      .doc(sale.orderId)
      .update({ "payment.razorpayIds.paymentId": "pay_SETTLED" });
    await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "handed it back before the gateway told us",
    });

    const matched = await matchRefundToOrder(db(), {
      refundId: "rfnd_SETTLED",
      paymentId: "pay_SETTLED",
      amountPaise: PRICE_IN_STOCK_PAISE,
      orderId: "",
    });
    expect(matched.orderId).toBe(sale.orderId);
    // It says it is recorded, because it is, and it leaves no marker on a
    // fully refunded order where the form that would clear one is hidden.
    expect(matched.recorded).toBe(true);
    const block = (await orderDoc(sale.orderId)).refund as Record<string, unknown>;
    expect(block.gatewayPending ?? null).toBeNull();
  }, 180_000);

  it("clears a marker already standing when a refund by another method settles the order", async () => {
    const sale = await sellOneJar(ref, nextCustomer());
    await db()
      .collection("orders")
      .doc(sale.orderId)
      .update({ "payment.razorpayIds.paymentId": "pay_CLEARED" });

    // The gateway asks first.
    await matchRefundToOrder(db(), {
      refundId: "rfnd_CLEARED",
      paymentId: "pay_CLEARED",
      amountPaise: PRICE_IN_STOCK_PAISE,
      orderId: "",
    });
    expect(
      ((await orderDoc(sale.orderId)).refund as Record<string, unknown>).gatewayPending,
    ).toBeTruthy();

    // The Owner records it as cash instead, which settles the order in full.
    await mustRecord({
      orderId: sale.orderId,
      method: "cash",
      amountPaise: PRICE_IN_STOCK_PAISE,
      note: "recorded as cash after all",
    });
    const block = (await orderDoc(sale.orderId)).refund as Record<string, unknown>;
    expect(block.gatewayPending ?? null).toBeNull();
  }, 180_000);
});
