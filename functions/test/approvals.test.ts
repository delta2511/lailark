/**
 * M2.5 on the emulator: the `approvals` collection, the three answers of
 * brief section 7.3, and the kitchen photo update of decision D5.
 *
 * Every call here goes over real HTTP to the real callable with a real ID
 * token carrying a real role claim, so "Owner only" is tested where it is
 * enforced, on the server, and not by looking at a screen with no button on
 * it.
 *
 * The assertion that repeats in every test: **`sentAt` is still null.** A yes
 * records that the Owner approved the message. Sending it is M5.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  approvalDoc,
  batchDoc,
  callFunction,
  clearFirestore,
  db,
  mustTransition,
  waitFor,
} from "./emulator";

const PRICE_OPEN = 59_900;
const PRICE_IN_STOCK = 64_900;

async function answer(who: "owner" | "kitchen" | "viewer" | null, data: Record<string, unknown>) {
  return callFunction("answerApproval", who, data);
}

/**
 * A draft batch, opened, which raises the batch-open broadcast approval.
 *
 * Each one gets a product of its own, because D15 allows only one open batch
 * per product and these tests want several open at once.
 */
let productCount = 0;

async function openBatch(): Promise<string> {
  productCount += 1;
  const created = await mustTransition("owner", {
    to: "draft",
    data: {
      productSlug: `prawns-pickle-${productCount}`,
      recipeId: "prawns-v1",
      plannedJars: 22,
      priceOpen: PRICE_OPEN,
      priceInStock: PRICE_IN_STOCK,
    },
  });
  await mustTransition("owner", { ref: created.ref, to: "open", data: {} });
  return created.ref as string;
}

describe("the broadcast approval: yes, not yet, edit then yes", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("is raised waiting, with nothing sent", async () => {
    const ref = await openBatch();
    const approval = await approvalDoc(`open-${ref}`);
    expect(approval).not.toBeNull();
    expect(approval?.kind).toBe("broadcast");
    expect(approval?.status).toBe("waiting");
    expect(approval?.batchRef).toBe(ref);
    expect(approval?.sentAt).toBeNull();
    expect(approval?.reason).toBeNull();
    expect(approval?.remindAt).toBeNull();
    // A broadcast carries no production clock: those are half and full only.
    expect(approval?.dueAt).toBeNull();
  });

  it("refuses the Kitchen and the Viewer, both answers", async () => {
    const ref = await openBatch();
    const id = `open-${ref}`;

    for (const who of ["kitchen", "viewer"] as const) {
      const yes = await answer(who, { id, answer: "yes", data: {} });
      expect(yes.error?.status).toBe("PERMISSION_DENIED");
      const notYet = await answer(who, { id, answer: "notYet", data: { reason: "not mine" } });
      expect(notYet.error?.status).toBe("PERMISSION_DENIED");
    }

    // Refused means refused: the approval is untouched.
    const approval = await approvalDoc(id);
    expect(approval?.status).toBe("waiting");
    expect(approval?.answeredBy).toBeNull();
  });

  it("refuses somebody who is not signed in", async () => {
    const ref = await openBatch();
    const out = await answer(null, { id: `open-${ref}`, answer: "yes", data: {} });
    expect(out.error?.status).toBe("UNAUTHENTICATED");
  });

  it("records a not yet with its reason, and brings the card back later", async () => {
    const ref = await openBatch();
    const id = `open-${ref}`;
    const out = await answer("owner", {
      id,
      answer: "notYet",
      data: { reason: "the jars have not come" },
    });
    expect(out.error).toBeUndefined();

    const approval = await approvalDoc(id);
    expect(approval?.status).toBe("notYet");
    expect(approval?.reason).toBe("the jars have not come");
    expect(approval?.remindAt).not.toBeNull();
    expect(approval?.sentAt).toBeNull();
    // Nothing was sent and nothing moved.
    expect((await batchDoc(ref)).state).toBe("open");
  });

  it("records the Owner's yes as approved, still unsent", async () => {
    const ref = await openBatch();
    const id = `open-${ref}`;
    const before = await approvalDoc(id);

    const out = await answer("owner", { id, answer: "yes", data: {} });
    expect(out.result?.alreadyAnswered).toBe(false);

    const approval = await approvalDoc(id);
    expect(approval?.status).toBe("approved");
    expect(approval?.draft).toBe(before?.draft);
    expect(approval?.answeredBy).toBeTruthy();
    expect(approval?.at).not.toBeNull();
    expect(approval?.sentAt).toBeNull();
  });

  it("records an edited message as edited, in the Owner's words", async () => {
    const ref = await openBatch();
    const id = `open-${ref}`;
    const out = await answer("owner", {
      id,
      answer: "yes",
      data: { messageText: "A batch is open for booking. We cook a small number of jars." },
    });
    expect(out.error).toBeUndefined();

    const approval = await approvalDoc(id);
    expect(approval?.status).toBe("edited");
    expect(approval?.draft).toBe("A batch is open for booking. We cook a small number of jars.");
    expect(approval?.sentAt).toBeNull();
  });

  it("writes nothing on a second yes", async () => {
    const ref = await openBatch();
    const id = `open-${ref}`;
    await answer("owner", { id, answer: "yes", data: {} });
    const first = await approvalDoc(id);

    const again = await answer("owner", { id, answer: "yes", data: {} });
    expect(again.result?.alreadyAnswered).toBe(true);
    const second = await approvalDoc(id);
    expect(second?.at).toEqual(first?.at);
  });
});

