import { describe, expect, it } from "vitest";
import {
  APPROVAL_KINDS,
  BATCH_STATES,
  BATCH_STATES_IN_STOCK,
  BATCH_STATES_OPEN_FOR_BOOKING,
  BATCH_STATES_PAUSABLE,
  BATCH_TRANSITIONS,
  type BatchState,
  canTransitionBatch,
  CONCERN_TYPES,
  COURIERS,
  DOCUMENT_KINDS,
  FULFILMENT_MODES,
  ORDER_CHANNELS,
  ORDER_STATES,
  ORDER_STATES_PAID,
  ORDER_STATES_RAISING_CONCERN,
  ORDER_STATES_TERMINAL,
  PAYMENT_METHODS,
  PAYMENT_METHODS_ONLINE,
  PAYMENT_STATUSES,
  ROLES,
  SETTINGS_NAMES,
  SHIPPING_RULES,
} from "./states.js";
import { SHARED_VERSION } from "./version.js";

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

describe("the spellings", () => {
  const lists = {
    BATCH_STATES,
    ORDER_STATES,
    PAYMENT_STATUSES,
    PAYMENT_METHODS,
    ORDER_CHANNELS,
    FULFILMENT_MODES,
    DOCUMENT_KINDS,
    COURIERS,
    SHIPPING_RULES,
    APPROVAL_KINDS,
    CONCERN_TYPES,
    ROLES,
    SETTINGS_NAMES,
  };

  for (const [name, values] of Object.entries(lists)) {
    it(`${name} has no duplicate and no stray whitespace`, () => {
      expect(isUnique(values)).toBe(true);
      for (const value of values) {
        expect(value).toBe(value.trim());
        expect(value.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("batch states, brief 8.1", () => {
  it("is the nine of the diagram plus paused", () => {
    expect([...BATCH_STATES]).toEqual([
      "draft",
      "open",
      "halfReached",
      "sourcing",
      "cooking",
      "bottled",
      "inStock",
      "soldOut",
      "archived",
      "paused",
    ]);
  });

  it("closes booking at 599 when cooking starts, brief 7.5", () => {
    expect([...BATCH_STATES_OPEN_FOR_BOOKING]).toEqual(["open", "halfReached", "sourcing"]);
    expect(BATCH_STATES_OPEN_FOR_BOOKING).not.toContain("cooking");
    expect([...BATCH_STATES_IN_STOCK]).toEqual(["bottled", "inStock"]);
  });

  it("can be paused from the six states of decision D23, and resume to each", () => {
    expect([...BATCH_STATES_PAUSABLE]).toEqual([
      "open",
      "halfReached",
      "sourcing",
      "cooking",
      "inStock",
      "soldOut",
    ]);
    for (const state of BATCH_STATES_PAUSABLE) {
      expect(canTransitionBatch(state, "paused")).toBe(true);
      expect(canTransitionBatch("paused", state)).toBe(true);
    }
  });

  it("refuses to pause a draft or an archived batch (D23)", () => {
    // A draft is not on sale, so there is nothing to freeze. An archived batch
    // is closed and its P&L is locked by the state.
    expect(canTransitionBatch("draft", "paused")).toBe(false);
    expect(canTransitionBatch("archived", "paused")).toBe(false);
    expect(canTransitionBatch("paused", "draft")).toBe(false);
    expect(canTransitionBatch("paused", "archived")).toBe(false);
    expect(canTransitionBatch("paused", "bottled")).toBe(false);
    expect([...BATCH_STATES_PAUSABLE]).not.toContain("draft");
    expect([...BATCH_STATES_PAUSABLE]).not.toContain("archived");
  });

  it("lets D23's two new rows in without losing the old ones", () => {
    expect(BATCH_TRANSITIONS.inStock).toEqual(["soldOut", "paused"]);
    expect(BATCH_TRANSITIONS.soldOut).toEqual(["archived", "paused"]);
  });

  it("names a transition table entry for every state", () => {
    for (const state of BATCH_STATES) {
      expect(BATCH_TRANSITIONS[state]).toBeDefined();
      for (const next of BATCH_TRANSITIONS[state]) {
        expect(BATCH_STATES).toContain(next);
      }
    }
  });

  it("walks the happy path of brief 8.2", () => {
    const path: readonly BatchState[] = [
      "draft",
      "open",
      "halfReached",
      "sourcing",
      "cooking",
      "bottled",
      "inStock",
      "soldOut",
      "archived",
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionBatch(path[i], path[i + 1])).toBe(true);
    }
  });

  it("refuses a jump that skips the kitchen", () => {
    expect(canTransitionBatch("open", "bottled")).toBe(false);
    expect(canTransitionBatch("draft", "inStock")).toBe(false);
    expect(canTransitionBatch("sourcing", "bottled")).toBe(false);
    expect(canTransitionBatch("archived", "open")).toBe(false);
    expect(canTransitionBatch("soldOut", "inStock")).toBe(false);
  });

  it("lets a bottled batch with nothing spare go straight to sold out", () => {
    expect(canTransitionBatch("bottled", "inStock")).toBe(true);
    expect(canTransitionBatch("bottled", "soldOut")).toBe(true);
  });

  it("makes archived terminal", () => {
    expect(BATCH_TRANSITIONS.archived).toEqual([]);
  });

  it("returns false instead of throwing for a state unknown at runtime", () => {
    expect(canTransitionBatch("nope", "open")).toBe(false);
    expect(canTransitionBatch("open", "nope")).toBe(false);
    expect(canTransitionBatch(undefined as unknown as BatchState, "open")).toBe(false);
    expect(canTransitionBatch("open", undefined as unknown as BatchState)).toBe(false);
    // The typed cases still hold with the same call shape.
    expect(canTransitionBatch("open", "halfReached")).toBe(true);
    expect(canTransitionBatch("open", "bottled")).toBe(false);
  });
});

describe("order states, brief 9.1", () => {
  it("is the seventeen of the table", () => {
    expect(ORDER_STATES).toHaveLength(17);
    expect([...ORDER_STATES]).toEqual([
      "draft",
      "held",
      "awaitingPayment",
      "expired",
      "paidWaiting",
      "toPack",
      "readyForCollection",
      "packed",
      "shipped",
      "delivered",
      "deliveryProblem",
      "claim",
      "changeRequested",
      "paused",
      "refunded",
      "voided",
      "closed",
    ]);
  });

  it("marks the three the table calls terminal", () => {
    expect([...ORDER_STATES_TERMINAL]).toEqual(["expired", "voided", "closed"]);
  });

  it("marks the four whose next step is a concern", () => {
    expect([...ORDER_STATES_RAISING_CONCERN]).toEqual([
      "deliveryProblem",
      "claim",
      "changeRequested",
      "paused",
    ]);
  });

  it("keeps every subset inside the full list", () => {
    for (const subset of [ORDER_STATES_TERMINAL, ORDER_STATES_RAISING_CONCERN, ORDER_STATES_PAID]) {
      for (const state of subset) {
        expect(ORDER_STATES).toContain(state);
      }
    }
  });
});

describe("payment, brief 9.2 and decision D10", () => {
  it("runs created, authorized, captured, then a refund", () => {
    expect([...PAYMENT_STATUSES]).toEqual([
      "created",
      "authorized",
      "captured",
      "partlyRefunded",
      "refunded",
    ]);
  });

  it("carries both counter UPI paths of D10", () => {
    expect([...PAYMENT_METHODS]).toEqual([
      "razorpay",
      "cash",
      "upiToAccount",
      "paymentLink",
      "razorpayQr",
    ]);
    expect(PAYMENT_METHODS).toContain("razorpayQr");
    expect(PAYMENT_METHODS).toContain("upiToAccount");
  });

  it("knows which methods confirm by webhook", () => {
    for (const method of PAYMENT_METHODS_ONLINE) {
      expect(PAYMENT_METHODS).toContain(method);
    }
    expect(PAYMENT_METHODS_ONLINE).not.toContain("cash");
    expect(PAYMENT_METHODS_ONLINE).not.toContain("upiToAccount");
  });
});

describe("the rest", () => {
  it("carries the five channels of brief 9.1", () => {
    expect([...ORDER_CHANNELS]).toEqual(["web", "counter", "phone", "whatsapp", "abroad"]);
  });

  it("carries the three roles of decision D13", () => {
    expect([...ROLES]).toEqual(["owner", "kitchen", "viewer"]);
  });

  it("carries the four document kinds of brief 13.3", () => {
    expect([...DOCUMENT_KINDS]).toEqual(["receipt", "bill", "refundNote", "creditNote"]);
  });

  it("carries the two couriers of brief 18.1", () => {
    expect([...COURIERS]).toEqual(["shiprocket", "indiaPost"]);
  });

  it("carries the four approval kinds of brief 18.1", () => {
    expect([...APPROVAL_KINDS]).toEqual(["halfReached", "full", "broadcast", "photoUpdate"]);
  });

  it("carries the three shipping positions of brief 4.2", () => {
    expect([...SHIPPING_RULES]).toEqual(["free", "flatFee", "freeOnTwo"]);
  });

  it("carries brief 18.1's names, the Q4 switch and D24's customer messages", () => {
    expect([...SETTINGS_NAMES]).toEqual([
      "gst",
      "shipping",
      "dispatch",
      "holds",
      "shelfLife",
      "courier",
      "prefixes",
      "discountCap",
      "pincodes",
      "permissions",
      "messages",
    ]);
  });
});

describe("the package", () => {
  it("reports its version as a value, so consumers can prove the link works", () => {
    expect(SHARED_VERSION).toBe("0.0.0");
  });
});
