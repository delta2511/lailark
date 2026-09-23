/**
 * What a document says, worked out from an order. No Firebase in this file.
 *
 * Brief 13.2 is the list; this turns an order into exactly that list, once,
 * so the PDF renderer has nothing to decide and the stored
 * `documents/{id}` and the page a customer holds can never disagree.
 *
 * **GST is off (D26, brief 4.5).** `taxable`, `cgst`, `sgst` and `igst` are
 * written on every document from day one, at zero, and `hsn` is carried on
 * every line from `products/{slug}.hsn` without being used for tax. Switching
 * GST on is then {@link splitGst} returning different numbers, not a
 * migration over documents already issued.
 */

import {
  addPaise,
  type DocumentKind,
  type DocumentLine,
  type DocumentRecord,
  type Paise,
  type SellerIdentity,
} from "@lailark/shared";

/* -------------------------------------------------------------------------- */
/* What the planner is given                                                  */
/* -------------------------------------------------------------------------- */

/** One line of the order, as the planner reads it. */
export interface DocumentSourceLine {
  /** What the customer reads: the product's name, or the custom description. */
  readonly description: string;
  /** `products/{slug}.hsn`, carried but unused while GST is off (D26). */
  readonly hsn: string | null;
  readonly qty: number;
  readonly unitPrice: Paise;
  /** The **printed** batch number, or null on a batch not yet bottled. */
  readonly batchNo: string | null;
  readonly jarNumbers: readonly string[];
}

/** An order, reduced to what a document needs. Plain values only. */
export interface DocumentSource {
  readonly orderId: string;
  readonly channel: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerEmail: string | null;
  /** The delivery address lines, empty when it was handed over at the door. */
  readonly deliveryLines: readonly string[];
  readonly placeOfSupply: string;
  readonly lines: readonly DocumentSourceLine[];
  readonly shippingFee: Paise;
  readonly discount: Paise;
  readonly discountReason: string | null;
  readonly paymentMethod: string;
  readonly paymentStatus: string;
  readonly paymentReference: string | null;
}

export interface DocumentPlanInput {
  readonly kind: DocumentKind;
  readonly source: DocumentSource;
  readonly seller: SellerIdentity;
  /** `settings/gst.enabled`. False at launch. */
  readonly gstEnabled: boolean;
  /** `settings/gst.homeState`. Kerala. Which side of 13.2's CGST/IGST line. */
  readonly homeState: string;
  /** The Asia/Kolkata calendar date, `"YYYY-MM-DD"`. */
  readonly issuedOn: string;
  /**
   * For a credit note or a refund note: the document number this one is
   * against. Null for a bill and a receipt.
   */
  readonly voids?: string | null;
  /**
   * For a refund note or a credit note, the amount actually being returned,
   * which need not be the whole order. Null means the whole thing.
   */
  readonly amount?: Paise | null;
}

/* -------------------------------------------------------------------------- */
/* GST, off at launch                                                         */
/* -------------------------------------------------------------------------- */

export interface GstSplit {
  readonly taxable: Paise;
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly igst: Paise;
}

/**
 * The tax on a total, given where the supply happened.
 *
 * **While GST is off this returns the whole total as taxable value and zero
 * for all three taxes**, which is what brief 4.5's "ready from day one"
 * means: the fields exist, they are written, and they read zero.
 *
 * The `enabled` branch is deliberately the only place the arithmetic would
 * live. It is not implemented here (GST calculation is out of M2.9's scope);
 * it throws rather than silently returning zeros, so nobody can switch
 * `settings/gst.enabled` on and quietly issue untaxed tax invoices.
 */
export function splitGst(total: Paise, homeState: string, placeOfSupply: string, enabled: boolean): GstSplit {
  if (!enabled) {
    return { taxable: total, cgst: 0, sgst: 0, igst: 0 };
  }
  throw new GstNotBuilt(
    `${GST_NOT_BUILT_REFUSAL} (place of supply ${placeOfSupply}, home ${homeState}, total ${total})`,
  );
}

