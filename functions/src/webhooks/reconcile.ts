/**
 * The 15-minute reconciliation: a payment that happened with no webhook.
 *
 * Brief §21.1, the third row: "Webhook never arrives → Reconciliation every
 * 15 minutes for pending orders asks Razorpay directly." A webhook is one
 * HTTP request from somebody else's server to ours, and one HTTP request is
 * a thing that gets lost. A customer whose money left their account and
 * whose order still says "held" is the worst state this system can be in,
 * because fifteen minutes later the hold lapses and their jar goes back on
 * sale. So nothing waits on the webhook arriving.
 *
 * It does two passes, cheapest first.
 *
 * 1. **Events we have but did not finish.** A delivery that was recorded and
 *    then failed to reach the task queue, or whose task died five times, is
 *    sitting in `webhookEvents` with `processedAt: null`. Those are worked
 *    off first: no network call, and the body is already on disk.
 * 2. **Orders still pending.** Every order still `held` or `awaitingPayment`
 *    with a gateway order behind it is asked about directly. A captured
 *    payment found this way goes through exactly the same
 *    `applyCapturedPayment` the webhook uses, so there is one code path that
 *    can turn a hold into a sale rather than two that have to agree, and the
 *    `already` branch inside it means a webhook landing in the same minute
 *    costs one read.
 *
 * **The daily settlement pull is not here.** It is fast-follow M3.6b (D29).
 *
 * The gateway call is an argument rather than an import, which is what lets
 * the emulator suite prove the recovery end to end: `api.razorpay.com` is
 * never reachable from a test, and a job whose only proof is "it would have
 * worked against the real thing" is not proven at all.
 */

import { type Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import {
  fetchRazorpayPaymentsForOrder,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  type RazorpayPaymentView,
} from "../orders/razorpay";
import { ORDERS } from "../orders/store";
import { applyCapturedPayment } from "./capture";
import type { CapturedPayment } from "./razorpayEvents";
import { processWebhookEvent, WEBHOOK_EVENTS } from "./razorpayWebhook";

/** The trail says the job did it, not the gateway. */
export const RECONCILE_ACTOR = "reconcile";

/** The two order states that mean "somebody may be paying right now". */
const PENDING_ORDER_STATES = ["held", "awaitingPayment"];

/** A home kitchen has a handful of live checkouts, never hundreds. */
const MAX_ORDERS_PER_RUN = 100;
/** Unfinished events are rare; a pile of them is a problem to look at. */
const MAX_EVENTS_PER_RUN = 50;

/**
 * How far back a pending order is still asked about. A checkout abandoned
 * last month is not going to be paid for now, and asking the gateway about
 * it every quarter of an hour forever is a bill with no purpose.
 */
const PENDING_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * How long an unprocessed event is left alone before the job picks it up:
 * long enough that a task still working through the queue is not raced, short
 * enough that a lost enqueue costs one cycle.
 */
const EVENT_GRACE_MS = 2 * 60_000;

export interface ReconcileReport {
  readonly eventsFinished: number;
  readonly ordersChecked: number;
  readonly paymentsFound: number;
  readonly ordersPaid: number;
  readonly concerns: number;
}

export interface ReconcileDeps {
  /** Asks the gateway what it holds against one of our gateway orders. */
  readonly fetchPayments: (razorpayOrderId: string) => Promise<readonly RazorpayPaymentView[]>;
  readonly processEvent: (db: Firestore, docId: string) => Promise<{ readonly outcome: string }>;
}

const LIVE: ReconcileDeps = {
  fetchPayments: (id) => fetchRazorpayPaymentsForOrder(id),
  processEvent: processWebhookEvent,
};

/**
 * One pass. Exported and taking its clock and its gateway as arguments so
 * the emulator test can run it directly, the shape `sweepExpiredHolds` has.
 */
export async function reconcilePendingPayments(
  db: Firestore,
  nowMillis: number = Date.now(),
  deps: ReconcileDeps = LIVE,
): Promise<ReconcileReport> {
  let eventsFinished = 0;
  let ordersChecked = 0;
  let paymentsFound = 0;
  let ordersPaid = 0;
  let concerns = 0;

  /* ---- pass 1: events recorded but never finished -------------------- */

  const unfinished = await db
    .collection(WEBHOOK_EVENTS)
    .where("processedAt", "==", null)
    .limit(MAX_EVENTS_PER_RUN)
    .get();
  for (const doc of unfinished.docs) {
    const receivedAt = doc.get("receivedAt");
    const receivedMillis = receivedAt instanceof Timestamp ? receivedAt.toMillis() : 0;
    if (receivedMillis > nowMillis - EVENT_GRACE_MS) continue;
    const done = await deps.processEvent(db, doc.id);
    if (done.outcome !== "already-processed" && done.outcome !== "no-such-event") {
      eventsFinished += 1;
    }
  }

  /* ---- pass 2: pending orders, asked about directly ------------------ */

  const pending = await db
    .collection(ORDERS)
    .where("state", "in", PENDING_ORDER_STATES)
    .limit(MAX_ORDERS_PER_RUN)
    .get();

  for (const doc of pending.docs) {
    const createdAt = doc.get("createdAt");
    const createdMillis = createdAt instanceof Timestamp ? createdAt.toMillis() : nowMillis;
    if (createdMillis < nowMillis - PENDING_WINDOW_MS) continue;

    const payment = asRecord(doc.get("payment"));
    // Cash and UPI to account are marked paid by a person, not by a gateway,
    // and an order with no gateway order behind it has nothing to ask about.
    const razorpayOrderId = str(asRecord(payment.razorpayIds).orderId);
    if (razorpayOrderId === "") continue;
    if (str(payment.status) !== "created") continue;

    ordersChecked += 1;

    const payments = await deps.fetchPayments(razorpayOrderId);
    const captured = payments.find((p) => p.status === "captured");
    if (captured === undefined) continue;
    paymentsFound += 1;

    const capture: CapturedPayment = {
      paymentId: captured.id,
      razorpayOrderId: captured.orderId || razorpayOrderId,
      amountPaise: captured.amountPaise,
      // Our own id off the gateway's notes when it is there, and this
      // order's own id when it is not: the payment was found *through* this
      // order's gateway id, so there is no guessing in the fallback.
      orderId: str(captured.notes.lailark_order_id) || doc.id,
      method: captured.method,
    };

    const applied = await applyCapturedPayment(db, capture, RECONCILE_ACTOR);
    if (applied.outcome === "applied" || applied.outcome === "applied-no-document") ordersPaid += 1;
    if (applied.concernId !== null) concerns += 1;
    console.log("reconcile: payment recovered with no webhook", {
      orderId: doc.id,
      paymentId: captured.id,
      outcome: applied.outcome,
    });
  }

  return { eventsFinished, ordersChecked, paymentsFound, ordersPaid, concerns };
}

/**
 * Every fifteen minutes, which is the hold's own length: a payment that
 * happened with no webhook is found inside the window its jars are still
 * reserved in, rather than after they have gone back on sale.
 */
export const reconcilePayments = onSchedule(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    schedule: "every 15 minutes",
    timeZone: "Asia/Kolkata",
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
    retryCount: 0,
  },
  async () => {
    const report = await reconcilePendingPayments(getFirestore(getAdminApp()));
    if (report.eventsFinished > 0 || report.paymentsFound > 0) {
      console.log("reconcilePayments", report);
    }
  },
);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
