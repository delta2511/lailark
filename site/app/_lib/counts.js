"use client";

import { useEffect, useState } from "react";
import JarMarks from "../ds/JarMarks";
import { inStockPrice, openBatchPrice } from "../../lib/money";
import { MRP_PAISE } from "@lailark/shared";

// Live jar counts for the home page's four jar cards.
//
// CLAUDE.md section 3: every count on the site is computed, never typed.
// Flow section 10: jars left, or jars paid, is always shown, everywhere a
// jar is shown. So a card may never print a number of its own, and may
// never fall back to a zero: it either draws the marks it was given or it
// says the count is unavailable.
//
// `/api/counts` itself is built in M3.3 (brief section 19.2: one function
// behind /api/counts, cached 15 s at the CDN). Until it exists the fetch
// 404s and every card degrades to "We cannot show the count just now.",
// which is the same degrade M3.3's own done-when names. This file is
// deliberately the smallest seam that behaviour needs; M3.3 extends it for
// the product pages rather than replacing it.
//
// ASSUMED (M3.2): the two sentences a customer reads when there is no
// count to draw, "We cannot show the count just now." and "Not in the
// kitchen just now." Customer-facing copy that no doc drafts is on the
// never-assume list (CLAUDE.md section 5), so Shefin confirms or replaces
// both.
//
// ASSUMED (M3.2): the response shape below. M3.3 owns the endpoint, so if
// it lands on a different shape, `readProduct` is the one function to
// change.
//
//   GET /api/counts
//   {
//     "products": {
//       "<slug>": {
//         "mode": "inStock" | "open" | "none",
//         "count": <int>,   // jars left (inStock) or jars paid (open)
//         "total": <int>    // jars in the batch, or bookable jars (open)
//       }
//     }
//   }
const COUNTS_URL = "/api/counts";

// A batch is 15 to 40 jars (flow section 1), so anything past this is bad
// data rather than a big batch. Refusing it keeps a broken payload from
// drawing a thousand marks and wrecking the layout.
const MAX_MARKS = 60;

// One request for the whole page, shared by every card that asks, resolved
// to null on any failure at all. Never rejects: a missing count is a
// display state, not an error a customer should see in the console.
let pending = null;

function loadCounts() {
  if (!pending) {
    pending = fetch(COUNTS_URL, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => (payload && typeof payload === "object" ? payload : null))
      .catch(() => null);
  }
  return pending;
}

/** Reads one product out of the payload, or null if it cannot be trusted. */
function readProduct(payload, slug) {
  const entry = payload?.products?.[slug];
  if (!entry || typeof entry !== "object") return null;
  if (entry.mode === "none") return { mode: "none" };
  if (entry.mode !== "inStock" && entry.mode !== "open") return null;

  // Checked on the raw values, never on Number(...) of them. Number(null),
  // Number(false), Number([]) and Number("") are all 0, and 0 is a perfectly
  // good integer, so coercing first turns a malformed payload into a
  // confident "0 jars left of 8". A count that cannot be trusted has to
  // become words, not a zero.
  const { count, total } = entry;
  if (!Number.isInteger(count) || count < 0) return null;
  // A batch has jars in it. total 0 would draw no marks and read as a count
  // of nothing out of nothing, so it is bad data rather than a sold-out
  // batch: sold out is count 0 of a real total, which is still drawn.
  if (!Number.isInteger(total) || total < 1) return null;
  if (total < count || total > MAX_MARKS) return null;
  return { mode: entry.mode, count, total };
}

function useCounts() {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let live = true;
    loadCounts().then((payload) => {
      if (!live) return;
      setState(payload ? { status: "ready", payload } : { status: "unavailable" });
    });
    return () => {
      live = false;
    };
  }, []);

  return state;
}

/**
 * The count slot on a jar card. Its own root node never changes, so the
 * card does not move when the counts land, and a screen reader hears the
 * count arrive rather than nothing.
 */
