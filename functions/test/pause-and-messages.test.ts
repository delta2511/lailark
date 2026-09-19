/**
 * Decisions D23 and D24 against the emulator.
 *
 * **D23**, answering Q13: a batch is pausable from Open, Half reached,
 * Sourcing, Cooking, **In stock** and **Sold out**, and resuming returns it to
 * the state it was paused from. Draft and Archived stay unpausable: a draft is
 * not on sale and an archived batch is closed with its P&L locked.
 *
 * **D24**, answering Q11: the three customer messages are drafted for the
 * Owner and he can edit them from `settings/messages`. Every one of them still
 * lands in an `approvals` document with `sentAt` null and waits for his yes.
 */

import { BATCH_STATES_PAUSABLE, DEFAULT_CUSTOMER_MESSAGES } from "@lailark/shared";
import { beforeAll, describe, expect, it } from "vitest";

import {
  approvalDoc,
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

/** A new draft of `productSlug`. D15 means one product per batch per test. */
async function newBatch(productSlug: string, plannedJars = 22): Promise<string> {
  const created = await mustTransition("owner", {
    to: "draft",
    data: {
      productSlug,
      recipeId: `${productSlug}-v1`,
      plannedJars,
      priceOpen: PRICE_OPEN,
      priceInStock: PRICE_IN_STOCK,
    },
  });
  return created.ref as string;
}

/**
 * Walks a fresh batch to `state`, including the two states D23 newly allows:
 * In stock (bottled with a surplus) and Sold out (bottled with none).
 */
async function batchIn(state: string, productSlug: string): Promise<string> {
  const ref = await newBatch(productSlug);
  if (state === "draft") return ref;
  await mustTransition("owner", { ref, to: "open", data: {} });
  if (state === "open") return ref;
  await setPaidCount(ref, 10);
  await waitForState(ref, "halfReached");
  if (state === "halfReached") return ref;
  await mustTransition("owner", { ref, to: "sourcing", data: {} });
  if (state === "sourcing") return ref;
  await mustTransition("kitchen", {
    ref,
    to: "cooking",
    data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
  });
  if (state === "cooking") return ref;

  // Bottled with twelve spare goes to In stock; bottled with none goes
  // straight to Sold out (A28). Both happen on a trigger.
  const jarCount = state === "soldOut" ? 10 : 22;
  if (state === "soldOut") {
    // ...and Sold out would carry straight on to Archived if every order in
    // the batch were closed, so one is left open to hold it there. This is the
    // shape a real sold-out batch has: jars owed, orders still moving.
    await db()
      .collection("orders")
      .doc(`ord-open-${productSlug}`)
      .set({ state: "paidWaiting", batchRefs: [ref], customerPhone: "+919000000502" });
  }
  await mustTransition("kitchen", {
    ref,
    to: "bottled",
    data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount, packedOn: "2026-09-04" },
  });
  await waitForState(ref, state);
  return ref;
}

/** Closes the order `batchIn("soldOut", ...)` left open, so it can archive. */
async function closeOpenOrder(productSlug: string): Promise<void> {
  await db().collection("orders").doc(`ord-open-${productSlug}`).update({ state: "closed" });
}

describe("D23: pausing, from every state the decision allows", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  for (const state of BATCH_STATES_PAUSABLE) {
    it(`pauses from ${state} and resumes back into it`, async () => {
      const ref = await batchIn(state, `pause-${state.toLowerCase()}`);
      expect((await batchDoc(ref)).state).toBe(state);

      await mustTransition("owner", {
        ref,
        to: "paused",
        data: { reason: "a jar from this batch looks wrong" },
      });
      const paused = await batchDoc(ref);
      expect(paused.state).toBe("paused");
      expect(paused.pausedReason).toBe("a jar from this batch looks wrong");
      // How resume knows where to go back to: the batch remembers.
      expect(paused.pausedFrom).toBe(state);

      await mustTransition("owner", { ref, to: state, data: {} });
      const resumed = await batchDoc(ref);
      expect(resumed.state).toBe(state);
      expect(resumed.pausedReason).toBeNull();
      expect(resumed.pausedFrom).toBeNull();
    });
  }

  it("refuses to resume anywhere but where it was paused from", async () => {
    const ref = await batchIn("sourcing", "pause-wrong-resume");
    await mustTransition("owner", { ref, to: "paused", data: { reason: "no prawns" } });

    const wrong = await transition("owner", { ref, to: "cooking", data: {} });
    expect(wrong.error?.status).toBe("FAILED_PRECONDITION");
    expect(wrong.error?.message).toMatch(/was paused from sourcing/);
    expect((await batchDoc(ref)).state).toBe("paused");

    // ...and the right one still works.
    await mustTransition("owner", { ref, to: "sourcing", data: {} });
    expect((await batchDoc(ref)).state).toBe("sourcing");
  });

  it("will not pause a draft: it is not on sale", async () => {
    const ref = await batchIn("draft", "pause-draft");
    const refused = await transition("owner", {
      ref,
      to: "paused",
      data: { reason: "changed my mind" },
    });
    expect(refused.error?.status).toBe("FAILED_PRECONDITION");
    expect((await batchDoc(ref)).state).toBe("draft");
  });

  it("will not pause an archived batch: it is closed and its P&L is locked", async () => {
    const ref = await batchIn("soldOut", "pause-archived");
    // Once the last order closes, the trigger archives it.
    await closeOpenOrder("pause-archived");
    await waitForState(ref, "archived");

    const refused = await transition("owner", {
      ref,
      to: "paused",
      data: { reason: "one more look" },
    });
    expect(refused.error?.status).toBe("FAILED_PRECONDITION");
    expect((await batchDoc(ref)).state).toBe("archived");
  });

  it("freezes an in-stock batch, which is the case Q13 was asked about", async () => {
    // A bad jar on the shelf. Before D23 there was no way to stop selling it.
    const ref = await batchIn("inStock", "pause-bad-jar");
    await mustTransition("owner", {
      ref,
      to: "paused",
      data: { reason: "a jar from this batch smells wrong" },
    });

    const { takeHold } = await import("../src/batches/holds");
    await expect(
      takeHold({ batchRef: ref, customerPhone: "+919000000501", orderId: "ord-paused", qty: 1 }),
    ).rejects.toThrow(/not on sale/);
  });
});

