/**
 * The Firestore and Functions side of the Sell screen (brief sections 7A.1
 * and 17.3).
 *
 * **This file never writes an order, a count or a rupee.** `orders`,
 * `documents` and `counters` take no client write at all (`firestore.rules`),
 * and `paidCount`/`heldJars` are protected fields, so every sale goes through
 * the `createCounterSale` callable and every void through `voidCounterSale`.
 * What is left for the client is reading: the catalogue, the batches, the
 * customer the number belongs to, and today's sales.
 *
 * The totals the screen shows come from `@lailark/shared`'s `saleTotals` and
 * `discountRights`, which is the same code the callable plans with, so the
 * number on the screen and the number that is charged are the same number by
 * construction rather than by care.
 */
import {
  BATCH_STATES_IN_STOCK,
  BATCH_STATES_OPEN_FOR_BOOKING,
  batchAvailability,
  businessDayKey,
  type Customer,
  type DiscountCapSettings,
  type DiscountRights,
  discountRights,
  inStockAvailability,
  inSameBusinessDay,
  type Order,
  type Paise,
  type Role,
} from "@lailark/shared";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type CollectionReference,
  type Query,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "preact/hooks";

import type { BatchDoc } from "../batches/data";
import { callableMessage } from "../callableError";
import { db, functions } from "../firebase";
import type { Live } from "../products/data";

export const ORDERS_COLLECTION = "orders";
export const CUSTOMERS_COLLECTION = "customers";
export const SETTINGS_COLLECTION = "settings";
export const DISCOUNT_CAP_DOC = "discountCap";

export type OrderDoc = Partial<Order> & { readonly id: string };
export type CustomerDoc = Partial<Customer> & { readonly id: string };

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

function watch<T extends { id: string }>(
  target: Query | CollectionReference,
  set: (state: Live<T>) => void,
): Unsubscribe {
  return onSnapshot(
    target,
    (snap) =>
      set({
        items: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as T),
        loading: false,
        denied: false,
      }),
    () => set({ items: [], loading: false, denied: true }),
  );
}

/**
 * Brief 17.3: "the list of today's counter sales". Today is the **business
 * day** (`BUSINESS_DAY_START_HOUR_IST`), so a sale entered at ten past
 * midnight is still on the evening it belongs to, and the list a person voids
 * from is exactly the list of sales that are still voidable.
 *
 * Every counter order is read and filtered in the browser rather than with a
 * range query on `createdAt`, because the collection is small, the cut-off is
 * not midnight (so it moves with the clock, which a query bound would not),
 * and this needs no composite index (A82: an index the emulator does not
 * enforce is an index nothing would catch the absence of).
 */
export function useTodaysCounterSales(): Live<OrderDoc> {
  const [state, setState] = useState<Live<OrderDoc>>({ items: [], loading: true, denied: false });

  useEffect(() => {
    const q = query(
      collection(db, ORDERS_COLLECTION),
      where("channel", "==", "counter"),
      orderBy("createdAt", "desc"),
    );
    return watch<OrderDoc>(q, (live) =>
      setState({ ...live, items: live.items.filter((order) => isFromToday(order)) }),
    );
  }, []);

  return state;
}

/** True when this order was entered in the business day we are still in. */
export function isFromToday(order: OrderDoc, now: number = Date.now()): boolean {
  const created = order.createdAt;
  if (!(created instanceof Timestamp)) return false;
  return inSameBusinessDay(created.toMillis(), now);
}

/** The business day, for the heading over today's sales. */
export function todaysBusinessDay(now: number = Date.now()): string {
  return businessDayKey(now);
}