/**
 * What a person reads when GST has been switched on before the tax on a bill
 * exists. A96: a sentence read at the counter with a customer waiting, and
 * one that names the thing that can actually be done about it.
 *
 * The callable refuses with exactly this **before** it opens its transaction
 * (see `createCounterSale`), so the ordinary path never reaches the throw
 * below; the throw is the belt to that braces, for any other caller.
 */
export const GST_NOT_BUILT_REFUSAL =
  "GST is switched on in Settings, but bills cannot work out the tax yet, so nothing can be sold. Ask Shefin to switch GST back off.";

/** Thrown by {@link splitGst}. Carries a sentence, not a stack trace. */
export class GstNotBuilt extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GstNotBuilt";
  }
}

/* -------------------------------------------------------------------------- */
/* The lines                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Brief 13.2's line list: the goods, then the shipping line "if any".
 *
 * A discount is **not** a line. It comes off under the subtotal, once, with
 * the reason that was typed at the counter beside it, so the goods column
 * reads as what was sold and the money column still adds up. Putting it in
 * both places (which the first draft of this did) shows the same fifty rupees
 * twice to somebody checking a bill by hand.
 */
export function documentLines(source: DocumentSource): DocumentLine[] {
  const lines: DocumentLine[] = [];

  for (const line of source.lines) {
    lines.push({
      description: line.description,
      hsn: line.hsn,
      qty: line.qty,
      unitPrice: line.unitPrice,
      amount: line.unitPrice * line.qty,
      batchNo: line.batchNo,
      jarNumbers: [...line.jarNumbers],
    });
  }

  if (source.shippingFee > 0) {
    lines.push({
      description: "Shipping",
      hsn: null,
      qty: 1,
      unitPrice: source.shippingFee,
      amount: source.shippingFee,
      batchNo: null,
      jarNumbers: [],
    });
  }

  return lines;
}

/** What the lines add up to before the discount comes off. */
export function documentSubtotal(source: DocumentSource): Paise {
  let subtotal = 0;
  for (const line of source.lines) subtotal = addPaise(subtotal, line.unitPrice * line.qty);
  return addPaise(subtotal, source.shippingFee);
}

/* -------------------------------------------------------------------------- */
/* The whole body                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The `documents/{id}` body, without the number, the stamps or `pdfPath`,
 * which the transaction that issues it adds.
 */
export type DocumentBody = Omit<
  DocumentRecord,
  "createdAt" | "updatedAt" | "createdBy" | "number" | "issuedAt" | "pdfPath"
>;

/**
 * Brief 13.2, once, for every one of the four kinds.
 *
 * A receipt, a refund note and a credit note are the same page with a
 * different title and a different sign, which is why they are one function:
 * M3.6 and M4.5 call this with their own `kind` and get a document that is
 * spelled, numbered and rendered exactly like a bill.
 */
export function planDocument(input: DocumentPlanInput): DocumentBody {
  const { source, kind } = input;

  const lines = documentLines(source);
  const subtotal = documentSubtotal(source);
  const orderTotal = subtotal - source.discount;
  const total = input.amount ?? orderTotal;

  const gst = splitGst(total, input.homeState, source.placeOfSupply, input.gstEnabled);

  // D38: the "handed over" note is a settings field, carried on the seller
  // block, so this reads it from there rather than from a constant.
  const deliveryText =
    source.deliveryLines.length === 0
      ? input.seller.handedOverText
      : source.deliveryLines.join(", ");

  return {
    kind,
    orderId: source.orderId,
    orderNumber: source.orderId,
    issuedOn: input.issuedOn,
    lines,
    taxable: gst.taxable,
    cgst: gst.cgst,
    sgst: gst.sgst,
    igst: gst.igst,
    total,
    voids: input.voids ?? null,
    cancelledBy: null,
    seller: input.seller,
    customer: {
      name: source.customerName,
      phone: source.customerPhone,
      email: source.customerEmail,
    },
    deliveryText,
    placeOfSupply: source.placeOfSupply,
    channel: source.channel,
    payment: {
      method: source.paymentMethod as DocumentBody["payment"]["method"],
      status: source.paymentStatus,
      reference: source.paymentReference,
    },
    subtotal,
    discount: source.discount,
    discountReason: source.discountReason,
    shippingFee: source.shippingFee,
    gstEnabled: input.gstEnabled,
    voided: null,
  };
}
