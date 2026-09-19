/**
 * The last row of brief section 8.2, end to end on the emulator:
 *
 *   | Batch full (90% booked) | Automatic flag, then owner yes | Optional
 *     edit | 3-day production clock replaces the 5-day | "The batch is full",
 *     after yes |
 *
 * Two halves. The flag is `onBatchWritten`: it stamps `fullReachedAt`, raises
 * the full approval on a 3 day clock, and stops the 5 day clock the half
 * approval was on, so exactly one clock is live. The yes is
 * `approveBatchFull`: the Owner's, nobody else's, stamping `fullApprovedAt`
 * and marking the approval answered without sending anything.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  approvalDoc,
  approveFull,
  batchDoc,
  clearFirestore,
  db,
  mustTransition,
  setPaidCount,
  waitFor,
  waitForState,
} from "./emulator";

const PRICE_OPEN = 59_900;
const PRICE_IN_STOCK = 64_900;

/** A live production clock: an approval still waiting, with a due date on it. */
function isLiveClock(approval: Record<string, unknown> | null): boolean {
  return approval !== null && approval.status === "waiting" && approval.dueAt !== null;
}

describe("batch full: the flag, then the Owner's yes", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    const created = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    ref = created.ref;
    await mustTransition("owner", { ref, to: "open", data: {} });

    // Ten of nineteen: half reached, and the 5 day clock starts.
    await setPaidCount(ref, 10);
    await waitForState(ref, "halfReached");
    await waitFor("the half approval", () => approvalDoc(`half-${ref}`), (a) => a !== null);
  });

  it("starts the 5 day clock at half, before anything is full", async () => {
    const half = await approvalDoc(`half-${ref}`);
    expect(isLiveClock(half)).toBe(true);
    const days = (half?.dueAt.toMillis() - half?.createdAt.toMillis()) / 86_400_000;
    expect(Math.round(days)).toBe(5);
    expect(half?.dueAtSupersededBy).toBeNull();
  });

  it("raises the full flag at 90% booked without moving the batch", async () => {
    await setPaidCount(ref, 19);
    const batch = await waitFor(
      "the full flag",
      () => batchDoc(ref),
      (b) => b.fullReachedAt !== null && b.fullReachedAt !== undefined,
    );
    // Full is a flag, not a state: the batch stays where it was.
    expect(batch.state).toBe("halfReached");
    expect(batch.fullApprovedAt).toBeNull();

    const full = await waitFor("the full approval", () => approvalDoc(`full-${ref}`), (a) => a !== null);
    expect(full).toMatchObject({ kind: "full", status: "waiting", batchRef: ref, answeredBy: null });
    // Brief 7.2 step 9 and 8.2, word for word.
    expect(full?.draft).toBe("The batch is full.");
    const days = (full?.dueAt.toMillis() - full?.createdAt.toMillis()) / 86_400_000;
    expect(Math.round(days)).toBe(3);
  });

  it("replaces the 5 day clock rather than leaving two running (8.2)", async () => {
    const half = await waitFor(
      "the half clock to be superseded",
      () => approvalDoc(`half-${ref}`),
      (a) => a?.dueAt === null,
    );
    expect(half?.dueAtSupersededBy).toBe(`full-${ref}`);
    // It is still the Owner's to answer, it just is not on a clock any more.
    expect(half?.status).toBe("waiting");

    // Exactly one clock is live on this batch.
    const live = (await db().collection("approvals").where("batchRef", "==", ref).get()).docs
      .map((d) => d.data())
      .filter(isLiveClock);
    expect(live.map((a) => a.kind)).toEqual(["full"]);
  });

  it("refuses the Kitchen and the Viewer the yes", async () => {
    for (const who of ["kitchen", "viewer"] as const) {
      const out = await approveFull(who, { ref, data: {} });
      expect(out.error?.status, who).toBe("PERMISSION_DENIED");
      expect(out.error?.message).toContain("owner");
    }
    for (const who of ["noRole", null] as const) {
      const out = await approveFull(who, { ref, data: {} });
      expect(out.result, String(who)).toBeUndefined();
    }
    // Nothing was stamped by any of them.
    expect((await batchDoc(ref)).fullApprovedAt).toBeNull();
    expect((await approvalDoc(`full-${ref}`))?.status).toBe("waiting");
  });

  it("lets the Owner say yes, stamping the batch and answering the approval", async () => {
    const out = await approveFull("owner", { ref, data: {} });
    expect(out.error).toBeUndefined();
    expect(out.result?.alreadyApproved).toBe(false);
    expect(out.result?.approvals).toEqual([`full-${ref}`]);

    const batch = await batchDoc(ref);
    expect(batch.fullApprovedAt).toBeTruthy();
    // Still a flag: the batch did not move.
    expect(batch.state).toBe("halfReached");

    const full = await approvalDoc(`full-${ref}`);
    expect(full).toMatchObject({ kind: "full", status: "approved" });
    expect(full?.answeredBy).toBeTruthy();
    // D5: the yes is recorded, the send is not done here.
    expect(full?.sentAt).toBeNull();
  });

  it("is harmless twice: the second yes writes nothing", async () => {
    const first = (await batchDoc(ref)).fullApprovedAt;

    const out = await approveFull("owner", { ref, data: {} });
    expect(out.error).toBeUndefined();
    expect(out.result?.alreadyApproved).toBe(true);

    // The first yes is the one that stands: the stamp did not move.
    expect((await batchDoc(ref)).fullApprovedAt.toMillis()).toBe(first.toMillis());
    const full = await approvalDoc(`full-${ref}`);
    expect(full?.status).toBe("approved");
    expect(full?.sentAt).toBeNull();
  });

  it("refuses a yes on a batch that is not full, and on one that is not there", async () => {
    const other = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "squid-pickle",
        recipeId: "squid-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    const notFull = await approveFull("owner", { ref: other.ref, data: {} });
    expect(notFull.error?.status).toBe("FAILED_PRECONDITION");
    expect(notFull.error?.message).toMatch(/not full yet/);

    const missing = await approveFull("owner", { ref: "b-999999", data: {} });
    expect(missing.error?.status).toBe("NOT_FOUND");
  });
});

