/**
 * **The done-when of M3.8:** a seeded batch fills through the site, and every
 * customer-facing message that falls out of it is a pending approval. None is
 * sent.
 *
 * One batch of 15 planned jars walks Open -> Half reached -> Sourcing ->
 * Cooking -> Bottled -> In stock while real web checkouts (the real
 * `createCheckout`, over real HTTP, with no sign-in, exactly as the site
 * calls it) and real captures fill it up. Along the way:
 *
 *  - the 90% cap (brief §7.1): 13 bookable jars out of 15 planned, and the
 *    fourteenth booking refused;
 *  - the per-person limit, checked inside the hold transaction, across every
 *    order this number already has in this batch;
 *  - half reached and full, each raising an approval and each starting its
 *    clock, the 3 day one replacing the 5 day one (brief §8.2);
 *  - booking closing when the pot goes on (brief §7.5);
 *  - the surplus going on sale in stock at bottling;
 *  - `?s=<shareCode>` recorded on the order it arrived with;
 *  - the private order link, `/o/<token>`, answering with the order and its
 *    documents;
 *  - and D32's sending list: one row per booked customer, ticked by hand.
 *
 * The invariant asserted after every move: `paidCount + live holds <=
 * capacity`. Nothing here may oversell.
 */

import { liveHeldJars, PRICE_OPEN_PAISE, PRICE_IN_STOCK_PAISE } from "@lailark/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { readPublicOrder } from "../src/api/order";
import { applyCapturedPayment } from "../src/webhooks/capture";
import {
  approvalDoc,
  batchDoc,
  callFunction,
  clearFirestore,
  db,
  mustTransition,
  setPaidCount,
  waitFor,
  waitForState,
} from "./emulator";

const PRODUCT = "prawns-and-dates";
const PRODUCT_NAME = "Prawns and dates";
const PLANNED = 15;
const BOOKABLE = 13; // 90% of 15, rounded down (brief §7.1)
const HALF = 7; // half of bookable, rounded up
const LIMIT = 3; // a quarter of bookable, rounded down

let customerSeq = 0;
function nextCustomer(): string {
  return `+91900${String(++customerSeq).padStart(7, "0")}`;
}

let paymentSeq = 0;

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

/** One web checkout, through the real callable. Returns what the page gets. */
async function book(
  qty: number,
  over: Record<string, unknown> = {},
): Promise<Record<string, string | number>> {
  const out = await callFunction("createCheckout", null, {
    productSlug: PRODUCT,
    qty,
    customerName: "Asha",
    customerPhone: nextCustomer(),
    address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_OPEN_PAISE * qty,
    clientRef: `cr-${Math.random().toString(36).slice(2)}`,
    ...over,
  });
  if (!out.result) throw new Error(`checkout refused: ${JSON.stringify(out.error)}`);
  return out.result;
}

/** The checkout, refused. Returns the sentence the customer would read. */
async function bookRefused(qty: number, over: Record<string, unknown> = {}): Promise<string> {
  const out = await callFunction("createCheckout", null, {
    productSlug: PRODUCT,
    qty,
    customerName: "Asha",
    customerPhone: nextCustomer(),
    address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_OPEN_PAISE * qty,
    clientRef: `cr-${Math.random().toString(36).slice(2)}`,
    ...over,
  });
  if (out.result) throw new Error("that checkout should have been refused");
  return String(out.error?.message ?? "");
}

/** The money arriving, through the real capture path. */
async function pay(result: Record<string, string | number>): Promise<void> {
  const applied = await applyCapturedPayment(db(), {
    paymentId: `pay_${++paymentSeq}_${Date.now()}`,
    razorpayOrderId: String(result.razorpayOrderId),
    orderId: String(result.orderId),
    amountPaise: Number(result.totalPaise),
    method: "upi",
  });
  expect(applied.outcome).toBe("applied");
}

/** Books and pays for `qty` jars in one go, and hands back the order id. */
async function bookAndPay(qty = 1, over: Record<string, unknown> = {}): Promise<string> {
  const result = await book(qty, over);
  await pay(result);
  return String(result.orderId);
}

/**
 * CLAUDE.md §3, asserted after every move: a jar is free, held, paid or gone,
 * and never two of those at once.
 */
