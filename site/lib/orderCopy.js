/**
 * Every word the private order page (`/o/<token>`) puts in front of a
 * customer, in one place.
 *
 * **Approved by Shefin as D63**, 25 Sep 2026, exactly as drafted below.
 * Nothing here was in the docs: the brief names the page (§5, "a private
 * order link sent with the bill, `lailark.in/o/<long random token>`. No login
 * page.") and says nothing about what it says, and the story doc drafts no
 * sentence for it, so all of it sat on CLAUDE.md §5's never-assume list until
 * he answered.
 *
 * Written to the house rules (CLAUDE.md §3 and the story doc §4): we, not I.
 * No em dashes. Warm, sparse, plain. Nothing that sounds like a brand or a
 * bot. No promised date.
 *
 * **There is no line here for the order's state, and that is D63's own
 * decision.** Shefin was offered it and left it out: it is the largest copy
 * surface on the page, a dozen phrases a customer would have to decode, and
 * the page reads correctly without it. `/api/order/<token>` does not send the
 * state either. It can be added later without moving anything else.
 */

export const ORDER_PAGE_COPY = {
  /** The page's heading (D63). */
  heading: "Your order",

  /**
   * What somebody sees when the link does not match an order (D63). A wrong
   * or half-copied link is the likely reason, so it points at the thing they
   * can actually do rather than at an error. It is also what a link that is
   * not a link at all draws: the difference is not the customer's business.
   */
  notFound: "We cannot find an order on this link. Do check it, or message us and we will look.",

  /** When the page itself could not reach us (D63). */
  unavailable: "We cannot show your order just now. Please try again in a moment.",

  /* The field labels down the page (D63). Each is a noun, not a sentence. */
  labelOrder: "Order",
  labelPlaced: "Placed",
  labelBatch: "Batch",
  labelShipping: "Shipping",
  labelTotal: "Total",
  labelGoingTo: "Going to",
  labelJarNumbers: "Your jars",
  headingDocuments: "Bills and receipts",
  documentLink: "Open",
  /** When a bill has not been issued yet (D63). */
  noDocuments: "Nothing has been issued on this order yet.",

  /** How a document's kind reads (D63). The four kinds of brief §13.1. */
  documentKind: {
    receipt: "Receipt",
    bill: "Bill",
    refundNote: "Refund note",
    creditNote: "Credit note",
  },

  /**
   * A document whose kind this page has no word for. ASSUMED (M3.8): D63
   * approved the four kinds and did not draft a fallback, because there is
   * nothing else to fall back from today. "Document" is the plainest noun
   * there is and it promises nothing.
   */
  documentKindUnknown: "Document",
};

/**
 * The kind of a document in words.
 *
 * A kind this page has no word for prints the safe fallback, never the raw
 * stored value. The stored kind is an internal id (`refundNote`, and whatever
 * a later milestone adds), and a customer page is not the place to leak one:
 * the number, the date and the amount beside it already say which document
 * this is.
 */
export function documentKindWords(kind) {
  return Object.prototype.hasOwnProperty.call(ORDER_PAGE_COPY.documentKind, kind)
    ? ORDER_PAGE_COPY.documentKind[kind]
    : ORDER_PAGE_COPY.documentKindUnknown;
}
