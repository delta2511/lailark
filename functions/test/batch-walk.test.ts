/**
 * The done-when of M2.3: one batch walks Draft -> Archived on the emulator,
 * with every side effect of brief section 8.2 asserted as it goes.
 *
 * Draft, Open, Half reached, Sourcing, Cooking, Bottled, In stock, Sold out,
 * Archived: the reference minted at Draft and the printed number stamped at
 * Bottled (decision D21c), the computed fields, the approvals and concerns
 * written, booking closing at Cooking, the surplus at Bottled.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { takeHold } from "../src/batches/holds";
import { isBatchRef } from "@lailark/shared";

import {
  batchByNo,
  batchCounterNext,
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
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
  });

  it("Draft: the Owner creates it under a fixed reference, with no number (D21c)", async () => {
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

    ref = result.ref;
    // D21c: `b-` plus six lowercase base32 characters, fixed for the whole
    // life of the batch, and no printed number yet.
    expect(isBatchRef(ref)).toBe(true);
    expect(result.batchNo).toBeNull();

    const batch = await batchDoc(ref);
    expect(batch.batchNo).toBeNull();
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

    // Creating a batch does not touch the counter (D21c): the number is
    // stamped at bottling, so an abandoned draft leaves no hole.
    expect(await batchCounterNext()).toBe(1);

    // D24: the product name and the main ingredient are copied onto the batch
    // once, so every customer message can be drafted without a catalogue read.
    expect("productName" in batch).toBe(true);
    expect("mainIngredientName" in batch).toBe(true);
  });

  it("Open: the card is published and the opted-in list is offered a message", async () => {
    await mustTransition("owner", { ref, to: "open", data: {} });

    const batch = await batchDoc(ref);
    expect(batch.state).toBe("open");

    // Nothing is sent. The broadcast waits for the Owner.
    const offer = await approval(`open-${ref}`);
    expect(offer).toMatchObject({
      kind: "broadcast",
      status: "waiting",
      // D21c: the approval points at the reference, not at a number it does
      // not have, and is never re-pointed when it gets one.
      batchRef: ref,
      answeredBy: null,
      sentAt: null,
    });
    // D24: a real draft, not a TODO. Q11 is answered.
    expect(String(offer?.draft)).not.toMatch(/TODO/);
    expect(String(offer?.draft)).toContain("open for booking at ₹599");
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
    expect(isBatchRef(second.ref)).toBe(true);
    expect(second.ref).not.toBe(ref);

    const refused = await transition("owner", { ref: second.ref, to: "open", data: {} });
    expect(refused.error?.status).toBe("FAILED_PRECONDITION");
    // D21c: the blocker has no printed number yet, so it is named by its
    // reference.
    expect(refused.error?.message).toContain(`Batch ${ref}`);
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
    await mustTransition("owner", { ref: other.ref, to: "open", data: {} });
    expect((await batchDoc(other.ref)).state).toBe("open");
  });

  it("Half reached: automatic at half of bookable, with the 5 day clock and an approval", async () => {
    // Nine of nineteen is below half. Nothing happens.
    await setPaidCount(ref, 9);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await batchDoc(ref)).state).toBe("open");
    expect(await approval(`half-${ref}`)).toBeNull();

    // Ten is half of nineteen, rounded up.
    await setPaidCount(ref, 10);
    const batch = await waitForState(ref, "halfReached");
    expect(batch.halfReachedAt).toBeTruthy();
    expect(batch.halfApprovedAt).toBeNull();

    const waiting = await waitFor(
      "the half approval",
      () => approval(`half-${ref}`),
      (a) => a !== null,
    );
    expect(waiting).toMatchObject({ kind: "halfReached", status: "waiting", batchRef: ref });
    // D24 renders brief 7.2's line. There is no `ingredients` document in this
    // emulator run, so the ingredient placeholder stands, which is exactly the
    // question the Owner answers before approving.
    expect(waiting?.draft).toMatch(/^Half the batch is paid for\. We are arranging the /);
    expect(waiting?.draft).not.toMatch(/TODO/);
    // Five days, brief 7.3.
    const days = (waiting?.dueAt.toMillis() - waiting?.createdAt.toMillis()) / 86_400_000;
    expect(Math.round(days)).toBe(5);
  });

  it("Sourcing: the Owner says yes, and the message is recorded, not sent", async () => {
    await mustTransition("owner", { ref, to: "sourcing", data: {} });

    const batch = await batchDoc(ref);
    expect(batch.state).toBe("sourcing");
    expect(batch.halfApprovedAt).toBeTruthy();

    const answered = await approval(`half-${ref}`);
    expect(answered).toMatchObject({ status: "approved", sentAt: null });
    expect(answered?.answeredBy).toBeTruthy();
  });

  it("Cooking: the kitchen starts the pot and booking closes at Rs 599", async () => {
    // While sourcing, the open price is still on offer.
    const held = await takeHold({ batchRef: ref, customerPhone: "+919000000001", orderId: "ord-open-1", qty: 1 });
    expect(held.availabilityBefore.capacity).toBe(19);
    await db().collection("batches").doc(ref).update({ heldJars: {} });

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

    const batch = await batchDoc(ref);
    expect(batch.state).toBe("cooking");
    expect(batch.landedOn).toBe("2026-09-01");
    expect(batch.source).toBe("Beypore harbour");
    expect(batch.weightRaw).toBe(12_000);

    // Brief 14.1: the main ingredient's raw weight and price, against the batch.
    const line = await db().collection("batches").doc(ref).collection("lines").doc("main").get();
    expect(line.data()).toMatchObject({ qtyActual: 12_000, costActual: 480_000 });

    // Brief 7.5: booking is closed. No jar can be held at the open price now.
    await expect(takeHold({ batchRef: ref, customerPhone: "+919000000001", orderId: "ord-open-2", qty: 1 })).rejects.toThrow(/not on sale/);
  });

  it("Bottled: the number is stamped here (D21c), with best before and the surplus", async () => {
    expect((await batchDoc(ref)).batchNo).toBeNull();
    const bottled = await mustTransition("kitchen", {
      ref,
      to: "bottled",
      data: {
        weightCleaned: 9_000,
        weightCooked: 7_000,
        jarCount: 22,
        packedOn: "2026-09-04",
      },
    });

    // D21c: global, sequential, zero padded to three digits (8.3), allocated
    // in this transaction and nowhere else.
    expect(bottled.batchNo).toBe("001");
    expect(bottled.computed.batchNo).toBe("001");
    expect(await batchCounterNext()).toBe(2);

    const batch = await batchDoc(ref);
    expect(batch.batchNo).toBe("001");
    // The printed number resolves through the field, never the document id.
    expect((await batchByNo("001"))?.ref).toBe(ref);
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
    const batch = await waitForState(ref, "inStock");
    expect(batch.state).toBe("inStock");

    const offer = await waitFor(
      "the back-in-stock broadcast",
      () => approval(`inStock-${ref}`),
      (a) => a !== null,
    );
    expect(offer).toMatchObject({ kind: "broadcast", status: "waiting", batchRef: ref, sentAt: null });
    expect(String(offer?.draft)).not.toMatch(/TODO/);
    expect(String(offer?.draft)).toContain("on sale at ₹649");

    // The surplus is on sale at Rs 649, and a jar can be held again.
    const held = await takeHold({ batchRef: ref, customerPhone: "+919000000003", orderId: "ord-stock-1", qty: 1 });
    expect(held.availabilityBefore.available).toBe(12);
    await db().collection("batches").doc(ref).update({ heldJars: {} });
  });

  it("Sold out: automatic when no jar is free, but not while one is held", async () => {
    await db()
      .collection("orders")
      .doc("ord-walk")
      .set({ state: "paidWaiting", batchRefs: [ref], customerPhone: "+919000000001" });

    await setPaidCount(ref, 21);
    await takeHold({ batchRef: ref, customerPhone: "+919000000004", orderId: "ord-last", qty: 1 });
    await new Promise((r) => setTimeout(r, 1500));
    // Brief 9.3: somebody is paying for the last jar. That is not sold out.
    expect((await batchDoc(ref)).state).toBe("inStock");

    await setPaidCount(ref, 22);
    await db().collection("batches").doc(ref).update({ heldJars: {} });
    const batch = await waitForState(ref, "soldOut", "archived");
    expect(batch.state).toBe("soldOut");
  });

  it("Archived: automatic, once every order in the batch is closed", async () => {
    // One order is still open, so the batch stays sold out.
    await new Promise((r) => setTimeout(r, 1500));
    expect((await batchDoc(ref)).state).toBe("soldOut");

    await db().collection("orders").doc("ord-walk").update({ state: "closed" });

    const batch = await waitForState(ref, "archived");
    expect(batch.state).toBe("archived");

    // Nothing moves out of archived, by any caller.
    const refused = await transition("owner", { ref, to: "open", data: {} });
    expect(refused.error?.status).toBe("FAILED_PRECONDITION");
  });

  it("leaves the whole walk on one document, under the reference it started with", async () => {
    const batch = await batchDoc(ref);
    expect(batch).toMatchObject({
      // D21c: the id never changed, from draft to archived, and the number it
      // took at bottling is still the only one it has had.
      batchNo: "001",
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
    // Three batches were created in this walk and one was bottled, so exactly
    // one number has been issued (D21c).
    expect(await batchCounterNext()).toBe(2);
    expect((await db().collection("batches").where("batchNo", "==", null).get()).size).toBe(2);
  });
});

describe("a pot that comes up short", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("raises a yield Concern per customer, on the most recently paid (7.7)", async () => {
    const { ref } = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    await mustTransition("owner", { ref, to: "open", data: {} });

    await db().collection("orders").doc("ord-early").set({
      state: "paidWaiting",
      batchRefs: [ref],
      customerPhone: "+919000000001",
      paidAt: new Date("2026-09-01T06:00:00Z"),
      payment: { status: "captured" },
      lines: [{ batchRef: ref, qty: 4 }],
    });
    await db().collection("orders").doc("ord-latest").set({
      state: "paidWaiting",
      batchRefs: [ref],
      customerPhone: "+919000000002",
      paidAt: new Date("2026-09-02T06:00:00Z"),
      payment: { status: "captured" },
      lines: [{ batchRef: ref, qty: 6 }],
    });

    await setPaidCount(ref, 10);
    await waitForState(ref, "halfReached");
    await mustTransition("owner", { ref, to: "sourcing", data: {} });
    await mustTransition("kitchen", {
      ref,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 6_000, costRaw: 240_000 },
    });

    // Ten paid, six in the pot: four jars short.
    const result = await mustTransition("kitchen", {
      ref,
      to: "bottled",
      data: { weightCleaned: 4_000, weightCooked: 3_000, jarCount: 6, packedOn: "2026-09-04" },
    });
    expect(result.computed.jarsShort).toBe(4);
    expect(result.computed.surplus).toBe(0);
    // D21c: even a pot that came up short is jars, so it takes a number.
    expect(result.batchNo).toBe("001");

    const concerns = await db().collection("concerns").where("batchRef", "==", ref).get();
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
    await waitForState(ref, "soldOut", "archived");
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
    await mustTransition("owner", { ref: first.ref, to: "open", data: {} });
    await mustTransition("owner", {
      ref: first.ref,
      to: "paused",
      data: { reason: "no prawns at Beypore this week" },
    });
    expect((await batchDoc(first.ref)).state).toBe("paused");

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
    const refused = await transition("owner", { ref: second.ref, to: "open", data: {} });
    expect(refused.error?.status).toBe("FAILED_PRECONDITION");
    expect(refused.error?.message).toContain(`Batch ${first.ref}`);
    expect(refused.error?.message).toContain("paused");
    expect(refused.error?.message).toContain("D15");
    expect((await batchDoc(second.ref)).state).toBe("draft");

    // Resumed and cooked, it stops blocking.
    await mustTransition("owner", { ref: first.ref, to: "open", data: {} });
    await setPaidCount(first.ref, 10);
    await waitForState(first.ref, "halfReached");
    await mustTransition("owner", { ref: first.ref, to: "sourcing", data: {} });
    await mustTransition("kitchen", {
      ref: first.ref,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
    });

    await mustTransition("owner", { ref: second.ref, to: "open", data: {} });
    expect((await batchDoc(second.ref)).state).toBe("open");
  });
});

/* -------------------------------------------------------------------------- */
/* Decision D21c: an order outlives the moment the batch is numbered          */
/* -------------------------------------------------------------------------- */

