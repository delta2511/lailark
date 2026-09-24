"use client";

import { useEffect, useState } from "react";
import JarMarks from "../ds/JarMarks";
import { inStockPrice, openBatchPrice } from "../../lib/money";

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
