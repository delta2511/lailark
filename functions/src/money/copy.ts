/**
 * Every word a customer reads on a bill, in one place.
 *
 * A bill is customer-facing text (CLAUDE.md section 3), so: no em dashes,
 * periods and commas only, plain and sparse.
 *
 * **Decision D37: a document carries no sentence of its own.** It stays
 * structural. There is no footer, no thank-you, and no line explaining what a
 * credit note does, and none is to be added later. So this file holds only
 * two kinds of string: the seller block, copied character for character from
 * what Shefin gave, and **field labels**, which are the names of the things
 * brief 13.2 lists ("Bill number and date", "Place of supply", "Total"). A
 * credit note says what it reverses by carrying its number in a labelled
 * field (`LABELS.against`), not by explaining itself in prose.
 */

import type { DocumentKind, SellerIdentity } from "@lailark/shared";

/**
 * Who the bill is from, when `settings/seller` says nothing.
 *
 * The one named place (never scattered through the PDF code), and the
 * fallback rather than the truth: `settings/seller` overrides it field by
 * field, so a new address or a renewed FSSAI licence is a settings change,
 * not a deploy. `gstin` is null and stays null until GST is switched on
 * (D26); it is never invented here.
 */
export const DEFAULT_SELLER: SellerIdentity = {
  name: "Lailark Kitchen",
  addressLines: [
    "Neduvanchalil Veedu, Kunnamangalam,",
    "Kozhikode, Kerala, India, PIN 673571",
  ],
  supportPhone: "Customer care: +91 88919 23827",
  fssai: "FSSAI Lic. No. 21323244000035",
  website: "www.lailark.in",
  gstin: null,
  // D38: the wording stands, but it is a field, not a constant. This is its
  // fallback; `settings/seller.handedOverText` overrides it.
  handedOverText: "Handed over at Kunnamangalam",
};

/**
 * What the page is titled. Brief 13.1: a bill before the GST switch is a
 * plain bill and is "never titled 'tax invoice'", so the bill's title is a
 * function of `gstEnabled` and of nothing else.
 */
export function documentTitle(kind: DocumentKind, gstEnabled: boolean): string {
  switch (kind) {
    case "bill":
      return gstEnabled ? "Tax invoice" : "Bill";
    case "receipt":
      return "Receipt";
    case "creditNote":
      return "Credit note";
    case "refundNote":
      return "Refund note";
  }
}

/** The label in front of the number, which is the title without the case. */
export const LABELS = {
  number: (kind: DocumentKind, gstEnabled: boolean) =>
    `${documentTitle(kind, gstEnabled)} number`,
  date: "Date",
  billedTo: "Billed to",
  delivery: "Delivery",
  placeOfSupply: "Place of supply",
  channel: "Channel",
  payment: "Payment",
  reference: "Reference",
  against: "Against",
  description: "Description",
  batch: "Batch",
  jars: "Jars",
  qty: "Qty",
  unitPrice: "Each",
  amount: "Amount",
  hsn: "HSN",
  subtotal: "Subtotal",
  discount: "Discount",
  shipping: "Shipping",
  taxable: "Taxable value",
  cgst: "CGST 2.5%",
  sgst: "SGST 2.5%",
  igst: "IGST 5%",
  total: "Total",
  gstin: "GSTIN",
  voided: "Voided",
} as const;

/** Brief 13.2's "Added once GST is on": the inclusive-price line. */
export const GST_INCLUSIVE_LINE = "Price inclusive of GST.";

/** How a sale reached us, brief 13.2's "Channel". */
export const CHANNEL_LABEL: Readonly<Record<string, string>> = {
  web: "Online",
  counter: "At the door",
  phone: "Phone",
  whatsapp: "WhatsApp",
  abroad: "From abroad",
};

/** How it was paid, brief 13.2's "Payment method and reference". */
export const PAYMENT_LABEL: Readonly<Record<string, string>> = {
  cash: "Cash",
  upiToAccount: "UPI to our account",
  razorpay: "Card or UPI online",
  razorpayQr: "UPI, our QR code",
  paymentLink: "Payment link",
};

/** Stamped across a document whose number stands but whose sale does not. */
export const VOID_MARK = "VOID";
