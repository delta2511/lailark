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
 *         "mode": "inStock" | "open" | "none",
 *         "count": <int>,               // jars left (inStock) or paid (open)
 *         "total": <int>,               // bottled jars (inStock) or bookable jars (open)
 *         "priceInStockPaise": <int>,   // this batch's own price (D40), inStock only
 *         "priceOpenPaise": <int>,      // this batch's own price (D40), open only
 *         "packedOn": "YYYY-MM-DD"|null,   // inStock only
 *         "bestBefore": "YYYY-MM-DD"|null, // inStock only
 *         "saleStopOn": "YYYY-MM-DD"|null  // inStock only: the Buy cut-off, brief §6.2
 *       }
 *     },
 *     "shipping": {
 *       "rule": "free" | "flatFee" | "freeOnTwo",
 *       "flatFeePaise": <int>   // D12: 60 rupees, editable, only meaningful off "free"
 *     }
 *   }
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
  inStockAvailability,
  type HeldJars,
} from "@lailark/shared";

export type CountsMode = "inStock" | "open" | "none";

export interface CountsProductEntry {
  readonly mode: CountsMode;
  readonly count?: number;
  readonly total?: number;
  readonly priceInStockPaise?: number;
  readonly priceOpenPaise?: number;
  readonly packedOn?: string | null;
  readonly bestBefore?: string | null;
  readonly saleStopOn?: string | null;
}

export interface CountsShipping {
  readonly rule: "free" | "flatFee" | "freeOnTwo";
  readonly flatFeePaise: number;
}

export interface CountsPayload {
  readonly products: Readonly<Record<string, CountsProductEntry>>;
  readonly shipping: CountsShipping;
}

/** D12: the flat fee if the switch is ever used, editable via settings. */
const DEFAULT_FLAT_FEE_PAISE = 6_000;
const SHIPPING_RULES = ["free", "flatFee", "freeOnTwo"] as const;

async function readShipping(db: Firestore): Promise<CountsShipping> {
  const snap = await db.collection("settings").doc("shipping").get();
  const rawRule = snap.get("rule");
  const rule = (SHIPPING_RULES as readonly string[]).includes(String(rawRule))
    ? (rawRule as CountsShipping["rule"])
    : "free";
  return { rule, flatFeePaise: numberOr(snap.get("flatFee"), DEFAULT_FLAT_FEE_PAISE) };
}

const IN_STOCK_STATES: readonly string[] = BATCH_STATES_IN_STOCK;
const OPEN_STATES: readonly string[] = BATCH_STATES_OPEN_FOR_BOOKING;

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isoDateOr(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

interface Best {
  readonly data: DocumentData;
  /** 0 = in stock, ranks ahead of 1 = open for booking. */
  readonly tier: 0 | 1;
  readonly available: number;
}

function availabilityFor(data: DocumentData, tier: 0 | 1, nowMillis: number): number {
  const heldJars = data.heldJars as HeldJars | undefined;
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

function entryFor(best: Best): CountsProductEntry {
  const { data, tier } = best;
  if (tier === 0) {
    return {
      mode: "inStock",
      count: best.available,
      // "Jars in the batch" (A153): what this batch actually bottled, not
      // a moving ceiling, so the marks total never shrinks as jars sell.
      total: Math.max(1, numberOr(data.bottledJars, 1)),
      priceInStockPaise: numberOr(data.priceInStock, 0),
      packedOn: isoDateOr(data.packedOn),
      bestBefore: isoDateOr(data.bestBefore),
      saleStopOn: isoDateOr(data.saleStopOn),
    };
  }
  return {
    mode: "open",
    count: numberOr(data.paidCount, 0),
    // D3: bookable jars is the number the card shows.
    total: Math.max(1, numberOr(data.bookableJars, 1)),
    priceOpenPaise: numberOr(data.priceOpen, 0),
  };
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

  const visibleStates = [...IN_STOCK_STATES, ...OPEN_STATES];
  const batchesSnap = await db.collection("batches").where("state", "in", visibleStates).get();

  const bestBySlug = new Map<string, Best>();
  for (const doc of batchesSnap.docs) {
    const data = doc.data();
    const slug = data.productSlug;
    if (typeof slug !== "string" || slug === "") continue;

    const tier: 0 | 1 = IN_STOCK_STATES.includes(String(data.state)) ? 0 : 1;
    const available = availabilityFor(data, tier, nowMillis);
    const existing = bestBySlug.get(slug);
    if (!existing || tier < existing.tier || (tier === existing.tier && available > existing.available)) {
      bestBySlug.set(slug, { data, tier, available });
    }
  }

  const products: Record<string, CountsProductEntry> = {};
  for (const productDoc of productsSnap.docs) {
    const slug = productDoc.id;
    const best = bestBySlug.get(slug);
    products[slug] = best ? entryFor(best) : { mode: "none" };
  }

  return { products, shipping };
}
