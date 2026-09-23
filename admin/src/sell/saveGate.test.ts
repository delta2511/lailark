import { describe, expect, it } from "vitest";

import { SELL } from "../copy";
import { computeOutstanding, canSaveFrom, type SaveGateInput } from "./saveGate";

/**
 * A complete, ready-to-save state: every test below starts here and breaks
 * exactly one thing, so a failure always points at a single cause.
 */
const READY: SaveGateInput = {
  phoneText: "9000000001",
  phoneProblem: null,
  phoneE164: "+919000000001",
  needsName: false,
  shownName: "Asha",
  askingNewCustomer: false,

  isCustom: false,
  mayChangePrice: false,
  customDescription: "",
  customAmount: null,
  offeredCustomLinesCount: 0,
  hasBatch: true,

  qtyOk: true,

  priceProblem: null,
  discountProblem: null,
  total: 64_900,

  fulfilment: "handedOver",
  addressReady: true,
  addressName: "",
  addressPhone: "",
  addressLines: "",
  addressCity: "",
  addressState: "",
};

describe("computeOutstanding, the ready state", () => {
  it("has nothing outstanding, so canSaveFrom is true", () => {
    expect(computeOutstanding(READY)).toEqual([]);
    expect(canSaveFrom(computeOutstanding(READY), false)).toBe(true);
  });

  it("canSaveFrom is false while saving, with nothing outstanding to blame", () => {
    expect(canSaveFrom(computeOutstanding(READY), true)).toBe(false);
  });
});

/**
 * The bug this file exists to catch, brief §17.1: the Kitchen (no
 * `mayChangePrice`) picks "Something else" on a product the Owner has not
 * set any custom lines on. `custom-line-none` already says so up in section
 * 2, but before this fix nothing in `outstanding` did, so the save button
 * went dead with an empty panel next to it: the exact failure the task was
 * opened to close.
 */
describe("computeOutstanding, the kitchen custom-line-with-nothing-set-up case", () => {
  const state: SaveGateInput = {
    ...READY,
    isCustom: true,
    mayChangePrice: false,
    customDescription: "",
    customAmount: null,
    offeredCustomLinesCount: 0,
  };

  it("names the problem and points at a way out of it, not at a dead restatement", () => {
    const outstanding = computeOutstanding(state);
    const lineItem = outstanding.find((item) => item.id === "line");
    expect(lineItem).toBeDefined();
    expect(lineItem?.message).toBe(SELL.outstandingCustomLineNone);
    // Points at the "A jar" chip, the person's real move, not back at the
    // custom-line picker that has nothing in it.
    expect(lineItem?.targetId).toBe("sale-line-kind-jar");
  });

  it("keeps Save disabled", () => {
    expect(canSaveFrom(computeOutstanding(state), false)).toBe(false);
  });
});

it("still points at the picker, not the jar toggle, when the Owner has set lines to offer", () => {
  const state: SaveGateInput = {
    ...READY,
    isCustom: true,
    mayChangePrice: false,
    customDescription: "",
    customAmount: null,
    offeredCustomLinesCount: 2,
  };
  const lineItem = computeOutstanding(state).find((item) => item.id === "line");
  expect(lineItem?.message).toBe(SELL.customLinePick);
  expect(lineItem?.targetId).toBe("custom-line-options");
});

/* -------------------------------------------------------------------------- */
/* The invariant: a disabled Save always names a reason                       */
/* -------------------------------------------------------------------------- */

/**
 * An independent restatement of "is this sale actually ready to save,"
 * written from the same nine preconditions `NewSale.tsx` used to write
 * `canSave` with by hand, on purpose *not* sharing a line of code with
 * `computeOutstanding`. If `computeOutstanding` ever again forgets a case
 * the way it forgot the empty-custom-line-list one, this oracle still says
 * "not ready" while `computeOutstanding` says "nothing outstanding," and
 * the test below catches exactly that gap.
 */
function referenceReady(state: SaveGateInput): boolean {
  const lineReady = state.isCustom
    ? state.customDescription.trim() !== "" && state.customAmount !== null && state.customAmount >= 1
    : state.hasBatch;
  const nameReady = !state.needsName || state.shownName.trim() !== "";
  return (
    state.phoneE164 !== null &&
    state.qtyOk &&
    lineReady &&
    state.addressReady &&
    state.discountProblem === null &&
    state.priceProblem === null &&
    state.total >= 0 &&
    nameReady &&
    !state.askingNewCustomer
  );
}

/**
 * One state per precondition, each the ready state with exactly one thing
 * broken, so this is a representative spread of every reason `canSave` can
 * be false, not just the one Shefin hit.
 */
const BROKEN_STATES: Record<string, SaveGateInput> = {
  "no phone": { ...READY, phoneText: "", phoneE164: null },
  "invalid phone": { ...READY, phoneText: "123", phoneProblem: SELL.phoneInvalid, phoneE164: null },
  "new number, no name yet": { ...READY, needsName: true, shownName: "" },
  "new number not yet confirmed": { ...READY, askingNewCustomer: true },
  "no product or batch chosen": { ...READY, hasBatch: false },
  "custom line, owner, no description": { ...READY, isCustom: true, mayChangePrice: true },
  "custom line, owner, no amount": {
    ...READY,
    isCustom: true,
    mayChangePrice: true,
    customDescription: "Broken jar",
    customAmount: null,
  },
  "custom line, kitchen, nothing set up": {
    ...READY,
    isCustom: true,
    mayChangePrice: false,
    offeredCustomLinesCount: 0,
  },
  "custom line, kitchen, lines offered but none picked": {
    ...READY,
    isCustom: true,
    mayChangePrice: false,
    offeredCustomLinesCount: 3,
  },
  "bad quantity": { ...READY, qtyOk: false },
  "price above MRP": { ...READY, priceProblem: SELL.priceAboveMrp },
  "discount over the cap": { ...READY, discountProblem: SELL.discountOverCap("₹50") },
  "total gone negative": { ...READY, total: -100 },
  "shipping, no address at all": { ...READY, fulfilment: "ship", addressReady: false },
  "shipping, name given, phone missing": {
    ...READY,
    fulfilment: "ship",
    addressReady: false,
    addressName: "Reception",
  },
  "shipping, name and phone given, lines missing": {
    ...READY,
    fulfilment: "ship",
    addressReady: false,
    addressName: "Reception",
    addressPhone: "9000000009",
  },
};

describe("computeOutstanding, the invariant", () => {
  it("the ready state really is ready, by the independent oracle too", () => {
    expect(referenceReady(READY)).toBe(true);
  });

  for (const [name, state] of Object.entries(BROKEN_STATES)) {
    it(`"${name}": if the sale is not actually ready, something is named outstanding`, () => {
      expect(referenceReady(state), `${name}: fixture is not actually broken`).toBe(false);
      expect(computeOutstanding(state).length, `${name}: canSave would be false with nothing to blame`).toBeGreaterThan(
        0,
      );
    });
  }

  it("holds for saving canSave too: not-ready and not-saving never yields canSave true", () => {
    for (const state of Object.values(BROKEN_STATES)) {
      expect(canSaveFrom(computeOutstanding(state), false)).toBe(false);
    }
  });
});