/** One customer, live, as the number is typed. Null while it is not a number. */
export function useCustomer(phoneE164: string | null): {
  readonly customer: CustomerDoc | null;
  readonly loading: boolean;
  readonly known: boolean;
} {
  const [state, setState] = useState<{ customer: CustomerDoc | null; loading: boolean; known: boolean }>({
    customer: null,
    loading: false,
    known: false,
  });

  useEffect(() => {
    if (phoneE164 === null) {
      setState({ customer: null, loading: false, known: false });
      return undefined;
    }
    setState({ customer: null, loading: true, known: false });
    return onSnapshot(
      doc(db, CUSTOMERS_COLLECTION, phoneE164),
      (snap) =>
        setState({
          customer: snap.exists() ? ({ id: snap.id, ...snap.data() } as CustomerDoc) : null,
          loading: false,
          known: snap.exists(),
        }),
      () => setState({ customer: null, loading: false, known: false }),
    );
  }, [phoneE164]);

  return state;
}

/**
 * The Kitchen's discount cap. **Decision D17:** the Owner sets it in
 * Settings, and a missing document means no kitchen discount at all.
 *
 * The screen reads it only so it can show the right cap and grey out the box.
 * The server reads it again, itself, inside the transaction, so this value
 * never decides anything: a phone that lied about it would be measured
 * against `settings/discountCap` regardless.
 */
export function useDiscountRights(role: Role): DiscountRights {
  const [cap, setCap] = useState<Paise | null>(null);

  useEffect(() => {
    return onSnapshot(
      doc(db, SETTINGS_COLLECTION, DISCOUNT_CAP_DOC),
      (snap) => {
        const data = snap.data() as Partial<DiscountCapSettings> | undefined;
        setCap(typeof data?.kitchenCap === "number" ? data.kitchenCap : null);
      },
      () => setCap(null),
    );
  }, []);

  return discountRights({ role, kitchenCap: cap });
}

/* -------------------------------------------------------------------------- */
/* Batches a jar can come from                                                */
/* -------------------------------------------------------------------------- */

export interface SellableBatch {
  readonly ref: string;
  readonly batchNo: string | null;
  readonly state: string;
  readonly productSlug: string;
  readonly packedOn: string | null;
  readonly createdAtMillis: number;
  readonly available: number;
  readonly unitPrice: Paise;
  readonly kind: "product" | "openBatch";
}

/**
 * Every batch of `productSlug` a jar could come from now, with its price and
 * how many jars are free, oldest first.
 *
 * The same arithmetic the server uses (`batchAvailability` /
 * `inStockAvailability` from `@lailark/shared`), so the count the screen
 * offers and the count the transaction checks cannot drift. The screen still
 * never decides anything: the save re-checks all of it inside the
 * transaction, which is the only check that can be trusted.
 */
export function sellableBatchesFor(
  batches: readonly BatchDoc[],
  productSlug: string,
  now: number = Date.now(),
): SellableBatch[] {
  const out: SellableBatch[] = [];
  for (const batch of batches) {
    if (batch.productSlug !== productSlug) continue;
    const state = String(batch.state ?? "");
    const held = (batch.heldJars ?? {}) as Record<string, { qty: number; expiresAt: unknown }>;

    let available = 0;
    let unitPrice = 0;
    let kind: "product" | "openBatch";

    if ((BATCH_STATES_IN_STOCK as readonly string[]).includes(state)) {
      available = inStockAvailability({
        bottledJars: batch.bottledJars ?? 0,
        paidCount: batch.paidCount ?? 0,
        heldJars: held as never,
        writtenOff: batch.writtenOff ?? 0,
        now,
      }).available;
      unitPrice = batch.priceInStock ?? 0;
      kind = "product";
    } else if ((BATCH_STATES_OPEN_FOR_BOOKING as readonly string[]).includes(state)) {
      available = batchAvailability({
        bookableJars: batch.bookableJars ?? 0,
        paidCount: batch.paidCount ?? 0,
        heldJars: held as never,
        now,
      }).available;
      unitPrice = batch.priceOpen ?? 0;
      kind = "openBatch";
    } else {
      continue;
    }

    if (available <= 0) continue;
    out.push({
      ref: batch.id,
      batchNo: batch.batchNo ?? null,
      state,
      productSlug,
      packedOn: batch.packedOn ?? null,
      createdAtMillis: batch.createdAt instanceof Timestamp ? batch.createdAt.toMillis() : 0,
      available,
      unitPrice,
      kind,
    });
  }

  // Oldest packed first, which is the batch the server would suggest
  // (brief 7A.1 step 2) and the jar nearest its best before.
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "product" ? -1 : 1;
    if (a.packedOn !== null && b.packedOn !== null && a.packedOn !== b.packedOn) {
      return a.packedOn < b.packedOn ? -1 : 1;
    }
    if (a.packedOn !== null && b.packedOn === null) return -1;
    if (a.packedOn === null && b.packedOn !== null) return 1;
    return a.createdAtMillis - b.createdAtMillis || (a.ref < b.ref ? -1 : 1);
  });
}

