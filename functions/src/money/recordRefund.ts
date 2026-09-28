/**
 * `recordRefund` and `markOrderRefusal`: brief §12.3, M4.5, decisions D31 and
 * D65. Owner only, both of them, because both move money or move what money
 * means.
 *
 * `refundPlan.ts` decides; this file does the Firestore work, in **one**
 * transaction, the same shape `voidCounterSale` already has.
 *
 * ## D31: recorded, not started
 *
 * Nothing here talks to Razorpay. A refund is made in the Razorpay dashboard,
 * by UPI, or in cash, and then recorded here so the ledger stays true. There
 * is no 6-month guard either; both are M4.5b.
 *
 * ## One transaction, or the count and the books can disagree
 *
 * CLAUDE.md §3: "Counts change only inside Firestore transactions on the batch
 * document, in functions." Putting a jar back is a count change, so the jar,
 * the order, the `refunds/{id}` record and the refund or credit note are one
 * commit. A refund that put the jar back but left the order looking paid, or
 * an order marked refunded whose jar never came back, cannot exist.
 *
 * ## Nothing is sent to anybody
 *
 * Brief §12.3 notes that a Razorpay refund reaches the customer in about 5 to
 * 7 working days and that "the agent says so". Nothing here says it. D32 and
 * CLAUDE.md §3: every customer message at launch is a person's decision on a
 * screen, and the agent is a later milestone. This records the refund and
 * stops. No `approvals` document is raised either, because nothing here is
 * waiting on the Owner: he is the one who just did it.
 */

