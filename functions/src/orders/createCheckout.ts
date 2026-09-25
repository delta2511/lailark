/**
 * `createCheckout`: the only way a jar leaves a batch for somebody on the
 * website.
 *
 * Brief §6.1 steps 3 and 4, and §7.2 steps 3 and 4. `./checkout.ts` is that
 * specification as code, with no Firebase in it; this file does the Firestore
 * work it asks for, and then talks to Razorpay.
 *
 * ## The shape, and why it is this shape
 *
 * 1. **One transaction** takes the hold, writes the order, writes the
 *    customer and appends the trail. Either all four land or none does. The
 *    count moves through `batches/holds.ts`, the same module the counter sale
 *    goes through, so there is one place in the system that can make a count
 *    wrong rather than two that have to agree (CLAUDE.md §3).
 * 2. **Then** the Razorpay order is created, outside the transaction, because
 *    a network call inside one would be retried with it and could create two
 *    gateway orders for one jar.
 * 3. If Razorpay refuses, the hold is **released** in a second transaction
 *    and the customer is told plainly. A jar is never left out of the count
 *    because a gateway was down; at worst it comes back fifteen minutes later
 *    when the hold lapses anyway (brief §9.3).
 *
 * ## No sign-in
 *
 * Brief §5: "No accounts, no passwords. A customer is a phone number." So
 * this callable is public. What protects it is that it writes nothing a
 * customer chooses: the price comes from the batch, the shipping from
 * Settings, the batch from the server's own chooser, and the per-person limit
 * and the count are checked inside the transaction. The worst an abusive
 * caller can do is take holds that lapse in fifteen minutes, which the sweep
 * (`sweepHolds.ts`) tidies. App Check closes that door in M5.9.
 *
 * ## No document is issued here
 *
 * **Decision D36.** A hold may expire, and a bill number is permanent, never
 * reused and never deleted. Issuing one here would put an unpaid non-sale in
 * the register the CA reads and leave a hole when the hold lapsed. The bill
 * (in stock) or the receipt (an open batch booking) is issued when Razorpay
 * captures, in M3.6's webhook.
 */

import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { WEB_HOLD_MINUTES } from "@lailark/shared";

import { writeAudit } from "../audit/write";
import { HoldRefused, readStockClaim, type StockClaim, writeStockClaim } from "../batches/holds";
import { readStockRelease, writeStockRelease } from "../batches/holds";
import { BATCHES, heldJarsWithCustomerFrom, PRODUCTS } from "../batches/store";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import {
  checkResumableCheckout,
  chooseWebBatch,
  parseCheckoutRequest,
  planCheckout,
  planResumedContact,
  type StartedCheckout,
  type StoredContact,
} from "./checkout";
import {
  createRazorpayOrder,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  razorpayKeyIdForClient,
  RazorpayFailed,
  RazorpayNotConfigured,
} from "./razorpay";
import { saleProductViewFrom } from "./store";
import {
  CUSTOMERS,
  freeOrderRef,
  ORDERS,
  pincodeList,
  productShippingFrom,
  saleBatchViewFrom,
  saleCustomerViewFrom,
  shippingSwitch,
  webCandidateBatchesFor,
  webHoldMinutes,
  withCustomerTimestamps,
} from "./store";

/** Contention on a batch document is a retry, not a failure. */
const MAX_TRANSACTION_ATTEMPTS = 12;

/**
 * Who the audit trail says did this. Not a uid: nobody signed in, and
 * pretending an Owner took the hold would make the trail lie.
 */
const ACTOR = "web";

/** What the checkout page needs to open Razorpay Checkout. */
export interface CheckoutResult {
  readonly orderId: string;
  readonly batchRef: string;
  readonly batchNo: string | null;
  readonly qty: number;
  readonly unitPricePaise: number;
  readonly shippingFeePaise: number;
  readonly totalPaise: number;
  readonly lineDescription: string;
  readonly holdExpiresAtMillis: number;
  /** The key id, never the secret. */
  readonly razorpayKeyId: string;
  readonly razorpayOrderId: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerEmail: string | null;
  /** True when this exact attempt had already been made and nothing moved. */
  readonly alreadyStarted: boolean;
}

