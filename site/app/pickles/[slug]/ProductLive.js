"use client";

import JarMarks from "../../ds/JarMarks";
import { canBuyToday, useProductDetail, useShipping } from "../../_lib/counts";
import { formatINR, inStockPrice, openBatchPrice } from "../../../lib/money";

// M3.3: the product page's live section. Reuses the home page's own
// unavailable/none copy (M3.2, ASSUMED A153/M3.2) so the site never says
// the same thing two different ways.
const UNAVAILABLE = "We cannot show the count just now.";
// The two date fields' own fallbacks. Both are printed on the jar, so when
// the batch cannot be read the page says where to look rather than borrowing
// the count's sentence. ASSUMED (M3.3): both strings.
const PRINTED_ON_THE_JAR = "Printed on the jar.";
const BEST_BEFORE_RULE = "Six months from packing, printed on the jar.";

/** "2026-09-04" as "4 Sep 2026". Null for anything that is not a date. */
function formatLabelDate(iso) {
  if (typeof iso !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  const month = MONTHS[Number(m) - 1];
  if (!month) return null;
  return `${Number(d)} ${month} ${y}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const NOT_IN_KITCHEN = "Not in the kitchen just now.";

// ASSUMED (M3.3): every string below this line. None of it is drafted in
// the docs; it is kept to the minimum the two cards and the Buy control
// need, in the voice the rest of the site already uses.
const BUY_LABEL = "Buy";
const SALE_STOPPED =
  "This batch is no longer sold online. It is still sold at the counter, up to its best before.";
const LOADING_HEIGHT = { minHeight: "3.2rem" };

// Brief §7.4, "the promise on the batch page, before paying". The brief's
// own draft says "we buy the prawns", which is only true of one of the four
// heroes; reused here as the home page (M3.2) already adapted it, word for
// word: "we buy what the batch needs" in place of the product-specific
// ingredient, so the same promise is not wrong on the squid, beef or koorka
// page. Not a fresh paraphrase of the brief: this exact sentence already
// exists, reviewed, in `site/app/page.js`.
const OPEN_BATCH_PROMISE =
  "This batch has not been cooked yet. When you pay, your jar is kept for you. Once half the batch is paid for we buy what the batch needs and start cooking, and we will send you photos from the kitchen as it happens. We do not put a date on it, because the sea does not keep one.";

function priceFor(entry) {
  if (entry.mode === "inStock") {
    return entry.priceInStockPaise != null ? formatINR(entry.priceInStockPaise) : inStockPrice();
  }
  return entry.priceOpenPaise != null ? formatINR(entry.priceOpenPaise) : openBatchPrice();
}

/**
 * The count, the price and the Buy control. The one place that decides
 * whether Buy may render at all: `canBuyToday` (site/app/_lib/counts.js)
 * is the single function everything here defers to, and its default is
 * always "no", so a loading page, a failed fetch or a batch past its sale
 * stop (brief 6.2) all render the same way a customer sees it: no button.
 */
export function ProductBuyBlock({ slug }) {
  const state = useProductDetail(slug);

  if (state.status !== "ready") {
    return (
      <div className="product-live" style={LOADING_HEIGHT} aria-live="polite">
        {state.status === "unavailable" ? <p className="product-live__note">{UNAVAILABLE}</p> : null}
      </div>
    );
  }

  const { entry } = state;
  if (entry.mode === "none") {
    return (
      <div className="product-live" aria-live="polite">
        <p className="product-live__note">{NOT_IN_KITCHEN}</p>
      </div>
    );
  }

  const inStock = entry.mode === "inStock";
  const buy = canBuyToday(entry);

  return (
    <div className="product-live" aria-live="polite">
      <JarMarks count={entry.count} total={entry.total} reading={inStock ? "left" : "paid"} />
      <p className="product-live__reading">
        {inStock ? "jars left in this batch" : "jars paid into this batch"}{" "}
        <span className="product-live__price">{priceFor(entry)}</span>
      </p>
      {inStock && !buy ? (
        <p className="product-live__note">{SALE_STOPPED}</p>
      ) : (
        <button type="button" className="product-buy">
          {inStock ? BUY_LABEL : `Pay ${priceFor(entry)} to book a jar`}
        </button>
      )}
      {!inStock ? <p className="product-live__promise">{OPEN_BATCH_PROMISE}</p> : null}
    </div>
  );
}

/**
 * The two Legal Metrology fields that only a live batch can answer (brief
 * 20.3): date of packing and best before. Everything else the section needs
 * is a build-time constant, rendered by the page itself.
 */
export function ProductLegalDates({ slug }) {
  const state = useProductDetail(slug);

  // A date is not a count, so neither of these may ever fall back to the
  // count's own sentence. Both facts are printed on the jar itself, which is
  // the honest answer whenever the batch behind them cannot be read: the
  // customer is told where to find the number, not told a count is missing.
  if (state.status !== "ready" || state.entry.mode === "none") {
    return (
      <>
        <div className="product-legal__row">
          <dt>Date of packing</dt>
          <dd>{PRINTED_ON_THE_JAR}</dd>
        </div>
        <div className="product-legal__row">
          <dt>Best before</dt>
          <dd>{BEST_BEFORE_RULE}</dd>
        </div>
      </>
    );
  }

  const { entry } = state;
  if (entry.mode === "open") {
    // Brief 20.3, quoted as drafted (ASSUMED, confirm wording note in the
    // brief itself): an open batch has not been packed yet.
    return (
      <div className="product-legal__row">
        <dt>Packed on</dt>
        <dd>Printed on the jar when bottled. Best before six months from packing.</dd>
      </div>
    );
  }

  return (
    <>
      <div className="product-legal__row">
        <dt>Date of packing</dt>
        <dd>{formatLabelDate(entry.packedOn) ?? PRINTED_ON_THE_JAR}</dd>
      </div>
      <div className="product-legal__row">
        <dt>Best before</dt>
        <dd>{formatLabelDate(entry.bestBefore) ?? BEST_BEFORE_RULE}</dd>
      </div>
    </>
  );
}

/**
 * The shipping line, brief section 20.4: the total price, shipping
 * included, has to be visible before payment. There is no checkout yet
 * (M3.5), so this is the informational line the card carries in the
 * meantime; it never renders a charge it cannot back with a settings read.
 */
export function ProductShippingLine() {
  const shipping = useShipping();
  if (!shipping) return null;
  if (shipping.rule === "free") {
    return <p className="product-shipping">Shipping is free.</p>;
  }
  return <p className="product-shipping">Shipping {formatINR(shipping.flatFeePaise)}.</p>;
}
