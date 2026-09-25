/**
 * `/api/counts`: the one function behind live jar counts (brief §19.2).
 *
 * Public, unauthenticated, read-only. It never writes: counts change only
 * inside the Firestore transactions in `batches/`, in a hold or a sale
 * (CLAUDE.md §3). This module only reads what has already been written and
 * shapes it into the smallest payload a jar card needs.
 *
 * One read of `products` (the active catalogue) and one read of `batches`
 * (every batch in a state a customer may see), rather than one read per
 * product: the brief calls this endpoint a cost surface, so it is built to
 * scale with the number of live batches, not the number of callers.
 *
 * The response shape is owned jointly with `site/app/_lib/counts.js` (M3.2's
 * seam, extended here for the product pages):
 *
 *   GET /api/counts
 *   {
 *     "products": {
 *       "<slug>": {
 *         "mode": "inStock" | "open" | "cooking" | "none",
 *         "count": <int>,               // jars left (inStock) or paid (open)
 *         "total": <int>,               // bottled jars (inStock) or bookable jars (open)
 *         "priceInStockPaise": <int>,   // this batch's own price (D40), inStock only
 *         "priceOpenPaise": <int>,      // this batch's own price (D40), open only
 *         "packedOn": "YYYY-MM-DD"|null,   // inStock only
 *         "bestBefore": "YYYY-MM-DD"|null, // inStock only
 *         "saleStopOn": "YYYY-MM-DD"|null, // inStock only: the Buy cut-off, brief §6.2
 *         "perPersonLimit": <int>,      // most jars one person may take (M3.5)
 *         "available": <int>,           // jars actually takeable right now (M3.5)
 *         "shippingRule": "free"|"flatFee"|"freeOnTwo"|null // the product's own (M3.5)
 *       }
 *     },
 *     "shipping": {
 *       "rule": "free" | "flatFee" | "freeOnTwo",
 *       "flatFeePaise": <int>,  // D12: 60 rupees, editable, only meaningful off "free"
 *       "freeFromJars": <int>   // brief 4.2: where "freeOnTwo" stops charging
 *     }
 *   }
 *
 * `"cooking"` (M3.8) carries `count`, `total`, `available: 0` and nothing
 * else: brief §7.5 closes booking when the pot goes on, so the card says
 * "Being cooked now. Unpaid jars go on sale when bottled" and offers no Buy
 * control and no jar picker.
 *
 * A slug with no batch in a visible state still appears, as `{"mode":"none"}`,
 * so a customer sees "not in the kitchen" rather than an unavailable count:
 * `site/app/_lib/counts.js` treats a slug missing from the payload entirely
 * as a fetch failure, not as "nothing on right now".
 *
 * `shipping` is one more cheap read, `settings/shipping` (the pattern
 * `functions/src/money/store.ts` already uses for `settings/seller` etc.):
 * a missing document means the switch has never been touched, so the
 * fallback is "free", which is what brief 4.2/D12 says shipping actually is
 * at launch.
 */
import type { Firestore, DocumentData } from "firebase-admin/firestore";
import {
  BATCH_STATES_IN_STOCK,
  BATCH_STATES_OPEN_FOR_BOOKING,
  batchAvailability,
  IN_STOCK_PER_PERSON_LIMIT,
  inStockAvailability,
  type HeldJars,
  normaliseShippingSwitch,
  resolvePerPersonLimit,
  type ShippingRule,
} from "@lailark/shared";

import { chooseWebBatch, type CheckoutBatchCandidate } from "../orders/checkout";

/**
 * What a customer may do with this product right now.
 *
 *  - `inStock`: bottled jars, ₹649, buyable today.
 *  - `open`: a batch open for booking at ₹599.
 *  - `cooking`: brief §7.5. Booking closed when the pot went on, and the
 *    jars that were not booked go on sale when the batch is bottled. The
 *    card says so and offers no Buy control (M3.8).
 *  - `none`: nothing of this product is in the kitchen.
 */
export type CountsMode = "inStock" | "open" | "cooking" | "none";

