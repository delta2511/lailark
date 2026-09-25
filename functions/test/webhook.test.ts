/**
 * M3.6 against the emulators: the real HTTP function at its real URL, the
 * real Cloud Tasks queue behind it, real transactions on real documents.
 *
 * Razorpay itself is never reached. `api.razorpay.com` is blocked in this
 * container and there is no key in it, so every delivery here is a body this
 * file signs with `EMULATOR_WEBHOOK_SECRET` and posts itself, which is what
 * makes the bad-signature tests possible at all: the handler's verification
 * is switched on exactly as it is in production, and only the secret is a
 * known constant. The reconciliation is given a stub in place of the gateway
 * for the same reason, through the argument it takes for it.
 *
 * What is proven here, in the order the task asks for it:
 *
 *  - a capture turns a hold into a sale, moves the count and issues the bill;
 *  - the same webhook twice changes nothing the second time;
 *  - a bad or tampered signature moves no money and leaves no record;
 *  - a payment with no webhook at all is recovered by the 15-minute job;
 *  - A184: a capture landing mid-release neither expires the paid order nor
 *    puts its jars back.
 */

import { PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE, liveHeldJars } from "@lailark/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { releaseHold } from "../src/orders/createCheckout";
import { EMULATOR_WEBHOOK_SECRET } from "../src/orders/razorpay";
import { sweepExpiredHolds } from "../src/orders/sweepHolds";
import { applyCapturedPayment } from "../src/webhooks/capture";
import { razorpaySignatureFor } from "../src/webhooks/razorpayEvents";
import { processWebhookEvent } from "../src/webhooks/razorpayWebhook";
import { reconcilePendingPayments } from "../src/webhooks/reconcile";
import {
  batchDoc,
  callFunction,
  clearFirestore,
  db,
  FUNCTIONS_HOST,
  mustTransition,
  PROJECT,
  setPaidCount,
  waitFor,
  waitForState,
} from "./emulator";

const PRODUCT = "prawns-and-dates";
/**
 * A fresh customer per checkout. The per-person limit is counted across a
 * customer's paid orders in a batch (brief 7.2 step 3), and these tests pay
 * for jar after jar out of one batch, so reusing a number would hit that cap
 * rather than testing anything about webhooks.
 */
let customerSeq = 0;
function nextCustomer(): string {
  return `+91900${String(++customerSeq).padStart(7, "0")}`;
}

const WEBHOOK_URL = `${FUNCTIONS_HOST}/${PROJECT}/asia-south1/razorpayWebhook`;

/* -------------------------------------------------------------------------- */
/* Seeding                                                                    */
/* -------------------------------------------------------------------------- */

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

async function openBatch(): Promise<string> {
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
  return ref;
}

async function inStockBatch(): Promise<string> {
  const ref = await openBatch();
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

/** A real web checkout, through the real callable, holding one jar. */
async function startCheckout(over: Record<string, unknown> = {}) {
  const customerPhone = nextCustomer();
  const out = await callFunction("createCheckout", null, {
    productSlug: PRODUCT,
    qty: 1,
    customerName: "Asha",
    customerPhone,
    address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    clientRef: `cr-${Math.random().toString(36).slice(2)}`,
    ...over,
  });
  if (!out.result) throw new Error(`checkout failed: ${JSON.stringify(out.error)}`);
  return out.result as {
    orderId: string;
    razorpayOrderId: string;
    totalPaise: number;
    batchRef: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Deliveries                                                                 */
/* -------------------------------------------------------------------------- */

let paymentSeq = 0;

function capturedEvent(args: {
  orderId: string;
  razorpayOrderId: string;
  amountPaise: number;
  paymentId?: string;
}) {
  return {
    entity: "event",
    account_id: "acc_emulator",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: args.paymentId ?? `pay_${++paymentSeq}_${Date.now()}`,
          amount: args.amountPaise,
          currency: "INR",
          status: "captured",
          order_id: args.razorpayOrderId,
          method: "upi",
          notes: { lailark_order_id: args.orderId, lailark_jars: "1" },
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };
}

/** Posts a body at the real function URL, signed unless told otherwise. */
async function deliver(
  body: unknown,
  opts: { eventId?: string; signature?: string | null; rawBody?: string } = {},
) {
  const raw = opts.rawBody ?? JSON.stringify(body);
  const signature =
    opts.signature === undefined ? razorpaySignatureFor(raw, EMULATOR_WEBHOOK_SECRET) : opts.signature;
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature === null ? {} : { "x-razorpay-signature": signature }),
      ...(opts.eventId ? { "x-razorpay-event-id": opts.eventId } : {}),
    },
    body: raw,
  });
  return { status: res.status, text: await res.text() };
}