import { FieldValue, getFirestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { toDocumentId } from "@lailark/shared";

import { writeAudit } from "../audit/write";
import { readStockRelease, ReleaseRefused, type StockRelease, writeStockRelease } from "../batches/holds";
import { BATCHES, PRODUCTS } from "../batches/store";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { checkOwner } from "../orders/sale";
import { isOrderRef, ORDERS } from "../orders/store";
import { issueDocument, readDocumentContext, readIssue, readOrderBill } from "./issue";
import { GST_NOT_BUILT_REFUSAL, type DocumentSource } from "./plan";
import {
  parseMarkRefusalRequest,
  parseRecordRefundRequest,
  planMarkRefusal,
  planRecordRefund,
  accumulatedGatewayFee,
  planRefundDocumentBody,
  refundBlockOf,
  type RefundableLine,
  type RefundableOrder,
  type RefundDocumentBody,
  type RefundPlan,
} from "./refundPlan";

const MAX_TRANSACTION_ATTEMPTS = 12;

/** `refunds/{id}`, brief §18.1. Written only by this function. */
export const REFUNDS = "refunds";

/* -------------------------------------------------------------------------- */
/* recordRefund                                                               */
/* -------------------------------------------------------------------------- */

export const recordRefund = onCall(
  {
    // A callable's own auth is the Firebase Auth token this function checks
    // for itself, not IAM: Cloud Run must therefore let an anonymous request
    // reach it, or the SDK's call is refused before any of our code runs
    // (A254). Every export states it rather than inheriting a past deploy's.
    invoker: "public",
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    enforceAppCheck: false,
  },
  async (request) => {
    const caller = { uid: request.auth?.uid ?? null, role: request.auth?.token?.role };
    const owner = checkOwner(caller);
    if (!owner.ok) throw new HttpsError(owner.code, owner.message);

    const parsed = parseRecordRefundRequest(request.data ?? {});
    if (!parsed.ok) throw new HttpsError(parsed.code, parsed.message);
    const input = parsed.value;

    if (!isOrderRef(input.orderId)) {
      throw new HttpsError(
        "invalid-argument",
        'An order is named by its reference, for example "o-7f3a2c".',
      );
    }

    const db = getFirestore(getAdminApp());
    const actor = owner.uid;

    try {
      return await db.runTransaction(
      async (tx) => {
        const nowMillis = Date.now();

        /* ---- read -------------------------------------------------- */

        const orderRef = db.collection(ORDERS).doc(input.orderId);
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
          throw new HttpsError("not-found", "There is no order with that reference.");
        }

        const documents = await readDocumentContext(tx, db);
        // A103, as `createCounterSale` does it: GST cannot be worked out yet,
        // so a refund note cannot be drawn with it on. Refused here with a
        // sentence the Owner can act on rather than the bare INTERNAL that
        // the throw inside `splitGst` would become. A refund is his own act
        // at a screen, so refusing is honest: unlike a capture, no money has
        // already arrived that the system has to account for either way.
        if (documents.gst.enabled) {
          throw new HttpsError("failed-precondition", GST_NOT_BUILT_REFUSAL);
        }

        // Brief §13.1 decides the kind off what the order already carries: a
        // credit note after a bill, a refund note where only a receipt
        // exists. The order stores whichever serial was issued in one field
        // (`billNumber`), so the *kind* has to come from the document itself.
        const rawNumber = orderSnap.get("billNumber");
        const documentNumber =
          typeof rawNumber === "string" && rawNumber !== "" ? rawNumber : null;
        let existingKind: RefundableOrder["documentKind"] = null;
        if (documentNumber !== null) {
          let documentId: string | null = null;
          try {
            documentId = toDocumentId(documentNumber);
          } catch {
            documentId = null;
          }
          if (documentId !== null) {
            const snap = await readOrderBill(tx, db, documentId);
            const kind = snap.get("kind");
            if (kind === "bill" || kind === "receipt") existingKind = kind;
          }
        }

        const order = refundableOrderFrom(orderSnap.id, orderSnap.data() ?? {}, {
          documentNumber,
          documentKind: existingKind,
        });

        const block = refundBlockOf(order.refund);
        // Cash has no reference of its own, so its `refunds/{id}` counts the
        // cash refunds already recorded on this order (see `refundDocumentId`).
        const cashRefundsSoFar =
          input.method === "cash"
            ? (
                await tx.get(
                  db
                    .collection(REFUNDS)
                    .where("orderId", "==", order.id)
                    .where("method", "==", "cash"),
                )
              ).size
            : 0;

        const decision = planRecordRefund(input, order, {
          cashRefundsSoFar,
          gatewayPendingRefundId: block.gatewayPendingRefundId,
        });
        if (!decision.ok) throw new HttpsError(decision.code, decision.message);
        const plan = decision.value;

        // The jars, read before anything is written, as ever.
        const releases: StockRelease[] = [];
        for (const back of plan.jarReturns) {
          try {
            releases.push(
              await readStockRelease(tx, db, {
                batchRef: back.batchRef,
                orderId: order.id,
                qty: back.qty,
                mode: "paid",
              }),
            );
          } catch (error) {
            if (error instanceof ReleaseRefused) {
              throw new HttpsError("failed-precondition", error.message, { reason: error.reason });
            }
            throw error;
          }
        }

        // What the note has to be able to say: the product's **name** (never a
        // slug, which is a developer's string) and the batch's printed number,
        // for brief §13.2's "product, batch number, jar numbers" columns. Read
        // here, in the read phase, for every line rather than for the first
        // one: an order can carry jars from more than one batch.
        const naming = await readDocumentNaming(tx, db, order.lines);

        const serial = await readIssue(tx, db, plan.documentKind, nowMillis, documents);

        // The goods column of the note, which must add up to the amount being
        // returned. See `planRefundDocumentBody`.
        const body = planRefundDocumentBody({
          lines: order.lines,
          shippingFee: num(orderSnap.get("shippingFee")),
          discount: num(asRecord(orderSnap.get("discount")).amount),
          discountReason: discountReasonOf(orderSnap.get("discount")),
          amount: plan.amount,
          fullyRefunded: plan.fullyRefunded,
          ...naming,
        });

        /* ---- write ------------------------------------------------- */

        // `tx.create`, so the same refund can never be recorded twice: the
        // gateway's refund id and a UPI reference are each unique by nature,
        // and Firestore refuses the second create rather than trusting a
        // check somebody could forget.
        tx.create(db.collection(REFUNDS).doc(plan.refundId), {
          orderId: order.id,
          concernId: null,
          amount: plan.amount,
          method: plan.method,
          razorpayRefundId: input.razorpayRefundId,
          reference: input.reference,
          status: "processed",
          note: input.note,
          documentNumber: serial.number,
          documentKind: plan.documentKind,
          jarsReturned: plan.jarsReturned,
          batchRefs: plan.jarReturns.map((r) => r.batchRef),
          jarsHeldBackBecause: plan.jarsHeldBackBecause,
          gatewayFeeUnreturned: plan.gatewayFeeUnreturned,
          refusalReason: plan.refusalReason,
          recordedBy: actor,
          recordedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor,
        });

        const orderPatch = orderPatchFor(plan, block, serial.number, input.refusalReason, actor);
        tx.set(
          orderRef,
          { ...orderPatch, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor },
          { merge: true },
        );
        writeAudit(tx, db, {
          object: `${ORDERS}/${order.id}`,
          action: plan.fullyRefunded ? "refundRecorded" : "partialRefundRecorded",
          patch: {
            method: plan.method,
            amount: plan.amount,
            refundedTotal: plan.refundedTotal,
            fullyRefunded: plan.fullyRefunded,
            jarsReturned: plan.jarsReturned,
            jarsHeldBackBecause: plan.jarsHeldBackBecause,
            documentNumber: serial.number,
            refundId: plan.refundId,
            refusalReason: plan.refusalReason,
            documentItemised: body.itemised,
          },
          beforeSnap: orderSnap,
          by: actor,
        });

        for (const release of releases) {
          writeStockRelease(tx, db, release, actor);
          writeAudit(tx, db, {
            object: `${BATCHES}/${release.batchRef}`,
            action: "refundJarsReturned",
            patch: { ...release.auditPatch, orderId: order.id, refundId: plan.refundId },
            beforeSnap: release.batchSnap,
            by: actor,
          });
        }

        issueDocument(
          tx,
          db,
          serial,
          {
            source: refundDocumentSource(order, orderSnap.data() ?? {}, input, plan, body),
            context: documents,
            nowMillis,
            voids: plan.voids,
            amount: plan.amount,
          },
          actor,
        );

        return {
          orderId: order.id,
          refundId: plan.refundId,
          method: plan.method,
          amount: plan.amount,
          refundedTotal: plan.refundedTotal,
          fullyRefunded: plan.fullyRefunded,
          orderState: plan.nextOrderState ?? order.state,
          paymentStatus: plan.paymentStatus,
          jarsReturned: plan.jarsReturned,
          jarsHeldBackBecause: plan.jarsHeldBackBecause,
          documentKind: plan.documentKind,
          documentNumber: serial.number,
          documentItemised: body.itemised,
          refusalReason: plan.refusalReason,
        };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
      );
    } catch (error) {
      // The `tx.create` on `refunds/{id}` is the idempotency key: a duplicate
      // Razorpay refund id, a UPI reference typed twice, or a cash refund that
      // loses the `cash-<order>-<n>` race all come back as Firestore's
      // "document already exists". The refusal is correct and nothing is
      // half-written, but left unhandled it reaches the Owner as a 500 with no
      // sentence on it, and the panel asks him to read a reason that is not
      // there. So it is caught here and answered in words.
      if (documentAlreadyExists(error)) {
        throw new HttpsError("failed-precondition", ALREADY_RECORDED);
      }
      throw error;
    }
  },
);

/**
 * What the Owner reads when the same refund is offered twice. Admin wording,
 * and it names the two things he can look at rather than just saying no.
 */
export const ALREADY_RECORDED =
  "This refund is already recorded. Check the refunds listed on this order, and the Razorpay refund id or UPI reference you typed.";

/** Firestore's "document already exists" is gRPC status 6. */
function documentAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 6;
}