describe("the Owner's edit of the full message", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    const created = await mustTransition("owner", {
      to: "draft",
      data: {
        productSlug: "prawns-pickle",
        recipeId: "prawns-v1",
        plannedJars: 22,
        priceOpen: PRICE_OPEN,
        priceInStock: PRICE_IN_STOCK,
      },
    });
    ref = created.ref;
    await mustTransition("owner", { ref, to: "open", data: {} });
    await setPaidCount(ref, 19);
    await waitFor("the full approval", () => approvalDoc(`full-${ref}`), (a) => a !== null);
  });

  it("records an edited line as edited, and still sends nothing", async () => {
    const out = await approveFull("owner", {
      ref,
      data: { messageText: "The batch is full. We start cooking on Friday." },
    });
    expect(out.error).toBeUndefined();

    const full = await approvalDoc(`full-${ref}`);
    expect(full?.status).toBe("edited");
    expect(full?.draft).toBe("The batch is full. We start cooking on Friday.");
    expect(full?.sentAt).toBeNull();
    expect((await batchDoc(ref)).fullApprovedAt).toBeTruthy();
  });

  it("refuses an input the row does not ask for, and any protected field", async () => {
    const sneaky = await approveFull("owner", { ref, data: { sneaky: true } });
    expect(sneaky.error?.status).toBe("INVALID_ARGUMENT");
    expect(sneaky.error?.message).toContain("sneaky");

    const smuggled = await approveFull("owner", { ref, data: { fullApprovedAt: 1 } });
    expect(smuggled.error?.status).toBe("INVALID_ARGUMENT");
    expect(smuggled.error?.message).toContain("fullApprovedAt");
  });
});