export const createCheckout = onCall(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    // Explicit, not the platform's 60 seconds. Everything this call does is
    // bounded already: the transaction retries at most a dozen times on a
    // contended batch, and the Razorpay order aborts at ten seconds
    // (`RAZORPAY_TIMEOUT_MS`, A175). Thirty is comfortably above the slowest
    // honest run and well under the hold, so a customer who is going to be
    // told "something went wrong" hears it while the page is still theirs,
    // rather than a minute later with the jars long since released.
    timeoutSeconds: 30,
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
    // Brief §5: there is no sign-in on the website at all. App Check is the
    // gate this call will eventually get (M5.9).
    enforceAppCheck: false,
    // The checkout page is served from the customer site, which Hosting
    // serves from a different origin than the function's own.
    cors: true,
  },
  async (request) => {
    const parsed = parseCheckoutRequest(request.data);
    if (!parsed.ok) throw new HttpsError(parsed.code, parsed.message);
    const input = parsed.value;

    const db = getFirestore(getAdminApp());

    const held = await db.runTransaction(
      async (tx) => {
        const nowMillis = Date.now();

        /* ---- read ---------------------------------------------------- */

        // The same checkout arriving twice takes one hold. A tap delivered
        // twice, or a response lost after this transaction already committed,
        // comes back here with the same `clientRef` and gets the order that
        // was already written rather than a second jar out of the count.
        const holdMinutes = await webHoldMinutes(tx, db, WEB_HOLD_MINUTES);

        const minted = await freeOrderRef(tx, db, input.clientRef);
        const orderId = minted.ref;
        if (minted.already !== null) {
          const existing = await tx.get(db.collection(ORDERS).doc(orderId));
          const line = firstLine(existing);
          const storedBatchRef = String(line.batchRef ?? "");
          // The batch is read before the decision, not after it: whether the
          // jars are really still held is the batch's answer, not the
          // order's (see `checkResumableCheckout`).
          const batchSnap = storedBatchRef === ""
            ? null
            : await tx.get(db.collection(BATCHES).doc(storedBatchRef));
          const heldHere =
            batchSnap === null ? null : (heldJarsWithCustomerFrom(batchSnap)[orderId] ?? null);
          const heldJarsForOrder =
            heldHere === null || heldHere.expiresAt <= nowMillis ? null : heldHere.qty;

          // ...but only while its jars are really still held, and only when
          // it is still the same customer buying the same thing. Everything
          // this refuses used to be answered with the stored order whatever
          // the browser had just asked for.
          const resume = checkResumableCheckout(
            startedCheckoutFrom(existing, heldJarsForOrder, nowMillis),
            {
              productSlug: input.productSlug,
              qty: input.qty,
              expectedTotalPaise: input.expectedTotalPaise,
              customerPhone: input.customerPhone,
            },
            holdMinutes,
          );
          if (!resume.ok) {
            // Handed back outside the transaction, because the release is a
            // transaction of its own and this one must not write here.
            return {
              alreadyStarted: "refused" as const,
              refused: resume,
              orderId,
              batchRef: storedBatchRef,
              qty: typeof line.qty === "number" ? line.qty : 0,
            };
          }
          // The line the customer is about to pay for, named as the first
          // attempt named it. One more read, on a path taken once in a while.
          const productSnap = await tx.get(
            db.collection(PRODUCTS).doc(String(line.productSlug ?? "")),
          );
          const productName = (productSnap.get("name") as string | undefined) ?? "";

          // M3.5a: the address in *this* request, not the one the first tap
          // left behind. A customer who dismissed the Razorpay window to fix
          // a house number used to be answered with the stored order, and
          // the jar went to the first address.
          const resumeCustomerRef = db.collection(CUSTOMERS).doc(input.customerPhone);
          const resumeCustomerSnap = await tx.get(resumeCustomerRef);
          const contact = planResumedContact(
            input,
            storedContactFrom(existing, resumeCustomerSnap),
            {
              productName,
              restriction: productShippingFrom(productSnap).restriction,
              pincodes: await pincodeList(tx, db),
            },
          );
          // Refused: the new address is one we cannot send to. The hold
          // stays and so does the reference, because there is nothing wrong
          // with their jars: the next tap, with the pincode fixed, is this
          // same checkout going through.
          if (!contact.ok) throw new HttpsError(contact.code, contact.message);

          const orderPatch = contact.value.orderPatch;
          if (Object.keys(orderPatch).length > 0) {
            const orderRef = db.collection(ORDERS).doc(orderId);
            tx.set(orderRef, withStamps({ ...orderPatch }, ["updatedAt"]), { merge: true });
            writeAudit(tx, db, {
              object: `${ORDERS}/${orderId}`,
              action: "checkout",
              patch: orderPatch,
              beforeSnap: existing,
              by: ACTOR,
            });
          }
          const resumeCustomerPatch = contact.value.customerPatch;
          if (Object.keys(resumeCustomerPatch).length > 0) {
            tx.set(
              resumeCustomerRef,
              withStamps({ ...resumeCustomerPatch }, ["updatedAt"]),
              { merge: true },
            );
            writeAudit(tx, db, {
              object: `${CUSTOMERS}/${input.customerPhone}`,
              action: "checkout",
              patch: resumeCustomerPatch,
              beforeSnap: resumeCustomerSnap.exists
                ? (resumeCustomerSnap as DocumentSnapshot)
                : null,
              by: ACTOR,
            });
          }

          return {
            alreadyStarted: true as const,
            orderId,
            snap: existing,
            productName,
            batchNo: (batchSnap?.get("batchNo") as string | null | undefined) ?? null,
            // What the customer typed this time, which is what the order now
            // carries and what Razorpay Checkout should open prefilled with.
            customerName: input.customerName,
            customerEmail: input.email,
          };
        }

        const shipping = await shippingSwitch(tx, db);
        const pincodes = await pincodeList(tx, db);

        const productSnap = await tx.get(db.collection(PRODUCTS).doc(input.productSlug));
        if (!productSnap.exists || productSnap.get("active") !== true) {
          throw new HttpsError(
            "not-found",
            "We are not selling that one just now. Do have a look at what is in the kitchen.",
          );
        }
        const product = {
          ...saleProductViewFrom(productSnap),
          ...productShippingFrom(productSnap),
        };

        const todayIso = kolkataDate(nowMillis);

        let batchRef = input.batchRef;
        if (batchRef === null) {
          const candidates = await webCandidateBatchesFor(tx, db, input.productSlug, nowMillis);
          const chosen = chooseWebBatch(candidates, product.name, todayIso);
          if (!chosen.ok) throw new HttpsError(chosen.code, chosen.message);
          batchRef = chosen.ref;
        }

        const batchSnap = await tx.get(db.collection(BATCHES).doc(batchRef));
        if (!batchSnap.exists) {
          throw new HttpsError("not-found", "That batch is gone. Please start again.");
        }
        const batch = {
          ...saleBatchViewFrom(batchSnap),
          saleStopOn:
            typeof batchSnap.get("saleStopOn") === "string" && batchSnap.get("saleStopOn") !== ""
              ? (batchSnap.get("saleStopOn") as string)
              : null,
        };

        const customerRef = db.collection(CUSTOMERS).doc(input.customerPhone);
        const customerSnap = await tx.get(customerRef);
        const customer = customerSnap.exists ? saleCustomerViewFrom(customerSnap) : null;

        /* ---- plan ---------------------------------------------------- */

        const decision = planCheckout(input, {
          orderId,
          batch,
          product,
          customer,
          shipping,
          pincodes,
          // M5.7 writes the policy pages, and an order will then carry the
          // version it agreed to. Until then there is no published version
          // to name, and inventing one would put a lie in the record.
          // TODO(M5.7): read the published `policyVersions` id here.
          policyVersion: "",
          holdMinutes,
          nowMillis,
          todayIso,
        });
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);
        const plan = decision.value;

        // The count moves here, or nowhere. Every check the hold makes
        // (state, the per-person limit across this customer's orders in this
        // batch, `paid + live holds + requested <= capacity`) is made against
        // the batch as *this* transaction read it, which is what makes the
        // loser of a race lose honestly.
        let claim: StockClaim;
        try {
          claim = await readStockClaim(tx, db, {
            batchRef,
            customerPhone: input.customerPhone,
            orderId,
            qty: input.qty,
            mode: "hold",
            holdMinutes,
            // D52: a fallback for a blank box, never a narrowing of a typed
            // one. `resolvePerPersonLimit` inside the hold decides which.
            perPersonLimitFallback: plan.perPersonLimitFallback ?? undefined,
          });
        } catch (error) {
          if (error instanceof HoldRefused) {
            throw new HttpsError("aborted", error.message, { reason: error.reason });
          }
          throw error;
        }

        /* ---- write --------------------------------------------------- */

        const orderRef = db.collection(ORDERS).doc(orderId);
        const orderBody: Record<string, unknown> = {
          ...plan.order,
          holdExpiresAt:
            claim.expiresAtMillis === null ? null : Timestamp.fromMillis(claim.expiresAtMillis),
        };
        tx.create(orderRef, withStamps(orderBody, plan.stampFields));
        writeAudit(tx, db, {
          object: `${ORDERS}/${orderId}`,
          action: "checkout",
          patch: orderBody,
          beforeSnap: null,
          by: ACTOR,
        });

        const customerBody = withCustomerTimestamps(plan.customerPatch);
        tx.set(customerRef, withStamps(customerBody, plan.customerStampFields), { merge: true });
        writeAudit(tx, db, {
          object: `${CUSTOMERS}/${input.customerPhone}`,
          action: plan.customerIsNew ? "create" : "checkout",
          patch: customerBody,
          beforeSnap: customerSnap.exists ? (customerSnap as DocumentSnapshot) : null,
          by: ACTOR,
        });

        writeStockClaim(tx, db, claim, ACTOR);
        writeAudit(tx, db, {
          object: `${BATCHES}/${batchRef}`,
          action: "webHold",
          patch: claim.auditPatch,
          beforeSnap: claim.batchSnap,
          by: ACTOR,
        });

        return {
          alreadyStarted: false as const,
          orderId,
          batchRef,
          batchNo: claim.batchNo,
          qty: input.qty,
          unitPricePaise: plan.unitPrice,
          shippingFeePaise: plan.totals.shippingFee,
          totalPaise: plan.totals.total,
          lineDescription: plan.lineDescription,
          holdExpiresAtMillis: claim.expiresAtMillis ?? 0,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.email,
        };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );

    /* ---- the same checkout, twice ------------------------------------ */

    if (held.alreadyStarted === "refused") {
      // The customer changed what they were buying, so the jars they first
      // asked for go back before they are told to tap again. Without this
      // their own live hold would be counted against their per-person limit
      // and refuse the very order the page is showing them (brief §4.1).
      if (held.refused.releaseStoredHold && held.batchRef !== "" && held.qty > 0) {
        await releaseHold(held.orderId, held.batchRef, held.qty);
      }
      throw new HttpsError(held.refused.code, held.refused.message, {
        reason: held.refused.reason,
      });
    }

    if (held.alreadyStarted) {
      // `razorpayKeyIdForClient` throws when no key is configured, exactly
      // as the gateway call does on the fresh path. It is caught here for
      // the same reason it is caught there: a customer meets the plain
      // sentence, not an internal error, whichever path they are on.
      try {
        return alreadyStarted(held.orderId, held.snap, held.productName, held.batchNo, {
          customerName: held.customerName,
          customerEmail: held.customerEmail,
        });
      } catch (error) {
        if (error instanceof RazorpayNotConfigured) {
          console.error("createCheckout: no Razorpay key to resume with", {
            orderId: held.orderId,
          });
          throw new HttpsError("unavailable", error.message);
        }
        throw error;
      }
    }

    /* ---- Razorpay, outside the transaction --------------------------- */

    let gateway;
    try {
      gateway = await createRazorpayOrder({
        amountPaise: held.totalPaise,
        orderId: held.orderId,
        // Brief §9.2: the order id travels in `notes`, and M3.6's webhook
        // reads it back off `payment.captured` to find the hold this money
        // belongs to, rather than trusting anything the browser says.
        notes: {
          lailark_order_id: held.orderId,
          lailark_batch_ref: held.batchRef,
          lailark_jars: String(held.qty),
        },
      });
    } catch (error) {
      await releaseHold(held.orderId, held.batchRef, held.qty);
      if (error instanceof RazorpayNotConfigured || error instanceof RazorpayFailed) {
        console.error("createCheckout: Razorpay refused", {
          orderId: held.orderId,
          detail: error instanceof RazorpayFailed ? error.detail : "no key configured",
        });
        throw new HttpsError("unavailable", error.message);
      }
      throw error;
    }

    await db
      .collection(ORDERS)
      .doc(held.orderId)
      .set(
        {
          payment: { razorpayIds: { orderId: gateway.id } },
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: ACTOR,
        },
        { merge: true },
      );

    const result: CheckoutResult = {
      orderId: held.orderId,
      batchRef: held.batchRef,
      batchNo: held.batchNo,
      qty: held.qty,
      unitPricePaise: held.unitPricePaise,
      shippingFeePaise: held.shippingFeePaise,
      totalPaise: held.totalPaise,
      lineDescription: held.lineDescription,
      holdExpiresAtMillis: held.holdExpiresAtMillis,
      razorpayKeyId: gateway.keyId,
      razorpayOrderId: gateway.id,
      customerName: held.customerName,
      customerPhone: held.customerPhone,
      customerEmail: held.customerEmail,
      alreadyStarted: false,
    };
    return result;
  },
);