/* -------------------------------------------------------------------------- */
/* markOrderRefusal (D65)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * D65: "the refusal reason is recorded on the order, may be set when the
 * refund is recorded, and **may be added afterwards**", because an order
 * refunded first and understood later must still be markable.
 *
 * It writes no money and moves no count: the jar went back at the refund
 * whatever the mark says. All it changes is whether that person's per-person
 * allowance for the batch counts as spent, which `orderSpentAllowance` reads. A
 * `null` reason takes the mark off again, which has to be possible: leaving a
 * mark made in error on the order would lock that customer out of the batch
 * for its life.
 */
export const markOrderRefusal = onCall(
  {
    invoker: "public",
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    enforceAppCheck: false,
  },
  async (request) => {
    const caller = { uid: request.auth?.uid ?? null, role: request.auth?.token?.role };
    const owner = checkOwner(caller);
    if (!owner.ok) throw new HttpsError(owner.code, owner.message);

    const parsed = parseMarkRefusalRequest(request.data ?? {});
    if (!parsed.ok) throw new HttpsError(parsed.code, parsed.message);
    const input = parsed.value;
    if (!isOrderRef(input.orderId)) {
      throw new HttpsError(
        "invalid-argument",
        'An order is named by its reference, for example "o-7f3a2c".',
      );
    }

    const db = getFirestore(getAdminApp());
    const actor = owner.uid;

    return db.runTransaction(async (tx: Transaction) => {
      const orderRef = db.collection(ORDERS).doc(input.orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) {
        throw new HttpsError("not-found", "There is no order with that reference.");
      }

      const decision = planMarkRefusal(input, { refund: orderSnap.get("refund") });
      if (!decision.ok) throw new HttpsError(decision.code, decision.message);

      const refusal =
        decision.value.reason === null
          ? null
          : { reason: decision.value.reason, at: FieldValue.serverTimestamp(), by: actor };

      tx.set(
        orderRef,
        {
          refund: { refusal },
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor,
        },
        { merge: true },
      );
      writeAudit(tx, db, {
        object: `${ORDERS}/${input.orderId}`,
        action: decision.value.reason === null ? "refusalMarkCleared" : "refusalMarked",
        patch: { refusalReason: decision.value.reason },
        beforeSnap: orderSnap,
        by: actor,
      });

      return {
        orderId: input.orderId,
        refusalReason: decision.value.reason,
        /**
         * What the mark means in one word, so the screen never has to work it
         * out for itself: a marked refund keeps the customer's per-person
         * allowance spent, an unmarked full refund hands it back.
         */
        allowanceSpent: decision.value.reason !== null,
      };
    });
  },
);

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** The order document as the pure planner reads it. Every field defended. */
export function refundableOrderFrom(
  id: string,
  raw: Record<string, unknown>,
  document: { readonly documentNumber: string | null; readonly documentKind: RefundableOrder["documentKind"] },
): RefundableOrder {
  const payment = asRecord(raw.payment);
  const lines: RefundableLine[] = (Array.isArray(raw.lines) ? raw.lines : []).map((line) => {
    const l = asRecord(line);
    return {
      batchRef: typeof l.batchRef === "string" && l.batchRef !== "" ? l.batchRef : null,
      qty: num(l.qty),
      jarNumbers: Array.isArray(l.jarNumbers)
        ? (l.jarNumbers as unknown[]).filter((n): n is number => typeof n === "number")
        : [],
      productSlug: str(l.productSlug),
      customDescription:
        typeof l.customDescription === "string" && l.customDescription !== ""
          ? l.customDescription
          : null,
      unitPrice: num(l.unitPrice),
    };
  });

  return {
    id,
    state: typeof raw.state === "string" ? raw.state : "",
    customerPhone: typeof raw.customerPhone === "string" ? raw.customerPhone : "",
    lines,
    paidAmount: num(payment.amount),
    refundedSoFar: num(payment.refundedAmount),
    paymentMethod: typeof payment.method === "string" ? payment.method : "",
    paidAt: raw.paidAt,
    refund: raw.refund,
    documentNumber: document.documentNumber,
    documentKind: document.documentKind,
  };
}

