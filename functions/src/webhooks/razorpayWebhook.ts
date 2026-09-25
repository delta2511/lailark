/**
 * The Razorpay webhook: an HTTP function at its own function URL, and the
 * queued task that does the work.
 *
 * Brief §19.2, the Webhooks row, decides this shape word for word:
 * "HTTP functions called directly at their function URLs, not through
 * Hosting | Verify signature, write `webhookEvents/{id}`, reply 200 at once,
 * do the work in a queued task." So there is no Hosting rewrite for this
 * path: Razorpay is given the function's own `run.app` URL. A rewrite would
 * put the CDN between the gateway and the signature check for no gain, and
 * the customer site's `/api/**` rewrite is for the site, not for gateways.
 *
 * ## Why the work is not done in the request
 *
 * A capture opens a transaction on the batch document, issues a numbered
 * document and may draw nothing at all if a concern is the right answer.
 * That is tens of milliseconds on a good day and seconds behind a queue of
 * counter sales on a busy one. A gateway that does not get its 200 quickly
 * retries, and a retry that overlaps the first attempt is the kind of thing
 * that sells one jar twice. So the request does three cheap things and
 * stops: verify, create the event document, enqueue.
 *
 * ## Two locks, not one
 *
 * The `webhookEvents/{source-eventId}` create is `create`, which fails if
 * the document exists, so a redelivery is refused at the door and never
 * reaches the queue: that is the dedupe CLAUDE.md §3 asks for. Behind it,
 * {@link processWebhookEvent} refuses to act on an event it has already
 * stamped `processedAt`, and `applyCapturedPayment` refuses an order whose
 * payment has already moved. Three independent refusals, because "the same
 * webhook twice changes nothing" has to survive a task that is retried after
 * it committed but before it acknowledged.
 *
 * ## Nothing is sent to anybody
 *
 * D32: every customer message at launch is manual. The bill is issued; the
 * sending of it is a person's decision on a screen.
 */

import { FieldValue, type Firestore, getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { onRequest } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";

import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import {
  RAZORPAY_WEBHOOK_SECRET,
  RazorpayWebhookNotConfigured,
  razorpayWebhookSecret,
} from "../orders/razorpay";
import { applyCapturedPayment } from "./capture";
import { matchRefundToOrder } from "./refund";
import {
  EVENT_ID_HEADER,
  parseRazorpayWebhook,
  SIGNATURE_HEADER,
  verifyRazorpaySignature,
  WEBHOOK_SOURCE,
  webhookEventDocId,
} from "./razorpayEvents";

export const WEBHOOK_EVENTS = "webhookEvents";

/** The queued function the HTTP handler hands each new event to. */
export const WORKER_NAME = "razorpayWebhookWorker";

/**
 * A gateway can deliver a burst, and every delivery is a document create.
 * Higher than the default three, and still bounded, because the hard rule is
 * that every function sets a ceiling (CLAUDE.md §3).
 */
const WEBHOOK_MAX_INSTANCES = 10;

/** Razorpay's body is small; anything far larger is not one of its events. */
const MAX_BODY_BYTES = 1_000_000;

/* -------------------------------------------------------------------------- */
/* The request                                                                */
/* -------------------------------------------------------------------------- */

export const razorpayWebhook = onRequest(
  {
    region: REGION,
    maxInstances: WEBHOOK_MAX_INSTANCES,
    secrets: [RAZORPAY_WEBHOOK_SECRET],
    // A gateway posts server to server: there is no browser and no origin to
    // allow, and an open CORS policy would only invite one.
    cors: false,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("POST only");
      return;
    }

    const raw: Buffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
    if (raw.length > MAX_BODY_BYTES) {
      res.status(413).send("too large");
      return;
    }

    let secret: string;
    try {
      secret = razorpayWebhookSecret();
    } catch (error) {
      if (error instanceof RazorpayWebhookNotConfigured) {
        // 500, not 200: an unverifiable delivery must not be swallowed. A
        // non-2xx makes Razorpay retry, so the events that arrive before the
        // secret is set are not lost.
        console.error("razorpayWebhook: no webhook secret configured");
        res.status(500).send("not configured");
        return;
      }
      throw error;
    }

    if (!verifyRazorpaySignature(raw, headerOf(req.headers[SIGNATURE_HEADER]), secret)) {
      // 400 and nothing written. Anyone can POST at a public function URL,
      // so an unsigned body is not an event and leaves no trace.
      console.warn("razorpayWebhook: bad signature");
      res.status(400).send("bad signature");
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).send("bad body");
      return;
    }

    const { docId, eventId } = webhookEventDocId(headerOf(req.headers[EVENT_ID_HEADER]), raw);
    const parsed = parseRazorpayWebhook(body);
    const db = getFirestore(getAdminApp());

    try {
      // The must-not-exist create of CLAUDE.md §3. This is the dedupe: a
      // redelivery lands here, fails, and is answered 200 without a second
      // look at any order.
      await db
        .collection(WEBHOOK_EVENTS)
        .doc(docId)
        .create({
          source: WEBHOOK_SOURCE,
          eventId,
          type: parsed.type,
          payload: body,
          receivedAt: FieldValue.serverTimestamp(),
          processedAt: null,
          outcome: null,
          orderId: null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: WEBHOOK_SOURCE,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: WEBHOOK_SOURCE,
        });
    } catch (error) {
      if (alreadyExists(error)) {
        res.status(200).send("duplicate");
        return;
      }
      // Firestore refused for some other reason. 500 so the gateway retries.
      console.error("razorpayWebhook: could not record the event", { docId, error });
      res.status(500).send("not recorded");
      return;
    }

    try {
      await enqueue(docId);
    } catch (error) {
      // The event is safely on disk with `processedAt: null`, and the
      // 15-minute reconciliation sweeps exactly those (see ./reconcile.ts),
      // so a queue that is down delays the work rather than losing it. 200
      // is therefore honest: we have the event.
      console.error("razorpayWebhook: could not enqueue", { docId, error });
    }

    res.status(200).send("ok");
  },
);