export function ProductCount({ slug }) {
  const state = useCounts();
  const entry = state.status === "ready" ? readProduct(state.payload, slug) : null;

  let body = null;
  if (state.status === "loading") {
    // Nothing yet, and nothing said: the slot holds its height and waits.
    body = null;
  } else if (!entry) {
    body = (
      <p className="home-count__note">We cannot show the count just now.</p>
    );
  } else if (entry.mode === "none") {
    body = <p className="home-count__note">Not in the kitchen just now.</p>;
  } else {
    const inStock = entry.mode === "inStock";
    body = (
      <>
        <JarMarks
          count={entry.count}
          total={entry.total}
          reading={inStock ? "left" : "paid"}
        />
        <p className="home-count__reading">
          {inStock ? "jars left in this batch" : "jars paid into this batch"}{" "}
          <span className="home-count__price">
            {inStock ? inStockPrice() : openBatchPrice()}
          </span>
        </p>
      </>
    );
  }

  return (
    <div className="home-count" aria-live="polite">
      {body}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* M3.3: the product page's own reading of the same payload                   */
/* -------------------------------------------------------------------------- */
//
// The product page needs more than the home page's card: this batch's own
// price (D40: every batch may carry its own priceInStock/priceOpen, so a
// static site must never assume the launch default still holds) and, for an
// in-stock batch, the three shelf-life dates the Legal Metrology block and
// the Buy cut-off both need (brief 6.2, 20.3).
//
// Same discipline as `readProduct`: every field is checked on its raw JSON
// value, and anything that does not check out is dropped rather than
// coerced, because a dropped field degrades to "unavailable" or to no Buy
// button, and a coerced one could silently draw a wrong price or hide an
// expired sale-stop date behind a false "still selling".

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateOrNull(value) {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

/** A positive integer paise price at or under the printed MRP, or null. */
function paiseOrNull(value) {
  if (!Number.isInteger(value) || value <= 0) return null;
  if (value > MRP_PAISE) return null; // CLAUDE.md section 3: never above MRP.
  return value;
}

/**
 * The full detail one product page needs, or null if the base count itself
 * cannot be trusted (readProduct's own rule). A batch whose price or dates
 * fail validation still returns the count: only the fields that failed come
 * back null, so the page can still show the jars and simply drop the price
 * line or the Buy button, rather than hiding a count that is fine.
 */
export function readProductDetail(payload, slug) {
  const base = readProduct(payload, slug);
  if (!base) return null;
  if (base.mode === "none") return base;

  const entry = payload?.products?.[slug] ?? {};
  if (base.mode === "inStock") {
    return {
      ...base,
      priceInStockPaise: paiseOrNull(entry.priceInStockPaise),
      packedOn: isoDateOrNull(entry.packedOn),
      bestBefore: isoDateOrNull(entry.bestBefore),
      saleStopOn: isoDateOrNull(entry.saleStopOn),
    };
  }
  return {
    ...base,
    priceOpenPaise: paiseOrNull(entry.priceOpenPaise),
  };
}

/**
 * `{ status: "loading" | "unavailable" }` while there is nothing to show
 * yet, or `{ status: "ready", entry }` once the payload has landed and
 * validated. The product page's only source of truth for what to draw.
 */
export function useProductDetail(slug) {
  const state = useCounts();
  if (state.status === "loading") return { status: "loading" };
  if (state.status !== "ready") return { status: "unavailable" };
  const entry = readProductDetail(state.payload, slug);
  return entry ? { status: "ready", entry } : { status: "unavailable" };
}

const SHIPPING_RULES = ["free", "flatFee", "freeOnTwo"];

/**
 * The shipping line's own data, brief section 4.2 and D12: free at launch,
 * with an editable switch. Read, never typed: a garbage or missing value
 * degrades to "free" (never to "flatFee", which could show a charge that is
 * not real) rather than to "unavailable", because this is informational
 * only until M3.5 builds checkout, and "no surprise charges" (CLAUDE.md
 * section 3) means the safe default here is the lower one, not the pessimistic
 * one it would be for a real total.
 */
export function readShipping(payload) {
  const shipping = payload?.shipping;
  const rule = SHIPPING_RULES.includes(shipping?.rule) ? shipping.rule : "free";
  const flatFeePaise =
    Number.isInteger(shipping?.flatFeePaise) && shipping.flatFeePaise >= 0
      ? shipping.flatFeePaise
      : 6000;
  return { rule, flatFeePaise };
}

/** `null` while the payload has not landed; the shipping line otherwise. */
export function useShipping() {
  const state = useCounts();
  if (state.status !== "ready") return null;
  return readShipping(state.payload);
}

/**
 * Whether the Buy control may show at all, brief section 6.2's shelf-life
 * stop. The safe default is false: a loading page, a failed fetch, an
 * invalid date, or any mode other than a validated in-stock entry with a
 * real `saleStopOn` all hide Buy. This is deliberately the one function
 * that decides it, so no other code can compute its own, looser check.
 */
export function canBuyToday(detail, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!detail || detail.mode !== "inStock" || !detail.saleStopOn) return false;
  return todayIso <= detail.saleStopOn;
}