describe("an order placed while the batch was open", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("still resolves to the same batch after bottling stamps a number", async () => {
    const created = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "koorka-pickle",
        recipeId: "koorka-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    const ref: string = created.ref;
    await mustTransition("owner", { ref, to: "open", data: {} });

    // The order is written while the batch has no number at all, so it can
    // only point at the reference (D21c). Nothing will re-point it later.
    await db().collection("orders").doc("ord-early-bird").set({
      state: "paidWaiting",
      batchRefs: [ref],
      customerPhone: "+919000000007",
      paidAt: new Date("2026-09-01T06:00:00Z"),
      payment: { status: "captured" },
      lines: [{ batchRef: ref, qty: 3 }],
    });
    expect((await batchDoc(ref)).batchNo).toBeNull();

    // A hold taken now, at the open price, is taken against the reference too.
    const held = await takeHold({
      batchRef: ref,
      customerPhone: "+919000000008",
      orderId: "ord-early-hold",
      qty: 1,
    });
    expect(held.batchNo).toBeNull();
    expect(held.batchRef).toBe(ref);
    await db().collection("batches").doc(ref).update({ heldJars: {} });

    await setPaidCount(ref, 10);
    await waitForState(ref, "halfReached");
    await mustTransition("owner", { ref, to: "sourcing", data: {} });
    await mustTransition("kitchen", {
      ref,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Wayanad road", weightRaw: 12_000, costRaw: 480_000 },
    });

    // Six jars against ten paid, so the yield Concern is raised against this
    // very order: the server found it by the reference it was written with.
    const bottled = await mustTransition("kitchen", {
      ref,
      to: "bottled",
      data: { weightCleaned: 4_000, weightCooked: 3_000, jarCount: 6, packedOn: "2026-09-04" },
    });
    expect(bottled.batchNo).toBe("001");

    const concerns = await db().collection("concerns").where("batchRef", "==", ref).get();
    expect(concerns.docs.map((d) => d.get("orderId"))).toEqual(["ord-early-bird"]);
    // The concern id is keyed on the reference, so it would have been the same
    // id whether it was raised before or after the number existed.
    expect(concerns.docs[0].id).toBe(`yield-${ref}-ord-early-bird`);
    // ...and the summary the Owner reads names the printed number, because by
    // now there is one.
    expect(concerns.docs[0].get("summary")).toContain("Batch 001");

    // The order still points at the batch, and the batch now has a number, so
    // both directions resolve.
    const order = await db().collection("orders").doc("ord-early-bird").get();
    expect(order.get("batchRefs")).toEqual([ref]);
    expect((await batchByNo("001"))?.ref).toBe(ref);
    const found = await db().collection("orders").where("batchRefs", "array-contains", ref).get();
    expect(found.docs.map((d) => d.id)).toEqual(["ord-early-bird"]);
  });
});
