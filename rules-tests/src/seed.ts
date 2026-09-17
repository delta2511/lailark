/**
 * One document in every collection the rules name, written with the rules
 * switched off, so a denied *read* in a test is a denial and not a 404.
 */

import { doc, setDoc, Timestamp } from "firebase/firestore";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";

import { KITCHEN_UID, OWNER_UID, VIEWER_UID } from "./env.js";

export const CUSTOMER_PHONE = "+917736110087";
export const BATCH_NO = "001";
export const ORDER_ID = "ord-1";
export const DOCUMENT_ID = "LK-26-27-0001";
export const UPDATE_ID = "upd-1";

const now = Timestamp.fromDate(new Date("2026-09-16T00:00:00Z"));

const base = { createdAt: now, updatedAt: now, createdBy: OWNER_UID };

/** A whole batch document, every field of `Batch` in `shared`. */
export const BATCH_DOC = {
  ...base,
  productSlug: "prawns-and-dates",
  recipeId: "rec-1",
  state: "open",
  plannedJars: 22,
  bookableJars: 19,
  perPersonLimit: 4,
  priceOpen: 59900,
  priceInStock: 64900,
  paidCount: 3,
  heldJars: {},
  bottledJars: 0,
  writtenOff: 0,
  source: null,
  landedOn: null,
  cookedOn: null,
  packedOn: null,
  bestBefore: null,
  saleStopOn: null,
  weightRaw: null,
  weightCleaned: null,
  weightCooked: null,
  halfReachedAt: null,
  halfApprovedAt: null,
  fullReachedAt: null,
  fullApprovedAt: null,
  pausedReason: null,
  costs: { jarsLids: 0, boxInserts: 0, labelling: 0, gasPower: 0 },
  pnl: {
    revenue: 0,
    ingredientCost: 0,
    packagingCost: 0,
    shippingCost: 0,
    gatewayFees: 0,
    writeOffCost: 0,
    margin: 0,
  },
};

export async function seedFirestore(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    const put = (path: string, data: object) => setDoc(doc(db, path), data);

    await Promise.all([
      // public
      put("config/site", { notifyCtaVisible: true }),
      put("config/other", { secret: "not public" }),
      put("notify/n1", { contact: "+917736110087", source: "index", createdAt: now }),

      // money, server only
      put(`documents/${DOCUMENT_ID}`, { ...base, kind: "bill", orderId: ORDER_ID }),
      put("counters/bill-26-27", { next: 2 }),
      put("refunds/ref-1", { ...base, orderId: ORDER_ID, amount: 59900 }),
      put("settlements/setl-1", { ...base, amount: 59900, utr: "x" }),
      put("webhookEvents/razorpay-evt-1", { ...base, source: "razorpay" }),
      put("dayCloses/2026-09-16", { ...base, cashCounted: 0 }),

      // orders
      put(`orders/${ORDER_ID}`, {
        ...base,
        number: "LK/26-27/0001",
        channel: "counter",
        state: "held",
        total: 59900,
        payment: { method: "cash", status: "created" },
      }),
      put(`orders/${ORDER_ID}/events/e1`, { ...base, kind: "created" }),

      // kitchen
      put(`batches/${BATCH_NO}`, BATCH_DOC),
      put(`batches/${BATCH_NO}/lines/l1`, { ...base, ingredientId: "i1", qtyActual: 1 }),
      put(`batches/${BATCH_NO}/updates/${UPDATE_ID}`, {
        ...base,
        createdBy: KITCHEN_UID,
        photoPath: null,
        kitchenLine: "Prawns are in.",
        messageText: "",
        approvedBy: null,
        sentAt: null,
      }),
      put(`batches/${BATCH_NO}/updates/approved-1`, {
        ...base,
        createdBy: KITCHEN_UID,
        photoPath: null,
        kitchenLine: "Bottled.",
        messageText: "",
        approvedBy: OWNER_UID,
        sentAt: now,
      }),
      put(`batches/${BATCH_NO}/writeOffs/w1`, { ...base, qty: 1, reason: "cracked", by: KITCHEN_UID }),

      // catalogue
      put("products/prawns-and-dates", { ...base, name: "Prawns and dates" }),
      put("ingredients/i1", { ...base, labelName: "Prawns" }),
      put("recipes/rec-1", { ...base, productSlug: "prawns-and-dates", version: 1 }),

      // customers
      put(`customers/${CUSTOMER_PHONE}`, { ...base, name: "Shefin" }),
      put(`customers/${CUSTOMER_PHONE}/addresses/a1`, { ...base, pincode: "673571" }),

      // shipping
      put("shipments/sh-1", { ...base, orderId: ORDER_ID, courier: "indiaPost", packingCost: 0 }),
      put("shipments/sh-1/events/e1", { ...base, status: "created" }),

      // agent
      put("concerns/con-1", { ...base, type: "claim", orderId: ORDER_ID }),
      put("approvals/app-1", { ...base, kind: "halfReached", status: "waiting" }),
      put(`conversations/${CUSTOMER_PHONE}`, { ...base, summary: "" }),
      put(`conversations/${CUSTOMER_PHONE}/messages/m1`, { ...base, direction: "out", body: "hi" }),

      // system
      put("settings/discountCap", { ...base, amount: 0 }),
      put("settings/pincodes", { ...base, serviceable: [] }),
      put(`users/${OWNER_UID}`, { name: "Shefin", phone: "+917736110087", role: "owner" }),
      put(`users/${KITCHEN_UID}`, { name: "Sumayya", phone: "+919446587027", role: "kitchen" }),
      put(`users/${VIEWER_UID}`, { name: "CA", phone: "+910000000000", role: "viewer" }),
      put("policyVersions/p1", { ...base, kind: "orders", text: "..." }),
      put("audit/aud-1", { object: "batches/001", action: "update", by: OWNER_UID, at: now }),
    ]);
  });
}
