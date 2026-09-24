/**
 * Who may call what, against the emulator, with real tokens and real claims.
 * Brief section 17.12 and section 8.2's "Who" column.
 */

import { PROTECTED_BATCH_FIELDS } from "@lailark/shared";
import { beforeAll, describe, expect, it } from "vitest";

import { batchDoc, clearFirestore, db, mustTransition, transition, waitForState } from "./emulator";

const PRICE_OPEN = 59_900;
const PRICE_IN_STOCK = 64_900;

async function newBatch(productSlug: string): Promise<string> {
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
  return created.ref;
}

/** A batch carried to `state` by the callers who are allowed to do it. */
async function batchIn(state: string, productSlug: string): Promise<string> {
  const ref = await newBatch(productSlug);
  if (state === "draft") return ref;
  await mustTransition("owner", { ref, to: "open", data: {} });
  if (state === "open") return ref;
  await db().collection("batches").doc(ref).update({ paidCount: 10 });
  await waitForState(ref, "halfReached");
  if (state === "halfReached") return ref;
  await mustTransition("owner", { ref, to: "sourcing", data: {} });
  if (state === "sourcing") return ref;
  await mustTransition("kitchen", {
    ref,
    to: "cooking",
    data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
  });
  return ref;
}

describe("who may move a batch", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("refuses a caller with no token at all", async () => {
    const out = await transition(null, { to: "draft", data: {} });
    expect(out.error?.status).toBe("UNAUTHENTICATED");
  });

  it("refuses a signed-in number that is not on the admin list", async () => {
    const out = await transition("noRole", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    expect(out.error?.status).toBe("PERMISSION_DENIED");
    expect(out.error?.message).toContain("not on the Lailark admin list");
  });

  it("refuses the Viewer everything", async () => {
    const draft = await batchIn("draft", "viewer-test-draft");
    const open = await batchIn("open", "viewer-test-open");
    const sourcing = await batchIn("sourcing", "viewer-test-sourcing");
    for (const call of [
      { to: "draft", data: { productSlug: "x", recipeId: "y", plannedJars: 22, priceOpen: PRICE_OPEN, priceInStock: PRICE_IN_STOCK } },
      { ref: draft, to: "open", data: {} },
      { ref: open, to: "paused", data: { reason: "no" } },
      {
        ref: sourcing,
        to: "cooking",
        data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 1, costRaw: 1 },
      },
    ]) {
      const out = await transition("viewer", call);
      expect(out.error?.status, JSON.stringify(call)).toBe("PERMISSION_DENIED");
    }
  });

  it("lets the Kitchen move Sourcing, Cooking and Bottled", async () => {
    const ref = await batchIn("sourcing", "kitchen-test");

    await mustTransition("kitchen", {
      ref,
      to: "cooking",
      data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
    });
    expect((await batchDoc(ref)).state).toBe("cooking");

    await mustTransition("kitchen", {
      ref,
      to: "bottled",
      data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount: 22, packedOn: "2026-09-04" },
    });
    const batch = await batchDoc(ref);
    expect(batch.state).toBe("bottled");
    expect(batch.bestBefore).toBe("2027-03-04");
  });

  it("refuses the Kitchen the Owner's moves: opening, approving half, pausing", async () => {
    const draft = await batchIn("draft", "kitchen-refused");
    expect((await transition("kitchen", { ref: draft, to: "open", data: {} })).error?.status).toBe(
      "PERMISSION_DENIED",
    );

    const half = await batchIn("halfReached", "kitchen-refused-half");
    expect((await transition("kitchen", { ref: half, to: "sourcing", data: {} })).error?.status).toBe(
      "PERMISSION_DENIED",
    );
    expect(
      (await transition("kitchen", { ref: half, to: "paused", data: { reason: "no prawns" } })).error?.status,
    ).toBe("PERMISSION_DENIED");
  });

  it("lets the Owner open, pause and resume", async () => {
    const ref = await batchIn("open", "owner-test");

    await mustTransition("owner", { ref, to: "paused", data: { reason: "no prawns this week" } });
    let batch = await batchDoc(ref);
    expect(batch.state).toBe("paused");
    expect(batch.pausedReason).toBe("no prawns this week");

    await mustTransition("owner", { ref, to: "open", data: {} });
    batch = await batchDoc(ref);
    expect(batch.state).toBe("open");
    expect(batch.pausedReason).toBeNull();
  });

  it("refuses every automatic transition to every caller", async () => {
    const ref = await batchIn("open", "automatic-test");
    for (const who of ["owner", "kitchen"] as const) {
      const out = await transition(who, { ref, to: "halfReached", data: {} });
      expect(out.error?.status).toBe("FAILED_PRECONDITION");
      expect(out.error?.message).toMatch(/happens on its own/);
    }
  });
});

describe("the callable writes no protected field on a client's behalf", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    ref = await newBatch("protected-test");
  });

  it("refuses all fourteen of them, from the Owner", async () => {
    for (const field of PROTECTED_BATCH_FIELDS) {
      const out = await transition("owner", {
        ref,
        to: "open",
        data: { [field]: field === "state" ? "archived" : 999 },
      });
      expect(out.error?.status, field).toBe("INVALID_ARGUMENT");
      expect(out.error?.message).toContain(field);
    }
    // And nothing was written: the batch is still the draft it was.
    const batch = await batchDoc(ref);
    expect(batch.state).toBe("draft");
    expect(batch.bookableJars).toBe(19);
    expect(batch.paidCount).toBe(0);
  });

  it("refuses an input no transition asks for", async () => {
    const out = await transition("owner", { ref, to: "open", data: { sneaky: true } });
    expect(out.error?.status).toBe("INVALID_ARGUMENT");
    expect(out.error?.message).toContain("sneaky");
  });
});