/** Every document-number counter and where it stands. A replay must not move one. */
async function countersSnapshot(): Promise<Record<string, unknown>> {
  const snap = await db().collection("counters").get();
  const out: Record<string, unknown> = {};
  for (const doc of snap.docs) out[doc.id] = doc.get("next") ?? null;
  return out;
}

async function orderDoc(orderId: string) {
  return (await db().collection("orders").doc(orderId).get()).data() ?? {};
}

/**
 * How long a wait on the queued worker gets. The task queue retries with a
 * backoff when the functions emulator is busy, which it is when the whole
 * suite is running on a loaded box, so this is generously longer than one
 * retry rather than tuned to a quiet machine.
 */
const WORKER_TIMEOUT_MS = 45_000;
/** Room for that wait plus the checkout in front of it. */
const WORKER_TEST_TIMEOUT_MS = 90_000;

/** The worker runs off the request path, so every assertion waits for it. */
async function waitForPaid(orderId: string) {
  return waitFor(
    `order ${orderId} to be paid`,
    () => orderDoc(orderId),
    (order) => String((order.payment as { status?: string })?.status ?? "") === "captured",
    WORKER_TIMEOUT_MS,
  );
}

/**
 * Nothing still in flight when this file hands over to the next one.
 *
 * The queued worker commits after the test that triggered it has finished
 * asserting, and the next file's `clearFirestore` would otherwise race a
 * live transaction and be answered 409.
 */
