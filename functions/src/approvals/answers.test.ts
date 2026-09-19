/**
 * The three answers of brief section 7.3, and who may give them.
 *
 * The one thing every test here is really checking: **nothing is sent.** No
 * plan this module can produce puts `sentAt` in its patch or its stamp
 * fields, whatever the answer and whatever the kind.
 */

import { describe, expect, it } from "vitest";

import type { ApprovalView } from "../batches/store";
import {
  type AnswerContext,
  parseAnswerApprovalRequest,
  planApprovalAnswer,
} from "./answers";

const NOW = Date.parse("2026-09-19T15:30:00.000Z");

function approval(overrides: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: "open-b-abc123",
    kind: "broadcast",
    batchRef: "b-abc123",
    updateId: null,
    draft: "A batch of Prawns and dates pickle is open for booking at ₹599.",
    status: "waiting",
    remindAtMillis: null,
    sentAtMillis: null,
    ...overrides,
  };
}

function context(overrides: Partial<AnswerContext> = {}): AnswerContext {
  return {
    caller: { uid: "owner-uid", role: "owner" },
    approval: approval(),
    nowMillis: NOW,
    ...overrides,
  };
}

function yes(data: Record<string, unknown> = {}) {
  return { id: "open-b-abc123", answer: "yes" as const, data };
}

function notYet(data: Record<string, unknown> = { reason: "no prawns this week" }) {
  return { id: "open-b-abc123", answer: "notYet" as const, data };
}

/* -------------------------------------------------------------------------- */
/* The shape check                                                            */
/* -------------------------------------------------------------------------- */

describe("parseAnswerApprovalRequest", () => {
  it("takes an id and one of the two answers", () => {
    const parsed = parseAnswerApprovalRequest({ id: "open-b-abc123", answer: "yes", data: {} });
    expect(parsed.ok).toBe(true);
  });

  it("refuses an id that is a path", () => {
    const parsed = parseAnswerApprovalRequest({ id: "approvals/open-b-abc123", answer: "yes" });
    expect(parsed).toMatchObject({ ok: false, code: "invalid-argument" });
  });

  it("refuses an answer that is not one of the two", () => {
    const parsed = parseAnswerApprovalRequest({ id: "x", answer: "maybe" });
    expect(parsed).toMatchObject({ ok: false, code: "invalid-argument" });
  });

  it("refuses a not yet that carries a message", () => {
    const parsed = parseAnswerApprovalRequest({
      id: "x",
      answer: "notYet",
      data: { messageText: "half the batch is paid for" },
    });
    expect(parsed).toMatchObject({ ok: false, code: "invalid-argument" });
  });

  it("refuses a yes that carries a reason", () => {
    const parsed = parseAnswerApprovalRequest({ id: "x", answer: "yes", data: { reason: "later" } });
    expect(parsed).toMatchObject({ ok: false, code: "invalid-argument" });
  });
});

/* -------------------------------------------------------------------------- */
/* Owner only                                                                 */
/* -------------------------------------------------------------------------- */

describe("who may answer", () => {
  it("refuses the Kitchen", () => {
    const plan = planApprovalAnswer(yes(), context({ caller: { uid: "k", role: "kitchen" } }));
    expect(plan).toMatchObject({ ok: false, code: "permission-denied" });
  });

  it("refuses a Viewer", () => {
    const plan = planApprovalAnswer(yes(), context({ caller: { uid: "v", role: "viewer" } }));
    expect(plan).toMatchObject({ ok: false, code: "permission-denied" });
  });

  it("refuses the Kitchen a not yet as well as a yes", () => {
    const plan = planApprovalAnswer(notYet(), context({ caller: { uid: "k", role: "kitchen" } }));
    expect(plan).toMatchObject({ ok: false, code: "permission-denied" });
  });

  it("refuses somebody with no role at all", () => {
    const plan = planApprovalAnswer(yes(), context({ caller: { uid: "x", role: undefined } }));
    expect(plan).toMatchObject({ ok: false, code: "permission-denied" });
  });

  it("refuses somebody signed out", () => {
    const plan = planApprovalAnswer(yes(), context({ caller: { uid: null, role: "owner" } }));
    expect(plan).toMatchObject({ ok: false, code: "unauthenticated" });
  });
});

/* -------------------------------------------------------------------------- */
/* One door per yes                                                           */
/* -------------------------------------------------------------------------- */

describe("the two kinds this callable does not answer", () => {
  it("sends a half-reached yes to transitionBatch", () => {
    const plan = planApprovalAnswer(yes(), context({ approval: approval({ kind: "halfReached" }) }));
    expect(plan).toMatchObject({ ok: false, code: "failed-precondition" });
    expect((plan as { message: string }).message).toContain("transitionBatch");
  });

  it("sends a full yes to approveBatchFull", () => {
    const plan = planApprovalAnswer(yes(), context({ approval: approval({ kind: "full" }) }));
    expect(plan).toMatchObject({ ok: false, code: "failed-precondition" });
    expect((plan as { message: string }).message).toContain("approveBatchFull");
  });

  it("still takes a not yet on a half-reached approval, which moves nothing", () => {
    const plan = planApprovalAnswer(notYet(), context({ approval: approval({ kind: "halfReached" }) }));
    expect(plan).toMatchObject({ ok: true });
  });
});

/* -------------------------------------------------------------------------- */
/* Yes, and edit then yes                                                     */
/* -------------------------------------------------------------------------- */