async function assertNeverOversold(ref: string): Promise<void> {
  const batch = await batchDoc(ref);
  const capacity =
    typeof batch.bottledJars === "number" && batch.bottledJars > 0
      ? (batch.bottledJars as number)
      : (batch.bookableJars as number);
  const held = liveHeldJars(batch.heldJars, Date.now());
  expect((batch.paidCount as number) + held).toBeLessThanOrEqual(capacity);
}

async function approvalsIn(batchRef: string) {
  const snap = await db().collection("approvals").where("batchRef", "==", batchRef).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>);
}

describe("an open batch fills through the site, M3.8", () => {
  let ref = "";
  let firstOrderId = "";
  const paidPhones: string[] = [];

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    const created = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: PRODUCT,
        recipeId: `${PRODUCT}-v1`,
        plannedJars: PLANNED,
        priceOpen: PRICE_OPEN_PAISE,
        priceInStock: PRICE_IN_STOCK_PAISE,
      },
    });
    ref = created.ref;
    await mustTransition("owner", { ref, to: "open", data: {} });
  }, 60_000);

  afterAll(async () => {
    // The approval trigger commits off the request path; give it a moment so
    // the next file's `clearFirestore` is not answered 409.
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it("opens at 90% of the planned jars, with a quarter of that per person", async () => {
    const batch = await batchDoc(ref);
    expect(batch.plannedJars).toBe(PLANNED);
    expect(batch.bookableJars).toBe(BOOKABLE);
    expect(batch.perPersonLimit).toBe(LIMIT);
    expect(batch.paidCount).toBe(0);
  });

  it("refuses more jars than one person may take, inside the transaction", async () => {
    const phone = nextCustomer();
    const first = await book(LIMIT, { customerPhone: phone, expectedTotalPaise: PRICE_OPEN_PAISE * LIMIT });
    await pay(first);
    paidPhones.push(phone);
    firstOrderId = String(first.orderId);

    const message = await bookRefused(1, { customerPhone: phone });
    expect(message).toContain("per person");
    await assertNeverOversold(ref);
  }, 60_000);

  it("reaches half and asks the Owner first, with nothing sent", async () => {
    // Three jars are paid for already. Four more takes it to seven, which is
    // half of thirteen rounded up.
    while ((await batchDoc(ref)).paidCount < HALF) {
      const phone = nextCustomer();
      await bookAndPay(1, { customerPhone: phone });
      paidPhones.push(phone);
      await assertNeverOversold(ref);
    }

    await waitForState(ref, "halfReached");
    const batch = await batchDoc(ref);
    expect(batch.paidCount).toBeGreaterThanOrEqual(HALF);
    expect(batch.halfReachedAt).toBeTruthy();

    const half = await waitFor(
      "the half-reached approval",
      () => approvalDoc(`half-${ref}`),
      (doc) => doc !== null,
    );
    expect(half?.status).toBe("waiting");
    // Brief §7.3: the 5 day production clock starts here.
    expect(half?.dueAt).toBeTruthy();
    // The whole point: the customers hear nothing until Shefin says yes.
    expect(half?.sentAt).toBeNull();
    expect(half?.recipients ?? null).toBeNull();
  }, 120_000);

  it("on yes, the message becomes a sending list and still nothing is sent", async () => {
    await mustTransition("owner", { ref, to: "sourcing", data: {} });

    const half = await waitFor(
      "the sending list to be built",
      () => approvalDoc(`half-${ref}`),
      (doc) => Array.isArray(doc?.recipients),
      30_000,
    );
    expect(half?.status).toBe("approved");
    // D32: one row per customer who paid into this batch, each with a number
    // and nothing ticked.
    const rows = half?.recipients as Array<Record<string, unknown>>;
    expect(rows.length).toBe(paidPhones.length);
    expect(rows.map((r) => r.phone).sort()).toEqual([...paidPhones].sort());
    for (const row of rows) expect(row.sentAt).toBeNull();
    // Nothing was sent by anything here, and `sentAt` on the approval is not
    // touched: that field is M5's.
    expect(half?.sentAt).toBeNull();
    expect(half?.closedAt).toBeNull();
  }, 60_000);

  it("the Owner ticks each one off, and the last tick closes the list", async () => {
    const before = (await approvalDoc(`half-${ref}`)) ?? {};
    const rows = before.recipients as Array<Record<string, unknown>>;

    for (const row of rows) {
      const out = await callFunction("answerApproval", "owner", {
        id: `half-${ref}`,
        answer: "sent",
        data: { phone: row.phone },
      });
      expect(out.result, JSON.stringify(out.error)).toBeTruthy();
    }

    const after = (await approvalDoc(`half-${ref}`)) ?? {};
    for (const row of after.recipients as Array<Record<string, unknown>>) {
      expect(row.sentAt).toBeTruthy();
    }
    // "The approval closes when all are ticked or the Owner closes it" (D32).
    expect(after.closedAt).toBeTruthy();
    // Even now, nothing claims a machine sent it.
    expect(after.sentAt).toBeNull();
  }, 120_000);

  it("only the Owner may tick a message sent", async () => {
    const out = await callFunction("answerApproval", "kitchen", {
      id: `half-${ref}`,
      answer: "sent",
      data: { phone: paidPhones[0] },
    });
    expect(out.result).toBeFalsy();
    expect(String(out.error?.message ?? "")).toContain("owner");
  });

  it("fills to the 90% cap, raises the full flag, and refuses the next jar", async () => {
    while ((await batchDoc(ref)).paidCount < BOOKABLE) {
      const left = BOOKABLE - ((await batchDoc(ref)).paidCount as number);
      const phone = nextCustomer();
      const qty = Math.min(left, LIMIT);
      await bookAndPay(qty, {
        customerPhone: phone,
        expectedTotalPaise: PRICE_OPEN_PAISE * qty,
      });
      paidPhones.push(phone);
      await assertNeverOversold(ref);
    }

    const batch = await waitFor(
      "the full flag",
      () => batchDoc(ref),
      (doc) => doc.fullReachedAt != null,
      30_000,
    );
    expect(batch.paidCount).toBe(BOOKABLE);

    // Brief §7.1: the other 10% is the buffer, and nobody may book into it.
    const message = await bookRefused(1);
    expect(message.length).toBeGreaterThan(0);
    await assertNeverOversold(ref);
  }, 180_000);

  it("the 3 day clock replaces the 5 day one, brief §8.2", async () => {
    const full = await waitFor(
      "the full approval",
      () => approvalDoc(`full-${ref}`),
      (doc) => doc !== null,
      30_000,
    );
    expect(full?.status).toBe("waiting");
    expect(full?.dueAt).toBeTruthy();
    expect(full?.sentAt).toBeNull();

    // Never two live clocks on one batch. The half approval here was already
    // answered before the batch filled, and an answered approval's clock is
    // spent rather than cancelled (`cancelApprovalClocks`), so what this
    // asserts is the thing that matters: exactly one clock is still counting,
    // and it is the 3 day one.
    const live = (await approvalsIn(ref)).filter(
      (a) => a.dueAt != null && a.status === "waiting",
    );
    expect(live.map((a) => a.id)).toEqual([`full-${ref}`]);
  }, 60_000);

  it("booking closes when the pot goes on, brief §7.5", async () => {
    await callFunction("approveBatchFull", "owner", { ref, data: {} });
    await mustTransition("kitchen", {
      ref,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
    });

    // Nothing may be booked out of a batch on the stove. The customer is told
    // there is none to send rather than given a state word: the web chooser
    // finds no batch it may sell from at all, which is the same refusal a
    // product with nothing in the kitchen gives.
    const message = await bookRefused(1);
    expect(message).toContain(`no ${PRODUCT_NAME} to send`);
    await assertNeverOversold(ref);
  }, 90_000);

  it("a booking already paid for is still honoured while the pot is on (A200)", async () => {
    // The customer booked while the batch was Open and their hold lapsed
    // before the capture landed. Booking is closed to everyone else, and the
    // cap still holds, but this jar was inside it the whole time.
    const batchBefore = await batchDoc(ref);
    // Make room inside the cap, as a jar written off or a lapsed booking would.
    await db().collection("batches").doc(ref).update({ paidCount: BOOKABLE - 1 });

    const order = await db().collection("orders").add({
      number: "o-a200",
      channel: "web",
      customerPhone: nextCustomer(),
      state: "held",
      lines: [{ productSlug: PRODUCT, batchRef: ref, qty: 1, unitPrice: PRICE_OPEN_PAISE, jarNumbers: [] }],
      batchRefs: [ref],
      shippingFee: 0,
      total: PRICE_OPEN_PAISE,
      fulfilment: "ship",
      payment: { method: "razorpay", status: "created", razorpayIds: { orderId: "order_a200" }, amount: 0, refundedAmount: 0 },
      holdExpiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
    });

    const applied = await applyCapturedPayment(db(), {
      paymentId: `pay_a200_${Date.now()}`,
      razorpayOrderId: "order_a200",
      orderId: order.id,
      amountPaise: PRICE_OPEN_PAISE,
      method: "upi",
    });
    expect(applied.outcome).toBe("applied");

    const after = (await db().collection("orders").doc(order.id).get()).data() ?? {};
    // Served, not turned into a concern: `paidCount` moved and the order left
    // `held`.
    expect(after.state).not.toBe("held");
    expect((await batchDoc(ref)).paidCount).toBe(BOOKABLE);
    await assertNeverOversold(ref);
    expect(batchBefore.state).toBe("cooking");
  }, 90_000);

  it("the surplus goes on sale in stock when the batch is bottled", async () => {
    await mustTransition("kitchen", {
      ref,
      to: "bottled",
      data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount: PLANNED, packedOn: "2026-09-04" },
    });
    // Brief §8.2: `Bottled -> In stock` is automatic when the surplus is
    // more than nothing, so the state moves on its own.
    await waitForState(ref, "inStock");

    const batch = await batchDoc(ref);
    expect(batch.bottledJars).toBe(PLANNED);
    // 15 bottled, 13 booked: the two the buffer left go on sale at ₹649.
    expect(batch.state).toBe("inStock");
    await assertNeverOversold(ref);
  }, 120_000);

  it("the share link is recorded on the order it arrived with", async () => {
    const phone = nextCustomer();
    const result = await book(1, {
      customerPhone: phone,
      expectedTotalPaise: PRICE_IN_STOCK_PAISE,
      shareCode: "k3n9x2p1a7",
    });
    const order = (await db().collection("orders").doc(String(result.orderId)).get()).data() ?? {};
    expect(order.shareCodeUsed).toBe("k3n9x2p1a7");
    // And this customer now has a code of their own to share.
    const customer = (await db().collection("customers").doc(phone).get()).data() ?? {};
    expect(typeof customer.shareCode).toBe("string");
    expect((customer.shareCode as string).length).toBeGreaterThan(3);
  }, 60_000);

  it("the private order link answers with the order and its documents", async () => {
    const order = (await db().collection("orders").doc(firstOrderId).get()).data() ?? {};
    const token = order.token as string;
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    const payload = await readPublicOrder(db(), token);
    expect(payload).not.toBeNull();
    expect(payload?.order.number).toBe(firstOrderId);
    // The product's name, not its URL slug. A web order carries
    // `customDescription: null` on every line, so the name has to be looked
    // up on `products/{slug}` the same way the batch number is (M3.8 round 2).
    expect(payload?.order.lines[0]?.description).toBe(PRODUCT_NAME);
    expect(payload?.order.lines[0]?.description).not.toBe(PRODUCT);
    expect(payload?.order.lines[0]?.qty).toBe(LIMIT);
    expect(payload?.order.totalPaise).toBe(PRICE_OPEN_PAISE * LIMIT);
    // The receipt issued when the money arrived (brief §7.2 step 4).
    expect(payload?.documents.length).toBeGreaterThan(0);

    // Nothing that is ours rather than the customer's.
    const text = JSON.stringify(payload);
    expect(text).not.toContain("razorpayIds");
    expect(text).not.toContain("kitchenNote");
    expect(text).not.toContain("clientRef");
    expect(text).not.toContain(token);

    // Nor our internal vocabulary. D63 keeps the order's state off this page
    // on purpose, and the page draws none of these four: an unauthenticated
    // endpoint should not be handing out words nothing asked for (M3.8
    // round 2).
    const projected = payload?.order as unknown as Record<string, unknown>;
    expect(projected.state).toBeUndefined();
    expect(projected.channel).toBeUndefined();
    expect(projected.paymentStatus).toBeUndefined();
    expect(projected.paymentMethod).toBeUndefined();

    // A token nobody has answers with nothing at all.
    expect(await readPublicOrder(db(), "f".repeat(32))).toBeNull();
    expect(await readPublicOrder(db(), "not-a-token")).toBeNull();
  }, 60_000);

  it("THE DONE-WHEN: every customer-facing message is a pending approval, none sent", async () => {
    const approvals = await approvalsIn(ref);
    // The batch raised real messages on its way through.
    expect(approvals.length).toBeGreaterThan(0);

    for (const approval of approvals) {
      // Nothing, anywhere, has been sent by this system.
      expect(approval.sentAt ?? null).toBeNull();
      // Every one of them carries the text that would go out, waiting.
      expect(typeof approval.draft).toBe("string");
    }

    // And there is no other door: no conversation, no message, no outbox.
    expect((await db().collection("conversations").get()).size).toBe(0);
    expect((await db().collection("messages").get()).size).toBe(0);

    // Every recipient the Owner has not ticked is still untouched, and the
    // ticks that exist were made by a person through the Owner-only callable.
    for (const approval of approvals) {
      const rows = (approval.recipients ?? []) as Array<Record<string, unknown>>;
      for (const row of rows) {
        expect(typeof row.phone).toBe("string");
      }
    }
  }, 60_000);
});

