"use client";

import { useProductDetail } from "../_lib/counts";
import { inStockPrice, openBatchPrice } from "../../lib/money";

// The footer row of a jar card: the price and the one action anchor (M5.12).
//
// Mode-aware, because the two modes are two different prices and two
// different verbs (D84):
//
//   inStock  ₹649 and "Take a jar"
//   open     ₹599 and "Book a jar"
//   cooking  neither. Brief §7.5's line is what that card carries, and
//            `createCheckout` refuses a booking today, so a button here
//            would be a button that cannot work. M5.13 is the change.
//   anything else, loading included: neither.
//
// Why the loading state shows no price at all: an in-stock price printed on a
// card that turns out to be an open batch is a wrong price, and CLAUDE.md §3
// forbids a surprise charge at payment. The slot holds its height instead
// (`.hp-card__action`, min-height in the page's CSS) so no card jumps when the
// counts land.
//
// The anchor points where the card already points (D71): the title's anchor
// covers the whole card through a stretched pseudo-element, and this one sits
// above it in z-order so it is clickable. Two anchors per card, no more.
export default function CardAction({ slug }) {
  const state = useProductDetail(slug);
  const mode = state.status === "ready" ? state.entry.mode : null;

  if (mode !== "inStock" && mode !== "open") {
    return <div className="hp-card__action" />;
  }

  const inStock = mode === "inStock";
  return (
    <div className="hp-card__action">
      <span className="hp-card__price">
        {inStock ? inStockPrice() : openBatchPrice()}
      </span>
      <a className="hp-btn hp-btn--take" href={`/pickles/${slug}`}>
        {inStock ? "Take a jar" : "Book a jar"}
      </a>
    </div>
  );
}