describe("yes", () => {
  it("records the draft as approved, and does not send it", () => {
    const plan = planApprovalAnswer(yes(), context());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.patch).toMatchObject({
      status: "approved",
      draft: approval().draft,
      answeredBy: "owner-uid",
      remindAt: null,
    });
    expect(plan.value.stampFields).toEqual(["at", "updatedAt"]);
    expect(Object.keys(plan.value.patch)).not.toContain("sentAt");
    expect(plan.value.stampFields).not.toContain("sentAt");
  });

  it("records an edited message as edited, with the Owner's own words", () => {
    const plan = planApprovalAnswer(yes({ messageText: "  A batch is open at ₹599.  " }), context());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.patch).toMatchObject({
      status: "edited",
      draft: "A batch is open at ₹599.",
    });
  });

  /**
   * CLAUDE.md section 3: no long dashes in anything a customer reads. The
   * Owner types this box himself, so it is the one place a dash can get in.
   */
  it("refuses a long dash in the Owner's own wording", () => {
    for (const dash of ["\u2014", "\u2013", "\u2015"]) {
      const plan = planApprovalAnswer(
        yes({ messageText: `A batch is open ${dash} book now.` }),
        context(),
      );
      expect(plan).toMatchObject({ ok: false, code: "invalid-argument" });
      if (plan.ok) continue;
      expect(plan.message).toMatch(/comma/);
    }
  });

  it("takes a hyphen, which is not a long dash", () => {
    const plan = planApprovalAnswer(
      yes({ messageText: "Best-before 4 March 2027. Call us on 9446587027." }),
      context(),
    );
    expect(plan.ok).toBe(true);
  });

  it("records a re-submitted identical message as a plain yes, not an edit", () => {
    const same = approval({ draft: "Half the batch is paid for." });
    const plan = planApprovalAnswer(
      yes({ messageText: "  Half the batch is paid for.  " }),
      context({ approval: same }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.patch).toMatchObject({ status: "approved" });
  });

  it("refuses an empty edit rather than approving an empty message", () => {
    const plan = planApprovalAnswer(yes({ messageText: "   " }), context());
    expect(plan).toMatchObject({ ok: false, code: "invalid-argument" });
  });

  it("writes nothing on a second yes", () => {
    const plan = planApprovalAnswer(yes(), context({ approval: approval({ status: "approved" }) }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.alreadyAnswered).toBe(true);
    expect(plan.value.patch).toEqual({});
    expect(plan.value.stampFields).toEqual([]);
  });

  it("refuses to answer a message that has already gone out", () => {
    const plan = planApprovalAnswer(yes(), context({ approval: approval({ sentAtMillis: NOW }) }));
    expect(plan).toMatchObject({ ok: false, code: "failed-precondition" });
  });

  it("refuses an approval that is not there", () => {
    const plan = planApprovalAnswer(yes(), context({ approval: null }));
    expect(plan).toMatchObject({ ok: false, code: "not-found" });
  });
});

describe("yes on a kitchen photo update (D5)", () => {
  const photo = approval({
    id: "photo-b-abc123-u1",
    kind: "photoUpdate",
    updateId: "u1",
    draft: "The prawns are in the pot today.",
  });

  it("stamps the update the Owner approved", () => {
    const plan = planApprovalAnswer(
      { id: photo.id, answer: "yes", data: {} },
      context({ approval: photo }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.photoUpdate).toEqual({
      batchRef: "b-abc123",
      updateId: "u1",
      messageText: "The prawns are in the pot today.",
    });
  });

  it("stamps the edited line, not the kitchen's own", () => {
    const plan = planApprovalAnswer(
      { id: photo.id, answer: "yes", data: { messageText: "The prawns are in the pot." } },
      context({ approval: photo }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.photoUpdate?.messageText).toBe("The prawns are in the pot.");
    expect(plan.value.patch).toMatchObject({ status: "edited" });
  });

  it("approves a photo with no message at all without inventing one", () => {
    const plan = planApprovalAnswer(
      { id: photo.id, answer: "yes", data: {} },
      context({ approval: approval({ ...photo, draft: "" }) }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.patch).toMatchObject({ status: "approved", draft: "" });
  });
});

/* -------------------------------------------------------------------------- */
/* Not yet, with a reason                                                     */
/* -------------------------------------------------------------------------- */

describe("not yet", () => {
  it("records the reason and brings the card back next morning", () => {
    const plan = planApprovalAnswer(notYet(), context());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.patch).toMatchObject({
      status: "notYet",
      reason: "no prawns this week",
      answeredBy: "owner-uid",
    });
    // 19 Sep 2026 21:00 Kolkata, so the card is back at 07:00 on the 20th.
    expect(plan.value.remindAtMillis).toBe(Date.parse("2026-09-20T01:30:00.000Z"));
  });

  it("insists on a reason", () => {
    const plan = planApprovalAnswer(notYet({ reason: "  " }), context());
    expect(plan).toMatchObject({ ok: false, code: "invalid-argument" });
  });

  it("insists on a reason that was given at all", () => {
    const plan = planApprovalAnswer(notYet({}), context());
    expect(plan).toMatchObject({ ok: false, code: "invalid-argument" });
  });

  it("touches nothing but the approval: no state, no batch, no send", () => {
    const plan = planApprovalAnswer(notYet(), context());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.photoUpdate).toBe(null);
    expect(Object.keys(plan.value.patch).sort()).toEqual(["answeredBy", "reason", "status"]);
    expect(plan.value.stampFields).not.toContain("sentAt");
  });

  it("can be given again, pushing the card on another morning", () => {
    const plan = planApprovalAnswer(
      notYet({ reason: "still no prawns" }),
      context({ approval: approval({ status: "notYet", remindAtMillis: NOW }) }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.patch).toMatchObject({ reason: "still no prawns" });
  });

  it("cannot put off something already said yes to", () => {
    const plan = planApprovalAnswer(notYet(), context({ approval: approval({ status: "edited" }) }));
    expect(plan).toMatchObject({ ok: false, code: "failed-precondition" });
  });
});
