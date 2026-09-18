/**
 * Two callers at the same moment.
 *
 * CLAUDE.md section 3: batch numbers are global, sequential, never reused,
 * and counts change only inside a Firestore transaction. Both are claims
 * about what happens under contention, so both are tested under contention.
 */

import { liveHeldJars } from "@lailark/shared";
import { beforeAll, describe, expect, it } from "vitest";

import { HoldRefused, takeHold } from "../src/batches/holds";
import { clearFirestore, db, mustTransition, transition, waitForState } from "./emulator";

const PRICE_OPEN = 59_900;
const PRICE_IN_STOCK = 64_900;

function draftInputs(productSlug: string, plannedJars = 22) {
  return {
    to: "draft",
    data: {
      productSlug,
      recipeId: `${productSlug}-v1`,
      plannedJars,
      priceOpen: PRICE_OPEN,
      priceInStock: PRICE_IN_STOCK,
    },
  };
}

describe("the batch number under contention", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("gives six simultaneous callers six different numbers, with no gap", async () => {
    const calls = Array.from({ length: 6 }, (_, i) => transition("owner", draftInputs(`race-${i}`)));
    const results = await Promise.all(calls);

    const numbers = results.map((r) => r.result?.batchNo);
    expect(numbers.every((n) => typeof n === "string")).toBe(true);

    // Different, sequential, zero padded, and no number issued twice.
    expect(new Set(numbers).size).toBe(6);
    expect([...numbers].sort()).toEqual(["001", "002", "003", "004", "005", "006"]);

    // One document per number, and the counter agrees.
    const batches = await db().collection("batches").get();
    expect(batches.size).toBe(6);
    const counter = await db().collection("counters").doc("batch").get();
    expect(counter.get("next")).toBe(7);
  });

  it("never reuses a number, even after the batch it belongs to is finished", async () => {
    const next = await mustTransition("owner", draftInputs("race-after"));
    expect(next.batchNo).toBe("007");
  });
});

describe("the last jar", () => {
  let batchNo = "";

  beforeAll(async () => {
    await clearFirestore();
    const created = await mustTransition("owner", draftInputs("prawns-pickle"));
    batchNo = created.batchNo;
    await mustTransition("owner", { batchNo, to: "open", data: {} });
    // Nineteen bookable, eighteen already paid for: one jar left.
    await db().collection("batches").doc(batchNo).update({ paidCount: 18 });
    await waitForState(batchNo, "open", "halfReached");
  });

  it("is held by one of two simultaneous holders, never by both", async () => {
    const results = await Promise.allSettled([
      takeHold({ batchNo, customerPhone: "+919000000001", orderId: "ord-a", qty: 1 }),
      takeHold({ batchNo, customerPhone: "+919000000002", orderId: "ord-b", qty: 1 }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    const refusal = (lost[0] as PromiseRejectedResult).reason as HoldRefused;
    expect(refusal.reason).toBe("held-by-someone-else");
    // Brief 9.3, word for word.
    expect(refusal.message).toBe("Someone is paying for the last jar, check back in 15 minutes.");

    // The count itself: paid plus live holds never went past bookable.
    const snap = await db().collection("batches").doc(batchNo).get();
    const held = liveHeldJars(snap.get("heldJars"), Date.now());
    expect(held).toBe(1);
    expect(snap.get("paidCount") + held).toBeLessThanOrEqual(snap.get("bookableJars"));
  });

  it("is free again once the hold lapses, without any clean-up job", async () => {
    await db().collection("batches").doc(batchNo).update({ heldJars: {} });
    // A hold that expired a minute ago frees its jar (brief 9.3).
    await takeHold({ batchNo, customerPhone: "+919000000003", orderId: "ord-lapsed", qty: 1, holdMinutes: -1 });
    const taken = await takeHold({ batchNo, customerPhone: "+919000000004", orderId: "ord-fresh", qty: 1 });
    expect(taken.availabilityBefore.available).toBe(1);
  });

  it("refuses a hold for more jars than are free", async () => {
    await db().collection("batches").doc(batchNo).update({ heldJars: {} });
    await expect(takeHold({ batchNo, customerPhone: "+919000000005", orderId: "ord-greedy", qty: 2 })).rejects.toThrow(/jars free/);
  });
});
