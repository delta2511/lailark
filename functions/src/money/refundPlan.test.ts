/**
 * What recording a refund decides. Brief §12.3, M4.5, decisions D31 and D65.
 *
 * Money, so every branch is here: the amount arithmetic, the three methods,
 * whether the jar goes back, whether the allowance goes back, which document is
 * issued, and the id that makes a second recording of the same refund
 * impossible.
 */
import { describe, expect, it } from "vitest";

import {
  accumulatedGatewayFee,
  jarsByBatch,
  planRefundDocumentBody,
  parseMarkRefusalRequest,
  parseRecordRefundRequest,
  planMarkRefusal,
  planRecordRefund,
  refundBlockOf,
  refundDocumentId,
  type RecordRefundRequest,
  type RefundableLine,
  type RefundableOrder,
} from "./refundPlan";

const ORDER_ID = "o-7f3a2c";
const PRICE = 64_900;

function request(overrides: Partial<RecordRefundRequest> = {}): RecordRefundRequest {
  return {
    orderId: ORDER_ID,
    method: "cash",
    amountPaise: PRICE,
    razorpayRefundId: null,
    reference: null,
    note: "Handed back at the door",
    gatewayFeeUnreturnedPaise: null,
    refusalReason: null,
    ...overrides,
  };
}

function line(overrides: Partial<RefundableLine> = {}): RefundableLine {
  return {
    batchRef: "b-1",
    qty: 1,
    jarNumbers: [],
    productSlug: "prawns-and-dates",
    customDescription: null,
    unitPrice: PRICE,
    ...overrides,
  };
}

function order(overrides: Partial<RefundableOrder> = {}): RefundableOrder {
  return {
    id: ORDER_ID,
    state: "paidWaiting",
    customerPhone: "+919000000001",
    lines: [line()],
    paidAmount: PRICE,
    refundedSoFar: 0,
    paymentMethod: "cash",
    paidAt: 1,
    refund: undefined,
    documentNumber: "LKR/26-27/0001",
    documentKind: "receipt",
    ...overrides,
  };
}

const CONTEXT = { cashRefundsSoFar: 0, gatewayPendingRefundId: null };

function mustPlan(
  req: RecordRefundRequest = request(),
  ord: RefundableOrder = order(),
  context = CONTEXT,
) {
  const decision = planRecordRefund(req, ord, context);
  if (!decision.ok) throw new Error(`refused: ${decision.code} ${decision.message}`);
  return decision.value;
}

function refusalOf(
  req: RecordRefundRequest = request(),
  ord: RefundableOrder = order(),
  context = CONTEXT,
) {
  const decision = planRecordRefund(req, ord, context);
  if (decision.ok) throw new Error("expected a refusal, got a plan");
  return decision;
}

/* -------------------------------------------------------------------------- */

