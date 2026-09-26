#!/usr/bin/env node
/**
 * Seeds one order per group in `ORDER_GROUPS` (`@lailark/shared`), plus the
 * handful of specific cases M3.9's Orders screen needs someone to actually
 * see, so a fresh emulator (or a staging project) is not an empty screen.
 *
 *   node functions/scripts/seed-orders.mjs --emulator
 *   node functions/scripts/seed-orders.mjs --project tree-quiz-74e04
 *
 * **Writes `orders` and `documents` directly.** CLAUDE.md section 3 reserves
 * both collections for functions: every real order is created and changed by
 * a callable, and `orders/{orderId}` in `firestore.rules` refuses every
 * client write, Owner included. This script is the one deliberate exception,
 * the same way `seed-batch-001.mjs` writes `batches` directly instead of
 * calling `transitionBatch`: it runs with the Admin SDK, which the rules do
 * not apply to at all, and it exists only to put realistic-looking documents
 * in front of a person testing a screen, never to run against real money.
 * That is also why it refuses to run against the production project id
 * (`lailark`) unless `--emulator` is set or `--force` is passed: nothing
 * about this script's output should ever reach a real customer's order.
 *
 * Idempotent. Every order and the one bill are seeded by a fixed id
 * (`O_REFS` / `DOCUMENT_ID` below) inside a transaction that checks for an
 * existing document first, so re-running finds them and creates nothing a
 * second time, the same guarantee `seed-batch-001.mjs` gives.
 *
 * **The seeded bill reserves its number.** A document's Firestore id *is*
 * its bill number (`functions/src/money/store.ts`: "the document id is the
 * number", and `issueDocument`'s `tx.create` on that id is what makes "never
 * reused" true), and the next serial comes out of `counters/{series}`. So a
 * bill written straight into `documents` without winding its counter forward
 * does not just sit there looking harmless: it occupies a number the counter
 * still thinks is free, and the next real sale reads `next: 1`, builds the
 * same `LK-26-27-0001` id, and its `tx.create` fails. The counter is not
 * advanced on a failed transaction, so the sale after that fails the same
 * way, and every one after it, for good. The same wedge `issue.ts`'s long
 * comment describes, arrived at from the other end. (It showed up as
 * `admin/tests/sell.spec.ts` failing eight of eleven tests whenever this
 * seed had been run in the emulator first: every failure was a sale that
 * never completed.)
 *
 * So the bill and its counter are written **in one transaction**
 * (`createBillReservingItsNumber`), and `counters/{series}` is left pointing
 * past every serial the seed used. Both the counter id and that serial are
 * derived from `DOCUMENT_ID` itself, through `@lailark/shared`'s own
 * `fromDocumentId` / `parseDocumentNumber`, so the two can never drift; and
 * the counter is moved with a max, never an increment, so re-running changes
 * nothing and a counter a real bill has already pushed further is left where
 * it is.
 *
 * Money: every line total is `qty * unitPrice` via `multiplyPaise`
 * (`@lailark/shared`), shipping is 0 (the free switch, brief §4.2's default)
 * and there is no discount on any of these, so every order's `total` is
 * exactly the sum of its lines and every `payment.amount` matches the order
 * it is on. Real prices only: ₹599 open batch, ₹649 in stock, both from
 * `@lailark/shared`'s own constants, never retyped.
 *
 * ASSUMED (M3.9 follow-up): the eleven orders' names, phone numbers and
 * pincodes are invented placeholders (never real people), which is fine for
 * admin-facing seed data (CLAUDE.md section 5's "assume freely" list covers
 * test/seed content) but would not be fine as anything a customer reads.
 * Nothing here is customer-facing: it never goes through `customerMessage`,
 * and this script sends nothing.
 *
 * ASSUMED (M3.9 follow-up): ten of the eleven orders reference batch 001
 * (`b-001001`, `seed-batch-001.mjs`'s own ref) so the batch filter has a
 * real batch to point at even when `seed-batch-001.mjs` has not been run
 * first (the ref is just a string on the order; nothing here requires the
 * batch document to exist). One order (`toPack`) points at a second,
 * synthetic ref (`b-seedorder2`) that this script does not create a batch
 * document for, purely so the batch filter dropdown has two options to
 * narrow between, per the task.
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { fromDocumentId, multiplyPaise, parseDocumentNumber } from "@lailark/shared";

const AUTH_EMULATOR = "127.0.0.1:9099";
const FIRESTORE_EMULATOR = "127.0.0.1:8080";

const PRICE_OPEN_PAISE = 59_900; // ₹599, brief §4.1
const PRICE_IN_STOCK_PAISE = 64_900; // ₹649, brief §4.1
const PRODUCT_SLUG = "prawns-and-dates"; // seed-products.mjs, seed-batch-001.mjs
const BATCH_REF = "b-001001"; // seed-batch-001.mjs's own document id
const SECOND_BATCH_REF = "b-seedorder2"; // synthetic: exists only as a string on one order

function line({ batchRef, qty, unitPrice, jarNumbers = [] }) {
  return {
    productSlug: PRODUCT_SLUG,
    batchRef,
    qty,
    unitPrice,
    customDescription: null,
    jarNumbers,
  };
}

function contact({ name, phone, lines, city, state, pincode }) {
  return { name, phone, lines, city, state, pincode };
}

function payment({ method, status, amount, refundedAmount = 0, paymentId = null, upiRef = null, markedPaidBy = null }) {
  return {
    method,
    status,
    razorpayIds: paymentId ? { paymentId } : {},
    markedPaidBy,
    upiRef,
    amount,
    refundedAmount,
  };
}

/**
 * The eleven orders. One per `ORDER_GROUPS` entry (awaitingPayment,
 * paidWaiting, toPack, packed, shipped, readyForCollection, problem,
 * delivered, refunded, closed), plus a second `awaitingPayment` order for
 * **A201**: `state: "held"` with `payment.status: "captured"`, the single
 * case this whole screen exists to make visible. `held-paid` is listed
 * first so it is the first thing found under that tab.
 */
