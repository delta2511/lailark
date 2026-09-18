/**
 * The done-when of M2.3: one batch walks Draft -> Archived on the emulator,
 * with every side effect of brief section 8.2 asserted as it goes.
 *
 * Draft, Open, Half reached, Sourcing, Cooking, Bottled, In stock, Sold out,
 * Archived: the number allocated, the computed fields, the approvals and
 * concerns written, booking closing at Cooking, the surplus at Bottled.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { takeHold } from "../src/batches/holds";
import {
  batchDoc,
  clearFirestore,
  db,
  mustTransition,
  setPaidCount,
  transition,
  waitFor,
  waitForState,
} from "./emulator";

const PRICE_OPEN = 59_900;
const PRICE_IN_STOCK = 64_900;

async function approval(id: string) {
  const snap = await db().collection("approvals").doc(id).get();
  return snap.exists ? snap.data() ?? null : null;
}

describe("a batch walks Draft to Archived", () => {
  let batchNo = "";

  beforeAll(async () => {
    await clearFirestore();
  });

  it("Draft: the Owner creates it and the number comes from counters/batch", async () => {
    const result = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });

    batchNo = result.batchNo;
    // Global, sequential, zero padded to three digits (8.3).
    expect(batchNo).toBe("001");

    const batch = await batchDoc(batchNo);
    expect(batch.state).toBe("draft");
    expect(batch.productSlug).toBe("prawns-pickle");
    // 90% of 22, rounded down; a quarter of that, rounded down (7.1).
    expect(batch.bookableJars).toBe(19);
    expect(batch.perPersonLimit).toBe(4);
    expect(batch.paidCount).toBe(0);
    expect(batch.bottledJars).toBe(0);
    expect(batch.heldJars).toEqual({});
    expect(batch.priceOpen).toBe(PRICE_OPEN);
    expect(batch.bestBefore).toBeNull();

    const counter = await db().collection("counters").doc("batch").get();
    expect(counter.get("next")).toBe(2);
  });

  it("Open: the card is published and the opted-in list is offered a message", async () => {
    await mustTransition("owner", { batchNo, to: "open", data: {} });

    const batch = await batchDoc(batchNo);
    expect(batch.state).toBe("open");

    // Nothing is sent. The broadcast waits for the Owner.
    const offer = await approval(`open-${batchNo}`);
    expect(offer).toMatchObject({ kind: "broadcast", status: "waiting", batchNo, answeredBy: null });
  });

  it("D15: a second batch of the same product cannot open while this one is", async () => {
    const second = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 20,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    expect(second.batchNo).toBe("002");

    const refused = await transition("owner", { batchNo: "002", to: "open", data: {} });
    expect(refused.error?.status).toBe("FAILED_PRECONDITION");
    expect(refused.error?.message).toContain("Batch 001");
    expect(refused.error?.message).toContain("D15");

    // A different product is never blocked.
    const other = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "beef-pickle",
        recipeId: "beef-v1",
        plannedJars: 15,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    await mustTransition("owner", { batchNo: other.batchNo, to: "open", data: {} });
    expect((await batchDoc(other.batchNo)).state).toBe("open");
  });

  it("Half reached: automatic at half of bookable, with the 5 day clock and an approval", async () => {
    // Nine of nineteen is below half. Nothing happens.
    await setPaidCount(batchNo, 9);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await batchDoc(batchNo)).state).toBe("open");
    expect(await approval(`half-${batchNo}`)).toBeNull();

    // Ten is half of nineteen, rounded up.
    await setPaidCount(batchNo, 10);
    const batch = await waitForState(batchNo, "halfReached");
    expect(batch.halfReachedAt).toBeTruthy();
    expect(batch.halfApprovedAt).toBeNull();

    const waiting = await waitFor(
      "the half approval",
      () => approval(`half-${batchNo}`),
      (a) => a !== null,
    );
    expect(waiting).toMatchObject({ kind: "halfReached", status: "waiting", batchNo });
    expect(waiting?.draft).toBe("Half the batch is paid for. We are arranging the prawns now.");
    // Five days, brief 7.3.
    const days = (waiting?.dueAt.toMillis() - waiting?.createdAt.toMillis()) / 86_400_000;
    expect(Math.round(days)).toBe(5);
  });

  it("Sourcing: the Owner says yes, and the message is recorded, not sent", async () => {
    await mustTransition("owner", { batchNo, to: "sourcing", data: {} });

    const batch = await batchDoc(batchNo);
    expect(batch.state).toBe("sourcing");
    expect(batch.halfApprovedAt).toBeTruthy();

    const answered = await approval(`half-${batchNo}`);
    expect(answered).toMatchObject({ status: "approved", sentAt: null });
    expect(answered?.answeredBy).toBeTruthy();
  });

  it("Cooking: the kitchen starts the pot and booking closes at Rs 599", async () => {
    // While sourcing, the open price is still on offer.
    const held = await takeHold({ batchNo, customerPhone: "+919000000001", orderId: "ord-open-1", qty: 1 });
    expect(held.availabilityBefore.capacity).toBe(19);
    await db().collection("batches").doc(batchNo).update({ heldJars: {} });

    await mustTransition("kitchen", {
      batchNo,
      to: "cooking",
      data: {
        landedOn: "2026-09-01",
        source: "Beypore harbour",
        weightRaw: 12_000,
        costRaw: 480_000,
      },
    });

    const batch = await batchDoc(batchNo);
    expect(batch.state).toBe("cooking");
    expect(batch.landedOn).toBe("2026-09-01");
    expect(batch.source).toBe("Beypore harbour");
    expect(batch.weightRaw).toBe(12_000);

    // Brief 14.1: the main ingredient's raw weight and price, against the batch.
    const line = await db().collection("batches").doc(batchNo).collection("lines").doc("main").get();
    expect(line.data()).toMatchObject({ qtyActual: 12_000, costActual: 480_000 });

    // Brief 7.5: booking is closed. No jar can be held at the open price now.
    await expect(takeHold({ batchNo, customerPhone: "+919000000001", orderId: "ord-open-2", qty: 1 })).rejects.toThrow(/not on sale/);
  });

  it("Bottled: best before, the sale stop and the surplus are computed", async () => {
    await mustTransition("kitchen", {
      batchNo,
      to: "bottled",
      data: {
        weightCleaned: 9_000,
        weightCooked: 7_000,
        jarCount: 22,
        packedOn: "2026-09-04",
      },
    });

    const batch = await batchDoc(batchNo);
    expect(batch.bottledJars).toBe(22);
    expect(batch.packedOn).toBe("2026-09-04");
    // A27, and the printed batch 001 label.
    expect(batch.bestBefore).toBe("2027-03-04");
    expect(batch.saleStopOn).toBe("2027-01-02");
    expect(batch.weightCleaned).toBe(9_000);
    expect(batch.weightCooked).toBe(7_000);

    // 22 bottled against 10 paid: twelve jars of surplus, and no Concern.
    const concerns = await db().collection("concerns").get();
    expect(concerns.size).toBe(0);
  });

  it("In stock: automatic, because the pot gave a surplus", async () => {
    const batch = await waitForState(batchNo, "inStock");
    expect(batch.state).toBe("inStock");

    const offer = await waitFor(
      "the back-in-stock broadcast",
      () => approval(`inStock-${batchNo}`),
      (a) => a !== null,
    );
    expect(offer).toMatchObject({ kind: "broadcast", status: "waiting" });

    // The surplus is on sale at Rs 649, and a jar can be held again.
    const held = await takeHold({ batchNo, customerPhone: "+919000000003", orderId: "ord-stock-1", qty: 1 });
    expect(held.availabilityBefore.available).toBe(12);
    await db().collection("batches").doc(batchNo).update({ heldJars: {} });
  });

  it("Sold out: automatic when no jar is free, but not while one is held", async () => {
    await db()
      .collection("orders")
      .doc("ord-walk")
      .set({ state: "paidWaiting", batchNos: [batchNo], customerPhone: "+919000000001" });

    await setPaidCount(batchNo, 21);
    await takeHold({ batchNo, customerPhone: "+919000000004", orderId: "ord-last", qty: 1 });
    await new Promise((r) => setTimeout(r, 1500));
    // Brief 9.3: somebody is paying for the last jar. That is not sold out.
    expect((await batchDoc(batchNo)).state).toBe("inStock");

    await setPaidCount(batchNo, 22);
    await db().collection("batches").doc(batchNo).update({ heldJars: {} });
    const batch = await waitForState(batchNo, "soldOut", "archived");
    expect(batch.state).toBe("soldOut");
  });

  it("Archived: automatic, once every order in the batch is closed", async () => {
    // One order is still open, so the batch stays sold out.
    await new Promise((r) => setTimeout(r, 1500));
    expect((await batchDoc(batchNo)).state).toBe("soldOut");

    await db().collection("orders").doc("ord-walk").update({ state: "closed" });

    const batch = await waitForState(batchNo, "archived");
    expect(batch.state).toBe("archived");

    // Nothing moves out of archived, by any caller.
    const refused = await transition("owner", { batchNo, to: "open", data: {} });
    expect(refused.error?.status).toBe("FAILED_PRECONDITION");
  });

  it("leaves the whole walk on one document, with the number never reused", async () => {
    const batch = await batchDoc(batchNo);
    expect(batch).toMatchObject({
      state: "archived",
      productSlug: "prawns-pickle",
      plannedJars: 22,
      bookableJars: 19,
      perPersonLimit: 4,
      bottledJars: 22,
      paidCount: 22,
      packedOn: "2026-09-04",
      bestBefore: "2027-03-04",
      saleStopOn: "2027-01-02",
    });
    const counter = await db().collection("counters").doc("batch").get();
    expect(counter.get("next")).toBe(4);
  });
});

describe("a pot that comes up short", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("raises a yield Concern per customer, on the most recently paid (7.7)", async () => {
    const { batchNo } = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    await mustTransition("owner", { batchNo, to: "open", data: {} });

    await db().collection("orders").doc("ord-early").set({
      state: "paidWaiting",
      batchNos: [batchNo],
      customerPhone: "+919000000001",
      paidAt: new Date("2026-09-01T06:00:00Z"),
      payment: { status: "captured" },
      lines: [{ batchNo, qty: 4 }],
    });
    await db().collection("orders").doc("ord-latest").set({
      state: "paidWaiting",
      batchNos: [batchNo],
      customerPhone: "+919000000002",
      paidAt: new Date("2026-09-02T06:00:00Z"),
      payment: { status: "captured" },
      lines: [{ batchNo, qty: 6 }],
    });

    await setPaidCount(batchNo, 10);
    await waitForState(batchNo, "halfReached");
    await mustTransition("owner", { batchNo, to: "sourcing", data: {} });
    await mustTransition("kitchen", {
      batchNo,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 6_000, costRaw: 240_000 },
    });

    // Ten paid, six in the pot: four jars short.
    const result = await mustTransition("kitchen", {
      batchNo,
      to: "bottled",
      data: { weightCleaned: 4_000, weightCooked: 3_000, jarCount: 6, packedOn: "2026-09-04" },
    });
    expect(result.computed.jarsShort).toBe(4);
    expect(result.computed.surplus).toBe(0);

    const concerns = await db().collection("concerns").where("batchNo", "==", batchNo).get();
    const byOrder = new Map(concerns.docs.map((d) => [d.get("orderId"), d.data()]));
    // The shortfall falls on the most recently paid first: all four off the
    // six-jar order, and nothing off the earlier one.
    expect([...byOrder.keys()]).toEqual(["ord-latest"]);
    expect(byOrder.get("ord-latest")).toMatchObject({
      type: "yieldShortfall",
      customerPhone: "+919000000002",
      urgent: true,
      sentAt: null,
      answeredAt: null,
    });
    expect(byOrder.get("ord-latest")?.proposal).toMatch(/next batch/);

    // No surplus, so the batch goes straight to sold out (A28).
    await waitForState(batchNo, "soldOut", "archived");
  });
});

describe("D15 and a paused batch", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("will not open a second batch while the first of that product is paused", async () => {
    const first = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    await mustTransition("owner", { batchNo: first.batchNo, to: "open", data: {} });
    await mustTransition("owner", {
      batchNo: first.batchNo,
      to: "paused",
      data: { reason: "no prawns at Beypore this week" },
    });
    expect((await batchDoc(first.batchNo)).state).toBe("paused");

    const second = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 20,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });

    // D15 allows a second batch only once the first is cooking, and a paused
    // batch is not cooking.
    const refused = await transition("owner", { batchNo: second.batchNo, to: "open", data: {} });
    expect(refused.error?.status).toBe("FAILED_PRECONDITION");
    expect(refused.error?.message).toContain(`Batch ${first.batchNo}`);
    expect(refused.error?.message).toContain("paused");
    expect(refused.error?.message).toContain("D15");
    expect((await batchDoc(second.batchNo)).state).toBe("draft");

    // Resumed and cooked, it stops blocking.
    await mustTransition("owner", { batchNo: first.batchNo, to: "open", data: {} });
    await setPaidCount(first.batchNo, 10);
    await waitForState(first.batchNo, "halfReached");
    await mustTransition("owner", { batchNo: first.batchNo, to: "sourcing", data: {} });
    await mustTransition("kitchen", {
      batchNo: first.batchNo,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
    });

    await mustTransition("owner", { batchNo: second.batchNo, to: "open", data: {} });
    expect((await batchDoc(second.batchNo)).state).toBe("open");
  });
});
