#!/usr/bin/env node
/**
 * Seeds one **open (pre-order) batch** of prawns-and-dates, so a jar can
 * actually be booked and paid for.
 *
 *   node functions/scripts/seed-open-batch.mjs --emulator
 *   node functions/scripts/seed-open-batch.mjs --project tree-quiz-74e04
 *
 * **Why this exists.** `seed-batch-001.mjs` seeds batch 001 as an *archived*
 * batch (22 jars, sale long stopped), which is the right record of a real
 * batch and is exactly the wrong thing for testing a payment: an archived
 * batch is in none of `BATCH_STATES_IN_STOCK` or
 * `BATCH_STATES_OPEN_FOR_BOOKING`, so `/api/counts` answers
 * `{"mode":"none"}`, the product page offers no Buy control, `createCheckout`
 * has no jar to hold and Razorpay is never invoked. A staging project with
 * products and admin users and nothing else cannot prove the webhook end to
 * end. This script gives it one batch that is open for booking at ₹599.
 *
 * What it creates, each idempotently and each by a fixed id:
 *
 *   ingredients/{INGREDIENT.id}   one ingredient, so the recipe can name a main
 *   recipes/{RECIPE_ID}           one recipe with exactly one main ingredient
 *   batches/{BATCH_REF}           the batch, created `draft` then moved `open`
 *
 * One main ingredient on purpose. D41/A134 made Sourcing -> Cooking ask for a
 * weight and a cost per main line and sum them onto the batch; a two-main
 * recipe drags all of that into a script whose entire job is to make a jar
 * buyable, and none of it is exercised before bottling anyway.
 *
 * **D21c: an open batch has no number.** `batchNo` is written as an explicit
 * `null` and stays null until Cooking -> Bottled stamps it from
 * `counters/batch`. So this script consumes no numbered resource at all and
 * touches no counter: there is nothing for it to reserve. That is the
 * difference between it and `seed-orders.mjs`, whose bill's *id is* its
 * number and which therefore has to move `counters/{series}` in the same
 * transaction (`createBillReservingItsNumber` there, and A228/A229 for what
 * happens when a seed forgets). If a future edit here ever writes a
 * `batchNo`, a bill, an order number or anything else whose id is a serial,
 * it must reserve it in the same transaction with a `Math.max`, never an
 * increment.
 *
 * **The batch document is the two real transitions' own output.** The fields
 * below are `planCreate`'s patch (the `none -> draft` row) with `planOpen`'s
 * patch merged over it (`draft -> open`), in
 * `functions/src/batches/transitions.ts`, and the two counts are computed by
 * `batchMaths` from `@lailark/shared`, which is the same call `planCreate`
 * makes. Nothing here restates a number the engine derives. It is written
 * straight into `batches` with the Admin SDK rather than through
 * `transitionBatch`, the same deliberate exception `seed-batch-001.mjs` and
 * `seed-orders.mjs` take, because there is no signed-in Owner when a project
 * is first seeded.
 *
 * Prices are `PRICE_OPEN_PAISE` and `PRICE_IN_STOCK_PAISE` from
 * `@lailark/shared` (₹599 and ₹649, CLAUDE.md section 3), integers in paise,
 * never retyped here, and both are put through `assertAtOrBelowMrp` before
 * anything is written, so this script cannot be the thing that opens a batch
 * above the MRP printed on the jar.
 *
 * Against a real project it needs application default credentials
 * (`gcloud auth application-default login`) and the project id spelled out,
 * and it refuses the production project id (`lailark`) without `--force`:
 * this is a fabricated batch, and a fabricated batch open for booking would
 * sell real jars that do not exist.
 *
 * ASSUMED (M3.6 staging walk): the recipe's single line, 1,550 g of prawns
 * marked `estimated: true`, is a working figure, not a weighing. It is the
 * same placeholder `seed-batch-001.mjs` carries from the label basis doc
 * section 4. Nothing printed is generated from it in this flow: a label is
 * produced at bottling, and this batch is meant to be paid for and then
 * either cooked through the admin by hand or left alone.
 *
 * ASSUMED (M3.6 staging walk): `claimsText` and `storageText` are the exact
 * strings `seed-batch-001.mjs` already carries for this same product's
 * label, copied rather than paraphrased (CLAUDE.md section 3). No customer
 * copy is invented here.
 *
 * ASSUMED (M3.6 staging walk): this script does **not** raise the
 * `approval:broadcast` that the real `draft -> open` row raises. Nothing is
 * ever sent without the Owner, so a missing approval loses no message; a
 * seeded one would put a card in Today asking Shefin to broadcast a batch
 * that only exists to test a payment.
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  assertAtOrBelowMrp,
  batchMaths,
  BATCH_STATES_OPEN_FOR_BOOKING,
  DEFAULT_STORAGE_TEXT,
  formatINR,
  isBatchRef,
  PRICE_IN_STOCK_PAISE,
  PRICE_OPEN_PAISE,
} from "@lailark/shared";

const AUTH_EMULATOR = "127.0.0.1:9099";
const FIRESTORE_EMULATOR = "127.0.0.1:8080";

const PRODUCT_SLUG = "prawns-and-dates";

/**
 * The batch's internal reference, which is its document id and is fixed for
 * life (D21c). Six characters of the base32 alphabet in `shared/src/
 * numbers.ts`, checked below rather than trusted, and chosen to read as
 * "open" so nobody mistakes this seeded batch for a real one on a screen.
 */
