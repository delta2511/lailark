/**
 * The per-person limit, brief section 7.2 step 3: "Limit checked against the
 * number, across all their orders in this batch."
 *
 * Against the emulator, because the claim is about a transaction: the limit is
 * checked on the batch document the hold is written to, in the same
 * transaction, so two tabs, two devices or two simultaneous calls cannot walk
 * past it between the check and the write.
 *
 * Twenty-two planned jars gives nineteen bookable and a limit of four
 * (brief 7.1 and 4.1), which is the shape of batch 001.
 */

import { liveHeldJars } from "@lailark/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { HoldRefused, takeHold } from "../src/batches/holds";
import { batchDoc, clearFirestore, db, mustTransition, waitForState } from "./emulator";

const PRICE_OPEN = 59_900;
const PRICE_IN_STOCK = 64_900;

const ASHA = "+919000000101";
const BINU = "+919000000102";

let batchNo = "";

/** A fresh open batch of 22 planned jars: 19 bookable, limit 4. */
async function openBatch(productSlug: string): Promise<string> {
  const created = await mustTransition("owner", {
    to: "draft",
    data: {
      productSlug,
      recipeId: `${productSlug}-v1`,
      plannedJars: 22,
      priceOpen: PRICE_OPEN,
      priceInStock: PRICE_IN_STOCK,
    },
  });
  await mustTransition("owner", { batchNo: created.batchNo, to: "open", data: {} });
  await waitForState(created.batchNo, "open");
  return created.batchNo;
}

async function refusal(promise: Promise<unknown>): Promise<HoldRefused> {
  try {
    await promise;
  } catch (error) {
    return error as HoldRefused;
  }
  throw new Error("expected the hold to be refused, it was taken");
}

/** That customer's live held jars on the batch document, right now. */
async function heldBy(phone: string): Promise<number> {
  const held = (await batchDoc(batchNo)).heldJars as Record<
    string,
    { qty: number; expiresAt: { toMillis(): number }; customerPhone?: string }
  >;
  const now = Date.now();
  let total = 0;
  for (const hold of Object.values(held ?? {})) {
    if (hold.customerPhone === phone && hold.expiresAt.toMillis() > now) total += hold.qty;
  }
  return total;
}