export interface CountsProductEntry {
  readonly mode: CountsMode;
  readonly count?: number;
  readonly total?: number;
  readonly priceInStockPaise?: number;
  readonly priceOpenPaise?: number;
  readonly packedOn?: string | null;
  readonly bestBefore?: string | null;
  readonly saleStopOn?: string | null;
  /**
   * The most jars one person may take from this batch, so the checkout's
   * jar picker offers exactly what the server will allow (M3.5).
   *
   * **D52:** the number the Owner typed on the batch governs the web in
   * both directions, above two as well as below it. Only a blank box falls
   * back, and the fallback is brief 4.1's two jars in stock and the
   * computed quarter on an open batch. This and `readStockClaim` both go
   * through `resolvePerPersonLimit`, so the picker and the transaction
   * cannot disagree about the same batch.
   */
  readonly perPersonLimit?: number;
  /**
   * Jars a customer may actually take right now: capacity less paid less
   * every live hold. On an in-stock batch this is the same number as
   * `count`; on an open batch `count` is the **paid** marks (D3), so the
   * free figure has to be carried on its own or the checkout's jar picker
   * offers jars somebody else is already paying for (M3.5).
   */
  readonly available?: number;
  /**
   * `products/{slug}.shippingRule`, the product's own fee rule, or null
   * when it carries none.
   *
   * It is published because `createCheckout` enforces it
   * (`effectiveShippingSwitch(global, product.shippingRule)`) and refuses
   * any order whose total differs from the figure the page printed. A page
   * that could not see this field computed the global rule for every
   * product, so the moment the global switch left "free" a product with a
   * rule of its own was refused at the Pay button. Brief §4.2 and
   * CLAUDE.md §3: the fee is never first revealed at payment.
   */
  readonly shippingRule?: ShippingRule | null;
}

export interface CountsShipping {
  readonly rule: "free" | "flatFee" | "freeOnTwo";
  readonly flatFeePaise: number;
  /**
   * The jar count at which `freeOnTwo` stops charging. Brief 4.2 says two,
   * and it is a setting, so the checkout page (M3.5) reads it rather than
   * assuming it: a page that computed a different total from the server's
   * would be the surprise charge 4.2 forbids.
   */
  readonly freeFromJars: number;
}

export interface CountsPayload {
  readonly products: Readonly<Record<string, CountsProductEntry>>;
  readonly shipping: CountsShipping;
}

const SHIPPING_RULES = ["free", "flatFee", "freeOnTwo"] as const;

/**
 * The shipping switch, through the **same** clamp the server's own reader
 * uses (`normaliseShippingSwitch`, and `orders/store.ts` calls it too).
 *
 * It was clamped here alone once, and that was worse than not clamping at
 * all: a `freeFromJars` of 3.5 in Settings came down to the page as 3 and
 * stayed 3.5 on the server, where `shippingFeeFor` quietly read it as 2, so
 * the page's total and the charge parted company and every two-jar order was
 * refused. One clamp, in `@lailark/shared`, read by both.
 */
async function readShipping(db: Firestore): Promise<CountsShipping> {
  const snap = await db.collection("settings").doc("shipping").get();
  const ship = normaliseShippingSwitch({
    rule: snap.get("rule"),
    flatFee: snap.get("flatFee"),
    freeFromJars: snap.get("freeFromJars"),
  });
  // `flatFeePaise` on the wire, `flatFee` in the document: everything this
  // endpoint sends is named in paise.
  return { rule: ship.rule, flatFeePaise: ship.flatFee, freeFromJars: ship.freeFromJars };
}

const IN_STOCK_STATES: readonly string[] = BATCH_STATES_IN_STOCK;
const OPEN_STATES: readonly string[] = BATCH_STATES_OPEN_FOR_BOOKING;
/** Brief §7.5: booking closes when cooking starts, and the card says so. */
const COOKING_STATE = "cooking";

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * `perPersonLimitOverride` as written, untouched. Anything that is not a
 * whole number of jars is handed on as-is and refused by
 * `isPerPersonLimitOverride` inside `resolvePerPersonLimit`, so a `0`, a
 * `-5`, a `1.5` or a `"lots"` all fall through to the fallback rather than
 * becoming a cap nobody meant.
 */
function overrideOf(data: DocumentData): number | null {
  return typeof data.perPersonLimitOverride === "number" ? data.perPersonLimitOverride : null;
}