describe("D24: the three customer messages", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("drafts the batch-open message from the product, with no TODO left", async () => {
    await db().collection("products").doc("koorka-pickle").set({ name: "Koorka pickle" });
    const ref = await newBatch("koorka-pickle");
    await mustTransition("owner", { ref, to: "open", data: {} });

    const offer = await waitFor("the open broadcast", () => approvalDoc(`open-${ref}`), (a) => a !== null);
    expect(offer?.draft).toBe(
      "A batch of Koorka pickle is open for booking at ₹599. " +
        "We cook a small number of jars, so booking closes once they are taken.",
    );
    // D5: drafted, never sent.
    expect(offer?.status).toBe("waiting");
    expect(offer?.sentAt).toBeNull();
    expect(offer?.answeredBy).toBeNull();
  });

  it("takes the Owner's Settings wording over the draft", async () => {
    await clearFirestore();
    await db().collection("products").doc("squid-pickle").set({ name: "Squid pickle" });
    await db()
      .collection("settings")
      .doc("messages")
      .set({ batchOpen: "We have a batch of {product} open at {price}." });

    const ref = await newBatch("squid-pickle");
    await mustTransition("owner", { ref, to: "open", data: {} });

    const offer = await waitFor("the open broadcast", () => approvalDoc(`open-${ref}`), (a) => a !== null);
    expect(offer?.draft).toBe("We have a batch of Squid pickle open at ₹599.");
  });

  it("renders the half-reached message from the recipe's main ingredient", async () => {
    await clearFirestore();
    await db().collection("products").doc("beef-pickle").set({ name: "Beef pickle" });
    await db().collection("ingredients").doc("beef").set({ labelName: "Beef" });
    await db()
      .collection("recipes")
      .doc("beef-pickle-v1")
      .set({ lines: [{ ingredientId: "beef", isMain: true, qty: 1, unit: "kg" }] });

    const ref = await newBatch("beef-pickle");
    await mustTransition("owner", { ref, to: "open", data: {} });
    await setPaidCount(ref, 10);
    await waitForState(ref, "halfReached");

    const half = await waitFor("the half approval", () => approvalDoc(`half-${ref}`), (a) => a !== null);
    // Brief 7.2's shape, generated so it reads naturally for beef.
    expect(half?.draft).toBe("Half the batch is paid for. We are arranging the beef now.");
    expect(half?.sentAt).toBeNull();
  });

  it("drafts the back-in-stock message at the in-stock price", async () => {
    await clearFirestore();
    await db().collection("products").doc("prawns-pickle").set({ name: "Prawns and dates pickle" });

    const ref = await newBatch("prawns-pickle");
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
    await waitForState(ref, "inStock");

    const offer = await waitFor(
      "the back-in-stock broadcast",
      () => approvalDoc(`inStock-${ref}`),
      (a) => a !== null,
    );
    expect(offer?.draft).toBe(
      "The jars left over from our last batch of Prawns and dates pickle are on sale at ₹649. " +
        "There are only a few.",
    );
    expect(offer?.sentAt).toBeNull();
  });

  it("falls back to the drafts when settings/messages is not there", async () => {
    await clearFirestore();
    await db().collection("products").doc("koorka-pickle").set({ name: "Koorka pickle" });
    expect((await db().collection("settings").doc("messages").get()).exists).toBe(false);

    const ref = await newBatch("koorka-pickle");
    await mustTransition("owner", { ref, to: "open", data: {} });

    const offer = await waitFor("the open broadcast", () => approvalDoc(`open-${ref}`), (a) => a !== null);
    expect(offer?.draft).toBe(
      DEFAULT_CUSTOMER_MESSAGES.batchOpen
        .replace("{product}", "Koorka pickle")
        .replace("{price}", "₹599"),
    );
  });
});