/** The queue takes the document id, never the body: the body is on disk. */
async function enqueue(docId: string): Promise<void> {
  await getFunctions(getAdminApp())
    .taskQueue(`locations/${REGION}/functions/${WORKER_NAME}`)
    .enqueue({ docId });
}

/* -------------------------------------------------------------------------- */
/* The queued worker                                                          */
/* -------------------------------------------------------------------------- */

export const razorpayWebhookWorker = onTaskDispatched(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    // One at a time. Two captures on one batch would only contend on the
    // batch document and retry, but money work that queues is money work
    // nobody has to reason about.
    rateLimits: { maxConcurrentDispatches: 1 },
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 5 },
  },
  async (request) => {
    const docId = String((request.data as { docId?: unknown } | undefined)?.docId ?? "");
    if (docId === "") return;
    const outcome = await processWebhookEvent(getFirestore(getAdminApp()), docId);
    console.log("razorpayWebhookWorker", { docId, outcome });
  },
);

/* -------------------------------------------------------------------------- */
/* The work itself                                                            */
/* -------------------------------------------------------------------------- */

export interface ProcessResult {
  readonly outcome: string;
  readonly orderId: string | null;
}

/**
 * Does whatever one stored event asks for, exactly once.
 *
 * Exported and taking its database as an argument so the tests and the
 * reconciliation's backstop can drive it directly, the same shape
 * `sweepExpiredHolds` has.
 *
 * The `processedAt` stamp is written **after** the work, not before. A task
 * that dies mid-capture is therefore retried, and the retry is harmless
 * because every step underneath is idempotent. Stamping first would be the
 * other trade: never repeated, sometimes never done, and a payment that is
 * never applied is a customer who paid and got nothing.
 */
export async function processWebhookEvent(
  db: Firestore,
  docId: string,
): Promise<ProcessResult> {
  const ref = db.collection(WEBHOOK_EVENTS).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return { outcome: "no-such-event", orderId: null };
  if (snap.get("processedAt") != null) return { outcome: "already-processed", orderId: null };

  const parsed = parseRazorpayWebhook(snap.get("payload"));

  let outcome = "ignored";
  let orderId: string | null = null;

  if (parsed.capture !== null) {
    const applied = await applyCapturedPayment(db, parsed.capture, WEBHOOK_SOURCE);
    outcome = applied.outcome;
    orderId = applied.orderId === "" ? null : applied.orderId;
  } else if (parsed.refund !== null) {
    const matched = await matchRefundToOrder(db, parsed.refund, WEBHOOK_SOURCE);
    outcome = matched.orderId === null ? "refund-unmatched" : `refund-matched:${matched.matchedBy}`;
    orderId = matched.orderId;
  }

  await ref.set(
    {
      processedAt: FieldValue.serverTimestamp(),
      outcome,
      orderId,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: WEBHOOK_SOURCE,
    },
    { merge: true },
  );

  return { outcome, orderId };
}

/** Firestore's "document already exists" is gRPC status 6. */
function alreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 6;
}

function headerOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
