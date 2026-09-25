/**
 * `createCounterSale`: the only way a sale at the door becomes an order.
 *
 * Brief sections 7A.1 (the New sale screen) and 7A.6 (who may do what at the
 * counter). `./sale.ts` is that specification as code, with no Firebase in
 * it; this file does the Firestore work it asks for, **all of it in one
 * transaction**: the jar leaving the batch, the order, the customer, and the
 * audit trail.
 *
 * ## Why one transaction
 *
 * Firestore commits a transaction atomically. So either every one of those
 * four lands, or none of them does and the whole thing is retried. There is
 * no state in which a jar left a batch but the order that took it was never
 * written, and none in which an order exists for a jar that is still on the
 * shelf. CLAUDE.md section 3: "Counts change only inside Firestore
 * transactions on the batch document, in functions. Never oversell."
 *
 * The count itself moves through `batches/holds.ts`, the same module the web
 * checkout's hold goes through, so there is one place in the system that can
 * make a count wrong rather than two that have to agree. Its read half does
 * every check (state, the per-person limit, `paid + live holds + requested <=
 * capacity`) against the batch as *this* transaction read it, which is what
 * makes the loser of a race lose honestly: Firestore retries it against the
 * winner's write, and the second time round the arithmetic says no.
 *
 * ## What is never trusted from the request
 *
 * The price (it comes from the batch), the discount cap (it comes from
 * `settings/discountCap`, D17), the caller's role (it comes from the Auth
 * token's custom claim, which only `setRole` can set), and the total (the
 * request carries what the screen *showed*, and the sale is refused if the
 * server's own total differs, rather than charging the difference).
 *
 * ## History
 *
 * D39: `audit/{id}` is the only order history. This writes `audit` only.
 */

import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { writeAudit } from "../audit/write";
import {
  HoldRefused,
  PAYMENT_LINK_HOLD_MINUTES,
  readStockClaim,
  type StockClaim,
  writeStockClaim,
} from "../batches/holds";
import { BATCHES, PRODUCTS } from "../batches/store";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { newOrderToken, newShareCode } from "./links";
import { issueDocument, readDocumentContext, readIssue } from "../money/issue";
import { type DocumentSource, GST_NOT_BUILT_REFUSAL } from "../money/plan";
import {
  type BatchCandidate,
  checkSeller,
  chooseInStockBatch,
  parseCounterSaleRequest,
  planCounterSale,
  type SaleProductView,
} from "./sale";
import {
  candidateBatchesFor,
  CUSTOMERS,
  findNearMisses,
  freeOrderRef,
  kitchenDiscountCap,
  ORDERS,
  paymentLinkHoldMinutes,
  saleBatchViewFrom,
  saleCustomerViewFrom,
  saleProductViewFrom,
  withCustomerTimestamps,
} from "./store";

/**
 * Contention on the batch document is a retry, not a failure: two people
 * selling from the same batch at the same moment is ordinary, and only a
 * batch with no jar left should ever refuse.
 */
const MAX_TRANSACTION_ATTEMPTS = 12;