describe("the per-person limit, brief 7.2 step 3", () => {
  beforeEach(async () => {
    await clearFirestore();
    batchNo = await openBatch("prawns-pickle");
    expect((await batchDoc(batchNo)).perPersonLimit).toBe(4);
  });

  it("refuses a second hold that would take one customer past the limit", async () => {
    await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 3 });

    const refused = await refusal(
      takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a2", qty: 2 }),
    );
    expect(refused.reason).toBe("over-limit");
    // The refusal says how many they may still take.
    expect(refused.message).toContain("limited to 4 jars per person");
    expect(refused.message).toContain("you already have 3");
    expect(refused.message).toContain("You may still take 1 jar.");

    // The second hold wrote nothing: three jars held, not five.
    expect(await heldBy(ASHA)).toBe(3);
  });

  it("refuses a single hold above the limit outright", async () => {
    const refused = await refusal(
      takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 7 }),
    );
    expect(refused.reason).toBe("over-limit");
    expect(refused.message).toContain("You may still take 4 jars.");
    expect(await heldBy(ASHA)).toBe(0);

    // Seven jars were free the whole time: this is the limit, not the stock.
    expect((await batchDoc(batchNo)).bookableJars).toBe(19);
  });

  it("allows a hold exactly at the limit, and nothing after it", async () => {
    const taken = await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 4 });
    expect(taken.qty).toBe(4);
    expect(taken.customerJarsBefore).toBe(0);
    expect(taken.remainingAllowance).toBe(0);
    expect(await heldBy(ASHA)).toBe(4);

    const refused = await refusal(
      takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a2", qty: 1 }),
    );
    expect(refused.reason).toBe("over-limit");
    expect(refused.message).toContain("You cannot take any more from this batch.");
  });

  it("is per person: two customers may each take the limit", async () => {
    await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 4 });
    await takeHold({ batchNo, customerPhone: BINU, orderId: "ord-b1", qty: 4 });

    expect(await heldBy(ASHA)).toBe(4);
    expect(await heldBy(BINU)).toBe(4);

    // ...and each is then at their own ceiling, not at each other's.
    expect((await refusal(takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a2", qty: 1 }))).reason).toBe(
      "over-limit",
    );
    expect((await refusal(takeHold({ batchNo, customerPhone: BINU, orderId: "ord-b2", qty: 1 }))).reason).toBe(
      "over-limit",
    );
  });

  it("counts paid jars too, across every order of theirs in this batch", async () => {
    // Money arriving, as M2.8 and M3 will write it.
    await db().collection("orders").doc("ord-paid").set({
      state: "paidWaiting",
      batchNos: [batchNo],
      customerPhone: ASHA,
      paidAt: new Date("2026-09-01T06:00:00Z"),
      payment: { status: "captured" },
      lines: [{ batchNo, qty: 3 }],
    });

    const refused = await refusal(
      takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 2 }),
    );
    expect(refused.reason).toBe("over-limit");
    expect(refused.message).toContain("you already have 3");

    // One more is still theirs to take.
    const taken = await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 1 });
    expect(taken.customerJarsBefore).toBe(3);
    expect(taken.remainingAllowance).toBe(0);

    // Somebody else's paid order is not counted against them.
    await takeHold({ batchNo, customerPhone: BINU, orderId: "ord-b1", qty: 4 });
    expect(await heldBy(BINU)).toBe(4);
  });

  it("frees the allowance again when an earlier hold lapses (9.3)", async () => {
    await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 4, holdMinutes: -1 });
    expect(await heldBy(ASHA)).toBe(0);

    // The lapsed hold frees the jar, and with it the allowance.
    const taken = await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a2", qty: 4 });
    expect(taken.customerJarsBefore).toBe(0);
    expect(await heldBy(ASHA)).toBe(4);
  });

  it("re-holding the same order replaces that hold rather than adding to it", async () => {
    await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 4 });
    // The same order changing its mind is not a fifth jar.
    const again = await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-a1", qty: 2 });
    expect(again.customerJarsBefore).toBe(0);
    expect(await heldBy(ASHA)).toBe(2);
  });

  it("never ends above the limit, however many holds arrive at once", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        takeHold({ batchNo, customerPhone: ASHA, orderId: `ord-sim-${i}`, qty: 1 }),
      ),
    );

    const won = results.filter((r) => r.status === "fulfilled");
    expect(won.length).toBeLessThanOrEqual(4);
    expect(won.length).toBeGreaterThan(0);

    // The count itself, which is the claim that matters.
    expect(await heldBy(ASHA)).toBeLessThanOrEqual(4);
    expect(await heldBy(ASHA)).toBe(won.length);

    // ...and the batch as a whole never oversold either.
    const batch = await batchDoc(batchNo);
    expect(batch.paidCount + liveHeldJars(batch.heldJars, Date.now())).toBeLessThanOrEqual(
      batch.bookableJars,
    );
  });

  it("applies in stock as well: the limit is the batch's, not the price's", async () => {
    // Ten of nineteen paid takes it to half reached on its own; from there
    // the Owner and the Kitchen walk it to bottled, and the surplus goes on
    // sale in stock at Rs 649.
    await db().collection("batches").doc(batchNo).update({ paidCount: 10 });
    await waitForState(batchNo, "halfReached");
    await mustTransition("owner", { batchNo, to: "sourcing", data: {} });
    await mustTransition("kitchen", {
      batchNo,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
    });
    await mustTransition("kitchen", {
      batchNo,
      to: "bottled",
      data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount: 22, packedOn: "2026-09-04" },
    });
    await waitForState(batchNo, "inStock");

    await takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-s1", qty: 4 });
    expect((await refusal(takeHold({ batchNo, customerPhone: ASHA, orderId: "ord-s2", qty: 1 }))).reason).toBe(
      "over-limit",
    );
  });

  it("refuses a hold with no customer, or a number that is not E.164", async () => {
    for (const customerPhone of ["", "9000000101", "+91 90000 00101", "phone"]) {
      const refused = await refusal(
        takeHold({ batchNo, customerPhone, orderId: "ord-bad", qty: 1 }),
      );
      expect(refused.reason, customerPhone).toBe("invalid-customer");
    }
    expect((await batchDoc(batchNo)).heldJars).toEqual({});
  });
});