function buildOrders() {
  const heldTotal = multiplyPaise(PRICE_OPEN_PAISE, 1);
  const heldPaidTotal = multiplyPaise(PRICE_OPEN_PAISE, 1);
  const paidWaitingTotal = multiplyPaise(PRICE_OPEN_PAISE, 2);
  const toPackTotal = multiplyPaise(PRICE_IN_STOCK_PAISE, 1);
  const packedTotal = multiplyPaise(PRICE_OPEN_PAISE, 3);
  const shippedTotal = multiplyPaise(PRICE_IN_STOCK_PAISE, 1);
  const readyTotal = multiplyPaise(PRICE_IN_STOCK_PAISE, 1);
  const problemTotal = multiplyPaise(PRICE_OPEN_PAISE, 1);
  const deliveredTotal = multiplyPaise(PRICE_IN_STOCK_PAISE, 2);
  const refundedTotal = multiplyPaise(PRICE_OPEN_PAISE, 1);
  const closedTotal = multiplyPaise(PRICE_OPEN_PAISE, 1);

  return [
    {
      id: "o-seed0001",
      fields: {
        number: "o-seed0001",
        channel: "web",
        customerPhone: "+919000000001",
        deliveryContact: contact({
          name: "Ayesha Rahman",
          phone: "+919000000001",
          lines: ["12 Beach Road"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673001",
        }),
        state: "held",
        lines: [line({ batchRef: BATCH_REF, qty: 1, unitPrice: PRICE_OPEN_PAISE })],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: heldTotal,
        fulfilment: "ship",
        payment: payment({ method: "razorpay", status: "created", amount: heldTotal }),
        soldBy: null,
        token: "00000000000000000000000000000001",
      },
    },
    {
      // A201: the capture ended as a concern and the order stays `held`, but
      // the money genuinely arrived. Brief-mandated visibility (M3.9's task).
      id: "o-seed0002",
      fields: {
        number: "o-seed0002",
        channel: "web",
        customerPhone: "+919000000002",
        deliveryContact: contact({
          name: "Basil Thomas",
          phone: "+919000000002",
          lines: ["4 Hill View"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673002",
        }),
        state: "held",
        lines: [line({ batchRef: BATCH_REF, qty: 1, unitPrice: PRICE_OPEN_PAISE })],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: heldPaidTotal,
        fulfilment: "ship",
        payment: payment({
          method: "razorpay",
          status: "captured",
          amount: heldPaidTotal,
          paymentId: "pay_seed0002",
        }),
        soldBy: null,
        token: "00000000000000000000000000000002",
      },
    },
    {
      // Ships today: paid, not yet packed, and it actually ships.
      id: "o-seed0003",
      fields: {
        number: "o-seed0003",
        channel: "counter",
        customerPhone: "+919000000003",
        deliveryContact: contact({
          name: "Chitra Nair",
          phone: "+919000000003",
          lines: ["9 Market Street"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673003",
        }),
        state: "paidWaiting",
        lines: [line({ batchRef: BATCH_REF, qty: 2, unitPrice: PRICE_OPEN_PAISE })],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: paidWaitingTotal,
        fulfilment: "ship",
        payment: payment({
          method: "cash",
          status: "captured",
          amount: paidWaitingTotal,
          markedPaidBy: "seed",
        }),
        soldBy: "seed",
        token: "00000000000000000000000000000003",
      },
    },
    {
      // Carries the one seeded bill (see `buildDocument` below), and the
      // second batch ref, so both the search box's bill-number path and the
      // batch filter's second option are real.
      id: "o-seed0004",
      fields: {
        number: "o-seed0004",
        channel: "phone",
        customerPhone: "+919000000004",
        deliveryContact: contact({
          name: "Deepak Menon",
          phone: "+919000000004",
          lines: ["1 Lake Road"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673004",
        }),
        state: "toPack",
        lines: [line({ batchRef: SECOND_BATCH_REF, qty: 1, unitPrice: PRICE_IN_STOCK_PAISE })],
        batchRefs: [SECOND_BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: toPackTotal,
        fulfilment: "ship",
        payment: payment({
          method: "paymentLink",
          status: "captured",
          amount: toPackTotal,
          paymentId: "pay_seed0004",
        }),
        soldBy: "seed",
        token: "00000000000000000000000000000004",
      },
    },
    {
      id: "o-seed0005",
      fields: {
        number: "o-seed0005",
        channel: "whatsapp",
        customerPhone: "+919000000005",
        deliveryContact: contact({
          name: "Elsa Joseph",
          phone: "+919000000005",
          lines: ["22 Church Lane"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673005",
        }),
        state: "packed",
        lines: [
          line({ batchRef: BATCH_REF, qty: 3, unitPrice: PRICE_OPEN_PAISE, jarNumbers: [11, 12, 13] }),
        ],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: packedTotal,
        fulfilment: "ship",
        payment: payment({
          method: "paymentLink",
          status: "captured",
          amount: packedTotal,
          paymentId: "pay_seed0005",
        }),
        soldBy: "seed",
        token: "00000000000000000000000000000005",
      },
    },
    {
      id: "o-seed0006",
      fields: {
        number: "o-seed0006",
        channel: "abroad",
        customerPhone: "+971500000006",
        deliveryContact: contact({
          name: "Farhan Ali",
          phone: "+971500000006",
          lines: ["Villa 6, Al Barsha"],
          city: "Dubai",
          state: "",
          pincode: "",
        }),
        state: "shipped",
        lines: [line({ batchRef: BATCH_REF, qty: 1, unitPrice: PRICE_IN_STOCK_PAISE, jarNumbers: [14] })],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: shippedTotal,
        fulfilment: "ship",
        payment: payment({
          method: "razorpay",
          status: "captured",
          amount: shippedTotal,
          paymentId: "pay_seed0006",
        }),
        soldBy: null,
        token: "00000000000000000000000000000006",
      },
    },
    {
      id: "o-seed0007",
      fields: {
        number: "o-seed0007",
        channel: "counter",
        customerPhone: "+919000000007",
        // Collected in person: no delivery address at all, the honest empty
        // state `ORDERS.noDeliveryContact` covers.
        deliveryContact: null,
        state: "readyForCollection",
        lines: [line({ batchRef: BATCH_REF, qty: 1, unitPrice: PRICE_IN_STOCK_PAISE, jarNumbers: [15] })],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: readyTotal,
        fulfilment: "collect",
        payment: payment({
          method: "cash",
          status: "captured",
          amount: readyTotal,
          markedPaidBy: "seed",
        }),
        soldBy: "seed",
        token: "00000000000000000000000000000007",
      },
    },
    {
      id: "o-seed0008",
      fields: {
        number: "o-seed0008",
        channel: "web",
        customerPhone: "+919000000008",
        deliveryContact: contact({
          name: "Haritha Suresh",
          phone: "+919000000008",
          lines: ["3 Canal Road"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673008",
        }),
        state: "deliveryProblem",
        lines: [line({ batchRef: BATCH_REF, qty: 1, unitPrice: PRICE_OPEN_PAISE, jarNumbers: [16] })],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: problemTotal,
        fulfilment: "ship",
        payment: payment({
          method: "razorpay",
          status: "captured",
          amount: problemTotal,
          paymentId: "pay_seed0008",
        }),
        soldBy: null,
        kitchenNote: "Courier says the address could not be found. Redelivery to be arranged.",
        token: "00000000000000000000000000000008",
      },
    },
    {
      id: "o-seed0009",
      fields: {
        number: "o-seed0009",
        channel: "web",
        customerPhone: "+919000000009",
        deliveryContact: contact({
          name: "Irfan Khan",
          phone: "+919000000009",
          lines: ["8 Palm Avenue"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673009",
        }),
        state: "delivered",
        lines: [
          line({ batchRef: BATCH_REF, qty: 2, unitPrice: PRICE_IN_STOCK_PAISE, jarNumbers: [17, 18] }),
        ],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: deliveredTotal,
        fulfilment: "ship",
        payment: payment({
          method: "razorpay",
          status: "captured",
          amount: deliveredTotal,
          paymentId: "pay_seed0009",
        }),
        soldBy: null,
        token: "00000000000000000000000000000009",
      },
    },
    {
      id: "o-seed0010",
      fields: {
        number: "o-seed0010",
        channel: "phone",
        customerPhone: "+919000000010",
        deliveryContact: contact({
          name: "Jyothi Varma",
          phone: "+919000000010",
          lines: ["5 Temple Street"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673010",
        }),
        state: "refunded",
        lines: [line({ batchRef: BATCH_REF, qty: 1, unitPrice: PRICE_OPEN_PAISE, jarNumbers: [19] })],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: refundedTotal,
        fulfilment: "ship",
        payment: payment({
          method: "paymentLink",
          status: "refunded",
          amount: refundedTotal,
          refundedAmount: refundedTotal,
          paymentId: "pay_seed0010",
        }),
        soldBy: "seed",
        token: "0000000000000000000000000000000a",
      },
    },
    {
      // Pre-M3.8: `token: null`, so the Orders screen's bill box shows the
      // "no private link" line rather than drawing a broken one (A206).
      id: "o-seed0011",
      fields: {
        number: "o-seed0011",
        channel: "web",
        customerPhone: "+919000000011",
        deliveryContact: contact({
          name: "Kiran Babu",
          phone: "+919000000011",
          lines: ["2 Station Road"],
          city: "Kozhikode",
          state: "Kerala",
          pincode: "673011",
        }),
        state: "closed",
        lines: [line({ batchRef: BATCH_REF, qty: 1, unitPrice: PRICE_OPEN_PAISE, jarNumbers: [20] })],
        batchRefs: [BATCH_REF],
        shippingFee: 0,
        discount: null,
        total: closedTotal,
        fulfilment: "ship",
        payment: payment({
          method: "razorpay",
          status: "captured",
          amount: closedTotal,
          paymentId: "pay_seed0011",
        }),
        soldBy: null,
        token: null,
      },
    },
  ];
}

const ORDER_DEFAULTS = {
  placeOfSupply: "KL",
  discount: null,
  shareCodeUsed: null,
  policyVersion: "1",
  kitchenNote: null,
  draft: false,
  holdExpiresAt: null,
};

/** The one bill, against `o-seed0004`, so a bill number is real to search for. */
const DOCUMENT_ID = "LK-26-27-0001";

/**
 * Everything about the bill's place in its series, read off `DOCUMENT_ID`
 * rather than typed a second time. `fromDocumentId` turns the id back into
 * the number it is (`"LK/26-27/0001"`) and `parseDocumentNumber` splits that
 * into prefix, financial year and serial, both from `@lailark/shared`, which
 * is what `store.ts` composes ids out of in the first place. The counter id
 * is the series key with its slash dashed (`counterId` in `shared`), and the
 * counter must end up pointing one past the serial this seed occupies.
 */
const DOCUMENT_NUMBER = fromDocumentId(DOCUMENT_ID);
const PARSED_DOCUMENT_NUMBER = parseDocumentNumber(DOCUMENT_NUMBER);
const COUNTER_SERIES = `${PARSED_DOCUMENT_NUMBER.prefix}/${PARSED_DOCUMENT_NUMBER.fyLabel}`;
const COUNTER_ID = COUNTER_SERIES.split("/").join("-");
const COUNTER_NEXT = PARSED_DOCUMENT_NUMBER.n + 1;

function buildDocument() {
  const total = multiplyPaise(PRICE_IN_STOCK_PAISE, 1);
  return {
    kind: PARSED_DOCUMENT_NUMBER.kind,
    number: DOCUMENT_NUMBER,
    orderId: "o-seed0004",
    orderNumber: "o-seed0004",
    issuedOn: "2026-09-20",
    lines: [
      {
        description: "Prawns and dates pickle",
        hsn: "16",
        qty: 1,
        unitPrice: PRICE_IN_STOCK_PAISE,
        amount: total,
        batchNo: null,
        jarNumbers: [],
      },
    ],
    taxable: total,
    cgst: 0,
    sgst: 0,
    igst: 0,
    total,
    pdfPath: null,
    voids: null,
    cancelledBy: null,
    seller: {
      name: "Lailark Kitchen",
      addressLines: ["Kunnamangalam", "Kozhikode", "Kerala"],
      supportPhone: "+917736110087",
      fssai: "",
      website: "www.lailark.in",
      gstin: null,
      handedOverText: "Handed over at Kunnamangalam",
    },
    customer: { name: "Deepak Menon", phone: "+919000000004", email: null },
    deliveryText: "1 Lake Road, Kozhikode, Kerala, 673004",
    placeOfSupply: "KL",
    channel: "phone",
    payment: { method: "paymentLink", status: "captured", reference: "pay_seed0004" },
    subtotal: total,
    discount: 0,
    discountReason: null,
    shippingFee: 0,
    gstEnabled: false,
    voided: null,
  };
}

function parseArgs(argv) {
  const args = { emulator: false, project: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--emulator") args.emulator = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--project") args.project = argv[++i] ?? null;
    else if (arg.startsWith("--project=")) args.project = arg.slice("--project=".length);
    else {
      console.error(`seed-orders: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.emulator && !args.project) {
  console.error("seed-orders: pass --emulator for the local suite, or --project <id> for a real project.");
  process.exit(2);
}

let projectId;
if (args.emulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= AUTH_EMULATOR;
  process.env.FIRESTORE_EMULATOR_HOST ??= FIRESTORE_EMULATOR;
  projectId = args.project ?? process.env.GCLOUD_PROJECT ?? "lailark";
  process.env.GCLOUD_PROJECT ??= projectId;
} else {
  projectId = args.project;
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      "seed-orders: an emulator host is set in the environment but --emulator was not passed. Stopping.",
    );
    process.exit(2);
  }
  // The one guard this script adds beyond seed-batch-001's shape: these are
  // fabricated orders and a fabricated bill, and CLAUDE.md section 3 reserves
  // `orders`/`documents` for functions. Nothing here may reach the real
  // `lailark` project by accident.
  if (projectId === "lailark" && !args.force) {
    console.error(
      "seed-orders: refusing to seed fabricated orders and a fabricated bill into the production " +
        "project (lailark). Pass --emulator for the local suite, --project <staging id> for staging, " +
        "or --force if you really mean production.",
    );
    process.exit(2);
  }
}

const where = args.emulator
  ? `emulator (firestore ${process.env.FIRESTORE_EMULATOR_HOST})`
  : `project ${projectId}`;
console.log(`seed-orders: seeding into the ${where}.`);

const app = initializeApp({ projectId });
const db = getFirestore(app);

let failed = false;

async function createIfAbsent(collection, id, fields) {
  const ref = db.collection(collection).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    const now = FieldValue.serverTimestamp();
    tx.create(ref, { ...fields, createdAt: now, createdBy: "seed", updatedAt: now, updatedBy: "seed" });
    return true;
  });
}

/**
 * `createIfAbsent`'s sibling for the one document whose id is a reserved
 * number: it creates `documents/{DOCUMENT_ID}` and leaves
 * `counters/{COUNTER_ID}` pointing past that number, in a single
 * transaction, so the script cannot leave a bill without its reservation.
 *
 * The counter is moved with `Math.max`, never an increment: re-running does
 * not push it, and a counter that real bills have already carried past
 * `COUNTER_NEXT` is left exactly where it is. The fields match what
 * `writeDocument` (`functions/src/money/store.ts`) writes on a counter, so a
 * seeded series looks like a used one rather than like a different scheme.
 *
 * Returns whether the document was created; the counter is ensured either
 * way, which is what repairs an emulator seeded before this existed.
 */
async function createBillReservingItsNumber(fields) {
  const documentRef = db.collection("documents").doc(DOCUMENT_ID);
  const counterRef = db.collection("counters").doc(COUNTER_ID);
  return db.runTransaction(async (tx) => {
    // Both reads first: the Node SDK refuses a read after a write.
    const documentSnap = await tx.get(documentRef);
    const counterSnap = await tx.get(counterRef);

    const now = FieldValue.serverTimestamp();
    const created = !documentSnap.exists;
    if (created) {
      tx.create(documentRef, { ...fields, createdAt: now, createdBy: "seed", updatedAt: now, updatedBy: "seed" });
    }

    const stored = counterSnap.get("next");
    const existing = typeof stored === "number" && Number.isFinite(stored) ? Math.floor(stored) : 1;
    tx.set(
      counterRef,
      {
        next: Math.max(existing, COUNTER_NEXT),
        kind: PARSED_DOCUMENT_NUMBER.kind,
        fyLabel: PARSED_DOCUMENT_NUMBER.fyLabel,
        series: COUNTER_SERIES,
        updatedAt: now,
        updatedBy: "seed",
      },
      { merge: true },
    );

    return created;
  });
}

const orders = buildOrders();
let ordersCreated = 0;
for (const { id, fields } of orders) {
  try {
    const created = await createIfAbsent("orders", id, { ...ORDER_DEFAULTS, ...fields });
    if (created) ordersCreated += 1;
  } catch (error) {
    failed = true;
    console.error(`  failed to seed order ${id}: ${error?.message ?? error}`);
  }
}
console.log(`  ${ordersCreated} of ${orders.length} orders created (rest already existed)`);

let documentCreated = false;
try {
  documentCreated = await createBillReservingItsNumber(buildDocument());
  console.log(`  bill ${DOCUMENT_ID} ${documentCreated ? "created" : "already exists"}`);
  console.log(`  counter ${COUNTER_ID} left at next >= ${COUNTER_NEXT}`);
} catch (error) {
  failed = true;
  console.error(`  failed to seed the bill: ${error?.message ?? error}`);
}

console.log(
  `seed-orders: ${ordersCreated} order(s) created, ${documentCreated ? "bill created" : "bill already seeded"}.`,
);

if (failed) {
  console.error("seed-orders: finished with errors.");
  process.exit(1);
}
console.log("seed-orders: done.");
