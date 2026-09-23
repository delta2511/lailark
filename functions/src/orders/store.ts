/**
 * The Firestore side of the counter sale: reading each document the pure
 * planner works on into a plain view, minting an order reference, and turning
 * the planner's millisecond stamps back into Firestore `Timestamp`s.
 *
 * Every read here happens inside the caller's transaction and before any of
 * its writes, the same four-step shape `batches/store.ts` keeps: read, plan,
 * read what the plan names, write. The Node SDK refuses a read after a write
 * in one transaction.
 *
 * The one exception is {@link findNearMisses}, which deliberately runs
 * *outside* the transaction: it is an advisory check that refuses before
 * anything is written, and doing up to 99 document gets inside a transaction
 * would put all of them in its read set for no benefit at all.
 */

import { createHash, randomBytes } from "node:crypto";

import {
  type DocumentSnapshot,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import {
  BATCH_REF_ALPHABET,
  BATCH_STATES_IN_STOCK,
  BATCH_STATES_OPEN_FOR_BOOKING,
  batchAvailability,
  type CustomLine,
  inStockAvailability,
  nearMissNumbers,
} from "@lailark/shared";

import { BATCHES, heldJarsFrom, SETTINGS } from "../batches/store";
import type {
  BatchCandidate,
  SaleBatchView,
  SaleCustomerView,
  SaleProductView,
} from "./sale";

export const ORDERS = "orders";
export const CUSTOMERS = "customers";

/** `settings/discountCap`, decision D17. */
export const DISCOUNT_CAP_SETTINGS_ID = "discountCap";
/** `settings/holds`, brief 9.3 and 7A.1 step 5. */
export const HOLDS_SETTINGS_ID = "holds";
/** `settings/gst`, for the place of supply carried from day one. */
export const GST_SETTINGS_ID = "gst";

/** Kerala. The place of supply when nothing is being shipped anywhere. */
export const DEFAULT_HOME_STATE = "KL";

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function millisOf(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return null;
}

/* -------------------------------------------------------------------------- */
/* The order's own name                                                       */
/* -------------------------------------------------------------------------- */

/** `o-` and six characters, the same alphabet a batch reference uses (D21c). */
export const ORDER_REF_PREFIX = "o-";
export const ORDER_REF_LENGTH = 6;

const ORDER_REF = new RegExp(`^${ORDER_REF_PREFIX}[${BATCH_REF_ALPHABET}]{${ORDER_REF_LENGTH}}$`);

export function isOrderRef(text: unknown): text is string {
  return typeof text === "string" && ORDER_REF.test(text);
}

/**
 * A fresh order reference.
 *
 * ASSUMED (M2.8): an order is named the way a batch is before bottling
 * (D21c): a short, fixed, unguessable reference that is the document id and
 * never changes, rather than a number out of a counter. A counter would put
 * every sale in the system into contention on one document for a number
 * nothing depends on, and an abandoned or failed sale would leave a hole in
 * it. The number that has to be sequential and unbroken is the **bill**
 * number, which is a different series, issued from `counters` into
 * `documents` in M2.9, and which is the one a customer and the CA ever read.
 *
 * Crockford's base32 without i, l, o and u, so `o-7f3a2c` can be read off a
 * screen and said down a phone without being heard as something else.
 */
export function newOrderRef(): string {
  const bytes = randomBytes(ORDER_REF_LENGTH);
  let out = ORDER_REF_PREFIX;
  for (let i = 0; i < ORDER_REF_LENGTH; i += 1) {
    out += BATCH_REF_ALPHABET[bytes[i] % BATCH_REF_ALPHABET.length];
  }
  return out;
}

/**
 * The reference a sale started on this device would take, derived from the
 * `clientRef` the screen minted once when the person began that sale.
 *
 * Deriving it rather than querying for it means a repeat of the same sale is
 * an exact document read inside the transaction: no query, no index, and the
 * same trick the approvals use to survive an at-least-once trigger (A63).
 */
export function orderRefForClientRef(clientRef: string): string {
  const digest = createHash("sha256").update(clientRef).digest();
  let out = ORDER_REF_PREFIX;
  for (let i = 0; i < ORDER_REF_LENGTH; i += 1) {
    out += BATCH_REF_ALPHABET[digest[i] % BATCH_REF_ALPHABET.length];
  }
  return out;
}

/** An order already written by this same sale attempt, or null. */
export interface AlreadySold {
  readonly ref: string;
  readonly clientRef: string;
}

/**
 * Mints a reference and proves it is free, inside the transaction's reads.
 *
 * With a `clientRef`, the reference is derived from it and the existing
 * order, if any, is handed back instead. This is what stops one sale becoming
 * two: a tap that arrives twice, a response lost on a slow connection where
 * the transaction had already committed, or M2.10's offline draft being
 * finalised more than once. Without it the only thing between the counter and
 * a double charge is a disabled button.
 *
 * A derived reference that is already taken by a *different* sale is a hash
 * collision, not a repeat, so that falls back to a minted one.
 */
export async function freeOrderRef(
  tx: Transaction,
  db: Firestore,
  clientRef: string | null = null,
): Promise<{ readonly ref: string; readonly already: AlreadySold | null }> {
  if (clientRef !== null && clientRef !== "") {
    const derived = orderRefForClientRef(clientRef);
    const snap = await tx.get(db.collection(ORDERS).doc(derived));
    if (!snap.exists) return { ref: derived, already: null };
    if (snap.get("clientRef") === clientRef) {
      return { ref: derived, already: { ref: derived, clientRef } };
    }
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ref = newOrderRef();
    const taken = await tx.get(db.collection(ORDERS).doc(ref));
    if (!taken.exists) return { ref, already: null };
  }
  throw new Error("could not mint a free order reference in five tries");
}

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

export function saleBatchViewFrom(snap: DocumentSnapshot): SaleBatchView {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  return {
    ref: snap.id,
    batchNo: typeof d.batchNo === "string" && d.batchNo !== "" ? d.batchNo : null,
    state: typeof d.state === "string" ? d.state : "",
    productSlug: typeof d.productSlug === "string" ? d.productSlug : "",
    priceOpen: numberOr(d.priceOpen, 0),
    priceInStock: numberOr(d.priceInStock, 0),
  };
}

export function saleProductViewFrom(snap: DocumentSnapshot): SaleProductView {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(d.customLines) ? d.customLines : [];
  const customLines: CustomLine[] = [];
  for (const line of raw as Array<Record<string, unknown>>) {
    if (typeof line?.description === "string" && Number.isSafeInteger(line?.amountPaise)) {
      customLines.push({ description: line.description, amountPaise: line.amountPaise as number });
    }
  }
  return {
    slug: snap.id,
    name: typeof d.name === "string" && d.name !== "" ? d.name : snap.id,
    hsn: typeof d.hsn === "string" && d.hsn !== "" ? d.hsn : null,
    priceInStock: numberOr(d.priceInStock, 0),
    priceOpen: numberOr(d.priceOpen, 0),
    customLines,
  };
}

export function saleCustomerViewFrom(snap: DocumentSnapshot): SaleCustomerView {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const stats = (d.stats ?? {}) as Record<string, unknown>;
  const consents = (d.consents ?? {}) as Record<string, unknown>;
  const updates = (consents.updates ?? {}) as Record<string, unknown>;
  const marketing = (consents.marketing ?? {}) as Record<string, unknown>;
  return {
    phone: snap.id,
    name: typeof d.name === "string" ? d.name : "",
    email: typeof d.email === "string" && d.email !== "" ? d.email : null,
    orders: numberOr(stats.orders, 0),
    jars: numberOr(stats.jars, 0),
    consentUpdates: updates.given === true,
    consentMarketing: marketing.given === true,
  };
}

/* -------------------------------------------------------------------------- */
/* Choosing the batch, brief 7A.1 step 2                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every batch of one product, with how many jars a sale could still take from
 * each, so `chooseInStockBatch` never suggests a batch the save would refuse.
 *
 * Queried by `productSlug` alone and filtered in memory rather than with a
 * second `where` on the state, so this needs no composite index: a home
 * kitchen has a handful of batches per product, and an index that only the
 * deployed project enforces is an index the emulator would never have caught
 * the absence of (A82).
 */
export async function candidateBatchesFor(
  tx: Transaction,
  db: Firestore,
  productSlug: string,
  nowMillis: number,
): Promise<BatchCandidate[]> {
  if (productSlug === "") return [];
  const found = await tx.get(db.collection(BATCHES).where("productSlug", "==", productSlug));
  return found.docs.map((doc) => {
    const state = String(doc.get("state") ?? "");
    const heldJars = heldJarsFrom(doc);
    let available = 0;
    if ((BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(state)) {
      available = batchAvailability({
        bookableJars: numberOr(doc.get("bookableJars"), 0),
        paidCount: numberOr(doc.get("paidCount"), 0),
        heldJars,
        now: nowMillis,
      }).available;
    } else if ((BATCH_STATES_IN_STOCK as readonly string[]).includes(state)) {
      available = inStockAvailability({
        bottledJars: numberOr(doc.get("bottledJars"), 0),
        paidCount: numberOr(doc.get("paidCount"), 0),
        heldJars,
        writtenOff: numberOr(doc.get("writtenOff"), 0),
        now: nowMillis,
      }).available;
    }
    return {
      ref: doc.id,
      batchNo: typeof doc.get("batchNo") === "string" ? (doc.get("batchNo") as string) : null,
      state,
      packedOn: typeof doc.get("packedOn") === "string" ? (doc.get("packedOn") as string) : null,
      createdAtMillis: millisOf(doc.get("createdAt")) ?? 0,
      available,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The Kitchen's discount cap, in paise. **Decision D17:** it is set by the
 * Owner in Settings, never in code, and it ships empty, so a missing document
 * or a missing field means no kitchen discount at all.
 *
 * Read here, on the server, inside the transaction. It is never carried by
 * the request: a Kitchen phone posting straight to the callable, with no
 * screen in the way, is measured against exactly this number.
 */
export async function kitchenDiscountCap(tx: Transaction, db: Firestore): Promise<number | null> {
  const snap = await tx.get(db.collection(SETTINGS).doc(DISCOUNT_CAP_SETTINGS_ID));
  const cap = snap.get("kitchenCap");
  return typeof cap === "number" && Number.isSafeInteger(cap) && cap > 0 ? cap : null;
}

/** `settings/holds.paymentLinkHoldMinutes` (7A.1 step 5: 24 hours by default). */
export async function paymentLinkHoldMinutes(
  tx: Transaction,
  db: Firestore,
  fallback: number,
): Promise<number> {
  const snap = await tx.get(db.collection(SETTINGS).doc(HOLDS_SETTINGS_ID));
  const minutes = snap.get("paymentLinkHoldMinutes");
  return typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0 ? minutes : fallback;
}

/** `settings/gst.homeState`: where a sale handed over at the door happens. */
export async function homeState(tx: Transaction, db: Firestore): Promise<string> {
  const snap = await tx.get(db.collection(SETTINGS).doc(GST_SETTINGS_ID));
  const state = snap.get("homeState");
  return typeof state === "string" && state.trim() !== "" ? state.trim() : DEFAULT_HOME_STATE;
}

/* -------------------------------------------------------------------------- */
/* Near misses, brief 7A.1 step 1                                             */
/* -------------------------------------------------------------------------- */

export interface NearMiss {
  readonly phone: string;
  readonly name: string;
  readonly orders: number;
  readonly jars: number;
}

/**
 * Customers whose number is one typing slip from `phone`.
 *
 * **Why this is here at all.** `createCounterSale` creates
 * `customers/{phone}` when the number is new, so a wrong digit at the door
 * does not fail: it invents a stranger with no history, whose bill goes to
 * somebody else's WhatsApp, and the real customer's record never sees the
 * jar. Nothing downstream notices, because a new customer is a perfectly
 * normal thing for this call to make.
 *
 * So when the number is new, the sale stops once and asks. The candidates are
 * exact document ids from {@link nearMissNumbers} (at most 99), fetched with
 * one `getAll`, so this is a batched read by id: never a scan, never an index,
 * and never a guess. Nothing here changes a number by itself; the person at
 * the counter either taps the right customer or says it really is new.
 */
export async function findNearMisses(db: Firestore, phone: string): Promise<NearMiss[]> {
  const candidates = nearMissNumbers(phone);
  if (candidates.length === 0) return [];
  const refs = candidates.map((candidate) => db.collection(CUSTOMERS).doc(candidate));
  const snaps = await db.getAll(...refs);
  return snaps
    .filter((snap) => snap.exists)
    .map((snap) => {
      const view = saleCustomerViewFrom(snap);
      return { phone: view.phone, name: view.name, orders: view.orders, jars: view.jars };
    });
}

/* -------------------------------------------------------------------------- */
/* Stamps                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The planner has no Firebase in it, so it writes instants as plain epoch
 * milliseconds under a `...Millis` key. This puts them back as Firestore
 * `Timestamp`s before the write, and it runs **before** the audit entry is
 * built, so `before` and `after` on the trail are two timestamps rather than
 * a timestamp and a number.
 */
export function withCustomerTimestamps(
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };

  const consents = out.consents as Record<string, unknown> | undefined;
  if (consents) {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(consents)) {
      const consent = value as { given?: unknown; atMillis?: unknown; by?: unknown };
      next[key] = {
        given: consent.given === true,
        at: typeof consent.atMillis === "number" ? Timestamp.fromMillis(consent.atMillis) : null,
        by: (consent.by as string | null) ?? null,
      };
    }
    out.consents = next;
  }

  const stats = out.stats as Record<string, unknown> | undefined;
  if (stats) {
    const { lastOrderAtMillis, ...rest } = stats;
    // A patch that says nothing about when they last ordered leaves it where
    // it is. Writing null would erase the date of an order that still stands:
    // a void takes back one sale, not the customer's whole history, and
    // "last bought in November" (brief 7A.1 step 1) is what the seller reads
    // before greeting them.
    out.stats =
      typeof lastOrderAtMillis === "number"
        ? { ...rest, lastOrderAt: Timestamp.fromMillis(lastOrderAtMillis) }
        : { ...rest };
  }

  return out;
}