function isoDateOr(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

interface Best {
  readonly data: DocumentData;
  /**
   * 0 = in stock, ranks ahead of 1 = open for booking, which ranks ahead of
   * 2 = cooking. A batch on the stove is the last thing to show, because it
   * cannot be bought: it is only shown when this product has nothing else.
   */
  readonly tier: 0 | 1 | 2;
  readonly available: number;
  readonly candidate: CheckoutBatchCandidate;
}

function availabilityFor(data: DocumentData, tier: 0 | 1 | 2, nowMillis: number): number {
  const heldJars = data.heldJars as HeldJars | undefined;
  // Nothing is takeable on a batch that is cooking: booking closed when the
  // pot went on (brief §7.5), and the site must never offer a jar the
  // transaction is about to refuse.
  if (tier === 2) return 0;
  if (tier === 0) {
    return inStockAvailability({
      bottledJars: numberOr(data.bottledJars, 0),
      paidCount: numberOr(data.paidCount, 0),
      heldJars,
      writtenOff: numberOr(data.writtenOff, 0),
      now: nowMillis,
    }).available;
  }
  return batchAvailability({
    bookableJars: numberOr(data.bookableJars, 0),
    paidCount: numberOr(data.paidCount, 0),
    heldJars,
    now: nowMillis,
  }).available;
}

/** A Firestore `Timestamp`, a plain millis number, or nothing at all. */
function millisOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const stamp = value as { toMillis?: () => number } | null | undefined;
  if (stamp && typeof stamp.toMillis === "function") return stamp.toMillis();
  return fallback;
}

/** The product's own fee rule, or null for a product that carries none. */
function shippingRuleOf(data: DocumentData): ShippingRule | null {
  const rule = data.shippingRule;
  return (SHIPPING_RULES as readonly string[]).includes(String(rule))
    ? (rule as ShippingRule)
    : null;
}

function entryFor(best: Best, product: DocumentData): CountsProductEntry {
  const { data, tier } = best;
  const shippingRule = shippingRuleOf(product);
  if (tier === 2) {
    // Brief §7.5. The marks are still drawn, because the count is true and
    // "every count on the site is computed" (CLAUDE.md §3): these are the
    // jars people booked before booking closed. `available` is zero, and
    // `perPersonLimit` is deliberately absent, so nothing downstream can
    // build a jar picker out of this entry.
    return {
      mode: "cooking",
      count: numberOr(data.paidCount, 0),
      total: Math.max(1, numberOr(data.bookableJars, 1)),
      available: 0,
      shippingRule,
    };
  }
  if (tier === 0) {
    return {
      mode: "inStock",
      count: best.available,
      // "Jars in the batch" (A153): what this batch actually bottled, not
      // a moving ceiling, so the marks total never shrinks as jars sell.
      total: Math.max(1, numberOr(data.bottledJars, 1)),
      available: best.available,
      priceInStockPaise: numberOr(data.priceInStock, 0),
      packedOn: isoDateOr(data.packedOn),
      bestBefore: isoDateOr(data.bestBefore),
      saleStopOn: isoDateOr(data.saleStopOn),
      perPersonLimit: resolvePerPersonLimit(
        {
          perPersonLimit: numberOr(data.perPersonLimit, 0),
          perPersonLimitOverride: overrideOf(data),
        },
        IN_STOCK_PER_PERSON_LIMIT,
      ),
      shippingRule,
    };
  }
  return {
    mode: "open",
    count: numberOr(data.paidCount, 0),
    // D3: bookable jars is the number the card shows.
    total: Math.max(1, numberOr(data.bookableJars, 1)),
    available: best.available,
    priceOpenPaise: numberOr(data.priceOpen, 0),
    // No floor of one. `readStockClaim` puts none here either, and a floor
    // only on this side promised a jar the transaction was about to refuse:
    // D52 says the typed number is the authority in both directions, so a
    // batch capped at nothing has to read as nothing here too.
    perPersonLimit: resolvePerPersonLimit({
      perPersonLimit: numberOr(data.perPersonLimit, 0),
      perPersonLimitOverride: overrideOf(data),
    }),
    shippingRule,
  };
}

