/**
 * What a document says: brief 13.2's list, checked line by line, and the four
 * kinds of 13.1 checked as shapes.
 *
 * The receipt, the refund note and the credit note are not wired to anything
 * yet (M3.6 and M4.5 do that). They are tested here so that when those tasks
 * arrive they are a call, not a design.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_SELLER, documentTitle } from "./copy";
import {
  documentLines,
  documentSubtotal,
  type DocumentSource,
  planDocument,
  splitGst,
} from "./plan";

const JAR = 64_900;

function source(overrides: Partial<DocumentSource> = {}): DocumentSource {
  return {
    orderId: "o-7f3a2c",
    channel: "counter",
    customerName: "Asha Menon",
    customerPhone: "+919000001111",
    customerEmail: null,
    deliveryLines: [],
    placeOfSupply: "KL",
    lines: [
      {
        description: "Prawns and dates",
        hsn: "16052900",
        qty: 2,
        unitPrice: JAR,
        batchNo: "001",
        jarNumbers: ["001/04", "001/05"],
      },
    ],
    shippingFee: 0,
    discount: 0,
    discountReason: null,
    paymentMethod: "cash",
    paymentStatus: "captured",
    paymentReference: null,
    ...overrides,
  };
}

function plan(overrides: Partial<DocumentSource> = {}, extra: Record<string, unknown> = {}) {
  return planDocument({
    kind: "bill",
    source: source(overrides),
    seller: DEFAULT_SELLER,
    gstEnabled: false,
    homeState: "KL",
    issuedOn: "2026-09-23",
    ...extra,
  });
}

/* -------------------------------------------------------------------------- */

describe("GST, off at launch", () => {
  it("writes the whole total as taxable value and all three taxes at zero", () => {
    expect(splitGst(129_800, "KL", "KL", false)).toEqual({
      taxable: 129_800,
      cgst: 0,
      sgst: 0,
      igst: 0,
    });
  });

  it("refuses to pretend, rather than quietly issuing a zero-tax tax invoice", () => {
    expect(() => splitGst(129_800, "KL", "KL", true)).toThrow(/Ask Shefin to switch GST back off/);
  });

  it("carries the fields on every document, so switching on is not a migration", () => {
    const body = plan();
    expect(body.taxable).toBe(129_800);
    expect(body.cgst).toBe(0);
    expect(body.sgst).toBe(0);
    expect(body.igst).toBe(0);
    expect(body.gstEnabled).toBe(false);
  });

  it("carries HSN on the line without using it (D26)", () => {
    expect(plan().lines[0].hsn).toBe("16052900");
  });

  it("never invents a GSTIN", () => {
    expect(plan().seller.gstin).toBeNull();
  });
});

describe("the lines, brief 13.2", () => {
  it("carries the product, batch number, jar numbers, quantity, price and amount", () => {
    expect(documentLines(source())).toEqual([
      {
        description: "Prawns and dates",
        hsn: "16052900",
        qty: 2,
        unitPrice: JAR,
        amount: 129_800,
        batchNo: "001",
        jarNumbers: ["001/04", "001/05"],
      },
    ]);
  });

  it("adds a shipping line only when there is a shipping fee", () => {
    expect(documentLines(source()).some((line) => line.description === "Shipping")).toBe(false);
    const shipped = documentLines(source({ shippingFee: 6_000 }));
    expect(shipped).toHaveLength(2);
    expect(shipped[1]).toMatchObject({ description: "Shipping", amount: 6_000 });
  });

  it("keeps the discount out of the lines, so it is never shown twice", () => {
    const lines = documentLines(source({ discount: 5_000, discountReason: "regular customer" }));
    expect(lines).toHaveLength(1);
  });

  it("carries a custom line by its own description, with no batch behind it", () => {
    const lines = documentLines(
      source({
        lines: [
          {
            description: "A jar of the broken ones",
            hsn: null,
            qty: 1,
            unitPrice: 30_000,
            batchNo: null,
            jarNumbers: [],
          },
        ],
      }),
    );
    expect(lines[0]).toMatchObject({
      description: "A jar of the broken ones",
      batchNo: null,
      jarNumbers: [],
      amount: 30_000,
    });
  });
});