/**
 * The patch the order takes. Only a **full** refund moves the order's own
 * state (brief §9.1's `refunded`); a partial refund leaves it where it was so
 * the Kitchen keeps packing a jar the customer is still owed, and says what
 * happened on `payment.status` instead (see `refundPlan.ts`).
 */
function orderPatchFor(
  plan: RefundPlan,
  before: {
    readonly jarsReturned: number;
    readonly documentNumbers: readonly string[];
    readonly gatewayFeeUnreturned: number | null;
  },
  documentNumber: string,
  refusalReason: string | null,
  actor: string,
): Record<string, unknown> {
  const refusal =
    refusalReason !== null
      ? { reason: refusalReason, at: FieldValue.serverTimestamp(), by: actor }
      : undefined;

  const patch: Record<string, unknown> = {
    payment: { status: plan.paymentStatus, refundedAmount: plan.refundedTotal },
    refund: {
      totalPaise: plan.refundedTotal,
      fullyRefunded: plan.fullyRefunded,
      jarsReturned: before.jarsReturned + plan.jarsReturned,
      // Accumulated, never overwritten: a later refund that names no fee must
      // not turn a recorded cost into "nobody has said". See
      // `accumulatedGatewayFee`.
      gatewayFeeUnreturned: accumulatedGatewayFee(
        before.gatewayFeeUnreturned,
        plan.gatewayFeeUnreturned,
      ),
      documentNumbers: [...before.documentNumbers, documentNumber],
      lastMethod: plan.method,
      lastRecordedAt: FieldValue.serverTimestamp(),
      lastRecordedBy: actor,
      // The to-do marker comes off when there is nothing left to record: this
      // **is** the gateway refund it named, or the order is now refunded in
      // full, so no further refund can be recorded on it whatever the gateway
      // says next. Without the second case a refund recorded as cash and then
      // confirmed by the gateway left a marker on a fully refunded order that
      // no screen could clear, because the form that clears it is hidden once
      // the order is fully refunded.
      ...(plan.clearsGatewayPending || plan.fullyRefunded ? { gatewayPending: null } : {}),
      // Set only when it was typed with the refund. Leaving the key out
      // preserves a mark added earlier by `markOrderRefusal` (the patch is a
      // merging set, so an omitted key is not cleared).
      ...(refusal === undefined ? {} : { refusal }),
    },
  };
  if (plan.nextOrderState !== null) patch.state = plan.nextOrderState;
  return patch;
}