async function drainWorker(): Promise<void> {
  await waitFor(
    "every webhook event to be finished with",
    async () => {
      const snap = await db().collection("webhookEvents").get();
      return snap.docs.filter((doc) => doc.get("processedAt") == null).length;
    },
    (pending) => pending === 0,
    WORKER_TIMEOUT_MS,
  ).catch(() => undefined);
  // A last moment for the `processedAt` write itself to settle.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/* -------------------------------------------------------------------------- */

describe("the Razorpay webhook, brief 9.2 and 19.2", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 120_000);

  beforeEach(async () => {
    await leaveJarsFree(ref, 6);
  });

  afterAll(drainWorker, 60_000);

  it("turns the hold into a sale, moves the count and issues the bill", async () => {
    const started = await startCheckout();
    const before = await batchDoc(ref);
    expect(liveHeldJars(before.heldJars, Date.now())).toBe(1);
    const paidBefore = before.paidCount as number;

    const out = await deliver(
      capturedEvent({
        orderId: started.orderId,
        razorpayOrderId: started.razorpayOrderId,
        amountPaise: started.totalPaise,
      }),
      { eventId: `evt_sale_${started.orderId}` },
    );
    expect(out.status).toBe(200);

    const order = await waitForPaid(started.orderId);
    // Brief 9.1: a jar that exists goes to the packing list.
    expect(order.state).toBe("toPack");
    expect((order.payment as { amount: number }).amount).toBe(started.totalPaise);
    expect((order.payment as { razorpayIds: { paymentId: string } }).razorpayIds.paymentId)
      .toMatch(/^pay_/);
    expect(order.holdExpiresAt).toBeNull();
    // Brief 13.1: in stock online, the bill exists at payment.
    expect(String(order.billNumber)).toMatch(/^LK\/\d\d-\d\d\/\d{4}$/);

    // The jar is gone from held and on paid: the same jar, once.
    const after = await batchDoc(ref);
    expect(liveHeldJars(after.heldJars, Date.now())).toBe(0);
    expect((after.heldJars as Record<string, unknown>)[started.orderId]).toBeUndefined();
    expect(after.paidCount).toBe(paidBefore + 1);

    const documents = await db()
      .collection("documents")
      .where("orderId", "==", started.orderId)
      .get();
    expect(documents.size).toBe(1);
    expect(documents.docs[0].get("kind")).toBe("bill");

    // Nothing was sent to anybody (D32): no message, no draft, no concern.
    expect((await db().collection("concerns").get()).size).toBe(0);
    expect((await db().collection("messages").get()).size).toBe(0);
  }, WORKER_TEST_TIMEOUT_MS);

  it("changes nothing the second time the same webhook arrives", async () => {
    const started = await startCheckout();
    const event = capturedEvent({
      orderId: started.orderId,
      razorpayOrderId: started.razorpayOrderId,
      amountPaise: started.totalPaise,
    });
    const eventId = `evt_replay_${started.orderId}`;

    expect((await deliver(event, { eventId })).status).toBe(200);
    const order = await waitForPaid(started.orderId);
    const batchAfterFirst = await batchDoc(ref);
    const documentsAfterFirst = (await db().collection("documents").get()).size;
    const countersAfterFirst = await countersSnapshot();

    // The very same delivery, again. Razorpay retries exactly like this.
    const second = await deliver(event, { eventId });
    expect(second.status).toBe(200);
    expect(second.text).toBe("duplicate");

    // And a third, with no event id at all, so the id is derived from the
    // body: a retry re-sends identical bytes, so it dedupes too.
    expect((await deliver(event)).status).toBe(200);
    expect((await deliver(event)).text).toBe("duplicate");

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const again = await orderDoc(started.orderId);
    expect(again.billNumber).toBe(order.billNumber);
    expect(again.state).toBe(order.state);
    const batchAgain = await batchDoc(ref);
    expect(batchAgain.paidCount).toBe(batchAfterFirst.paidCount);
    expect((await db().collection("documents").get()).size).toBe(documentsAfterFirst);
    expect(await countersSnapshot()).toEqual(countersAfterFirst);
    expect((await db().collection("concerns").get()).size).toBe(0);
  }, WORKER_TEST_TIMEOUT_MS);

  it("refuses an unsigned or wrongly signed body, and records nothing", async () => {
    const started = await startCheckout();
    const event = capturedEvent({
      orderId: started.orderId,
      razorpayOrderId: started.razorpayOrderId,
      amountPaise: started.totalPaise,
    });

    const eventsBefore = (await db().collection("webhookEvents").get()).size;

    expect((await deliver(event, { signature: null })).status).toBe(400);
    expect((await deliver(event, { signature: "deadbeef" })).status).toBe(400);
    expect(
      (await deliver(event, { signature: razorpaySignatureFor(JSON.stringify(event), "wrong") }))
        .status,
    ).toBe(400);

    // Signed honestly, then the amount edited in flight: the classic one.
    const raw = JSON.stringify(event);
    const signature = razorpaySignatureFor(raw, EMULATOR_WEBHOOK_SECRET);
    const tampered = raw.replace(`"amount":${started.totalPaise}`, '"amount":100');
    expect(tampered).not.toBe(raw);
    expect((await deliver(null, { rawBody: tampered, signature })).status).toBe(400);

    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect((await db().collection("webhookEvents").get()).size).toBe(eventsBefore);
    const order = await orderDoc(started.orderId);
    expect(order.state).toBe("held");
    expect((order.payment as { status: string }).status).toBe("created");
    expect(liveHeldJars((await batchDoc(ref)).heldJars, Date.now())).toBe(1);
  }, WORKER_TEST_TIMEOUT_MS);

  it("answers 405 to anything that is not a POST", async () => {
    const res = await fetch(WEBHOOK_URL, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("stores an event it does not act on rather than failing the delivery", async () => {
    const out = await deliver(
      { event: "payment.failed", payload: { payment: { entity: { id: "pay_failed" } } } },
      { eventId: "evt_failed_1" },
    );
    expect(out.status).toBe(200);
    const stored = await waitFor(
      "the failed-payment event to be marked ignored",
      async () => (await db().collection("webhookEvents").doc("razorpay-evt_failed_1").get()).data() ?? {},
      (data) => data.processedAt != null,
      WORKER_TIMEOUT_MS,
    );
    expect(stored.outcome).toBe("ignored");
    expect(stored.type).toBe("payment.failed");
  }, WORKER_TEST_TIMEOUT_MS);

  it("still sells the jar when the hold lapsed and was swept but a jar is free", async () => {
    const started = await startCheckout();
    // The hold lapses and the sweep tidies it: brief 9.3's rare case.
    await db()
      .collection("batches")
      .doc(ref)
      .update({ [`heldJars.${started.orderId}.expiresAt`]: new Date(Date.now() - 60_000) });
    await sweepExpiredHolds(db(), Date.now());
    const paidBefore = (await batchDoc(ref)).paidCount as number;

    expect(
      (
        await deliver(
          capturedEvent({
            orderId: started.orderId,
            razorpayOrderId: started.razorpayOrderId,
            amountPaise: started.totalPaise,
          }),
          { eventId: `evt_late_${started.orderId}` },
        )
      ).status,
    ).toBe(200);

    const order = await waitForPaid(started.orderId);
    // The customer paid and this batch still has jars, so a jar is claimed
    // afresh and the sale completes rather than becoming somebody's chore.
    expect(order.state).toBe("toPack");
    expect(String(order.billNumber)).toMatch(/^LK\//);
    expect((await batchDoc(ref)).paidCount).toBe(paidBefore + 1);
    expect(
      (await db().collection("concerns").doc(`capture-hold-gone-${started.orderId}`).get()).exists,
    ).toBe(false);
  }, WORKER_TEST_TIMEOUT_MS);

  it("refuses to sell a jar for the wrong money", async () => {
    const started = await startCheckout();
    const paidBefore = (await batchDoc(ref)).paidCount as number;

    expect(
      (
        await deliver(
          capturedEvent({
            orderId: started.orderId,
            razorpayOrderId: started.razorpayOrderId,
            amountPaise: 100,
          }),
          { eventId: `evt_short_${started.orderId}` },
        )
      ).status,
    ).toBe(200);

    const order = await waitForPaid(started.orderId);
    expect(order.state).toBe("held");
    expect(order.billNumber ?? null).toBeNull();
    expect((await batchDoc(ref)).paidCount).toBe(paidBefore);
    expect(
      (await db().collection("concerns").doc(`capture-amount-${started.orderId}`).get()).exists,
    ).toBe(true);
    await db().collection("concerns").doc(`capture-amount-${started.orderId}`).delete();
  }, WORKER_TEST_TIMEOUT_MS);
});

/* -------------------------------------------------------------------------- */

describe("a payment with no webhook, brief 21.1", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 120_000);

  beforeEach(async () => {
    await leaveJarsFree(ref, 6);
  });

  it("is recovered by the fifteen minute reconciliation", async () => {
    const started = await startCheckout();
    // No webhook is ever delivered. This is the gateway answering the
    // question the job goes and asks it.
    const gateway = {
      fetchPayments: async (razorpayOrderId: string) =>
        razorpayOrderId === started.razorpayOrderId
          ? [
              {
                id: "pay_recovered_1",
                status: "captured",
                amountPaise: started.totalPaise,
                orderId: razorpayOrderId,
                method: "card",
                notes: { lailark_order_id: started.orderId },
              },
            ]
          : [],
      processEvent: processWebhookEvent,
    };

    const paidBefore = (await batchDoc(ref)).paidCount as number;
    const report = await reconcilePendingPayments(db(), Date.now(), gateway);

    expect(report.ordersChecked).toBe(1);
    expect(report.paymentsFound).toBe(1);
    expect(report.ordersPaid).toBe(1);

    const order = await orderDoc(started.orderId);
    expect(order.state).toBe("toPack");
    expect((order.payment as { status: string }).status).toBe("captured");
    expect((order.payment as { razorpayIds: { paymentId: string } }).razorpayIds.paymentId).toBe(
      "pay_recovered_1",
    );
    expect(String(order.billNumber)).toMatch(/^LK\//);
    expect(order.updatedBy).toBe("reconcile");
    expect((await batchDoc(ref)).paidCount).toBe(paidBefore + 1);

    // And running it again finds nothing left to do: the order is not
    // pending any more, so it is not even asked about.
    const second = await reconcilePendingPayments(db(), Date.now(), gateway);
    expect(second.ordersChecked).toBe(0);
    expect(second.ordersPaid).toBe(0);
    expect((await batchDoc(ref)).paidCount).toBe(paidBefore + 1);
  });

  it("leaves an order alone when the gateway says nothing was captured", async () => {
    const started = await startCheckout();
    const report = await reconcilePendingPayments(db(), Date.now(), {
      fetchPayments: async () => [
        {
          id: "pay_failed_1",
          status: "failed",
          amountPaise: started.totalPaise,
          orderId: started.razorpayOrderId,
          method: "upi",
          notes: {},
        },
      ],
      processEvent: processWebhookEvent,
    });
    expect(report.paymentsFound).toBe(0);
    expect((await orderDoc(started.orderId)).state).toBe("held");
  });

  it("finishes an event that was recorded but never made it to the queue", async () => {
    const started = await startCheckout();
    const event = capturedEvent({
      orderId: started.orderId,
      razorpayOrderId: started.razorpayOrderId,
      amountPaise: started.totalPaise,
    });
    // Exactly what the HTTP function writes when the enqueue then fails.
    await db()
      .collection("webhookEvents")
      .doc("razorpay-evt_stranded")
      .set({
        source: "razorpay",
        eventId: "evt_stranded",
        type: "payment.captured",
        payload: event,
        receivedAt: new Date(Date.now() - 10 * 60_000),
        processedAt: null,
        outcome: null,
        orderId: null,
      });

    const report = await reconcilePendingPayments(db(), Date.now(), {
      fetchPayments: async () => [],
      processEvent: processWebhookEvent,
    });
    expect(report.eventsFinished).toBe(1);

    const order = await orderDoc(started.orderId);
    expect(order.state).toBe("toPack");
    const stored = await db().collection("webhookEvents").doc("razorpay-evt_stranded").get();
    expect(stored.get("processedAt")).not.toBeNull();
    expect(stored.get("outcome")).toBe("applied");
  });
});

/* -------------------------------------------------------------------------- */

describe("A184: a capture landing while a hold is being released", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    ref = await inStockBatch();
  }, 120_000);

  beforeEach(async () => {
    await leaveJarsFree(ref, 6);
  });

  it("does not expire a paid order, and does not put its jars back", async () => {
    const started = await startCheckout();
    const paidBefore = (await batchDoc(ref)).paidCount as number;

    // The capture wins the race and commits first.
    const applied = await applyCapturedPayment(db(), {
      paymentId: "pay_a184_1",
      razorpayOrderId: started.razorpayOrderId,
      amountPaise: started.totalPaise,
      orderId: started.orderId,
      method: "upi",
    });
    expect(applied.outcome).toBe("applied");

    // Now the release the checkout had already decided to do runs. Before
    // M3.6 this wrote `state: "expired"` unconditionally.
    await releaseHold(started.orderId, ref, 1);

    const order = await orderDoc(started.orderId);
    expect(order.state).toBe("toPack");
    expect((order.payment as { status: string }).status).toBe("captured");
    expect(order.billNumber).toBe(applied.documentNumber);
    // The jar the customer paid for did not go back on sale.
    const batch = await batchDoc(ref);
    expect(batch.paidCount).toBe(paidBefore + 1);
    expect(liveHeldJars(batch.heldJars, Date.now())).toBe(0);
  });

  it("survives the two of them racing, over and over", async () => {
    for (let round = 0; round < 6; round += 1) {
      await leaveJarsFree(ref, 6);
      const started = await startCheckout();
      const paidBefore = (await batchDoc(ref)).paidCount as number;

      // Fired together, so the interleaving is whatever the database gives
      // us on the day. Both may fail; neither may leave a paid order dead.
      await Promise.all([
        applyCapturedPayment(db(), {
          paymentId: `pay_a184_race_${round}`,
          razorpayOrderId: started.razorpayOrderId,
          amountPaise: started.totalPaise,
          orderId: started.orderId,
          method: "upi",
        }),
        releaseHold(started.orderId, ref, 1),
      ]);

      const order = await orderDoc(started.orderId);
      const payment = order.payment as { status: string };
      const batch = await batchDoc(ref);
      if (payment.status === "captured") {
        // Money moved: the order is a sale and its jar is sold, never both
        // expired and back in the free count.
        expect(order.state).not.toBe("expired");
        expect(batch.paidCount).toBe(paidBefore + 1);
      } else {
        // The release got there first: an unpaid hold went back, which is
        // exactly what it is for.
        expect(order.state).toBe("expired");
        expect(batch.paidCount).toBe(paidBefore);
      }
      expect(liveHeldJars(batch.heldJars, Date.now())).toBe(0);
    }
  }, 120_000);

  it("sells one jar once when two captures for it arrive together", async () => {
    const started = await startCheckout();
    const paidBefore = (await batchDoc(ref)).paidCount as number;

    const capture = {
      paymentId: "pay_double_1",
      razorpayOrderId: started.razorpayOrderId,
      amountPaise: started.totalPaise,
      orderId: started.orderId,
      method: "upi",
    };
    const [first, second] = await Promise.all([
      applyCapturedPayment(db(), capture),
      applyCapturedPayment(db(), capture),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["already", "applied"]);
    expect((await batchDoc(ref)).paidCount).toBe(paidBefore + 1);
    expect((await db().collection("documents").where("orderId", "==", started.orderId).get()).size)
      .toBe(1);
  });

  it("does not let the hold sweep expire a paid order either", async () => {
    const started = await startCheckout();
    await applyCapturedPayment(db(), {
      paymentId: "pay_sweep_1",
      razorpayOrderId: started.razorpayOrderId,
      amountPaise: started.totalPaise,
      orderId: started.orderId,
      method: "upi",
    });
    // An hour later, with the hold long lapsed on paper.
    await sweepExpiredHolds(db(), Date.now() + 60 * 60_000);
    expect((await orderDoc(started.orderId)).state).toBe("toPack");
  });
});