describe("what it comes to", () => {
  it("adds the lines and the shipping, before the discount", () => {
    expect(documentSubtotal(source({ shippingFee: 6_000 }))).toBe(135_800);
  });

  it("takes the discount off the total and says why", () => {
    const body = plan({ discount: 5_000, discountReason: "regular customer" });
    expect(body.subtotal).toBe(129_800);
    expect(body.discount).toBe(5_000);
    expect(body.discountReason).toBe("regular customer");
    expect(body.total).toBe(124_800);
  });

  it("is integers in paise all the way down", () => {
    const body = plan({ shippingFee: 6_000, discount: 5_000, discountReason: "ok" });
    for (const value of [body.subtotal, body.discount, body.shippingFee, body.total, body.taxable]) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }
    for (const line of body.lines) {
      expect(Number.isSafeInteger(line.unitPrice)).toBe(true);
      expect(Number.isSafeInteger(line.amount)).toBe(true);
    }
  });
});

describe("who it is to, and where it happened", () => {
  it('says "handed over at Kunnamangalam" when there is no address', () => {
    expect(plan().deliveryText).toBe("Handed over at Kunnamangalam");
  });

  it("reads the handed-over note off the seller settings (D38)", () => {
    // Shefin's words: "keep that field editable as a note". So a different
    // door is a settings change, not a deploy.
    const body = planDocument({
      kind: "bill",
      source: source(),
      seller: { ...DEFAULT_SELLER, handedOverText: "Handed over at the shop" },
      gstEnabled: false,
      homeState: "KL",
      issuedOn: "2026-09-23",
    });
    expect(body.deliveryText).toBe("Handed over at the shop");
  });

  it("writes the delivery address when there is one", () => {
    const body = plan({ deliveryLines: ["14 Beach Road", "Kozhikode 673032"] });
    expect(body.deliveryText).toBe("14 Beach Road, Kozhikode 673032");
  });

  it("carries the place of supply, the channel and the payment reference", () => {
    const body = plan({ paymentMethod: "upiToAccount", paymentReference: "UPI 4429183726" });
    expect(body.placeOfSupply).toBe("KL");
    expect(body.channel).toBe("counter");
    expect(body.payment).toEqual({
      method: "upiToAccount",
      status: "captured",
      reference: "UPI 4429183726",
    });
  });

  it("freezes the seller block onto the document", () => {
    expect(plan().seller.name).toBe("Lailark Kitchen");
    expect(plan().seller.fssai).toBe("FSSAI Lic. No. 21323244000035");
  });
});

describe("the four kinds, brief 13.1", () => {
  it('never titles a bill "tax invoice" before the GST switch', () => {
    expect(documentTitle("bill", false)).toBe("Bill");
    expect(documentTitle("bill", true)).toBe("Tax invoice");
  });

  it("plans a receipt for a payment into an open batch", () => {
    const body = planDocument({
      kind: "receipt",
      source: source({ channel: "web", paymentMethod: "razorpay", paymentReference: "pay_x1" }),
      seller: DEFAULT_SELLER,
      gstEnabled: false,
      homeState: "KL",
      issuedOn: "2026-10-02",
    });
    expect(body.kind).toBe("receipt");
    expect(body.total).toBe(129_800);
    expect(body.voids).toBeNull();
    expect(documentTitle(body.kind, body.gstEnabled)).toBe("Receipt");
  });

  it("plans a refund note against the receipt it returns", () => {
    const body = planDocument({
      kind: "refundNote",
      source: source(),
      seller: DEFAULT_SELLER,
      gstEnabled: false,
      homeState: "KL",
      issuedOn: "2026-10-09",
      voids: "LKR/26-27/0004",
      amount: 59_900,
    });
    expect(body.kind).toBe("refundNote");
    expect(body.voids).toBe("LKR/26-27/0004");
    // A part refund: the lines still say what was bought, the total is what
    // is going back.
    expect(body.total).toBe(59_900);
    expect(body.subtotal).toBe(129_800);
  });

  it("plans a credit note that reverses a bill", () => {
    const body = planDocument({
      kind: "creditNote",
      source: source(),
      seller: DEFAULT_SELLER,
      gstEnabled: false,
      homeState: "KL",
      issuedOn: "2026-10-09",
      voids: "LK/26-27/0007",
    });
    expect(body.kind).toBe("creditNote");
    expect(body.voids).toBe("LK/26-27/0007");
    expect(body.total).toBe(129_800);
  });

  it("is born un-voided and un-cancelled", () => {
    const body = plan();
    expect(body.voided).toBeNull();
    expect(body.cancelledBy).toBeNull();
  });
});