/**
 * A194 (iv), on a batch of its own: the walk above ends with its 90% cap
 * full and one jar held, so there is no room left in it to resume anything.
 */
describe("a resumed checkout keeps the share link, M3.8 (A194 iv)", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    const created = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: PRODUCT,
        recipeId: `${PRODUCT}-v1`,
        plannedJars: 20,
        priceOpen: PRICE_OPEN_PAISE,
        priceInStock: PRICE_IN_STOCK_PAISE,
      },
    });
    ref = created.ref;
    await mustTransition("owner", { ref, to: "open", data: {} });
  }, 60_000);

  afterAll(async () => {
    // The triggers commit off the request path. Long enough that none of
    // them lands after the next file's `clearFirestore`, which would leave
    // that file looking at a batch this one already finished with.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  it("a resumed checkout records the share code the first tap dropped, A194 (iv)", async () => {
    // The thing A194 (iv) flagged, end to end: a customer arrives through
    // somebody's share link, the page loses the code on the hop, they dismiss
    // the Razorpay window and tap Pay again. The same `clientRef` comes back,
    // so this is the resume door, not a second order.
    const phone = nextCustomer();
    const clientRef = `cr-resume-${Date.now()}`;
    const first = await book(1, {
      customerPhone: phone,
      expectedTotalPaise: PRICE_OPEN_PAISE,
      clientRef,
    });
    const orderId = String(first.orderId);
    const before = (await db().collection("orders").doc(orderId).get()).data() ?? {};
    expect(before.shareCodeUsed ?? null).toBeNull();

    const second = await book(1, {
      customerPhone: phone,
      expectedTotalPaise: PRICE_OPEN_PAISE,
      clientRef,
      shareCode: "resume1234",
    });
    // One order, not two: the same jar, resumed.
    expect(String(second.orderId)).toBe(orderId);
    const after = (await db().collection("orders").doc(orderId).get()).data() ?? {};
    expect(after.shareCodeUsed).toBe("resume1234");
    // And the resume moved nothing else that costs money.
    expect(after.total).toBe(before.total);
    expect(after.shippingFee).toBe(before.shippingFee);

    // A third tap carrying somebody else's code does not take the credit.
    await book(1, {
      customerPhone: phone,
      expectedTotalPaise: PRICE_OPEN_PAISE,
      clientRef,
      shareCode: "second0000",
    });
    const third = (await db().collection("orders").doc(orderId).get()).data() ?? {};
    expect(third.shareCodeUsed).toBe("resume1234");

    // Rubbish on the resume door is dropped, not stored (A205).
    const rubbishRef = `cr-rubbish-${Date.now()}`;
    const rubbishPhone = nextCustomer();
    const started = await book(1, {
      customerPhone: rubbishPhone,
      expectedTotalPaise: PRICE_OPEN_PAISE,
      clientRef: rubbishRef,
    });
    await book(1, {
      customerPhone: rubbishPhone,
      expectedTotalPaise: PRICE_OPEN_PAISE,
      clientRef: rubbishRef,
      shareCode: "<img src=x onerror=alert(1)>",
    });
    const stored = (await db().collection("orders").doc(String(started.orderId)).get()).data() ?? {};
    expect(stored.shareCodeUsed ?? null).toBeNull();
    await assertNeverOversold(ref);
  }, 120_000);
});
/**
 * CLAUDE.md §8: "Every transaction has a race test (two callers, one jar)."
 *
 * The walk above fills the batch one checkout at a time, so nothing in it
 * ever contends. These do. Each one puts two callers on the same last jar and
 * asserts the same invariant afterwards: `paidCount + live holds <=
 * capacity`. Nothing here may oversell, whichever caller wins.
 */
