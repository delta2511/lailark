/**
 * The page. Not what it looks like, which is a thing to look at rather than
 * to assert, but the two things that can silently go wrong:
 *
 *  1. **the rupee sign.** It is not in WinAnsi, so a core font cannot print
 *     it. If somebody ever "fixes" `drawAmount` by handing `₹` to
 *     `drawText`, pdf-lib throws and this test says so rather than a customer
 *     opening a bill that reads "Rs.";
 *  2. **an unencodable character in a name or a reason** typed at the
 *     counter, which would otherwise throw in the middle of rendering a bill
 *     that has already been issued and numbered.
 */

import { describe, expect, it } from "vitest";
import { StandardFonts, PDFDocument } from "pdf-lib";

import { DEFAULT_SELLER } from "./copy";
import {
  A5,
  amountWidth,
  customerName,
  renderDocumentPdf,
  RUPEE_ADVANCE,
  winAnsi,
  wrap,
  type RenderableDocument,
} from "./pdf";

function doc(overrides: Partial<RenderableDocument> = {}): RenderableDocument {
  return {
    kind: "bill",
    number: "LK/26-27/0001",
    orderId: "o-7f3a2c",
    orderNumber: "o-7f3a2c",
    issuedOn: "2026-09-23",
    lines: [
      {
        description: "Prawns and dates",
        hsn: "16052900",
        qty: 2,
        unitPrice: 64_900,
        amount: 129_800,
        batchNo: "001",
        jarNumbers: ["001/04", "001/05"],
      },
    ],
    taxable: 129_800,
    cgst: 0,
    sgst: 0,
    igst: 0,
    total: 129_800,
    pdfPath: null,
    voids: null,
    cancelledBy: null,
    createdBy: "uid-owner",
    seller: DEFAULT_SELLER,
    customer: { name: "Asha Menon", phone: "+919000001111", email: null },
    deliveryText: "Handed over at Kunnamangalam",
    placeOfSupply: "KL",
    channel: "counter",
    payment: { method: "cash", status: "captured", reference: null },
    subtotal: 129_800,
    discount: 0,
    discountReason: null,
    shippingFee: 0,
    gstEnabled: false,
    voided: null,
    ...overrides,
  } as RenderableDocument;
}

describe("the rupee sign", () => {
  it("is not printable by a core font, which is why it is drawn", async () => {
    const pdf = await PDFDocument.create();
    const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
    expect(() => helvetica.widthOfTextAtSize("₹", 9)).toThrow();
  });

  it("takes a known width, so an amount can be right-aligned", async () => {
    const pdf = await PDFDocument.create();
    const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
    const width = amountWidth(64_900, { font: helvetica, size: 9 });
    expect(width).toBeCloseTo(RUPEE_ADVANCE * 9 + helvetica.widthOfTextAtSize("649", 9), 5);
  });

  it("leaves room for the minus on a negative amount", async () => {
    const pdf = await PDFDocument.create();
    const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
    expect(amountWidth(-5_000, { font: helvetica, size: 9 })).toBeGreaterThan(
      amountWidth(5_000, { font: helvetica, size: 9 }),
    );
  });
});

describe("text a person typed", () => {
  it("flattens what WinAnsi has no room for, rather than throwing mid-bill", () => {
    expect(winAnsi("Asha’s jar — the last one…")).toBe("Asha's jar - the last one...");
  });

  it("drops a rupee sign out of free text, because amounts are drawn not typed", () => {
    expect(winAnsi("paid ₹649")).toBe("paid 649");
  });

  it("keeps an ordinary name exactly as it is", () => {
    expect(winAnsi("Asha Menon")).toBe("Asha Menon");
  });
});

/* -------------------------------------------------------------------------- */

describe("the Billed to column stays in its column", () => {
  /** Half an A5 page less the gutter, which is what the block gets. */
  const COLUMN = A5[0] / 2 - 32 - 12;

  it("wraps a name too long for the column rather than running across the page", async () => {
    const pdf = await PDFDocument.create();
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const name = "Kunhimuhammed Abdurahiman Nedumparambil";

    // The thing that used to go wrong: one line, wider than the column.
    expect(bold.widthOfTextAtSize(name, 9)).toBeGreaterThan(COLUMN);

    const lines = wrap(name, bold, 9, COLUMN);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(name);
    for (const line of lines) {
      expect(bold.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(COLUMN);
    }
  });

  it("breaks a long email, which is one unbreakable word", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const email = "kunhimuhammed.abdurahiman@averylongdomainname.example.in";

    const lines = wrap(email, font, 8, COLUMN);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(email);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 8)).toBeLessThanOrEqual(COLUMN);
    }
  });

  it("draws a bill with both, and with the delivery block beside them", async () => {
    const bytes = await renderDocumentPdf(
      doc({
        customer: {
          name: "Kunhimuhammed Abdurahiman Nedumparambil",
          phone: "+919000001111",
          email: "kunhimuhammed.abdurahiman@averylongdomainname.example.in",
        },
      }),
    );
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });
});