/**
 * Puts the jars back when the gateway refused, so a jar is never out of the
 * count because Razorpay was down. The order is marked `expired` in the same
 * commit, so nothing downstream ever sees a held order with no gateway order
 * behind it.
 */
async function releaseHold(orderId: string, batchRef: string, qty: number): Promise<void> {
  const db = getFirestore(getAdminApp());
  try {
    await db.runTransaction(async (tx) => {
      const release = await readStockRelease(tx, db, { batchRef, orderId, qty, mode: "hold" });
      const orderSnap = await tx.get(db.collection(ORDERS).doc(orderId));
      writeStockRelease(tx, db, release, ACTOR);
      if (orderSnap.exists) {
        tx.set(
          db.collection(ORDERS).doc(orderId),
          {
            state: "expired",
            holdExpiresAt: null,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: ACTOR,
          },
          { merge: true },
        );
      }
    });
  } catch (error) {
    // A failed release is not a reason to tell the customer something worse
    // than "try again": the hold lapses on its own in fifteen minutes
    // (brief 9.3), and the sweep tidies the key.
    console.error("createCheckout: could not release the hold", { orderId, batchRef, error });
  }
}

/** `orders/{id}.lines[0]`, or an empty object. */
function firstLine(snap: DocumentSnapshot): Record<string, unknown> {
  const lines = (snap.data() ?? {}).lines;
  return (Array.isArray(lines) ? (lines[0] ?? {}) : {}) as Record<string, unknown>;
}