const BATCH_REF = "b-0pen15";
const RECIPE_ID = "seed-open-batch-recipe";

/** Twenty planned jars: inside the 15 to 40 a real batch is (CLAUDE.md §1). */
const PLANNED_JARS = 20;

/** The one ingredient, so the recipe has a main to name. */
const INGREDIENT = {
  id: "seed-open-batch-prawns",
  labelName: "Prawns",
  // Handoff §2's own wording for this allergen, not a paraphrase.
  allergenTags: ["Crustacean (Prawns)"],
  // Empty on purpose: see the long note in `seed-batch-001.mjs`. An empty map
  // is read as "not known" by `nutritionPer100g`, and inventing a figure under
  // a real ingredient's real name is the one thing a label may never carry.
  nutritionPer100g: {},
  unitCost: 0,
  unit: "g",
  source: null,
};

/**
 * D15's blockers, so this script refuses to open a second batch of a product
 * that already has one on sale.
 *
 * It mirrors `D15_BLOCKING_STATES` in `functions/src/batches/transitions.ts`,
 * which is the authority: the three booking states from `@lailark/shared`
 * plus `paused`, because a paused batch is not cooking and its customers are
 * waiting on a Concern. Composed from the shared list rather than typed out,
 * so the three can never drift; only `paused` is named here.
 */
const D15_BLOCKING = [...BATCH_STATES_OPEN_FOR_BOOKING, "paused"];

/** `recipes/{RECIPE_ID}`: one main ingredient and nothing else (D41). */
function createRecipe() {
  return {
    productSlug: PRODUCT_SLUG,
    version: 1,
    // Basis B, the recommended one, the same as batch 001's recipe.
    percentageBasis: "B",
    expectedYieldJars: PLANNED_JARS,
    finishedWeightG: PLANNED_JARS * 200,
    storageText: DEFAULT_STORAGE_TEXT,
    claimsText: "No added preservatives. Prepared by traditional method.",
    lines: [
      {
        ingredientId: INGREDIENT.id,
        qty: 1550,
        unit: "g",
        isMain: true,
        evaporates: false,
        estimated: true,
      },
    ],
  };
}

/**
 * `planCreate`'s patch for the `none -> draft` row, field for field
 * (`functions/src/batches/transitions.ts`), with the two counts from
 * `batchMaths` rather than worked out here.
 */
function draftBatch({ productName, priceOpen, priceInStock }) {
  const maths = batchMaths(PLANNED_JARS);
  return {
    // D21c: no number until bottling, written as an explicit null so "no
    // number yet" is a fact on the document rather than a missing field.
    batchNo: null,
    productSlug: PRODUCT_SLUG,
    productName,
    recipeId: RECIPE_ID,
    mainIngredientName: INGREDIENT.labelName,
    state: "draft",
    plannedJars: maths.plannedJars,
    bookableJars: maths.bookableJars,
    perPersonLimit: maths.perPersonLimit,
    perPersonLimitOverride: null,
    priceOpen,
    priceInStock,
    paidCount: 0,
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
    pausedFrom: null,
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
    createdBy: "seed",
  };
}

/**
 * `planOpen`'s patch for the `draft -> open` row, field for field. No
 * `batchNo`: brief §8.2 allocated one here and D21c moved it to bottling.
 */