describe("the half-reached approval has one door, and it is transitionBatch", () => {
  beforeAll(async () => {
    await clearFirestore();
  });

  it("refuses a yes here and names the callable that owns it", async () => {
    const ref = await openBatch();
    // Raised by hand: the trigger's own path is covered by the batch walk.
    await db()
      .collection("approvals")
      .doc(`half-${ref}`)
      .set({
        kind: "halfReached",
        batchRef: ref,
        updateId: null,
        draft: "Half the batch is paid for. We are arranging the prawns now.",
        status: "waiting",
        answeredBy: null,
        at: null,
        reason: null,
        remindAt: null,
        dueAt: null,
        dueAtSupersededBy: null,
        sentAt: null,
      });

    const out = await answer("owner", { id: `half-${ref}`, answer: "yes", data: {} });
    expect(out.error?.status).toBe("FAILED_PRECONDITION");
    expect(String(out.error?.message)).toContain("transitionBatch");
  });
});

describe("a kitchen photo update (D5)", () => {
  let ref = "";

  beforeAll(async () => {
    await clearFirestore();
    ref = await openBatch();
  });

  it("raises an approval for the Owner, with the Kitchen's own line as the draft", async () => {
    await db().collection("batches").doc(ref).collection("updates").doc("u1").set({
      photoPath: `batches/${ref}/u1.jpg`,
      kitchenLine: "The prawns are cleaned and in the pot.",
      messageText: "",
      approvedBy: null,
      sentAt: null,
      createdBy: "kitchen-uid",
    });

    const approval = await waitFor(
      "the photo update approval",
      () => approvalDoc(`photo-${ref}-u1`),
      (doc) => doc !== null,
    );
    expect(approval?.kind).toBe("photoUpdate");
    expect(approval?.status).toBe("waiting");
    expect(approval?.updateId).toBe("u1");
    expect(approval?.draft).toBe("The prawns are cleaned and in the pot.");
    expect(approval?.sentAt).toBeNull();
  });

  it("raises exactly one approval however often the update is written", async () => {
    await db()
      .collection("batches")
      .doc(ref)
      .collection("updates")
      .doc("u1")
      .set({ kitchenLine: "The prawns are cleaned and in the pot today." }, { merge: true });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    // One equality filter and the rest in JavaScript, so this test needs no
    // composite index that the app itself does not need.
    const found = (await db().collection("approvals").where("batchRef", "==", ref).get()).docs.filter(
      (doc) => doc.get("kind") === "photoUpdate",
    );
    expect(found.length).toBe(1);
    // The first draft stands: an approval already in front of the Owner is
    // never rewritten under him.
    expect(found[0].get("draft")).toBe("The prawns are cleaned and in the pot.");
  });

  it("is approved by the Owner, which stamps the update itself", async () => {
    const out = await answer("owner", {
      id: `photo-${ref}-u1`,
      answer: "yes",
      data: { messageText: "The prawns are in the pot today." },
    });
    expect(out.error).toBeUndefined();

    const approval = await approvalDoc(`photo-${ref}-u1`);
    expect(approval?.status).toBe("edited");
    expect(approval?.draft).toBe("The prawns are in the pot today.");
    expect(approval?.sentAt).toBeNull();

    const update = await db().collection("batches").doc(ref).collection("updates").doc("u1").get();
    expect(update.get("approvedBy")).toBeTruthy();
    expect(update.get("messageText")).toBe("The prawns are in the pot today.");
    // D5 again: approved is not sent.
    expect(update.get("sentAt")).toBeNull();
  });

  it("raises nothing for an update that is already approved", async () => {
    await db()
      .collection("batches")
      .doc(ref)
      .collection("updates")
      .doc("u1")
      .set({ kitchenLine: "One more line." }, { merge: true });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const approval = await approvalDoc(`photo-${ref}-u1`);
    expect(approval?.status).toBe("edited");
  });
});