/**
 * The batch a customer looking at this slug is being shown, and the one
 * `createCheckout` will take the hold from.
 *
 * It is `chooseWebBatch`, the checkout's own chooser, rather than a second
 * ordering written here: two orderings eventually pick two different
 * batches, and then the count on the page belongs to one batch and the jar
 * to another (its price, its best before, its per-person limit).
 *
 * `chooseWebBatch` refuses when every in-stock batch is past its
 * shelf-life stop (brief §6.2) and there is no open batch behind it. The
 * page still has to draw that batch: its count, its dates and the sentence
 * that it is no longer sold online are all read off it, and `canBuyToday`
 * is what hides the Buy control. So a refusal falls back to the same
 * in-stock-first, most-free ordering this endpoint has always used, and the
 * only batch the two can disagree about is one that cannot be bought
 * anyway.
 */
function pickBatch(list: readonly Best[], productName: string, todayIso: string): Best {
  // A cooking batch is never offered to the chooser: `createCheckout` would
  // refuse it, so putting it in front of `chooseWebBatch` could only make
  // the page and the callable disagree. It is the fallback, and only when
  // this product has nothing that can be bought at all.
  const chosen = chooseWebBatch(
    list.filter((b) => b.tier !== 2).map((b) => b.candidate),
    productName,
    todayIso,
  );
  if (chosen.ok) {
    const match = list.find((b) => b.candidate.ref === chosen.ref);
    if (match) return match;
  }
  return [...list].sort(
    (a, b) => a.tier - b.tier || b.available - a.available,
  )[0] as Best;
}

/** `"YYYY-MM-DD"` in Asia/Kolkata, the only calendar this shop has. */
function kolkataToday(nowMillis: number): string {
  return new Date(nowMillis + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Everything `/api/counts` returns, computed fresh from Firestore. Pure
 * enough to unit test against a fake `Firestore`-shaped reader, but the two
 * queries below are the real thing against the emulator (`functions/test/
 * counts.test.ts`).
 */
export async function computeCounts(db: Firestore): Promise<CountsPayload> {
  const nowMillis = Date.now();

  const [productsSnap, shipping] = await Promise.all([
    db.collection("products").where("active", "==", true).get(),
    readShipping(db),
  ]);
  if (productsSnap.empty) {
    return { products: {}, shipping };
  }

  // `cooking` joins the query in M3.8: brief §7.5 gives that batch a card of
  // its own ("Being cooked now. Unpaid jars go on sale when bottled"), so the
  // endpoint has to be able to see it. It never outranks a batch that can
  // actually be bought (`pickBatch`).
  const visibleStates = [...IN_STOCK_STATES, ...OPEN_STATES, COOKING_STATE];
  const batchesSnap = await db.collection("batches").where("state", "in", visibleStates).get();
  const todayIso = kolkataToday(nowMillis);

  const bySlug = new Map<string, Best[]>();
  for (const doc of batchesSnap.docs) {
    const data = doc.data();
    const slug = data.productSlug;
    if (typeof slug !== "string" || slug === "") continue;

    const state = String(data.state);
    const tier: 0 | 1 | 2 = IN_STOCK_STATES.includes(state)
      ? 0
      : OPEN_STATES.includes(state)
        ? 1
        : 2;
    const available = availabilityFor(data, tier, nowMillis);
    const list = bySlug.get(slug);
    const best: Best = {
      data,
      tier,
      available,
      candidate: {
        ref: doc.id,
        batchNo: typeof data.batchNo === "string" ? data.batchNo : null,
        state,
        packedOn: isoDateOr(data.packedOn),
        saleStopOn: isoDateOr(data.saleStopOn),
        createdAtMillis: millisOr(data.createdAt, 0),
        available,
      },
    };
    if (list) list.push(best);
    else bySlug.set(slug, [best]);
  }

  const products: Record<string, CountsProductEntry> = {};
  for (const productDoc of productsSnap.docs) {
    const slug = productDoc.id;
    const data = productDoc.data();
    const list = bySlug.get(slug);
    products[slug] =
      list && list.length > 0
        ? entryFor(
            pickBatch(list, typeof data.name === "string" ? data.name : slug, todayIso),
            data,
          )
        : { mode: "none" };
  }

  return { products, shipping };
}