function openPatch({ priceOpen, priceInStock }) {
  const maths = batchMaths(PLANNED_JARS);
  return {
    state: "open",
    plannedJars: maths.plannedJars,
    bookableJars: maths.bookableJars,
    perPersonLimit: maths.perPersonLimit,
    perPersonLimitOverride: null,
    priceOpen,
    priceInStock,
    pausedReason: null,
    pausedFrom: null,
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
      console.error(`seed-open-batch: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.emulator && !args.project) {
  console.error(
    "seed-open-batch: pass --emulator for the local suite, or --project <id> for a real project.",
  );
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
      "seed-open-batch: an emulator host is set in the environment but --emulator was not passed. Stopping.",
    );
    process.exit(2);
  }
  if (projectId === "lailark" && !args.force) {
    console.error(
      "seed-open-batch: refusing to open a fabricated batch for booking in the production " +
        "project (lailark). A batch open at " +
        `${formatINR(PRICE_OPEN_PAISE)} sells jars, and these do not exist. Pass --emulator for ` +
        "the local suite, --project <staging id> for staging, or --force if you really mean production.",
    );
    process.exit(2);
  }
}

// The reference is the document id for the rest of this batch's life, so it is
// checked against the shared shape before a single write, not after.
if (!isBatchRef(BATCH_REF)) {
  console.error(`seed-open-batch: ${BATCH_REF} is not a batch reference. Fix the constant.`);
  process.exit(2);
}

// CLAUDE.md section 3: never above the ₹649 MRP, which is printed on the jar.
// Both prices come from `@lailark/shared`; this is the belt to that.
const PRICE_OPEN = assertAtOrBelowMrp(PRICE_OPEN_PAISE);
const PRICE_IN_STOCK = assertAtOrBelowMrp(PRICE_IN_STOCK_PAISE);

const where = args.emulator
  ? `emulator (firestore ${process.env.FIRESTORE_EMULATOR_HOST})`
  : `project ${projectId}`;
console.log(`seed-open-batch: opening one ${PRODUCT_SLUG} batch in the ${where}.`);

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
 * The product's own name, for the batch's `productName` (D24 copies it once
 * so no later transaction pays for a catalogue read). Missing means
 * `seed-products.mjs` has not run, and `/api/counts` only reports a product
 * that is in `products` and active, so there is nothing to seed a batch
 * against: stop and say which script to run.
 */
async function productName() {
  const snap = await db.collection("products").doc(PRODUCT_SLUG).get();
  if (!snap.exists) {
    throw new Error(
      `products/${PRODUCT_SLUG} does not exist. Run seed-products.mjs against this project first; ` +
        `a batch of a product that is not in the catalogue is invisible to /api/counts.`,
    );
  }
  const name = snap.get("name");
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

/**
 * The batch, created as a draft. Idempotent on the document id: a batch
 * already at `BATCH_REF` is left exactly as it is, whatever state it has
 * reached since.
 */
async function createDraft(name) {
  return createIfAbsent("batches", BATCH_REF, draftBatch({
    productName: name,
    priceOpen: PRICE_OPEN,
    priceInStock: PRICE_IN_STOCK,
  }));
}

/**
 * `draft -> open`, and only from `draft`.
 *
 * A second run finds the batch already `open` and writes nothing. A run
 * against a batch Shefin has since moved on (sourcing, cooking, bottled)
 * leaves it where it is and says so: winding a cooking batch back to open
 * would reopen booking at ₹599 on a pot that is already on the stove.
 *
 * D15 is checked in the same transaction: one batch of a product open at a
 * time, and a second may open only once the first is cooking.
 */
async function openTheBatch() {
  const ref = db.collection("batches").doc(BATCH_REF);
  const siblings = db.collection("batches").where("productSlug", "==", PRODUCT_SLUG);
  return db.runTransaction(async (tx) => {
    // Every read before any write: the Node SDK refuses a read after one.
    const snap = await tx.get(ref);
    // Equality on one field only, so this needs no composite index on a real
    // project. The state is filtered here instead.
    const others = await tx.get(siblings);
    if (!snap.exists) throw new Error(`batches/${BATCH_REF} is not there to open.`);

    const state = snap.get("state");
    if (state === "open") return "already open";
    if (state !== "draft") {
      return `left alone: it is ${String(state)}, not a draft`;
    }

    const blocker = others.docs.find(
      (doc) => doc.id !== BATCH_REF && D15_BLOCKING.includes(String(doc.get("state"))),
    );
    if (blocker) {
      throw new Error(
        `batches/${blocker.id} of ${PRODUCT_SLUG} is ${String(blocker.get("state"))}. Only one batch ` +
          `of a product is open at a time (D15), so this draft stays a draft. Deal with that batch first.`,
      );
    }

    tx.update(ref, {
      ...openPatch({ priceOpen: PRICE_OPEN, priceInStock: PRICE_IN_STOCK }),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "seed",
    });
    return "opened";
  });
}

try {
  const { id: ingredientId, ...ingredientFields } = INGREDIENT;
  const ingredientCreated = await createIfAbsent("ingredients", ingredientId, ingredientFields);
  console.log(`  ingredient ${ingredientId} ${ingredientCreated ? "created" : "already exists"}`);

  const recipeCreated = await createIfAbsent("recipes", RECIPE_ID, createRecipe());
  console.log(`  recipe ${RECIPE_ID} ${recipeCreated ? "created" : "already exists"}`);

  const name = await productName();
  const draftCreated = await createDraft(name);
  console.log(`  batch ${BATCH_REF} ${draftCreated ? "created as a draft" : "already exists"}`);

  const outcome = await openTheBatch();
  console.log(`  batch ${BATCH_REF} ${outcome}`);

  const maths = batchMaths(PLANNED_JARS);
  console.log(
    `seed-open-batch: ${maths.plannedJars} planned, ${maths.bookableJars} bookable, ` +
      `${maths.perPersonLimit} per person, ${formatINR(PRICE_OPEN)} open and ` +
      `${formatINR(PRICE_IN_STOCK)} in stock. No batch number: it is stamped at bottling (D21c).`,
  );
} catch (error) {
  failed = true;
  console.error(`seed-open-batch: ${error?.message ?? error}`);
}

if (failed) {
  console.error("seed-open-batch: finished with errors.");
  process.exit(1);
}
console.log("seed-open-batch: done.");