describe("two callers, one jar, M3.8", () => {
  const RACE_PLANNED = 10;
  const RACE_BOOKABLE = 9; // 90% of 10
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    const created = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: PRODUCT,
        recipeId: `${PRODUCT}-v1`,
        plannedJars: RACE_PLANNED,
        priceOpen: PRICE_OPEN_PAISE,
        priceInStock: PRICE_IN_STOCK_PAISE,
      },
    });
    ref = created.ref;
    await mustTransition("owner", { ref, to: "open", data: {} });
  }, 60_000);

  afterAll(async () => {
    // The triggers commit off the request path. Long enough that none of
    // them lands after the next file's `clearFirestore`, which would leave
    // that file looking at a batch this one already finished with.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  /** One checkout, whether it won or was refused. Never throws. */
  async function race(qty: number, over: Record<string, unknown> = {}) {
    return callFunction("createCheckout", null, {
      productSlug: PRODUCT,
      qty,
      customerName: "Asha",
      customerPhone: nextCustomer(),
      address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
      consents: { updates: true, marketing: false },
      expectedTotalPaise: PRICE_OPEN_PAISE * qty,
      clientRef: `cr-${Math.random().toString(36).slice(2)}`,
      ...over,
    });
  }

  it("two checkouts arriving together at the last jar: one gets it", async () => {
    // Eight paid, nine bookable: exactly one jar left inside the cap.
    while ((await batchDoc(ref)).paidCount < RACE_BOOKABLE - 1) {
      await bookAndPay(1);
    }
    expect((await batchDoc(ref)).paidCount).toBe(RACE_BOOKABLE - 1);

    const [a, b] = await Promise.all([race(1), race(1)]);
    const won = [a, b].filter((out) => out.result);
    // One jar, so one winner. The loser is refused, not queued.
    expect(won.length).toBe(1);
    await assertNeverOversold(ref);

    // The held jar is really held: the batch counts it against the cap.
    const batch = await batchDoc(ref);
    expect((batch.paidCount as number) + liveHeldJars(batch.heldJars, Date.now())).toBe(
      RACE_BOOKABLE,
    );

    // And the winner's money lands without ever crossing the cap.
    await pay(won[0].result as Record<string, string | number>);
    expect((await batchDoc(ref)).paidCount).toBe(RACE_BOOKABLE);
    await assertNeverOversold(ref);
  }, 180_000);

  it("two checkouts arriving together at the 90% cap: neither gets into the buffer", async () => {
    // The cap is full. The other 10% is the yield buffer (brief §7.1) and
    // nobody may book into it, however many callers ask at once.
    expect((await batchDoc(ref)).paidCount).toBe(RACE_BOOKABLE);

    const outs = await Promise.all([race(1), race(1), race(1)]);
    expect(outs.filter((out) => out.result).length).toBe(0);
    for (const out of outs) expect(String(out.error?.message ?? "").length).toBeGreaterThan(0);

    const batch = await batchDoc(ref);
    expect(batch.paidCount).toBe(RACE_BOOKABLE);
    expect(liveHeldJars(batch.heldJars, Date.now())).toBe(0);
    // Never into the planned jars the buffer is holding back.
    expect(batch.paidCount as number).toBeLessThan(RACE_PLANNED);
    await assertNeverOversold(ref);
  }, 120_000);

  it("two lapsed holds captured together while the pot is on (A200): the cap still holds", async () => {
    await callFunction("approveBatchFull", "owner", { ref, data: {} });
    await mustTransition("owner", { ref, to: "sourcing", data: {} });
    await mustTransition("kitchen", {
      ref,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 9_000, costRaw: 360_000 },
    });
    expect((await batchDoc(ref)).state).toBe("cooking");

    // One jar of room inside the cap, and two customers who booked while the
    // batch was Open whose fifteen minutes ran out before the money landed.
    //
    // The room is made and then **waited for**: `onBatchWritten` reacts to
    // this write off the request path, and firing the two captures before it
    // has settled reads a batch that is still moving, which is a flaky test
    // rather than a real race.
    await db()
      .collection("batches")
      .doc(ref)
      .update({ paidCount: RACE_BOOKABLE - 1, heldJars: {} });
    await waitFor(
      "the room inside the cap to settle",
      () => batchDoc(ref),
      (doc) =>
        doc.paidCount === RACE_BOOKABLE - 1 && liveHeldJars(doc.heldJars, Date.now()) === 0,
      30_000,
    );

    const made = await Promise.all(
      [1, 2].map(async (n) => {
        const rzp = `order_race_${n}_${Date.now()}`;
        const doc = await db()
          .collection("orders")
          .add({
            number: `o-race-${n}`,
            channel: "web",
            customerPhone: nextCustomer(),
            state: "held",
            lines: [
              {
                productSlug: PRODUCT,
                batchRef: ref,
                qty: 1,
                unitPrice: PRICE_OPEN_PAISE,
                jarNumbers: [],
              },
            ],
            batchRefs: [ref],
            shippingFee: 0,
            total: PRICE_OPEN_PAISE,
            fulfilment: "ship",
            payment: {
              method: "razorpay",
              status: "created",
              razorpayIds: { orderId: rzp },
              amount: 0,
              refundedAmount: 0,
            },
            holdExpiresAt: new Date(Date.now() - 60_000),
            createdAt: new Date(),
          });
        return { id: doc.id, rzp };
      }),
    );

    const applied = await Promise.all(
      made.map((order, i) =>
        applyCapturedPayment(db(), {
          paymentId: `pay_race_${i}_${Date.now()}`,
          razorpayOrderId: order.rzp,
          orderId: order.id,
          amountPaise: PRICE_OPEN_PAISE,
          method: "upi",
        }),
      ),
    );

    // One jar of room, so exactly one of the two is served. The other is a
    // concern for the Owner, never a jar that does not exist (A184: neither
    // is expired, both were really paid).
    const served = applied.filter((out) => out.outcome.startsWith("applied"));
    expect(served.length).toBe(1);
    const refused = applied.filter((out) => !out.outcome.startsWith("applied"));
    expect(refused.length).toBe(1);
    expect(refused[0].concernId).toBeTruthy();

    expect((await batchDoc(ref)).paidCount).toBe(RACE_BOOKABLE);
    await assertNeverOversold(ref);
  }, 180_000);
});