/* -------------------------------------------------------------------------- */
/* The two callables                                                          */
/* -------------------------------------------------------------------------- */

export interface CounterSaleResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly state: string;
  readonly total: Paise;
  readonly subtotal: Paise;
  readonly discount: Paise;
  readonly jars: number;
  readonly unitPrice: Paise;
  readonly lineDescription: string;
  readonly batchRef: string | null;
  readonly batchNo: string | null;
  readonly customerCreated: boolean;
  readonly paid: boolean;
  readonly holdExpiresAtMillis: number | null;
  /** True when this exact sale had already been saved, so nothing happened twice. */
  readonly alreadySold?: boolean;
}

/** The one door a counter sale goes through. Brief 7A.1. */
export async function callCreateCounterSale(
  data: Readonly<Record<string, unknown>>,
): Promise<CounterSaleResult> {
  const call = httpsCallable<Record<string, unknown>, CounterSaleResult>(
    functions,
    "createCounterSale",
  );
  const result = await call(data);
  return result.data;
}

export interface VoidResult {
  readonly orderId: string;
  readonly state: string;
  readonly batchRef: string | null;
  readonly jarsReturned: number;
  readonly reason: string;
}

/** Brief 7A.6: void a sale entered by mistake, same day, before the bill. */
export async function callVoidCounterSale(orderId: string, reason: string): Promise<VoidResult> {
  const call = httpsCallable<{ orderId: string; reason: string }, VoidResult>(
    functions,
    "voidCounterSale",
  );
  const result = await call({ orderId, reason });
  return result.data;
}

/**
 * A refusal from either callable reads as the plain sentence the server
 * wrote for a person ("Someone is paying for the last jar, check back in 15
 * minutes"), never as a code and never as a blank screen.
 */
/** The plain line a refusal reads as on the Sell screen. */
export function saleErrorMessage(error: unknown, fallback: string): string {
  return callableMessage(error, fallback);
}

/**
 * The near misses the server sends back with a new-number refusal, so the
 * screen can offer them as one tap instead of making somebody retype.
 */
export interface NearMiss {
  readonly phone: string;
  readonly name: string;
  readonly orders: number;
  readonly jars: number;
}

export function nearMissesFrom(error: unknown): NearMiss[] {
  if (typeof error !== "object" || error === null) return [];
  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return [];
  const list = (details as { nearMisses?: unknown }).nearMisses;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (miss): miss is NearMiss =>
      typeof miss === "object" && miss !== null && typeof (miss as NearMiss).phone === "string",
  );
}

/**
 * The machine-readable half of a refusal, which both callables put in
 * `details.reason` beside the sentence a person reads. The screen uses it
 * only to decide which button to offer next; what it *says* is always the
 * server's own line.
 */
export function refusalReason(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/** True when the refusal was the server asking about a number it has never seen. */
export function isNewCustomerRefusal(error: unknown): boolean {
  return refusalReason(error) === "new-customer";
}

/**
 * True when the batch's per-person limit is what stopped the sale. Brief
 * 7A.6 gives "override the per-person limit" to the Owner and to nobody
 * else, so this is the one refusal that has a way past it, and only for him.
 */
export function isOverLimitRefusal(error: unknown): boolean {
  return refusalReason(error) === "over-limit";
}