export const createCounterSale = onCall(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    // App Check arrives with M5.9; until then the role claim is the gate.
    enforceAppCheck: false,
  },
  async (request) => {
    const caller = { uid: request.auth?.uid ?? null, role: request.auth?.token?.role };

    // Asked before anything is read, so a Viewer is told they may not sell
    // rather than told the last jar has gone.
    const seller = checkSeller(caller);
    if (!seller.ok) throw new HttpsError(seller.code, seller.message);

    const parsed = parseCounterSaleRequest(request.data);
    if (!parsed.ok) throw new HttpsError(parsed.code, parsed.message);
    const input = parsed.value;

    const db = getFirestore(getAdminApp());

    /* ---- a number that has never bought from us, brief 7A.1 step 1 ---- */

    // Outside the transaction on purpose: it refuses before anything is
    // written, and the near-miss lookup is up to 99 gets by id that have no
    // business in a transaction's read set. It also costs nothing at all on
    // the ordinary path, where the customer is already known.
    if (!input.confirmNewCustomer) {
      const existing = await db.collection(CUSTOMERS).doc(input.customerPhone).get();
      if (!existing.exists) {
        const nearMisses = await findNearMisses(db, input.customerPhone);
        throw new HttpsError(
          "failed-precondition",
          nearMisses.length === 0
            ? "This number has never bought from us. Check it, then add them."
            : `This number has never bought from us, and it is one digit from ${nearMisses
                .map((miss) => `${miss.name || miss.phone} (${miss.phone})`)
                .join(", ")}. Check it, then add them.`,
          { reason: "new-customer", phone: input.customerPhone, nearMisses },
        );
      }
    }

    return db.runTransaction(
      async (tx) => {
        const nowMillis = Date.now();

        /* ---- read ---------------------------------------------------- */

        // The same sale arriving twice writes one order. A tap delivered
        // twice, a response lost on a slow connection after this transaction
        // already committed, or M2.10 finalising an offline draft again all
        // come back here with the same `clientRef`, and all get the order
        // that was already written rather than a second charge.
        const minted = await freeOrderRef(tx, db, input.clientRef);
        const orderId = minted.ref;
        if (minted.already !== null) {
          const existing = await tx.get(db.collection(ORDERS).doc(orderId));
          return soldAlready(orderId, existing);
        }

        const kitchenCap = await kitchenDiscountCap(tx, db);
        const linkHoldMinutes = await paymentLinkHoldMinutes(tx, db, PAYMENT_LINK_HOLD_MINUTES);

        // The seller block, the prefixes and the GST switch, frozen onto the
        // bill this sale is about to be given (M2.9, brief 13.2). Also where
        // the place of supply comes from, so `settings/gst` is read once.
        const documents = await readDocumentContext(tx, db);
        const placeOfSupplyHome = documents.gst.homeState;

        // GST cannot be worked out yet (A103), so a bill cannot be issued
        // with it on. Refused here, before anything is read or written, with
        // a sentence a person at the counter can act on rather than the bare
        // INTERNAL that the throw inside `splitGst` would become.
        if (documents.gst.enabled) {
          throw new HttpsError("failed-precondition", GST_NOT_BUILT_REFUSAL);
        }

        // **Decision D36.** Brief 13.1 reads "Counter sale: at save" one row
        // and "In stock online: at payment" the next, and a counter sale paid
        // by link is both. Shefin's answer: a payment link is billed at
        // **capture**, not at save. A cash or UPI-to-account sale is paid the
        // moment it is entered, so its bill is issued here, in this
        // transaction, and the sale cannot commit without one. A payment link
        // is not paid at save: the jars are only held, the link may expire,
        // and no money has moved, so spending a permanent, never-reused,
        // never-deleted number on it would put an unpaid non-sale in the
        // register and leave a hole when it lapsed. That bill is issued when
        // Razorpay captures the payment, in M3.6's webhook, through this same
        // call.
        const willIssueBill =
          input.paymentMethod === "cash" || input.paymentMethod === "upiToAccount";
        // Read in the read phase, like everything else: the counter document
        // goes into this transaction's read set, so two sellers at once are
        // retried against each other rather than taking one number twice.
        const serial = willIssueBill ? await readIssue(tx, db, "bill", nowMillis, documents) : null;

        let product: SaleProductView | null = null;
        if (input.line.productSlug !== null) {
          const snap = await tx.get(db.collection(PRODUCTS).doc(input.line.productSlug));
          if (!snap.exists && input.line.kind !== "custom") {
            throw new HttpsError("not-found", "That product is not in the catalogue any more.");
          }
          if (snap.exists) product = saleProductViewFrom(snap);
        }

        // Which batch the jar comes from. An explicit reference is honoured
        // (the screen shows the suggestion and the person may change it);
        // otherwise brief 7A.1 step 2's "oldest in-stock batch first".
        let batchRef = input.line.batchRef;
        if (batchRef === null && input.line.kind !== "custom" && input.line.productSlug !== null) {
          const candidates: BatchCandidate[] = await candidateBatchesFor(
            tx,
            db,
            input.line.productSlug,
            nowMillis,
          );
          const chosen = chooseInStockBatch(candidates, product?.name ?? input.line.productSlug);
          if (!chosen.ok) throw new HttpsError(chosen.code, chosen.message);
          batchRef = chosen.ref;
        }

        // The count moves here, or nowhere. A custom line with no batch
        // behind it takes no jar, so it takes no claim either.
        const stockMode = input.paymentMethod === "paymentLink" ? "hold" : "paid";
        let claim: StockClaim | null = null;
        if (batchRef !== null) {
          try {
            claim = await readStockClaim(tx, db, {
              batchRef,
              customerPhone: input.customerPhone,
              orderId,
              qty: input.line.qty,
              mode: stockMode,
              holdMinutes: linkHoldMinutes,
              // 7A.6: the Owner's row. `checkSeller` has already established
              // the role, and `planCounterSale` refuses the flag outright for
              // anyone else, so this can never widen the Kitchen's rights.
              overrideLimit: input.overrideLimit && seller.role === "owner",
            });
          } catch (error) {
            if (error instanceof HoldRefused) {
              // Brief 7A.1 step 7: "If a jar went in the meantime (someone
              // bought the last one online), the screen says so before
              // saving." A line a person can act on, never a code.
              throw new HttpsError("aborted", error.message, { reason: error.reason });
            }
            throw error;
          }
        }

        const customerRef = db.collection(CUSTOMERS).doc(input.customerPhone);
        const customerSnap = await tx.get(customerRef);
        const customerView = customerSnap.exists ? saleCustomerViewFrom(customerSnap) : null;

        /* ---- plan ---------------------------------------------------- */

        const decision = planCounterSale(input, {
          caller,
          orderId,
          // M3.8: minted here, never taken from a request.
          orderToken: newOrderToken(),
          freshShareCode: newShareCode(),
          batch: claim === null ? null : saleBatchViewFrom(claim.batchSnap),
          product,
          customer: customerView,
          kitchenDiscountCap: kitchenCap,
          homeState: placeOfSupplyHome,
          paymentLinkHoldMinutes: linkHoldMinutes,
          nowMillis,
        });
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);
        const plan = decision.value;

        /* ---- write --------------------------------------------------- */

        const actor = seller.uid;
        const orderRef = db.collection(ORDERS).doc(orderId);

        // Brief 13.2, from values this transaction already has in hand. The
        // jar numbers are empty: a jar takes its number when it is packed
        // (M4.1), and a jar handed over at the door never gets one.
        const documentSource: DocumentSource = {
          orderId,
          channel: "counter",
          customerName: input.customerName ?? customerView?.name ?? "",
          customerPhone: input.customerPhone,
          customerEmail: customerView?.email ?? null,
          deliveryLines: input.deliveryContact?.lines ?? [],
          placeOfSupply: plan.order.placeOfSupply as string,
          lines: [
            {
              description: plan.lineDescription,
              hsn: product?.hsn ?? null,
              qty: input.line.qty,
              unitPrice: plan.unitPrice,
              batchNo: claim?.batchNo ?? null,
              jarNumbers: [],
            },
          ],
          shippingFee: plan.totals.shippingFee,
          discount: input.discountPaise,
          discountReason: input.discountPaise === 0 ? null : input.discountReason,
          paymentMethod: input.paymentMethod,
          paymentStatus: plan.stockMode === "paid" ? "captured" : "created",
          paymentReference: input.upiRef,
        };

        const orderBody: Record<string, unknown> = {
          ...plan.order,
          // A payment link's jars are out of the count until it expires
          // (7A.1 step 5). A paid sale's jar is simply gone.
          holdExpiresAt:
            claim?.expiresAtMillis != null ? Timestamp.fromMillis(claim.expiresAtMillis) : null,
          // The bill's number, in the same commit as the bill itself.
          billNumber: serial?.number ?? null,
        };

        tx.create(orderRef, withStamps(orderBody, plan.stampFields, actor));

        if (serial !== null) {
          issueDocument(
            tx,
            db,
            serial,
            { source: documentSource, context: documents, nowMillis },
            actor,
          );
        }
        writeAudit(tx, db, {
          object: `${ORDERS}/${orderId}`,
          action: "counterSale",
          patch: orderBody,
          beforeSnap: null,
          by: actor,
        });

        const customerBody = withCustomerTimestamps(plan.customerPatch);
        tx.set(customerRef, withStamps(customerBody, plan.customerStampFields, actor), {
          merge: true,
        });
        writeAudit(tx, db, {
          object: `${CUSTOMERS}/${input.customerPhone}`,
          action: plan.customerIsNew ? "create" : "counterSale",
          patch: customerBody,
          beforeSnap: customerSnap.exists ? (customerSnap as DocumentSnapshot) : null,
          by: actor,
        });

        if (claim !== null && batchRef !== null) {
          writeStockClaim(tx, db, claim, actor);
          // The jar leaving the batch shows on the batch's own timeline, not
          // only on the order's: "22 bottled, 3 sold at the counter" has to
          // be readable from the batch.
          writeAudit(tx, db, {
            object: `${BATCHES}/${batchRef}`,
            action: stockMode === "paid" ? "counterSale" : "counterSaleHold",
            patch: claim.auditPatch,
            beforeSnap: claim.batchSnap,
            by: actor,
          });
        }

        return {
          orderId,
          orderNumber: plan.order.number as string,
          state: plan.order.state as string,
          total: plan.totals.total,
          subtotal: plan.totals.subtotal,
          discount: plan.totals.discount,
          jars: plan.totals.jars,
          unitPrice: plan.unitPrice,
          lineDescription: plan.lineDescription,
          batchRef,
          batchNo: claim?.batchNo ?? null,
          billNumber: serial?.number ?? null,
          customerCreated: plan.customerIsNew,
          paid: plan.stockMode === "paid",
          holdExpiresAtMillis: claim?.expiresAtMillis ?? null,
          /** What is left on that batch after this sale. */
          jarsLeftBefore: claim?.availabilityBefore.available ?? null,
          limitOverridden: input.overrideLimit,
          alreadySold: false,
        };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  },
);