describe("the totals block stays on the paper", () => {
  /** The label is right-aligned at `colUnit` and may run back to the margin. */
  const LABEL = A5[0] - 32 - 72 - 32;

  /**
   * `sale.ts` lets a discount reason be 200 characters. Right-aligned and
   * unwrapped, the label crossed the left edge of the paper at about 60 and
   * was mostly off the sheet by 120, so the "D" of "Discount" was sliced off
   * by an ordinary reason typed at the counter.
   */
  it("wraps a discount reason that would otherwise run off the left edge", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const reason =
      "Discount, neighbour, takes four jars every month and always pays on the day, so this one is on us";

    // The thing that used to go wrong: one line, wider than the paper allows.
    expect(font.widthOfTextAtSize(reason, 7.5)).toBeGreaterThan(LABEL);

    const lines = wrap(reason, font, 7.5, LABEL);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(reason);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 7.5)).toBeLessThanOrEqual(LABEL);
    }
  });

  it("draws a bill whose reason is the full 200 characters the counter allows", async () => {
    const bytes = await renderDocumentPdf(
      doc({ discount: 5_000, discountReason: "r".repeat(200), total: 124_800 }),
    );
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });
});

describe("the jar numbers on a line", () => {
  /** What the description column gets, from the page geometry. */
  const DESCRIPTION = A5[0] - 32 - 122 - 32 - 12 - 14;

  /**
   * Empty until M4.1 fills it at packing. Lailark bottles 22 jars to a batch,
   * so the note becomes long the moment that task lands: unwrapped, 22 of
   * them ran off the right edge of the page.
   */
  it("wraps a whole batch of 22 rather than running off the page", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const jars = Array.from({ length: 22 }, (_, i) => `001/${String(i + 1).padStart(2, "0")}`);
    const note = `Batch 001, Jars ${jars.join(", ")}`;

    expect(font.widthOfTextAtSize(note, 7.5)).toBeGreaterThan(DESCRIPTION);

    const lines = wrap(note, font, 7.5, DESCRIPTION);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(note);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 7.5)).toBeLessThanOrEqual(DESCRIPTION);
    }
  });

  it("draws a bill carrying all 22", async () => {
    const jars = Array.from({ length: 22 }, (_, i) => `001/${String(i + 1).padStart(2, "0")}`);
    const bytes = await renderDocumentPdf(
      doc({
        lines: [
          {
            description: "Prawns and dates",
            hsn: "16052900",
            qty: 22,
            unitPrice: 64_900,
            amount: 1_427_800,
            batchNo: "001",
            jarNumbers: jars,
          },
        ],
        subtotal: 1_427_800,
        taxable: 1_427_800,
        total: 1_427_800,
      }),
    );
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });
});

describe("a name a core font cannot print", () => {
  it("falls back to the number, so Billed to is never blank", () => {
    // Kunnamangalam is in Kerala, so this is an ordinary thing to type.
    expect(customerName({ customer: { name: "\u0d06\u0d37 \u0d2e\u0d47\u0d28\u0d4b\u0d7b", phone: "+919000001111" } })).toBe(
      "+919000001111",
    );
  });

  it("keeps a name that survives flattening", () => {
    expect(customerName({ customer: { name: "Asha\u2019s", phone: "+919000001111" } })).toBe("Asha\u2019s");
  });

  it("falls back on a name that is only spaces", () => {
    expect(customerName({ customer: { name: "   ", phone: "+919000001111" } })).toBe("+919000001111");
  });
});

describe("a document that is not whole", () => {
  it("draws a page rather than throwing, whatever is missing", async () => {
    // A throw here runs on a trigger and takes the instance down, and the
    // counter sales sharing it with it.
    const half = { kind: "bill", number: "LK/26-27/0009", total: 0, lines: [] };
    const bytes = await renderDocumentPdf(half as unknown as RenderableDocument);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("survives an empty object", async () => {
    const bytes = await renderDocumentPdf({} as unknown as RenderableDocument);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});

describe("the page", () => {
  it("is one A5 page of PDF", async () => {
    const bytes = await renderDocumentPdf(doc());
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");

    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBe(1);
    const { width, height } = back.getPage(0).getSize();
    expect(width).toBeCloseTo(A5[0], 1);
    expect(height).toBeCloseTo(A5[1], 1);
  });

  it("is titled by its own number", async () => {
    const back = await PDFDocument.load(await renderDocumentPdf(doc()));
    expect(back.getTitle()).toBe("Bill LK/26-27/0001");
  });

  it("draws a shipped bill, a discounted one and a voided one", async () => {
    for (const variant of [
      doc({ shippingFee: 6_000, subtotal: 135_800, total: 135_800, deliveryText: "14 Beach Road, Kozhikode 673032" }),
      doc({ discount: 5_000, discountReason: "regular customer", total: 124_800 }),
      doc({ voided: { at: null as never, by: "uid-kitchen", reason: "entered on the wrong customer" } }),
    ]) {
      const bytes = await renderDocumentPdf(variant);
      expect(bytes.byteLength).toBeGreaterThan(1_000);
    }
  });

  it("renders a name with characters a core font cannot encode", async () => {
    const bytes = await renderDocumentPdf(
      doc({
        customer: { name: "ആശ — Asha’s", phone: "+919000001111", email: null },
        payment: { method: "upiToAccount", status: "captured", reference: "UPI–4429" },
      }),
    );
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });

  it("is the same bytes every time, so a re-render is not a new bill", async () => {
    const one = await renderDocumentPdf(doc());
    const two = await renderDocumentPdf(doc());
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(true);
  });
});
