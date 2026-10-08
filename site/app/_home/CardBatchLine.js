"use client";

import { useProductDetail } from "../_lib/counts";
import { formatDate } from "../../lib/order";

// The small mono line on a jar card (M5.12). The reference reads
// "Batch 001 · Bottled 4 Sep 2026 · 200 g"; this renders only what the site
// actually knows.
//
// The batch number is not available to the home page: `/api/counts` does not
// publish it and `products.json` does not carry it, and CLAUDE.md §3 forbids
// typing it, so the line leaves it out rather than inventing one. Reported as
// BLOCKED in the M5.12 ledger.
//
// `packedOn` exists only on an in-stock batch (readProductDetail validates it
// as an ISO date), so an open or cooking batch shows the jar size alone. The
// date is spelled by `formatDate` from site/lib/order.js, the same function the
// order page uses, so "4 Sep 2026" is spelled once in the codebase.
export default function CardBatchLine({ slug, jarGrams }) {
  const state = useProductDetail(slug);
  const packedOn = state.status === "ready" ? state.entry.packedOn : null;
  const bottled = packedOn ? formatDate(packedOn) : null;
  return (
    <p className="hp-card__meta">
      {bottled ? <>Bottled {bottled} &middot; </> : null}
      {jarGrams} g
    </p>
  );
}