/**
 * The contact a started checkout already carries, as `planResumedContact`
 * reads it. The address is on the order; the email is on the customer, which
 * is the only place the checkout ever put one.
 */
function storedContactFrom(
  orderSnap: DocumentSnapshot,
  customerSnap: DocumentSnapshot,
): StoredContact {
  const d = (orderSnap.data() ?? {}) as Record<string, unknown>;
  const contact = (d.deliveryContact ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const rawLines = contact.lines;
  const email = customerSnap.get("email");
  return {
    name: str(contact.name),
    phone: str(contact.phone),
    lines: Array.isArray(rawLines) ? rawLines.map((line) => str(line)) : [],
    city: str(contact.city),
    state: str(contact.state),
    pincode: str(contact.pincode),
    placeOfSupply: str(d.placeOfSupply),
    customerEmail: typeof email === "string" && email !== "" ? email : null,
  };
}

/** The order as `checkResumableCheckout` reads it. Plain values only. */
function startedCheckoutFrom(
  snap: DocumentSnapshot,
  heldJarsForOrder: number | null,
  nowMillis: number,
): StartedCheckout {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const payment = (d.payment ?? {}) as Record<string, unknown>;
  const ids = (payment.razorpayIds ?? {}) as Record<string, unknown>;
  const line = firstLine(snap);
  const expiry = d.holdExpiresAt;
  return {
    state: typeof d.state === "string" ? d.state : "",
    paymentStatus: typeof payment.status === "string" ? payment.status : "",
    razorpayOrderId: typeof ids.orderId === "string" ? ids.orderId : "",
    holdExpiresAtMillis: expiry instanceof Timestamp ? expiry.toMillis() : null,
    productSlug: typeof line.productSlug === "string" ? line.productSlug : "",
    qty: typeof line.qty === "number" ? line.qty : 0,
    totalPaise: typeof d.total === "number" ? d.total : 0,
    customerPhone: typeof d.customerPhone === "string" ? d.customerPhone : "",
    heldJarsForOrder,
    nowMillis,
  };
}

/**
 * The answer to a checkout that had already been started, and whose jars are
 * still held. Nothing moves. `checkResumableCheckout` has already refused
 * every other shape, so everything read here is known to be there.
 */
function alreadyStarted(
  orderId: string,
  snap: DocumentSnapshot,
  productName: string,
  batchNo: string | null,
  /**
   * The contact as *this* request gave it, which after M3.5a is what the
   * order carries: the snapshot was read before that write. Reading the name
   * back off the snapshot would hand the page the address it just corrected.
   */
  given: { readonly customerName: string; readonly customerEmail: string | null },
): CheckoutResult {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const line = firstLine(snap);
  const payment = (d.payment ?? {}) as Record<string, unknown>;
  const ids = (payment.razorpayIds ?? {}) as Record<string, unknown>;
  const num = (value: unknown): number => (typeof value === "number" ? value : 0);
  const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const expiry = d.holdExpiresAt;

  return {
    orderId,
    batchRef: str(line.batchRef) ?? "",
    batchNo,
    qty: num(line.qty),
    unitPricePaise: num(line.unitPrice),
    shippingFeePaise: num(d.shippingFee),
    totalPaise: num(d.total),
    // Built the way `planCheckout` builds it, so the second answer names the
    // same jar as the first. It used to come back empty, and Razorpay
    // Checkout then opened with no description at all.
    lineDescription:
      productName === ""
        ? ""
        : `${productName}, ${batchNo === null ? "this batch" : `batch ${batchNo}`}`,
    holdExpiresAtMillis: expiry instanceof Timestamp ? expiry.toMillis() : 0,
    // The bound secret, through the same reader the gateway call uses, and
    // never a set-but-empty variable: `?? "rzp_test_emulator"` did not catch
    // one, so the page opened Razorpay with `key: ""` and could only say it
    // had failed.
    razorpayKeyId: razorpayKeyIdForClient(),
    razorpayOrderId: str(ids.orderId) ?? "",
    customerName: given.customerName,
    customerPhone: str(d.customerPhone) ?? "",
    // M3.5a: this used to be `null` whatever the request carried, so a
    // customer who added an email on the second tap opened the payment
    // window without it.
    customerEmail: given.customerEmail,
    alreadyStarted: true,
  };
}

/** `"YYYY-MM-DD"` in Asia/Kolkata, which is the only calendar this shop has. */
function kolkataDate(nowMillis: number): string {
  return new Date(nowMillis + 330 * 60_000).toISOString().slice(0, 10);
}

/** Turns a plan's stamp field list into `serverTimestamp()` values. */
function withStamps(
  patch: Readonly<Record<string, unknown>>,
  stampFields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch, updatedBy: ACTOR };
  if (stampFields.includes("createdAt")) out.createdBy = ACTOR;
  for (const field of stampFields) {
    out[field] = FieldValue.serverTimestamp();
  }
  return out;
}