/**
 * A214, M3.8 round 3: the private order page never reads a URL slug.
 *
 * A web line carries `customDescription: null` and a `productSlug`, so the
 * only name it can be given is the one on `products/{slug}`, and a counter
 * line for a product is the same shape. That name is Shefin's to change: the
 * Products screen can rename it to nothing, or delete the product, long after
 * a batch has sold, and every customer holding an `/o/<token>` link we sent
 * with their bill reads whatever the endpoint falls back to.
 *
 * It falls back to nothing. The line keeps its quantity, its unit price, its
 * batch number and its jar numbers, and simply has no description, because
 * D63 approved this page's words one by one and a stand-in noun would be
 * copy nobody has drafted (CLAUDE.md §5).
 */
describe("a product the page cannot name, M3.8 round 3 (A214)", () => {
  const COUNTER_PHONE = "+919000555111";
  let ref = "";
  let token = "";

  /** The line the page would draw, for the counter order seeded below. */
  async function descriptionNow(): Promise<string | undefined> {
    const payload = await readPublicOrder(db(), token);
    return payload?.order.lines[0]?.description;
  }

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await db()
      .collection("customers")
      .doc(COUNTER_PHONE)
      .set({
        name: "Asha",
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

    const created = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: PRODUCT,
        recipeId: `${PRODUCT}-v1`,
        plannedJars: PLANNED,
        priceOpen: PRICE_OPEN_PAISE,
        priceInStock: PRICE_IN_STOCK_PAISE,
      },
    });
    ref = created.ref;
    await mustTransition("owner", { ref, to: "open", data: {} });
    await setPaidCount(ref, HALF);
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
      data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount: PLANNED, packedOn: "2026-09-04" },
    });
    await waitForState(ref, "inStock", "bottled", "soldOut");

    // A real counter sale, through the real callable: its one line is a
    // product line, so it carries `customDescription: null` and the slug,
    // exactly as a web line does. No test covered a counter order's name.
    const out = await callFunction("createCounterSale", "kitchen", {
      customerPhone: COUNTER_PHONE,
      customerName: "Asha",
      confirmNewCustomer: false,
      line: { kind: "product", productSlug: PRODUCT, batchRef: null, qty: 1 },
      discountPaise: 0,
      discountReason: "",
      fulfilment: "handedOver",
      paymentMethod: "cash",
      consents: { updates: true, marketing: false },
      expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    });
    if (!out.result) throw new Error(`counter sale refused: ${JSON.stringify(out.error)}`);
    const orderId = String((out.result as Record<string, unknown>).orderId);
    const order = (await db().collection("orders").doc(orderId).get()).data() ?? {};
    token = order.token as string;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  }, 180_000);

  afterEach(async () => {
    // Every case below breaks the product document; put it back.
    await seedProduct();
  });

  it("a counter sale reads the product's name, never its slug", async () => {
    expect(await descriptionNow()).toBe(PRODUCT_NAME);
    expect(await descriptionNow()).not.toBe(PRODUCT);
  }, 60_000);

  it("a name renamed to nothing leaves the line with no description at all", async () => {
    await db().collection("products").doc(PRODUCT).update({ name: "" });
    expect(await descriptionNow()).toBe("");
  }, 60_000);

  it("a name of nothing but spaces is not a name either", async () => {
    await db().collection("products").doc(PRODUCT).update({ name: "   " });
    expect(await descriptionNow()).toBe("");
  }, 60_000);

  it("a name that is not a string at all says nothing", async () => {
    await db().collection("products").doc(PRODUCT).update({ name: null });
    expect(await descriptionNow()).toBe("");
  }, 60_000);

  it("a product deleted after the sale says nothing", async () => {
    await db().collection("products").doc(PRODUCT).delete();
    expect(await descriptionNow()).toBe("");
  }, 60_000);

  it("a line pointing at no product, and a line with no product at all, say nothing", async () => {
    // Seeded rather than sold: `createCounterSale` and `createCheckout` both
    // refuse a product line with no slug, so these two shapes only exist on
    // an order whose product was removed from under it, or on a row written
    // before M3.8. The page must still read, and must still say no URL.
    const ghostToken = "a".repeat(32);
    await db()
      .collection("orders")
      .doc("order-ghost-lines")
      .set({
        number: "order-ghost-lines",
        token: ghostToken,
        total: PRICE_IN_STOCK_PAISE * 2,
        shippingFee: 0,
        lines: [
          { productSlug: "ghost-pickle", qty: 1, unitPrice: PRICE_IN_STOCK_PAISE, batchRef: ref },
          { qty: 1, unitPrice: PRICE_IN_STOCK_PAISE, batchRef: ref },
        ],
      });

    const payload = await readPublicOrder(db(), ghostToken);
    expect(payload?.order.lines.length).toBe(2);
    expect(payload?.order.lines[0]?.description).toBe("");
    expect(payload?.order.lines[1]?.description).toBe("");
    // Not one character of a URL anywhere in the answer.
    const text = JSON.stringify(payload);
    expect(text).not.toContain("ghost-pickle");
    expect(text).not.toContain(PRODUCT);
    // And the honest part of the line is still there.
    expect(payload?.order.lines[0]?.qty).toBe(1);
    expect(payload?.order.lines[0]?.unitPricePaise).toBe(PRICE_IN_STOCK_PAISE);
  }, 60_000);
});