/* -------------------------------------------------------------------------- */

/**
 * A capture arriving after the hold lapsed but **before** the sweep removed
 * its key.
 *
 * Holds are fifteen minutes and `sweepHolds` runs every five, so a dead key
 * outlives its expiry by up to five minutes. In that window the jar is
 * already free to `createCheckout`, to `/api/counts` and to the site, because
 * every one of those counts a hold only while its expiry is in the future
 * (brief §9.3). The capture must not be the one place in the system that
 * reads a stale key as a live hold: doing so sells one jar twice.
 *
 * Nothing here calls `sweepExpiredHolds`. That is the whole point: the
 * earlier hold-gone test does sweep, which is why it never caught this.
 */
describe("a capture landing on a lapsed but unswept hold", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
  }, 120_000);

  // A fresh batch per test: two of these deliberately sell a batch out, and
  // `soldOut` is a state the batch does not come back from (brief 8.2), so
  // resetting the count alone would not put it back on sale.
  beforeEach(async () => {
    ref = await inStockBatch();
  }, 120_000);

  afterAll(drainWorker, 60_000);

  /** Only the expiry is moved. The key, its qty and its phone stay exactly as they were. */
  async function lapseHold(orderId: string): Promise<void> {
    await db()
      .collection("batches")
      .doc(ref)
      .update({ [`heldJars.${orderId}.expiresAt`]: new Date(Date.now() - 60_000) });
  }

  /**
   * The hard rule, read straight off the batch document:
   * `paid + live holds <= capacity`. CLAUDE.md §3, "Never oversell."
   */
  async function assertNeverOversold(): Promise<void> {
    const batch = await batchDoc(ref);
    const capacity = (batch.bottledJars as number) ?? (batch.bookableJars as number);
    const paid = batch.paidCount as number;
    const held = liveHeldJars(batch.heldJars, Date.now());
    expect(
      { capacity, paid, held, sum: paid + held },
      `oversold: ${paid} paid + ${held} held > ${capacity} on the batch`,
    ).toMatchObject({ sum: paid + held });
    expect(paid + held).toBeLessThanOrEqual(capacity);
  }

  it("never sells more jars than the batch has", async () => {
    await leaveJarsFree(ref, 1);

    // Asha holds the last jar, and her hold lapses without being swept.
    const asha = await startCheckout({ batchRef: ref });
    await lapseHold(asha.orderId);

    // The jar is free again, so Bala buys it. This is an ordinary checkout
    // through the real callable: it only succeeds because the count says the
    // jar is there.
    const bala = await startCheckout({ batchRef: ref });

    // Both payments confirm. Both are real, both correctly signed.
    expect(
      (
        await deliver(
          capturedEvent({
            orderId: asha.orderId,
            razorpayOrderId: asha.razorpayOrderId,
            amountPaise: asha.totalPaise,
          }),
          { eventId: `evt_lapsed_a_${asha.orderId}` },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deliver(
          capturedEvent({
            orderId: bala.orderId,
            razorpayOrderId: bala.razorpayOrderId,
            amountPaise: bala.totalPaise,
          }),
          { eventId: `evt_lapsed_b_${bala.orderId}` },
        )
      ).status,
    ).toBe(200);

    await waitForPaid(bala.orderId);
    await waitForPaid(asha.orderId);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    await assertNeverOversold();
  }, WORKER_TEST_TIMEOUT_MS);

  it("completes the sale when the batch still has a jar to give", async () => {
    await leaveJarsFree(ref, 6);
    const started = await startCheckout({ batchRef: ref });
    await lapseHold(started.orderId);
    const paidBefore = (await batchDoc(ref)).paidCount as number;

    expect(
      (
        await deliver(
          capturedEvent({
            orderId: started.orderId,
            razorpayOrderId: started.razorpayOrderId,
            amountPaise: started.totalPaise,
          }),
          { eventId: `evt_reclaim_${started.orderId}` },
        )
      ).status,
    ).toBe(200);

    const order = await waitForPaid(started.orderId);
    // The customer paid and a jar exists, so there is no reason to refuse.
    expect(order.state).toBe("toPack");
    expect(String(order.billNumber)).toMatch(/^LK\//);
    const batch = await batchDoc(ref);
    expect(batch.paidCount).toBe(paidBefore + 1);
    // The stale key is gone: it is not left behind to be counted again.
    expect((batch.heldJars as Record<string, unknown>)[started.orderId]).toBeUndefined();
    expect(
      (await db().collection("documents").where("orderId", "==", started.orderId).get()).size,
    ).toBe(1);
    expect(
      (await db().collection("concerns").doc(`capture-hold-gone-${started.orderId}`).get()).exists,
    ).toBe(false);
    await assertNeverOversold();
  }, WORKER_TEST_TIMEOUT_MS);

  it("raises the concern, and burns no bill number, when there is no jar left", async () => {
    await leaveJarsFree(ref, 1);
    const started = await startCheckout({ batchRef: ref });
    await lapseHold(started.orderId);
    // Somebody else takes the jar that came free, and pays for it.
    await db()
      .collection("batches")
      .doc(ref)
      .update({ paidCount: ((await batchDoc(ref)).paidCount as number) + 1 });
    const paidBefore = (await batchDoc(ref)).paidCount as number;
    const countersBefore = await countersSnapshot();

    expect(
      (
        await deliver(
          capturedEvent({
            orderId: started.orderId,
            razorpayOrderId: started.razorpayOrderId,
            amountPaise: started.totalPaise,
          }),
          { eventId: `evt_noroom_${started.orderId}` },
        )
      ).status,
    ).toBe(200);

    const order = await waitForPaid(started.orderId);
    // Brief §21.1: "Technical, not a sale."
    expect(order.state).toBe("held");
    expect(order.billNumber ?? null).toBeNull();
    expect((await batchDoc(ref)).paidCount).toBe(paidBefore);
    expect(await countersSnapshot()).toEqual(countersBefore);
    expect(
      (await db().collection("concerns").doc(`capture-hold-gone-${started.orderId}`).get()).exists,
    ).toBe(true);
    await assertNeverOversold();
    await db().collection("concerns").doc(`capture-hold-gone-${started.orderId}`).delete();
  }, WORKER_TEST_TIMEOUT_MS);

  it("does not reclaim a jar from a batch somebody has paused", async () => {
    await leaveJarsFree(ref, 6);
    const started = await startCheckout({ batchRef: ref });
    await lapseHold(started.orderId);
    // D23 put `inStock` on the pausable list exactly so sales can be frozen
    // on jars that turn out to be bad. Reclaiming would hand one out.
    await mustTransition("owner", {
      ref,
      to: "paused",
      data: { reason: "a jar from this batch looks wrong" },
    });
    const paidBefore = (await batchDoc(ref)).paidCount as number;
    const countersBefore = await countersSnapshot();

    const applied = await applyCapturedPayment(db(), {
      paymentId: "pay_paused_1",
      razorpayOrderId: started.razorpayOrderId,
      amountPaise: started.totalPaise,
      orderId: started.orderId,
      method: "upi",
    });

    expect(applied.outcome).toBe("hold-gone");
    expect((await batchDoc(ref)).paidCount).toBe(paidBefore);
    expect((await orderDoc(started.orderId)).billNumber ?? null).toBeNull();
    expect(await countersSnapshot()).toEqual(countersBefore);
    await assertNeverOversold();
    await db().collection("concerns").doc(`capture-hold-gone-${started.orderId}`).delete();
    // Resumed, or D15 refuses to open the next test's batch: only one batch
    // of a product may be open at a time, and a paused one still counts.
    await mustTransition("owner", { ref, to: "inStock", data: {} });
  }, WORKER_TEST_TIMEOUT_MS);

  it("gives one last jar to one of two lapsed captures racing for it", async () => {
    await leaveJarsFree(ref, 2);
    const asha = await startCheckout({ batchRef: ref });
    const bala = await startCheckout({ batchRef: ref });
    await lapseHold(asha.orderId);
    await lapseHold(bala.orderId);
    // Both holds are dead, so the batch reads as having two jars free; then
    // somebody else takes one, leaving exactly one for the two of them.
    await db()
      .collection("batches")
      .doc(ref)
      .update({ paidCount: ((await batchDoc(ref)).paidCount as number) + 1 });
    const paidBefore = (await batchDoc(ref)).paidCount as number;

    const [first, second] = await Promise.all([
      applyCapturedPayment(db(), {
        paymentId: "pay_reclaim_race_a",
        razorpayOrderId: asha.razorpayOrderId,
        amountPaise: asha.totalPaise,
        orderId: asha.orderId,
        method: "upi",
      }),
      applyCapturedPayment(db(), {
        paymentId: "pay_reclaim_race_b",
        razorpayOrderId: bala.razorpayOrderId,
        amountPaise: bala.totalPaise,
        orderId: bala.orderId,
        method: "upi",
      }),
    ]);

    // Exactly one jar existed, so exactly one sale may happen.
    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["applied", "hold-gone"]);
    expect((await batchDoc(ref)).paidCount).toBe(paidBefore + 1);
    await assertNeverOversold();
    for (const id of [asha.orderId, bala.orderId]) {
      await db().collection("concerns").doc(`capture-hold-gone-${id}`).delete().catch(() => undefined);
    }
  }, WORKER_TEST_TIMEOUT_MS);
});