describe("reading the request", () => {
  it("takes the three methods brief §12.3 names, and nothing else", () => {
    for (const method of ["razorpay", "upi", "cash"]) {
      const parsed = parseRecordRefundRequest({
        orderId: ORDER_ID,
        method,
        amountPaise: 100,
        razorpayRefundId: "rfnd_abc123",
        reference: "UPI123456",
        note: "a note",
      });
      expect(parsed.ok, method).toBe(true);
    }
    const bad = parseRecordRefundRequest({ orderId: ORDER_ID, method: "bankTransfer", amountPaise: 100 });
    expect(bad.ok).toBe(false);
  });

  it("refuses an amount that is not a whole number of paise above zero", () => {
    // CLAUDE.md §3: money is integers in paise. A float would be a number
    // nobody could reconcile against a bank statement.
    for (const amountPaise of [0, -1, 64_900.5, "649", null, undefined, NaN, Infinity]) {
      const parsed = parseRecordRefundRequest({ orderId: ORDER_ID, method: "cash", amountPaise, note: "n" });
      expect(parsed.ok, String(amountPaise)).toBe(false);
    }
  });

  it("asks each method for what brief §12.3's table says it needs", () => {
    // "Razorpay: Amount. If done in the dashboard, the refund webhook matches
    // it." The id is what makes recording the same one twice impossible.
    expect(parseRecordRefundRequest({ orderId: ORDER_ID, method: "razorpay", amountPaise: 100 }).ok).toBe(false);
    // "UPI to account: Amount, UPI reference."
    expect(parseRecordRefundRequest({ orderId: ORDER_ID, method: "upi", amountPaise: 100 }).ok).toBe(false);
    // "Cash: Amount, note."
    expect(parseRecordRefundRequest({ orderId: ORDER_ID, method: "cash", amountPaise: 100 }).ok).toBe(false);
  });

  it("refuses a reference that could address another document", () => {
    for (const reference of ["../orders/o-7f3a2c", "a/b", "  ", "a".repeat(200)]) {
      const parsed = parseRecordRefundRequest({
        orderId: ORDER_ID,
        method: "upi",
        amountPaise: 100,
        reference,
      });
      expect(parsed.ok, reference).toBe(false);
    }
  });

  it("refuses a gateway fee that is not a whole number of paise", () => {
    for (const fee of [-1, 12.5, "12"]) {
      const parsed = parseRecordRefundRequest({
        orderId: ORDER_ID,
        method: "cash",
        amountPaise: 100,
        note: "n",
        gatewayFeeUnreturnedPaise: fee,
      });
      expect(parsed.ok, String(fee)).toBe(false);
    }
    // Zero is a real answer, and so is leaving it out.
    const zero = parseRecordRefundRequest({
      orderId: ORDER_ID,
      method: "cash",
      amountPaise: 100,
      note: "n",
      gatewayFeeUnreturnedPaise: 0,
    });
    expect(zero.ok && zero.value.gatewayFeeUnreturnedPaise).toBe(0);
    const absent = parseRecordRefundRequest({ orderId: ORDER_ID, method: "cash", amountPaise: 100, note: "n" });
    expect(absent.ok && absent.value.gatewayFeeUnreturnedPaise).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("how much may be refunded", () => {
  it("never more than what was actually paid", () => {
    const refused = refusalOf(request({ amountPaise: PRICE + 1 }));
    expect(refused.code).toBe("failed-precondition");
    expect(refused.message).toContain("Only");
  });

  it("counts what has already gone back", () => {
    const half = Math.round(PRICE / 2);
    const ord = order({ refundedSoFar: half });
    expect(mustPlan(request({ amountPaise: PRICE - half }), ord).fullyRefunded).toBe(true);
    expect(planRecordRefund(request({ amountPaise: PRICE - half + 1 }), ord, CONTEXT).ok).toBe(false);
  });

  it("refuses an order no money ever arrived on", () => {
    expect(refusalOf(request(), order({ paidAmount: 0 })).code).toBe("failed-precondition");
  });

  it("refuses a voided sale, whose jars are already back", () => {
    const refused = refusalOf(request(), order({ state: "voided" }));
    expect(refused.message).toContain("voided");
  });

  it("refuses a second refund on an order already refunded in full", () => {
    // Idempotency is not optional on money: the whole payment has gone back,
    // so there is nothing left, whatever the amount asked for.
    const ord = order({ refundedSoFar: PRICE, refund: { totalPaise: PRICE, fullyRefunded: true } });
    const refused = refusalOf(request({ amountPaise: 1 }), ord);
    expect(refused.code).toBe("failed-precondition");
    expect(refused.message).toContain("already been refunded in full");
  });

  it("refuses a gateway fee on a payment no gateway handled", () => {
    const refused = refusalOf(
      request({ gatewayFeeUnreturnedPaise: 1_500 }),
      order({ paymentMethod: "cash" }),
    );
    expect(refused.code).toBe("invalid-argument");
    // Zero is harmless, so it is not refused.
    expect(
      planRecordRefund(request({ gatewayFeeUnreturnedPaise: 0 }), order({ paymentMethod: "cash" }), CONTEXT).ok,
    ).toBe(true);
    // And on a Razorpay payment it is exactly what brief §12.3 asks for.
    expect(
      mustPlan(request({ gatewayFeeUnreturnedPaise: 1_500 }), order({ paymentMethod: "razorpay" }))
        .gatewayFeeUnreturned,
    ).toBe(1_500);
  });
});

/* -------------------------------------------------------------------------- */

describe("the jar, brief §12.3's 'returns to the count if not packed'", () => {
  it("goes back on a full refund of an unpacked order", () => {
    const plan = mustPlan();
    expect(plan.jarReturns).toEqual([{ batchRef: "b-1", qty: 1 }]);
    expect(plan.jarsReturned).toBe(1);
    expect(plan.jarsHeldBackBecause).toBeNull();
  });

  it("does not go back on a partial refund. ASSUMED, M4.5", () => {
    // Half a jar's price back is not evidence the jar came back, and putting
    // one on sale that somebody may still be holding could oversell.
    const plan = mustPlan(request({ amountPaise: 30_000 }));
    expect(plan.fullyRefunded).toBe(false);
    expect(plan.jarsReturned).toBe(0);
    expect(plan.jarsHeldBackBecause).toBe("partial-refund");
    // And the order's own state does not move: the customer is still owed the jar.
    expect(plan.nextOrderState).toBeNull();
    expect(plan.paymentStatus).toBe("partlyRefunded");
  });

  it("does not go back once the order is packed or beyond", () => {
    for (const state of ["packed", "shipped", "delivered", "deliveryProblem", "claim"]) {
      const plan = mustPlan(request(), order({ state }));
      expect(plan.jarsReturned, state).toBe(0);
      expect(plan.jarsHeldBackBecause, state).toBe("already-packed");
    }
  });

  it("does not go back once a jar number is written, whatever the state says", () => {
    // A packed order that was then paused is in a state the packed list does
    // not name, and its jars are in a sealed box all the same.
    const plan = mustPlan(request(), order({ state: "paused", lines: [line({ jarNumbers: [7] })] }));
    expect(plan.jarsReturned).toBe(0);
    expect(plan.jarsHeldBackBecause).toBe("already-packed");
  });

  it("does go back for a counter sale waiting to be collected", () => {
    // The jars are on the kitchen shelf with no numbers written, so they are
    // sellable again. `readyForCollection` is deliberately not a packed state.
    expect(mustPlan(request(), order({ state: "readyForCollection" })).jarsReturned).toBe(1);
  });

  it("takes no jar off the count for a refused capture, which never took one", () => {
    // §21.1 and A242: the money arrived, `payment.status` says captured, the
    // order stayed `held` and not one jar moved onto `paidCount`. Giving one
    // back here would take somebody else's.
    const plan = mustPlan(request(), order({ state: "held", paidAt: undefined }));
    expect(plan.jarsReturned).toBe(0);
    expect(plan.jarsHeldBackBecause).toBe("took-no-jars");
    expect(plan.fullyRefunded).toBe(true);
  });

  it("adds the jars up per batch and ignores a custom line with no batch", () => {
    expect(
      jarsByBatch([
        line({ batchRef: "b-1", qty: 1 }),
        line({ batchRef: "b-1", qty: 2 }),
        line({ batchRef: "b-2", qty: 1 }),
        line({ batchRef: null, qty: 5 }),
      ]),
    ).toEqual([
      { batchRef: "b-1", qty: 3 },
      { batchRef: "b-2", qty: 1 },
    ]);
  });
});

/* -------------------------------------------------------------------------- */

describe("the document, brief §13.1", () => {
  it("issues a credit note after a bill", () => {
    const plan = mustPlan(request(), order({ documentKind: "bill", documentNumber: "LK/26-27/0004" }));
    expect(plan.documentKind).toBe("creditNote");
    expect(plan.voids).toBe("LK/26-27/0004");
  });

  it("issues a refund note against a receipt", () => {
    const plan = mustPlan(request(), order({ documentKind: "receipt", documentNumber: "LKR/26-27/0002" }));
    expect(plan.documentKind).toBe("refundNote");
    expect(plan.voids).toBe("LKR/26-27/0002");
  });

  it("issues a refund note with nothing to void when the order has no document", () => {
    const plan = mustPlan(request(), order({ documentKind: null, documentNumber: null }));
    expect(plan.documentKind).toBe("refundNote");
    expect(plan.voids).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("the refunds/{id}, which is the idempotency key", () => {
  it("names a gateway refund by the gateway's own refund id", () => {
    expect(refundDocumentId(request({ method: "razorpay", razorpayRefundId: "rfnd_A1" }), order(), CONTEXT)).toBe(
      "razorpay-rfnd_A1",
    );
  });

  it("names a UPI refund by its reference", () => {
    expect(refundDocumentId(request({ method: "upi", reference: "UPI7788" }), order(), CONTEXT)).toBe("upi-UPI7788");
  });

  it("counts cash refunds, which carry no reference of their own", () => {
    expect(refundDocumentId(request(), order(), CONTEXT)).toBe(`cash-${ORDER_ID}-1`);
    expect(refundDocumentId(request(), order(), { ...CONTEXT, cashRefundsSoFar: 2 })).toBe(`cash-${ORDER_ID}-3`);
  });

  it("clears the gateway's to-do marker only for the refund it is about", () => {
    const rzp = request({ method: "razorpay", razorpayRefundId: "rfnd_A1" });
    expect(mustPlan(rzp, order(), { ...CONTEXT, gatewayPendingRefundId: "rfnd_A1" }).clearsGatewayPending).toBe(true);
    expect(mustPlan(rzp, order(), { ...CONTEXT, gatewayPendingRefundId: "rfnd_OTHER" }).clearsGatewayPending).toBe(
      false,
    );
    // A cash refund recorded while a gateway refund is still outstanding
    // leaves the marker standing, because it is still to be recorded.
    expect(mustPlan(request(), order(), { ...CONTEXT, gatewayPendingRefundId: "rfnd_A1" }).clearsGatewayPending).toBe(
      false,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("the refusal mark, D65", () => {
  it("may be set with the refund", () => {
    expect(mustPlan(request({ refusalReason: "Abusive on the phone" })).refusalReason).toBe("Abusive on the phone");
  });

  it("may be added afterwards, on an order that has been refunded", () => {
    const decision = planMarkRefusal(
      { orderId: ORDER_ID, reason: "Understood later" },
      { refund: { totalPaise: PRICE, fullyRefunded: true } },
    );
    expect(decision.ok && decision.value.reason).toBe("Understood later");
  });

  it("may be taken off again, because a mark made in error would lock a customer out", () => {
    const decision = planMarkRefusal(
      { orderId: ORDER_ID, reason: null },
      { refund: { totalPaise: PRICE, fullyRefunded: true, refusal: { reason: "wrong" } } },
    );
    expect(decision.ok && decision.value.reason).toBeNull();
  });

  it("means nothing on an order with no refund on it, so it is refused", () => {
    const decision = planMarkRefusal({ orderId: ORDER_ID, reason: "x" }, { refund: undefined });
    expect(decision.ok).toBe(false);
  });

  it("reads an empty or blank reason as taking the mark off", () => {
    for (const reason of ["", "   ", null, undefined]) {
      const parsed = parseMarkRefusalRequest({ orderId: ORDER_ID, reason });
      expect(parsed.ok && parsed.value.reason, String(reason)).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("reading the refund block back off Firestore", () => {
  it("answers zero and false for anything that is not a refund block", () => {
    for (const raw of [undefined, null, "refunded", 7, [], {}]) {
      const view = refundBlockOf(raw);
      expect(view.totalPaise, String(raw)).toBe(0);
      expect(view.fullyRefunded, String(raw)).toBe(false);
      expect(view.hasRefusal, String(raw)).toBe(false);
      expect(view.gatewayPendingRefundId, String(raw)).toBeNull();
    }
  });

  it("reads only a literal true as fully refunded", () => {
    expect(refundBlockOf({ fullyRefunded: "yes" }).fullyRefunded).toBe(false);
    expect(refundBlockOf({ fullyRefunded: 1 }).fullyRefunded).toBe(false);
    expect(refundBlockOf({ fullyRefunded: true }).fullyRefunded).toBe(true);
  });

  it("keeps the document numbers that are strings and drops what is not", () => {
    expect(refundBlockOf({ documentNumbers: ["LKF/26-27/0001", 7, null] }).documentNumbers).toEqual([
      "LKF/26-27/0001",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* The note's own arithmetic                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A credit note reverses a bill. It is a statutory document with a permanent,
 * never-reused number on it, so its goods column has to add up to its total.
 * Round 1 of M4.5 issued one reading 649 rupees of goods against a 300 rupee
 * total, and dropped every line of the order after the first. Every case here
 * asserts the sum against the amount, because that is the invariant.
 */
describe("the refund note's lines add up to what is being returned", () => {
  const NAMES = new Map([
    ["prawns-and-dates", "Prawns and dates"],
    ["lime-pickle", "Lime pickle"],
  ]);
  const HSN = new Map([["prawns-and-dates", "16052900"]]);
  const BATCHES = new Map([
    ["b-1", "001"],
    ["b-2", null],
  ]);

  function body(args: Partial<Parameters<typeof planRefundDocumentBody>[0]> = {}) {
    return planRefundDocumentBody({
      lines: [line()],
      shippingFee: 0,
      discount: 0,
      discountReason: null,
      amount: PRICE,
      fullyRefunded: true,
      productNames: NAMES,
      hsnBySlug: HSN,
      batchNos: BATCHES,
      ...args,
    });
  }

  /**
   * What `planDocument` will put in the total column, worked out the same way.
   *
   * This is the **source** body, where shipping is still its own field, so it is
   * added in here. Not to be confused with `functions/test/refunds.test.ts`'s
   * `closes`, which checks the **stored** document, by which point
   * `documentLines` has pushed shipping into `lines` and adding both would count
   * it twice.
   */
  function closes(out: ReturnType<typeof planRefundDocumentBody>, amount: number): void {
    const goods = out.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
    expect(goods + out.shippingFee - out.discount).toBe(amount);
  }

  it("itemises a full refund, and the column closes", () => {
    const out = body();
    expect(out.itemised).toBe(true);
    closes(out, PRICE);
  });

  it("keeps every line, not just the first", () => {
    const lines = [line(), line({ productSlug: "lime-pickle", batchRef: "b-2", unitPrice: 30_000 })];
    const out = body({ lines, amount: PRICE + 30_000 });
    expect(out.lines).toHaveLength(2);
    expect(out.lines[1].description).toBe("Lime pickle, this batch");
    closes(out, PRICE + 30_000);
  });

  it("names the product and the batch, never a slug", () => {
    const out = body();
    expect(out.lines[0].description).toBe("Prawns and dates, batch 001");
    expect(out.lines[0].batchNo).toBe("001");
    expect(out.lines[0].hsn).toBe("16052900");
  });

  it("carries the jar numbers the order was packed with", () => {
    const out = body({ lines: [line({ jarNumbers: [4, 5] })] });
    expect(out.lines[0].jarNumbers).toEqual(["4", "5"]);
  });

  it("keeps a custom line's own description", () => {
    const out = body({ lines: [line({ customDescription: "Two jars, replacement" })] });
    expect(out.lines[0].description).toBe("Two jars, replacement");
  });

  it("itemises when shipping and a discount are what make it reconcile", () => {
    const out = body({ shippingFee: 5_000, discount: 2_000, discountReason: "Regular", amount: PRICE + 3_000 });
    expect(out.itemised).toBe(true);
    expect(out.shippingFee).toBe(5_000);
    expect(out.discount).toBe(2_000);
    expect(out.discountReason).toBe("Regular");
    closes(out, PRICE + 3_000);
  });

  it("falls back to one honest line for a partial refund, and it closes", () => {
    const out = body({ amount: 30_000, fullyRefunded: false });
    expect(out.itemised).toBe(false);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].description).toBe("Part refund, Prawns and dates, batch 001");
    expect(out.lines[0].qty).toBe(1);
    expect(out.lines[0].unitPrice).toBe(30_000);
    expect(out.lines[0].batchNo).toBe("001");
    // Folded in, so the column still adds up rather than showing a shipping
    // line that was not refunded.
    expect(out.shippingFee).toBe(0);
    expect(out.discount).toBe(0);
    closes(out, 30_000);
  });

  it("falls back to one line for a full refund whose amount does not reconcile", () => {
    // A refused capture of the wrong amount, or a payment that was not the
    // order's total. The lines cannot honestly describe it, so they do not try.
    const out = body({ amount: 50_000, fullyRefunded: true });
    expect(out.itemised).toBe(false);
    expect(out.lines[0].description).toBe("Refund, Prawns and dates, batch 001");
    closes(out, 50_000);
  });

  it("closes even with no lines at all to describe", () => {
    const out = body({ lines: [], amount: 12_345, fullyRefunded: false });
    expect(out.lines[0].description).toBe("Part refund");
    closes(out, 12_345);
  });

  it("uses no em dash anywhere, because a note is customer-facing", () => {
    for (const out of [body(), body({ amount: 30_000, fullyRefunded: false })]) {
      for (const l of out.lines) expect(l.description).not.toContain("\u2014");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The gateway fee                                                            */
/* -------------------------------------------------------------------------- */

describe("the unreturned gateway fee", () => {
  it("is refused when it is larger than what was paid", () => {
    // One fat-fingered zero would otherwise put 50,000 rupees of cost into a
    // P&L built on 15 to 40 jars.
    const refused = refusalOf(
      request({ gatewayFeeUnreturnedPaise: 500_000_000 }),
      order({ paymentMethod: "razorpay" }),
    );
    expect(refused.code).toBe("invalid-argument");
    expect(refused.message).toContain("more than the");
    // Right up to the payment is allowed: a typo the Owner can still correct.
    expect(
      planRecordRefund(
        request({ gatewayFeeUnreturnedPaise: PRICE }),
        order({ paymentMethod: "razorpay" }),
        CONTEXT,
      ).ok,
    ).toBe(true);
  });

  it("accumulates across refunds and is never wiped by a refund that names none", () => {
    // Two Razorpay refunds really do cost two fees.
    expect(accumulatedGatewayFee(1_532, 1_200)).toBe(2_732);
    // A first fee against nothing recorded is the fee.
    expect(accumulatedGatewayFee(null, 1_532)).toBe(1_532);
    // And a later refund that names no fee leaves the recorded one alone. This
    // is the defect: writing the field unconditionally turned 15.32 rupees of
    // real cost into "nobody has said", and the batch P&L lost it.
    expect(accumulatedGatewayFee(1_532, null)).toBe(1_532);
    // Null stays null, which is a different fact from zero.
    expect(accumulatedGatewayFee(null, null)).toBeNull();
    // Zero is a real answer and is recorded as one.
    expect(accumulatedGatewayFee(null, 0)).toBe(0);
    expect(accumulatedGatewayFee(0, 1_532)).toBe(1_532);
  });

  it("is read back off the order so a later refund can add to it", () => {
    expect(refundBlockOf({ gatewayFeeUnreturned: 1_532 }).gatewayFeeUnreturned).toBe(1_532);
    expect(refundBlockOf({ gatewayFeeUnreturned: "1532" }).gatewayFeeUnreturned).toBeNull();
    expect(refundBlockOf({}).gatewayFeeUnreturned).toBeNull();
  });
});
