/**
 * Two callers at the same moment.
 *
 * CLAUDE.md section 3: batch numbers are global, sequential, never reused,
 * and counts change only inside a Firestore transaction. Both are claims
 * about what happens under contention, so both are tested under contention.
 *
 * Decision D21c moved the number from creation to bottling, which changes
 * what contention means: two kitchens bottling at the same moment contend on
 * `counters/batch`, and a batch that is abandoned before bottling never takes
 * a number to leave a hole behind.
 */

import { isBatchRef, liveHeldJars } from "@lailark/shared";
import { beforeAll, describe, expect, it } from "vitest";

import { HoldRefused, takeHold } from "../src/batches/holds";
import {
  batchByNo,
  batchCounterNext,
  batchDoc,
  clearFirestore,
  db,
  mustTransition,
  setPaidCount,
  transition,
  waitForState,
} from "./emulator";

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

describe("the printed batch number under contention, decision D21c", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  /** Walks a fresh batch from draft to cooking, ready to be bottled. */
  async function cookedBatch(productSlug: string): Promise<string> {
    const created = await mustTransition("owner", draftInputs(productSlug));
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
    return ref;
  }

  function bottle(ref: string, jarCount: number) {
    return transition("kitchen", {
      ref,
      to: "bottled",
      data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount, packedOn: "2026-09-04" },
    });
  }

  it("gives six simultaneous drafts six different references, and no number at all", async () => {
    const calls = Array.from({ length: 6 }, (_, i) => transition("owner", draftInputs(`race-${i}`)));
    const results = await Promise.all(calls);

    const refs = results.map((r) => r.result?.ref as string);
    expect(refs.every((r) => isBatchRef(r))).toBe(true);
    expect(new Set(refs).size).toBe(6);

    // D21c: creating a batch takes no number, so six drafts leave the counter
    // exactly where it was.
    for (const r of results) expect(r.result?.batchNo).toBeNull();
    expect(await batchCounterNext()).toBe(1);
    expect((await db().collection("batches").get()).size).toBe(6);
    expect((await db().collection("batches").where("batchNo", "==", null).get()).size).toBe(6);
  });

  it("gives two simultaneous bottlings two different numbers, never the same one", async () => {
    await clearFirestore();
    const a = await cookedBatch("race-bottle-a");
    const b = await cookedBatch("race-bottle-b");

    // Both transactions read `counters/batch` in their own read set, so the
    // one that commits second is retried against the number the first wrote.
    const [first, second] = await Promise.all([bottle(a, 22), bottle(b, 20)]);
    expect(first.result, JSON.stringify(first.error)).toBeTruthy();
    expect(second.result, JSON.stringify(second.error)).toBeTruthy();

    const numbers = [first.result.batchNo, second.result.batchNo].sort();
    expect(numbers).toEqual(["001", "002"]);
    expect(await batchCounterNext()).toBe(3);

    // One document per number, and each carries the number it was given.
    expect((await batchByNo("001"))?.batchNo).toBe("001");
    expect((await batchByNo("002"))?.batchNo).toBe("002");
    expect((await db().collection("batches").where("batchNo", "==", "001").get()).size).toBe(1);
  });

  it("numbers in bottling order, whatever order the batches were created in", async () => {
    await clearFirestore();
    // Created first, second, third...
    const first = await cookedBatch("order-first");
    const second = await cookedBatch("order-second");
    const third = await cookedBatch("order-third");

    // ...bottled third, first, second.
    const bottledThird = await bottle(third, 22);
    const bottledFirst = await bottle(first, 21);
    const bottledSecond = await bottle(second, 20);

    expect(bottledThird.result.batchNo).toBe("001");
    expect(bottledFirst.result.batchNo).toBe("002");
    expect(bottledSecond.result.batchNo).toBe("003");

    // The references never moved: each batch is the same document it was.
    expect((await batchDoc(third)).batchNo).toBe("001");
    expect((await batchDoc(first)).batchNo).toBe("002");
    expect((await batchDoc(second)).batchNo).toBe("003");
    expect(await batchCounterNext()).toBe(4);
  });

  it("leaves the counter untouched by a batch abandoned before bottling", async () => {
    await clearFirestore();

    // Opened, cooked, and then paused and left. It never reaches bottling.
    const abandoned = await cookedBatch("abandoned");
    await mustTransition("owner", {
      ref: abandoned,
      to: "paused",
      data: { reason: "the pot was thrown out" },
    });
    expect((await batchDoc(abandoned)).batchNo).toBeNull();
    expect(await batchCounterNext()).toBe(1);

    // The next batch that is actually bottled takes 001, not 002: there is no
    // hole in the printed sequence (D21c).
    const real = await cookedBatch("real");
    const bottled = await bottle(real, 22);
    expect(bottled.result.batchNo).toBe("001");
    expect(await batchCounterNext()).toBe(2);
  });

  it("never reuses a number, even after the batch it belongs to is finished", async () => {
    const next = await cookedBatch("race-after");
    const bottled = await bottle(next, 22);
    expect(bottled.result.batchNo).toBe("002");
  });
});

describe("the last jar", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    const created = await mustTransition("owner", draftInputs("prawns-pickle"));
    ref = created.ref;
    await mustTransition("owner", { ref, to: "open", data: {} });
    // Nineteen bookable, eighteen already paid for: one jar left.
    await db().collection("batches").doc(ref).update({ paidCount: 18 });
    await waitForState(ref, "open", "halfReached");
  });

  it("is held by one of two simultaneous holders, never by both", async () => {
    const results = await Promise.allSettled([
      takeHold({ batchRef: ref, customerPhone: "+919000000001", orderId: "ord-a", qty: 1 }),
      takeHold({ batchRef: ref, customerPhone: "+919000000002", orderId: "ord-b", qty: 1 }),
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
    const snap = await db().collection("batches").doc(ref).get();
    const held = liveHeldJars(snap.get("heldJars"), Date.now());
    expect(held).toBe(1);
    expect(snap.get("paidCount") + held).toBeLessThanOrEqual(snap.get("bookableJars"));
  });

  it("is free again once the hold lapses, without any clean-up job", async () => {
    await db().collection("batches").doc(ref).update({ heldJars: {} });
    // A hold that expired a minute ago frees its jar (brief 9.3).
    await takeHold({ batchRef: ref, customerPhone: "+919000000003", orderId: "ord-lapsed", qty: 1, holdMinutes: -1 });
    const taken = await takeHold({ batchRef: ref, customerPhone: "+919000000004", orderId: "ord-fresh", qty: 1 });
    expect(taken.availabilityBefore.available).toBe(1);
  });

  it("refuses a hold for more jars than are free", async () => {
    await db().collection("batches").doc(ref).update({ heldJars: {} });
    await expect(takeHold({ batchRef: ref, customerPhone: "+919000000005", orderId: "ord-greedy", qty: 2 })).rejects.toThrow(/jars free/);
  });
});