/** What the callable hands back for a sale, whether it wrote it now or before. */
export interface CounterSaleResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly state: string;
  readonly total: number;
  readonly subtotal: number;
  readonly discount: number;
  readonly jars: number;
  readonly unitPrice: number;
  readonly lineDescription: string;
  readonly batchRef: string | null;
  readonly batchNo: string | null;
  /** The bill's number, `"LK/26-27/0001"`, or null when none was issued. */
  readonly billNumber: string | null;
  readonly customerCreated: boolean;
  readonly paid: boolean;
  readonly holdExpiresAtMillis: number | null;
  readonly jarsLeftBefore: number | null;
  readonly limitOverridden: boolean;
  /** True when this sale had already been written and nothing was done again. */
  readonly alreadySold: boolean;
}

/**
 * The answer to a sale that has already been written: the order that exists,
 * read back and reported exactly as the first call reported it, so a repeat
 * is indistinguishable to the screen from the original success. Nothing is
 * written, no jar moves, and the customer is charged once.
 */
function soldAlready(orderId: string, snap: DocumentSnapshot): CounterSaleResult {
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const line = (Array.isArray(d.lines) ? d.lines[0] : {}) as Record<string, unknown>;
  const payment = (d.payment ?? {}) as Record<string, unknown>;
  const discount = (d.discount ?? {}) as Record<string, unknown>;
  const num = (value: unknown): number => (typeof value === "number" ? value : 0);
  const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

  return {
    orderId,
    orderNumber: str(d.number) ?? "",
    state: str(d.state) ?? "",
    total: num(d.total),
    subtotal: num(d.subtotal),
    discount: num(discount.amount),
    jars: num(d.jars),
    unitPrice: num(line.unitPrice),
    lineDescription: str(line.description) ?? "",
    batchRef: str(line.batchRef),
    batchNo: str(line.batchNo),
    billNumber: str(d.billNumber),
    customerCreated: false,
    paid: str(payment.status) === "captured",
    holdExpiresAtMillis: null,
    jarsLeftBefore: null,
    limitOverridden: d.limitOverridden === true,
    alreadySold: true,
  };
}

/** Turns a plan's stamp field list into `serverTimestamp()` values. */
function withStamps(
  patch: Readonly<Record<string, unknown>>,
  stampFields: readonly string[],
  actor: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch, updatedBy: actor };
  if (stampFields.includes("createdAt")) out.createdBy = actor;
  for (const field of stampFields) {
    out[field] = FieldValue.serverTimestamp();
  }
  return out;
}
