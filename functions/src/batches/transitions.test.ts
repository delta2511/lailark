/**
 * Brief section 8.2, row by row, with no emulator: who may call each
 * transition, what it asks for, what it computes, what it flags, and every
 * move that is not on the table.
 */

import {
  BATCH_STATES_OPEN_FOR_BOOKING,
  batchMaths,
  bestBefore,
  formatCalDate,
  PRICE_IN_STOCK_PAISE,
  PRICE_OPEN_PAISE,
  PROTECTED_BATCH_FIELDS,
  saleStopOn,
} from "@lailark/shared";
import { describe, expect, it } from "vitest";

import {
  APPROVAL_DRAFTS,
  BATCH_TRANSITION_TABLE,
  type BatchView,
  blockingOpenBatch,
  d15Message,
  FULL_APPROVAL_ROW,
  FULL_CLOCK_DAYS,
  HALF_CLOCK_DAYS,
  isAutomatic,
  nextAutomaticStep,
  NO_STATE,
  type PaidOrderView,
  parseFullApprovalRequest,
  parseTransitionRequest,
  planFullApproval,
  planTransition,
  type SiblingBatch,
  transitionRow,
  type TransitionContext,
  yieldShortfallAllocation,
} from "./transitions";

const NOW = Date.UTC(2026, 8, 18, 6, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function batchView(over: Partial<BatchView> = {}): BatchView {
  const maths = batchMaths(over.plannedJars ?? 22);
  return {
    batchNo: "003",
    state: "draft",
    productSlug: "prawns-pickle",
    recipeId: "prawns-v1",
    plannedJars: 22,
    bookableJars: maths.bookableJars,
    perPersonLimit: maths.perPersonLimit,
    priceOpen: PRICE_OPEN_PAISE,
    priceInStock: PRICE_IN_STOCK_PAISE,
    paidCount: 0,
    bottledJars: 0,
    writtenOff: 0,
    packedOn: null,
    halfReachedAt: null,
    fullReachedAt: null,
    fullApprovedAt: null,
    ...over,
  };
}

function context(over: Partial<TransitionContext> = {}): TransitionContext {
  return {
    caller: { uid: "uid-owner", role: "owner" },
    batch: batchView(),
    siblings: [],
    paidOrders: [],
    mainIngredientId: "prawns",
    nowMillis: NOW,
    ...over,
  };
}

function plan(
  request: { batchNo?: string; to: string; data?: Record<string, unknown> },
  ctx: Partial<TransitionContext> = {},
) {
  const parsed = parseTransitionRequest({
    ...(request.batchNo === undefined ? {} : { batchNo: request.batchNo }),
    to: request.to,
    data: request.data ?? {},
  });
  if (!parsed.ok) return parsed;
  return planTransition(parsed.value, context(ctx));
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected a plan, got ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function refused<T extends { ok: boolean }>(result: T): Extract<T, { ok: false }> {
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: false }>;
}

/* -------------------------------------------------------------------------- */

describe("the table itself, brief 8.2", () => {
  it("has a row for every transition the shared state machine allows", () => {
    // Every row of the table is a legal move, spelled the same as the shared
    // BATCH_TRANSITIONS, except the create row which has no "from" state.
    for (const row of BATCH_TRANSITION_TABLE) {
      if (row.from === NO_STATE) {
        expect(row.to).toBe("draft");
        continue;
      }
      expect(transitionRow(row.from, row.to)).toBe(row);
    }
  });

  it("names the caller of every row, and only the six automatic ones are automatic", () => {
    const automatic = BATCH_TRANSITION_TABLE.filter(isAutomatic).map((r) => `${r.from}->${r.to}`);
    expect(automatic.sort()).toEqual(
      [
        "bottled->inStock",
        "bottled->soldOut",
        "inStock->soldOut",
        "open->halfReached",
        "soldOut->archived",
      ].sort(),
    );
    for (const row of BATCH_TRANSITION_TABLE) {
      expect(row.callers.length).toBeGreaterThan(0);
    }
  });

  it("gives the kitchen exactly the two moves 17.12 gives it", () => {
    const kitchen = BATCH_TRANSITION_TABLE.filter((r) => r.callers.includes("kitchen")).map(
      (r) => `${r.from}->${r.to}`,
    );
    expect(kitchen.sort()).toEqual(["cooking->bottled", "sourcing->cooking"]);
  });

  it("gives the viewer nothing at all", () => {
    expect(BATCH_TRANSITION_TABLE.filter((r) => r.callers.includes("viewer"))).toEqual([]);
  });

  it("computes only fields it actually writes: no phantom bookingClosed", () => {
    const cooking = transitionRow("sourcing", "cooking");
    expect(cooking?.computes).not.toContain("bookingClosed");
    // ...and the plan for that row writes no such field either.
    const written = ok(
      plan({ batchNo: "003", to: "cooking", data: cookingInputs() }, { batch: batchView({ state: "sourcing" }) }),
    ).value.patch;
    expect(Object.keys(written)).not.toContain("bookingClosed");
    // Booking closes by the state alone: `cooking` is not open for booking.
    expect(written.state).toBe("cooking");
  });

  it("names the milestone that owns each part of 8.2 it has not built yet", () => {
    const bottling = transitionRow("cooking", "bottled");
    expect(bottling?.later).toEqual([
      "M2.9: issue bills for the open-batch orders of this batch",
      "M5.6: generate the label data and publish the /batch/<nnn> page",
    ]);
    // Nothing else on the table is carrying an unbuilt half of a row.
    for (const row of BATCH_TRANSITION_TABLE) {
      if (row === bottling) continue;
      expect(row.later ?? []).toEqual([]);
    }
  });
});

describe("who may call, and who may not", () => {
  it("refuses a caller with no token", () => {
    const result = refused(
      plan({ to: "draft", data: draftInputs() }, { caller: { uid: null, role: null }, batch: null }),
    );
    expect(result.code).toBe("unauthenticated");
  });

  it("refuses a caller with no role", () => {
    const result = refused(
      plan(
        { to: "draft", data: draftInputs() },
        { caller: { uid: "uid-stranger", role: undefined }, batch: null },
      ),
    );
    expect(result.code).toBe("permission-denied");
    expect(result.message).toMatch(/not on the Lailark admin list/);
  });

  it("refuses a viewer every row", () => {
    const viewer = { uid: "uid-viewer", role: "viewer" };
    for (const to of ["draft", "open", "sourcing", "cooking", "bottled", "paused"]) {
      const from = { draft: null, open: "draft", sourcing: "halfReached", cooking: "sourcing", bottled: "cooking", paused: "open" }[to];
      const result = refused(
        plan(
          { batchNo: from === null ? undefined : "003", to, data: {} },
          {
            caller: viewer,
            batch: from === null ? null : batchView({ state: from as string }),
          },
        ),
      );
      expect(result.code).toBe("permission-denied");
    }
  });

  it("lets the Kitchen cook and bottle, and nothing else", () => {
    const kitchen = { uid: "uid-kitchen", role: "kitchen" };
    expect(
      ok(
        plan({ batchNo: "003", to: "cooking", data: cookingInputs() }, { caller: kitchen, batch: batchView({ state: "sourcing" }) }),
      ).value.row.to,
    ).toBe("cooking");
    expect(
      ok(
        plan({ batchNo: "003", to: "bottled", data: bottlingInputs() }, { caller: kitchen, batch: batchView({ state: "cooking", paidCount: 5 }) }),
      ).value.row.to,
    ).toBe("bottled");

    const opening = refused(
      plan({ batchNo: "003", to: "open", data: {} }, { caller: kitchen, batch: batchView({ state: "draft" }) }),
    );
    expect(opening.code).toBe("permission-denied");
    expect(opening.message).toMatch(/Only owner can move a batch/);

    const pausing = refused(
      plan({ batchNo: "003", to: "paused", data: { reason: "no prawns" } }, { caller: kitchen, batch: batchView({ state: "open" }) }),
    );
    expect(pausing.code).toBe("permission-denied");
  });

  it("refuses every automatic row from a person, however senior", () => {
    const rows: Array<[string, string]> = [
      ["open", "halfReached"],
      ["bottled", "inStock"],
      ["bottled", "soldOut"],
      ["inStock", "soldOut"],
      ["soldOut", "archived"],
    ];
    for (const [from, to] of rows) {
      const result = refused(
        plan({ batchNo: "003", to, data: {} }, { batch: batchView({ state: from }) }),
      );
      expect(result.code).toBe("failed-precondition");
      expect(result.message).toMatch(/happens on its own/);
    }
  });
});

describe("moves that are not on the table", () => {
  it("refuses draft straight to cooking", () => {
    const result = refused(plan({ batchNo: "003", to: "cooking", data: cookingInputs() }));
    expect(result.message).toBe("A batch that is a draft cannot go to cooking.");
  });

  it("refuses a step backwards", () => {
    const result = refused(
      plan({ batchNo: "003", to: "open", data: {} }, { batch: batchView({ state: "cooking" }) }),
    );
    expect(result.code).toBe("failed-precondition");
  });

  it("refuses anything out of archived", () => {
    for (const to of ["open", "inStock", "soldOut", "paused", "draft"]) {
      expect(refused(plan({ batchNo: "003", to, data: {} }, { batch: batchView({ state: "archived" }) })).ok).toBe(false);
    }
  });

  it("refuses a batch that is not there", () => {
    const result = refused(plan({ batchNo: "404", to: "open", data: {} }, { batch: null }));
    expect(result.code).toBe("not-found");
  });

  it("refuses a second draft on a batch that exists", () => {
    const result = refused(plan({ batchNo: "003", to: "draft", data: draftInputs() }));
    expect(result.message).toMatch(/already exists/);
  });

  it("refuses an unknown state outright", () => {
    const parsed = parseTransitionRequest({ batchNo: "003", to: "simmering", data: {} });
    expect(parsed.ok).toBe(false);
  });

  it("refuses a batch number that is not a batch number", () => {
    expect(parseTransitionRequest({ batchNo: "3", to: "open" }).ok).toBe(false);
    expect(parseTransitionRequest({ batchNo: "003", to: "open" }).ok).toBe(true);
  });
});

describe("no client writes a protected field, the Owner included (A40)", () => {
  it("refuses every one of the fourteen by name", () => {
    for (const field of PROTECTED_BATCH_FIELDS) {
      const parsed = parseTransitionRequest({ batchNo: "003", to: "open", data: { [field]: 1 } });
      expect(parsed.ok, field).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain(field);
    }
  });

  it("asks for the jar count and the limit under names of their own", () => {
    // `bottledJars` and `perPersonLimit` are protected; the buttons that ask
    // for them send `jarCount` and `limitPerPerson`.
    expect(parseTransitionRequest({ batchNo: "003", to: "bottled", data: { bottledJars: 22 } }).ok).toBe(false);
    expect(parseTransitionRequest({ batchNo: "003", to: "bottled", data: { jarCount: 22 } }).ok).toBe(true);
    expect(parseTransitionRequest({ batchNo: "003", to: "open", data: { perPersonLimit: 4 } }).ok).toBe(false);
    expect(parseTransitionRequest({ batchNo: "003", to: "open", data: { limitPerPerson: 4 } }).ok).toBe(true);
  });

  it("refuses an input no row asks for", () => {
    const result = refused(plan({ batchNo: "003", to: "open", data: { priceCash: 100 } }));
    expect(result.message).toMatch(/not priceCash/);
  });
});

/* -------------------------------------------------------------------------- */
/* Row 1: none -> draft                                                       */
/* -------------------------------------------------------------------------- */

function draftInputs(over: Record<string, unknown> = {}) {
  return {
    productSlug: "prawns-pickle",
    recipeId: "prawns-v1",
    plannedJars: 22,
    priceOpen: PRICE_OPEN_PAISE,
    priceInStock: PRICE_IN_STOCK_PAISE,
    ...over,
  };
}

describe("none -> draft: the Owner creates a batch", () => {
  it("computes bookable, half and the limit from the planned jars alone", () => {
    const value = ok(plan({ to: "draft", data: draftInputs() }, { batch: null })).value;
    expect(value.patch.state).toBe("draft");
    expect(value.patch.bookableJars).toBe(19);
    expect(value.patch.perPersonLimit).toBe(4);
    expect(value.computed.halfJars).toBe(10);
    expect(value.batchNo).toBeNull();
  });

  it("matches the 7.1 table at every size", () => {
    for (const [planned, bookable, half, limit] of [
      [15, 13, 7, 3],
      [20, 18, 9, 4],
      [22, 19, 10, 4],
      [40, 36, 18, 9],
    ]) {
      const value = ok(
        plan({ to: "draft", data: draftInputs({ plannedJars: planned }) }, { batch: null }),
      ).value;
      expect([value.patch.bookableJars, value.computed.halfJars, value.patch.perPersonLimit]).toEqual([
        bookable,
        half,
        limit,
      ]);
    }
  });

  it("starts every count at zero", () => {
    const value = ok(plan({ to: "draft", data: draftInputs() }, { batch: null })).value;
    expect(value.patch.paidCount).toBe(0);
    expect(value.patch.heldJars).toEqual({});
    expect(value.patch.bottledJars).toBe(0);
    expect(value.patch.writtenOff).toBe(0);
  });

  it("asks for all five inputs", () => {
    for (const missing of ["productSlug", "recipeId", "plannedJars", "priceOpen", "priceInStock"]) {
      const data = draftInputs();
      delete (data as Record<string, unknown>)[missing];
      const result = refused(plan({ to: "draft", data }, { batch: null }));
      expect(result.message).toContain(missing);
    }
  });

  it("refuses money that is not whole paise", () => {
    for (const priceOpen of [59900.5, -59900, "599", null]) {
      const result = refused(plan({ to: "draft", data: draftInputs({ priceOpen }) }, { batch: null }));
      expect(result.code).toBe("invalid-argument");
      expect(result.message).toMatch(/paise/);
    }
  });

  it("refuses a pot too small to book a single jar", () => {
    const result = refused(plan({ to: "draft", data: draftInputs({ plannedJars: 1 }) }, { batch: null }));
    expect(result.message).toMatch(/no bookable jar/);
  });
});

/* -------------------------------------------------------------------------- */
/* Row 2: draft -> open                                                       */
/* -------------------------------------------------------------------------- */

describe("draft -> open: the Owner publishes the card", () => {
  it("recomputes bookable and the limit, and offers the opted-in list a message", () => {
    const value = ok(plan({ batchNo: "003", to: "open", data: { plannedJars: 40 } })).value;
    expect(value.patch.state).toBe("open");
    expect(value.patch.bookableJars).toBe(36);
    expect(value.patch.perPersonLimit).toBe(9);
    expect(value.computed.halfJars).toBe(18);
    expect(value.approvals).toHaveLength(1);
    expect(value.approvals[0]).toMatchObject({ kind: "broadcast", status: "waiting", answer: false });
    expect(value.concerns).toEqual([]);
  });

  it("takes the Owner's override of the per-person limit", () => {
    const value = ok(plan({ batchNo: "003", to: "open", data: { limitPerPerson: 2 } })).value;
    expect(value.patch.perPersonLimit).toBe(2);
  });

  it("refuses a limit above the bookable jars", () => {
    expect(refused(plan({ batchNo: "003", to: "open", data: { limitPerPerson: 100 } })).ok).toBe(false);
  });

  it("never lets bookable drop below paid (17.4)", () => {
    const result = refused(
      plan(
        { batchNo: "003", to: "open", data: { plannedJars: 10 } },
        { batch: batchView({ state: "draft", paidCount: 12 }) },
      ),
    );
    expect(result.message).toMatch(/12 are already paid for/);
  });

  describe("decision D15: one batch of a product open at a time", () => {
    const blockers: SiblingBatch[] = [
      { batchNo: "002", state: "open" },
      { batchNo: "002", state: "halfReached" },
      { batchNo: "002", state: "sourcing" },
      // D15 allows a second batch only once the first is *cooking*, and a
      // paused batch is not cooking.
      { batchNo: "002", state: "paused" },
    ];

    for (const sibling of blockers) {
      it(`refuses while batch 002 is ${sibling.state}`, () => {
        const result = refused(plan({ batchNo: "003", to: "open", data: {} }, { siblings: [sibling] }));
        expect(result.code).toBe("failed-precondition");
        expect(result.message).toContain("Batch 002");
        expect(result.message).toContain("D15");
      });
    }

    for (const state of ["cooking", "bottled", "inStock", "soldOut", "archived", "draft"]) {
      it(`allows it once batch 002 is ${state}`, () => {
        expect(ok(plan({ batchNo: "003", to: "open", data: {} }, { siblings: [{ batchNo: "002", state }] })).ok).toBe(
          true,
        );
      });
    }

    it("names the batch that blocks it and says when it will clear", () => {
      expect(d15Message({ batchNo: "002", state: "sourcing" }, "prawns-pickle")).toBe(
        "Batch 002 of prawns-pickle is still sourcing. Only one batch of a product is open at a time (D15): a second can open once batch 002 is cooking.",
      );
      expect(blockingOpenBatch([{ batchNo: "002", state: "cooking" }])).toBeNull();
    });

    it("says a paused batch is paused, and how to clear it", () => {
      const result = refused(
        plan({ batchNo: "003", to: "open", data: {} }, { siblings: [{ batchNo: "002", state: "paused" }] }),
      );
      expect(result.code).toBe("failed-precondition");
      expect(result.message).toContain("paused");
      expect(result.message).toBe(
        "Batch 002 of prawns-pickle is paused, which is not cooking. Only one batch of a product is open at a time (D15): resume batch 002 and get it cooking before opening a second.",
      );
      expect(blockingOpenBatch([{ batchNo: "002", state: "paused" }])).toEqual({
        batchNo: "002",
        state: "paused",
      });
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Row 4: halfReached -> sourcing                                             */
/* -------------------------------------------------------------------------- */

describe("half reached -> sourcing: the Owner says yes", () => {
  const half = { batch: batchView({ state: "halfReached", paidCount: 10 }) };

  it("stamps the approval and the batch, and sends nothing", () => {
    const value = ok(plan({ batchNo: "003", to: "sourcing", data: {} }, half)).value;
    expect(value.patch.state).toBe("sourcing");
    expect(value.stampFields).toContain("halfApprovedAt");
    expect(value.approvals[0]).toMatchObject({
      id: "half-003",
      kind: "halfReached",
      status: "approved",
      answer: true,
    });
    expect(value.approvals[0].draft).toBe("Half the batch is paid for. We are arranging the prawns now.");
  });

  it("records an edited message as edited", () => {
    const value = ok(
      plan({ batchNo: "003", to: "sourcing", data: { messageText: "Half paid. Prawns on Friday." } }, half),
    ).value;
    expect(value.approvals[0].status).toBe("edited");
    expect(value.approvals[0].draft).toBe("Half paid. Prawns on Friday.");
  });

  it("carries a TODO(Q11) for a product the brief has not drafted wording for", () => {
    expect(APPROVAL_DRAFTS.half("beef-pickle")).toMatch(/TODO\(Q11\)/);
    expect(APPROVAL_DRAFTS.open("prawns-pickle")).toMatch(/TODO\(Q11\)/);
    expect(APPROVAL_DRAFTS.inStock("prawns-pickle")).toMatch(/TODO\(Q11\)/);
    expect(APPROVAL_DRAFTS.full()).toBe("The batch is full.");
  });
});

/* -------------------------------------------------------------------------- */
/* Row 5: sourcing -> cooking                                                 */
/* -------------------------------------------------------------------------- */

function cookingInputs(over: Record<string, unknown> = {}) {
  return {
    landedOn: "2026-09-01",
    source: "Beypore harbour",
    weightRaw: 12000,
    costRaw: 480000,
    ...over,
  };
}

describe("sourcing -> cooking: the kitchen starts the pot", () => {
  const sourcing = { batch: batchView({ state: "sourcing", paidCount: 10 }) };

  it("closes booking by moving to a state that is not open for booking (7.5)", () => {
    const value = ok(plan({ batchNo: "003", to: "cooking", data: cookingInputs() }, sourcing)).value;
    expect(value.patch.state).toBe("cooking");
    // By the state and nothing else. There is no `bookingClosed` field to
    // write, so the row does not claim to compute one.
    expect(BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).not.toContain("cooking");
    expect(value.row.computes).not.toContain("bookingClosed");
    expect(Object.keys(value.patch)).not.toContain("bookingClosed");
  });

  it("records the main ingredient's weight and cost against the batch (14.1)", () => {
    const value = ok(plan({ batchNo: "003", to: "cooking", data: cookingInputs() }, sourcing)).value;
    expect(value.lines).toEqual([
      { id: "main", ingredientId: "prawns", qtyActual: 12000, costActual: 480000 },
    ]);
  });

  it("falls back to a plain main line when the recipe has no main ingredient", () => {
    const value = ok(
      plan({ batchNo: "003", to: "cooking", data: cookingInputs() }, { ...sourcing, mainIngredientId: null }),
    ).value;
    expect(value.lines[0].ingredientId).toBe("main");
  });

  it("asks for the landed date, the source, the raw weight and the cost", () => {
    for (const missing of ["landedOn", "source", "weightRaw", "costRaw"]) {
      const data = cookingInputs();
      delete (data as Record<string, unknown>)[missing];
      expect(refused(plan({ batchNo: "003", to: "cooking", data }, sourcing)).message).toContain(missing);
    }
  });

  it("refuses a date that is not a date and a cost that is not paise", () => {
    expect(refused(plan({ batchNo: "003", to: "cooking", data: cookingInputs({ landedOn: "1 Sep" }) }, sourcing)).ok).toBe(false);
    expect(refused(plan({ batchNo: "003", to: "cooking", data: cookingInputs({ costRaw: 4800.5 }) }, sourcing)).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Row 6: cooking -> bottled                                                  */
/* -------------------------------------------------------------------------- */

function bottlingInputs(over: Record<string, unknown> = {}) {
  return {
    weightCleaned: 9000,
    weightCooked: 7000,
    jarCount: 22,
    packedOn: "2026-09-04",
    ...over,
  };
}

describe("cooking -> bottled: the kitchen counts the jars", () => {
  const cooking = { batch: batchView({ state: "cooking", paidCount: 10 }) };

  it("computes best before and the sale stop from the shared rule (A27)", () => {
    const value = ok(plan({ batchNo: "003", to: "bottled", data: bottlingInputs() }, cooking)).value;
    expect(value.patch.bestBefore).toBe("2027-03-04");
    expect(value.patch.saleStopOn).toBe("2027-01-02");
    expect(value.patch.bestBefore).toBe(formatCalDate(bestBefore("2026-09-04")));
    expect(value.patch.saleStopOn).toBe(formatCalDate(saleStopOn("2026-09-04")));
  });

  it("computes the surplus over the paid jars", () => {
    const value = ok(plan({ batchNo: "003", to: "bottled", data: bottlingInputs() }, cooking)).value;
    expect(value.computed.surplus).toBe(12);
    expect(value.computed.jarsShort).toBe(0);
    expect(value.concerns).toEqual([]);
  });

  it("raises a yield Concern per customer, on the most recently paid (7.7)", () => {
    const paidOrders: PaidOrderView[] = [
      { id: "ord-early", customerPhone: "+919000000001", jars: 4, paidAtMillis: NOW - 3 * DAY_MS },
      { id: "ord-late", customerPhone: "+919000000002", jars: 3, paidAtMillis: NOW - 1 * DAY_MS },
      { id: "ord-latest", customerPhone: "+919000000003", jars: 3, paidAtMillis: NOW },
    ];
    const value = ok(
      plan(
        { batchNo: "003", to: "bottled", data: bottlingInputs({ jarCount: 6 }) },
        { batch: batchView({ state: "cooking", paidCount: 10 }), paidOrders },
      ),
    ).value;
    expect(value.computed.jarsShort).toBe(4);
    expect(value.concerns.map((c) => c.orderId)).toEqual(["ord-latest", "ord-late"]);
    expect(value.concerns[0].type).toBe("yieldShortfall");
    expect(value.concerns[0].urgent).toBe(true);
    expect(value.concerns[0].proposal).toMatch(/next batch/);
    expect(value.concerns[0].summary).toContain("3 jars short");
    expect(value.concerns[1].summary).toContain("1 jar short");
  });

  it("raises one batch-level Concern when the orders are not readable", () => {
    const value = ok(
      plan({ batchNo: "003", to: "bottled", data: bottlingInputs({ jarCount: 6 }) }, cooking),
    ).value;
    expect(value.concerns).toHaveLength(1);
    expect(value.concerns[0].id).toBe("yield-003");
    expect(value.concerns[0].orderId).toBeNull();
  });

  it("allows an empty pot, and calls it four jars short", () => {
    const value = ok(plan({ batchNo: "003", to: "bottled", data: bottlingInputs({ jarCount: 0 }) }, { batch: batchView({ state: "cooking", paidCount: 4 }) })).value;
    expect(value.computed.surplus).toBe(0);
    expect(value.computed.jarsShort).toBe(4);
  });

  it("asks for both weights, the jar count and the packed-on date", () => {
    for (const missing of ["weightCleaned", "weightCooked", "jarCount", "packedOn"]) {
      const data = bottlingInputs();
      delete (data as Record<string, unknown>)[missing];
      expect(refused(plan({ batchNo: "003", to: "bottled", data }, cooking)).message).toContain(missing);
    }
  });
});

describe("the shortfall allocation, brief 7.7", () => {
  const orders: PaidOrderView[] = [
    { id: "a", customerPhone: null, jars: 2, paidAtMillis: 1 },
    { id: "b", customerPhone: null, jars: 2, paidAtMillis: 2 },
    { id: "c", customerPhone: null, jars: 2, paidAtMillis: 3 },
  ];

  it("takes nothing when the pot is whole", () => {
    expect(yieldShortfallAllocation(orders, 0)).toEqual([]);
  });

  it("takes from the newest first, one order at a time", () => {
    expect(yieldShortfallAllocation(orders, 3)).toEqual([
      { orderId: "c", customerPhone: null, jarsShort: 2 },
      { orderId: "b", customerPhone: null, jarsShort: 1 },
    ]);
  });

  it("stops at the oldest order when the whole batch is short", () => {
    expect(yieldShortfallAllocation(orders, 99).map((s) => s.orderId)).toEqual(["c", "b", "a"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Pause and resume                                                           */
/* -------------------------------------------------------------------------- */

describe("any -> paused: the Owner freezes sales", () => {
  for (const state of ["open", "halfReached", "sourcing", "cooking"]) {
    it(`pauses from ${state}`, () => {
      const value = ok(
        plan({ batchNo: "003", to: "paused", data: { reason: "no prawns this week" } }, { batch: batchView({ state }) }),
      ).value;
      expect(value.patch.state).toBe("paused");
      expect(value.patch.pausedReason).toBe("no prawns this week");
    });
  }

  it("cannot pause a bottled batch", () => {
    expect(refused(plan({ batchNo: "003", to: "paused", data: { reason: "x" } }, { batch: batchView({ state: "bottled" }) })).ok).toBe(false);
  });

  it("asks for a reason", () => {
    expect(refused(plan({ batchNo: "003", to: "paused", data: {} }, { batch: batchView({ state: "open" }) })).message).toContain("reason");
  });

  it("raises a Concern per paid customer, and sends nothing", () => {
    const value = ok(
      plan(
        { batchNo: "003", to: "paused", data: { reason: "no prawns this week" } },
        {
          batch: batchView({ state: "open", paidCount: 5 }),
          paidOrders: [
            { id: "ord-1", customerPhone: "+919000000001", jars: 3, paidAtMillis: NOW },
            { id: "ord-2", customerPhone: "+919000000002", jars: 2, paidAtMillis: NOW },
          ],
        },
      ),
    ).value;
    expect(value.concerns.map((c) => c.type)).toEqual(["batchPaused", "batchPaused"]);
    expect(value.concerns.map((c) => c.customerPhone)).toEqual(["+919000000001", "+919000000002"]);
    expect(value.approvals).toEqual([]);
  });

  it("resumes into any of the four states it can be paused from, and clears the reason", () => {
    for (const to of ["open", "halfReached", "sourcing", "cooking"]) {
      const value = ok(plan({ batchNo: "003", to, data: {} }, { batch: batchView({ state: "paused" }) })).value;
      expect(value.patch.state).toBe(to);
      expect(value.patch.pausedReason).toBeNull();
    }
  });

  it("cannot resume into bottled", () => {
    expect(refused(plan({ batchNo: "003", to: "bottled", data: bottlingInputs() }, { batch: batchView({ state: "paused" }) })).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The automatic rows                                                         */
/* -------------------------------------------------------------------------- */

function automatic(batch: Partial<BatchView>, over: Partial<{ openOrders: number; heldJars: Record<string, { qty: number; expiresAt: number }> }> = {}) {
  return nextAutomaticStep({
    batch: batchView(batch),
    heldJars: over.heldJars ?? {},
    openOrders: over.openOrders ?? 0,
    nowMillis: NOW,
  });
}

describe("the automatic rows, brief 8.2", () => {
  it("does nothing to an open batch below half", () => {
    const step = automatic({ state: "open", paidCount: 9 });
    expect(step.to).toBeNull();
    expect(step.stampFields).toEqual([]);
  });

  it("moves to half reached at exactly half of bookable, and starts the 5 day clock", () => {
    const step = automatic({ state: "open", paidCount: 10 });
    expect(step.to).toBe("halfReached");
    expect(step.stampFields).toContain("halfReachedAt");
    expect(step.approvals[0]).toMatchObject({ id: "half-003", kind: "halfReached", status: "waiting" });
    expect(step.approvals[0].dueAtMillis).toBe(NOW + HALF_CLOCK_DAYS * 24 * 60 * 60 * 1000);
  });

  it("does not reach half twice", () => {
    expect(automatic({ state: "open", paidCount: 12, halfReachedAt: NOW - 1000 }).to).toBeNull();
  });

  it("raises the full flag at 90% booked, without changing the state, on the 3 day clock", () => {
    const step = automatic({ state: "sourcing", paidCount: 19 });
    expect(step.to).toBeNull();
    expect(step.stampFields).toContain("fullReachedAt");
    expect(step.approvals[0]).toMatchObject({ id: "full-003", kind: "full", status: "waiting" });
    expect(step.approvals[0].dueAtMillis).toBe(NOW + FULL_CLOCK_DAYS * 24 * 60 * 60 * 1000);
    expect(step.approvals[0].draft).toBe("The batch is full.");
  });

  it("replaces the 5 day clock rather than running a second one beside it (8.2)", () => {
    const step = automatic({ state: "sourcing", paidCount: 19, halfReachedAt: NOW - DAY_MS });
    // The 3 day clock starts...
    expect(step.approvals[0].dueAtMillis).toBe(NOW + FULL_CLOCK_DAYS * DAY_MS);
    // ...and the 5 day one it replaced is cancelled in the same step.
    expect(step.cancelClocks).toEqual([{ id: "half-003", supersededBy: "full-003" }]);

    // Every other step leaves every clock alone.
    expect(automatic({ state: "open", paidCount: 10 }).cancelClocks).toEqual([]);
    expect(automatic({ state: "bottled", paidCount: 10, bottledJars: 22 }).cancelClocks).toEqual([]);
  });

  it("never starts the 5 day clock after the 3 day one: half is always taken first", () => {
    // A batch that fills in a single payment. The half hop must come first,
    // so the 5 day clock exists to be replaced rather than being created
    // after the 3 day clock had already started.
    const first = automatic({ state: "open", paidCount: 19 });
    expect(first.to).toBe("halfReached");
    expect(first.approvals[0].dueAtMillis).toBe(NOW + HALF_CLOCK_DAYS * DAY_MS);

    const second = automatic({ state: "halfReached", paidCount: 19, halfReachedAt: NOW });
    expect(second.stampFields).toContain("fullReachedAt");
    expect(second.approvals[0].dueAtMillis).toBe(NOW + FULL_CLOCK_DAYS * DAY_MS);
    expect(second.cancelClocks).toEqual([{ id: "half-003", supersededBy: "full-003" }]);
  });

  it("does not raise the full flag twice", () => {
    expect(automatic({ state: "sourcing", paidCount: 19, fullReachedAt: NOW - 1000 }).to).toBeNull();
  });

  it("goes bottled to in stock when the pot gave a surplus", () => {
    const step = automatic({ state: "bottled", paidCount: 10, bottledJars: 22 });
    expect(step.to).toBe("inStock");
    expect(step.approvals[0]).toMatchObject({ id: "inStock-003", kind: "broadcast", status: "waiting" });
  });

  it("goes bottled straight to sold out when there is none (A28)", () => {
    const step = automatic({ state: "bottled", paidCount: 22, bottledJars: 22 });
    expect(step.to).toBe("soldOut");
    expect(step.approvals).toEqual([]);
  });

  it("goes in stock to sold out when no jar is free", () => {
    expect(automatic({ state: "inStock", paidCount: 22, bottledJars: 22 }).to).toBe("soldOut");
    expect(automatic({ state: "inStock", paidCount: 21, bottledJars: 22 }).to).toBeNull();
    expect(automatic({ state: "inStock", paidCount: 20, bottledJars: 22, writtenOff: 2 }).to).toBe("soldOut");
  });

  it("does not call a batch sold out while somebody is paying for the last jar (9.3)", () => {
    const step = automatic(
      { state: "inStock", paidCount: 21, bottledJars: 22 },
      { heldJars: { "ord-1": { qty: 1, expiresAt: NOW + 60_000 } } },
    );
    expect(step.to).toBeNull();
  });

  it("counts a lapsed hold as a free jar", () => {
    const step = automatic(
      { state: "inStock", paidCount: 21, bottledJars: 22 },
      { heldJars: { "ord-1": { qty: 1, expiresAt: NOW - 60_000 } } },
    );
    expect(step.to).toBeNull();
  });

  it("archives a sold out batch once every order is closed, and not before", () => {
    expect(automatic({ state: "soldOut" }, { openOrders: 1 }).to).toBeNull();
    expect(automatic({ state: "soldOut" }, { openOrders: 0 }).to).toBe("archived");
  });

  it("does nothing at all to an archived batch", () => {
    const step = automatic({ state: "archived" }, { openOrders: 0 });
    expect(step.to).toBeNull();
    expect(step.stampFields).toEqual([]);
  });

  it("stops: every step's own precondition is false once it is applied", () => {
    // The walk the triggers actually take, each hop fed the state the
    // previous hop wrote. It has to end, and end at archived.
    let batch = batchView({ state: "open", paidCount: 19, bottledJars: 22 });
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const step = nextAutomaticStep({ batch, heldJars: {}, openOrders: 0, nowMillis: NOW });
      if (step.to === null && step.stampFields.length === 0) break;
      seen.push(step.to ?? `flag:${step.stampFields[0]}`);
      batch = batchView({
        ...batch,
        state: step.to ?? batch.state,
        halfReachedAt: step.stampFields.includes("halfReachedAt") ? NOW : batch.halfReachedAt,
        fullReachedAt: step.stampFields.includes("fullReachedAt") ? NOW : batch.fullReachedAt,
      });
    }
    expect(seen).toEqual(["halfReached", "flag:fullReachedAt"]);
    expect(batch.state).toBe("halfReached");
  });
});

/* -------------------------------------------------------------------------- */
/* The last row of 8.2: the Owner's yes on "The batch is full."               */
/* -------------------------------------------------------------------------- */

function fullApproval(
  data: Record<string, unknown> = {},
  ctx: Partial<TransitionContext> = {},
) {
  const parsed = parseFullApprovalRequest({ batchNo: "003", data });
  if (!parsed.ok) return parsed;
  return planFullApproval(parsed.value, context(ctx));
}

/** A batch the flag has already been raised on, which is what the yes answers. */
const FULL_BATCH: Partial<BatchView> = {
  state: "sourcing",
  paidCount: 19,
  halfReachedAt: NOW - 3 * DAY_MS,
  fullReachedAt: NOW - DAY_MS,
};

describe("the full approval: automatic flag, then owner yes", () => {
  it("is the Owner's, and nobody else's", () => {
    expect(FULL_APPROVAL_ROW.callers).toEqual(["owner"]);

    for (const role of ["kitchen", "viewer"]) {
      const result = refused(
        fullApproval({}, { caller: { uid: `uid-${role}`, role }, batch: batchView(FULL_BATCH) }),
      );
      expect(result.code, role).toBe("permission-denied");
      expect(result.message).toMatch(/Only the owner/);
    }

    expect(refused(fullApproval({}, { caller: { uid: null, role: null } })).code).toBe(
      "unauthenticated",
    );
    expect(
      refused(fullApproval({}, { caller: { uid: "uid-stranger", role: undefined } })).code,
    ).toBe("permission-denied");
  });

  it("stamps the batch and marks the approval approved, and sends nothing", () => {
    const value = ok(fullApproval({}, { batch: batchView(FULL_BATCH) })).value;

    // The batch does not move: full is a flag, not a state.
    expect(value.patch).toEqual({});
    expect(value.stampFields).toEqual(["updatedAt", "fullApprovedAt"]);
    expect(value.alreadyApproved).toBe(false);
    expect(value.approvals).toHaveLength(1);
    expect(value.approvals[0]).toMatchObject({
      id: "full-003",
      kind: "full",
      batchNo: "003",
      draft: "The batch is full.",
      status: "approved",
      answer: true,
      // Nothing here is a send, and nothing here starts a clock: the 3 day
      // clock was started by the flag and is not restarted by the answer.
      dueAtMillis: null,
    });
  });

  it("records an edited message as edited", () => {
    const value = ok(
      fullApproval({ messageText: "The batch is full. Cooking starts Friday." }, { batch: batchView(FULL_BATCH) }),
    ).value;
    expect(value.approvals[0].status).toBe("edited");
    expect(value.approvals[0].draft).toBe("The batch is full. Cooking starts Friday.");
  });

  it("refuses a yes on a batch that is not full yet", () => {
    const result = refused(
      fullApproval({}, { batch: batchView({ state: "open", paidCount: 10, fullReachedAt: null }) }),
    );
    expect(result.code).toBe("failed-precondition");
    expect(result.message).toMatch(/not full yet/);
  });

  it("refuses a yes on a batch that is not there", () => {
    expect(refused(fullApproval({}, { batch: null })).code).toBe("not-found");
  });

  it("is harmless twice: the first yes is the one that stands", () => {
    const value = ok(
      fullApproval({}, { batch: batchView({ ...FULL_BATCH, fullApprovedAt: NOW - 60_000 }) }),
    ).value;
    expect(value.alreadyApproved).toBe(true);
    // Nothing is written at all, so the stamp cannot move.
    expect(value.patch).toEqual({});
    expect(value.stampFields).toEqual([]);
    expect(value.approvals).toEqual([]);
    expect(value.computed.fullApprovedAtMillis).toBe(NOW - 60_000);
  });

  it("takes messageText and nothing else, and no protected field at all", () => {
    const unexpected = parseFullApprovalRequest({ batchNo: "003", data: { sneaky: true } });
    expect(unexpected.ok).toBe(false);
    expect(refused(unexpected).message).toContain("sneaky");

    const smuggled = parseFullApprovalRequest({ batchNo: "003", data: { fullApprovedAt: 1 } });
    expect(refused(smuggled).message).toContain("fullApprovedAt");

    expect(refused(parseFullApprovalRequest({ batchNo: "3", data: {} })).code).toBe(
      "invalid-argument",
    );
    expect(refused(parseFullApprovalRequest(null)).code).toBe("invalid-argument");
  });
});