/**
 * The product names, HSN codes and printed batch numbers the note's lines need,
 * read inside the caller's transaction. Distinct slugs and refs only, so a
 * two-line order of the same product is two lines and one read.
 */
async function readDocumentNaming(
  tx: Transaction,
  db: ReturnType<typeof getFirestore>,
  lines: readonly RefundableLine[],
): Promise<{
  readonly productNames: ReadonlyMap<string, string>;
  readonly hsnBySlug: ReadonlyMap<string, string | null>;
  readonly batchNos: ReadonlyMap<string, string | null>;
}> {
  const productNames = new Map<string, string>();
  const hsnBySlug = new Map<string, string | null>();
  const batchNos = new Map<string, string | null>();

  for (const slug of new Set(lines.map((line) => line.productSlug).filter((slug) => slug !== ""))) {
    const snap = await tx.get(db.collection(PRODUCTS).doc(slug));
    if (!snap.exists) continue;
    productNames.set(slug, str(snap.get("name")));
    hsnBySlug.set(slug, str(snap.get("hsn")) || null);
  }
  for (const ref of new Set(
    lines.map((line) => line.batchRef).filter((ref): ref is string => ref !== null),
  )) {
    const snap = await tx.get(db.collection(BATCHES).doc(ref));
    // D21c: null while the batch has no printed number, which is not an error.
    batchNos.set(ref, snap.exists ? str(snap.get("batchNo")) || null : null);
  }

  return { productNames, hsnBySlug, batchNos };
}

/** Brief §13.2's line list, for a refund note or a credit note. */
function refundDocumentSource(
  order: RefundableOrder,
  raw: Record<string, unknown>,
  input: { readonly method: string; readonly reference: string | null; readonly razorpayRefundId: string | null },
  plan: RefundPlan,
  body: RefundDocumentBody,
): DocumentSource {
  const contact = asRecord(raw.deliveryContact);
  const payment = asRecord(raw.payment);

  return {
    orderId: typeof raw.number === "string" && raw.number !== "" ? raw.number : order.id,
    channel: typeof raw.channel === "string" ? raw.channel : "",
    customerName: str(contact.name),
    customerPhone: order.customerPhone,
    customerEmail: null,
    deliveryLines: Array.isArray(contact.lines) ? (contact.lines as unknown[]).map(str) : [],
    placeOfSupply: str(raw.placeOfSupply),
    // The goods column and the money under it come from one place, so they
    // cannot disagree: `planRefundDocumentBody` is what makes the arithmetic
    // close against `amount: plan.amount`.
    lines: body.lines,
    shippingFee: body.shippingFee,
    discount: body.discount,
    discountReason: body.discountReason,
    // What the money went back *by*, which is what a person reading the note
    // needs, not how it originally came in.
    paymentMethod: str(payment.method),
    paymentStatus: plan.paymentStatus,
    paymentReference: input.razorpayRefundId ?? input.reference,
  };
}

/** The reason typed with a discount at the counter, or null. */
function discountReasonOf(value: unknown): string | null {
  const reason = asRecord(value).reason;
  return typeof reason === "string" && reason !== "" ? reason : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
