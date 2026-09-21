#!/usr/bin/env node
/**
 * Seeds batch 001: the prawns-and-dates product, its recipe from the label
 * basis doc placeholders (marked estimated), and batch 001 itself as an
 * Archived batch with 22 bottled jars, 0 paid online, and every real number
 * from the v0 handoff §1 and §2.
 *
 *   node functions/scripts/seed-batch-001.mjs --emulator
 *   node functions/scripts/seed-batch-001.mjs --project tree-quiz-74e04
 *
 * Idempotent. Re-running finds the existing batch 001, does not create a
 * second one (batch numbers are never reused, CLAUDE.md section 3).
 *
 * Against a real project it needs application default credentials
 * (`gcloud auth application-default login`) and the project id spelled out.
 *
 * ASSUMED (M2.7): the product "Prawns and dates" has already been seeded by
 * seed-products.mjs. This script creates the ingredients and recipe that
 * product uses, then the batch.
 *
 * ASSUMED (M2.7): the printed label shows Prawns 59%, Dates 22% (handoff §2),
 * but the recipe engine computes basis B: Prawns 35%, Dates 23% (label basis
 * doc section 4). The recipe data carries the percentages; D28 says the batch
 * 001 web page shows no percentages for batch 001, so the record page differs
 * from the printed jar. This script marks all recipe weights as estimated
 * (from the label basis doc's placeholder table) because they have not been
 * recorded from the actual batch.
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  batchMaths,
  DEFAULT_STORAGE_TEXT,
  bestBefore as bestBeforeFor,
  formatCalDate,
  saleStopOn as saleStopOnFor,
} from "@lailark/shared";

/**
 * The two dates the jar carries, computed rather than typed, and then checked
 * against what is actually printed on the 22 jars before anything is written.
 *
 * Typing them would work today and lie later: if the shelf-life rule ever
 * moves, a typed date would quietly disagree with the engine that computes
 * every other batch's, and nobody would notice until a customer read one. This
 * way the seed refuses to run instead.
 */
const PRINTED = {
  packedOn: "2026-09-04",
  bestBefore: "2027-03-04",
  saleStopOn: "2027-01-02",
};

function datesForBatch001() {
  const computed = {
    bestBefore: formatCalDate(bestBeforeFor(PRINTED.packedOn)),
    saleStopOn: formatCalDate(saleStopOnFor(PRINTED.packedOn)),
  };
  for (const key of ["bestBefore", "saleStopOn"]) {
    if (computed[key] !== PRINTED[key]) {
      throw new Error(
        `seed-batch-001: the shelf-life rule now gives ${key} ${computed[key]}, but the 22 jars ` +
          `are printed with ${PRINTED[key]}. The jars are the truth. Fix the rule or this seed, ` +
          `do not let them disagree.`,
      );
    }
  }
  return computed;
}

const AUTH_EMULATOR = "127.0.0.1:9099";
const FIRESTORE_EMULATOR = "127.0.0.1:8080";

const PRODUCT_SLUG = "prawns-and-dates";
const BATCH_REF = "b-001001";

/**
 * Ingredients seeded for batch 001's recipe.
 * Allergens from handoff §2.
 *
 * **Nutrition is deliberately empty on every ingredient.** Handoff §2's
 * nutrition panel belongs to the finished jar, per 100 g of pickle, after six
 * kilos of ingredients cooked down to four. It is not any one ingredient's
 * figure, and nothing in the repo gives per-ingredient nutrition. An earlier
 * draft of this seed put the jar's own protein figure, 10.7 g, on raw prawns,
 * where the real value is nearer 20: a number that looks right, sits under a
 * real ingredient's real name, and is wrong. CLAUDE.md section 3 says not to
 * invent a number, and a label is the last place to start.
 *
 * `nutritionPer100g` in `shared/src/recipe.ts` already refuses to compute a
 * panel when a contributing ingredient lacks a nutrient, so an empty map is
 * read as "not known" rather than as zero. Filling these needs a real source
 * (IFCT or USDA) cited per ingredient, which is its own task.
 * Weights and costs are null/zero placeholders; the actual batch carries
 * recipe lines with qty and unit, not ingredient costs.
 */
const INGREDIENTS = [
  {
    id: "batch-001-prawns",
    labelName: "Prawns",
    allergenTags: ["Crustacean (Prawns)"],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: "Chaliyam",
  },
  {
    id: "batch-001-dates",
    labelName: "Dates",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-vinegar",
    labelName: "Vinegar",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "l",
    densityGPerMl: 1.0,
    source: null,
  },
  {
    id: "batch-001-gingelly-oil",
    labelName: "Gingelly (Sesame) Oil",
    allergenTags: ["Sesame"],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "l",
    densityGPerMl: 0.92,
    source: null,
  },
  {
    id: "batch-001-garlic",
    labelName: "Garlic",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-green-chilli",
    labelName: "Green Chilli",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-salt",
    labelName: "Salt",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-ginger",
    labelName: "Ginger",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-kashmiri-chilli",
    labelName: "Kashmiri Chilli Powder",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-red-chilli",
    labelName: "Red Chilli Powder",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-sugar",
    labelName: "Sugar",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-mustard",
    labelName: "Mustard",
    allergenTags: ["Mustard"],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-curry-leaves",
    labelName: "Curry Leaves",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-turmeric",
    labelName: "Turmeric",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-fenugreek",
    labelName: "Fenugreek",
    allergenTags: [],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
  {
    id: "batch-001-asafoetida",
    labelName: "Compounded Asafoetida (Gum Arabic, Wheat Flour, Asafoetida)",
    allergenTags: ["Wheat (Gluten)"],
    nutritionPer100g: {},
    unitCost: 0,
    unit: "g",
    source: null,
  },
];

/**
 * Recipe for batch 001: the prawns-and-dates product.
 * All weights are from the label basis doc section 4 (placeholder weights, marked estimated).
 * D28: percentageBasis is "B" (recommended); the printed label shows Prawns 59%, Dates 22%,
 * which is basis C (ingoing over finished weight). The recipe engine computes basis B.
 */
function createRecipe() {
  return {
    productSlug: PRODUCT_SLUG,
    version: 1,
    percentageBasis: "B",
    expectedYieldJars: 22,
    finishedWeightG: 4400, // 22 jars * 200 g (handoff §1)
    // The jar's own storage line, taken from `shared` rather than retyped: the
    // site deliberately shows a shortened version (handoff section 7), but a
    // recipe record is what a label is printed from, and dropping "refrigerate
    // after opening" from that would take a food-safety line off a real jar.
    storageText: DEFAULT_STORAGE_TEXT,
    claimsText: "No added preservatives. Prepared by traditional method.",
    lines: [
      // Main ingredients: marked isMain for the two emphasized on the label (5(2)(g)).
      // Prawns: cleaned raw 1,550 g (estimated, from label basis doc section 4).
      {
        ingredientId: "batch-001-prawns",
        qty: 1550,
        unit: "g",
        isMain: true,
        evaporates: false,
        estimated: true,
      },
      // Dates: 1,000 g (estimated).
      {
        ingredientId: "batch-001-dates",
        qty: 1000,
        unit: "g",
        isMain: true,
        evaporates: false,
        estimated: true,
      },
      // Vinegar: 2 L in, ~400 g stays (estimated). Evaporates: the 1,600 g
      // boiled off is out of the label percentage (5(2)(f), first proviso).
      {
        ingredientId: "batch-001-vinegar",
        qty: 2,
        unit: "l",
        isMain: false,
        evaporates: true,
        // "2 L in, about 400 g stays" is the label basis doc's own estimate,
        // and it is the figure the whole basis-B percentage rests on.
        residueG: 400,
        estimated: true,
      },
      // Spices and flavourings follow. isMain false (5(2)(g) exempts them).
      {
        ingredientId: "batch-001-gingelly-oil",
        qty: 1,
        unit: "l",
        isMain: false,
        evaporates: false,
        estimated: true,
      },
      { ingredientId: "batch-001-garlic", qty: 150, unit: "g", isMain: false, evaporates: false, estimated: true },
      {
        ingredientId: "batch-001-green-chilli",
        qty: 100,
        unit: "g",
        isMain: false,
        evaporates: false,
        estimated: true,
      },
      { ingredientId: "batch-001-ginger", qty: 80, unit: "g", isMain: false, evaporates: false, estimated: true },
      { ingredientId: "batch-001-salt", qty: 90, unit: "g", isMain: false, evaporates: false, estimated: true },
      {
        ingredientId: "batch-001-kashmiri-chilli",
        qty: 30,
        unit: "g",
        isMain: false,
        evaporates: false,
        estimated: true,
      },
      {
        ingredientId: "batch-001-red-chilli",
        qty: 30,
        unit: "g",
        isMain: false,
        evaporates: false,
        estimated: true,
      },
      { ingredientId: "batch-001-sugar", qty: 40, unit: "g", isMain: false, evaporates: false, estimated: true },
      // Asafoetida sits here, before mustard, because that is where it is
      // printed on the jar. The "Contains:" line is built by walking these
      // lines in order, so this order is what decides whether the allergen
      // declaration reads the way the 22 labels read. Out of place, the line
      // came out "Mustard and Wheat (Gluten)" against a jar that says
      // "Wheat (Gluten) and Mustard".
      {
        ingredientId: "batch-001-asafoetida",
        qty: 5,
        unit: "g",
        isMain: false,
        evaporates: false,
        estimated: true,
      },
      {
        ingredientId: "batch-001-mustard",
        qty: 15,
        unit: "g",
        isMain: false,
        evaporates: false,
        estimated: true,
      },
      {
        ingredientId: "batch-001-curry-leaves",
        qty: 10,
        unit: "g",
        isMain: false,
        evaporates: false,
        estimated: true,
      },
      { ingredientId: "batch-001-fenugreek", qty: 5, unit: "g", isMain: false, evaporates: false, estimated: true },
      { ingredientId: "batch-001-turmeric", qty: 8, unit: "g", isMain: false, evaporates: false, estimated: true },
    ],
  };
}

/**
 * Batch 001: archived, with every real number from the handoff §1 and §2.
 * D21c: the batch has two names. The document id is the internal reference
 * (b-001001); batchNo is the printed number ("001").
 */
function createBatch() {
  const maths = batchMaths(22); // handoff §1: 22 jars
  const dates = datesForBatch001();
  return {
    batchNo: "001",
    productSlug: PRODUCT_SLUG,
    productName: "Prawns and dates",
    recipeId: "batch-001-recipe",
    mainIngredientName: "Prawns",
    state: "archived",
    plannedJars: maths.plannedJars,
    // Never hand-computed: the same helper the site, the admin and every
    // transition use, so this archived batch cannot disagree with a live one.
    bookableJars: maths.bookableJars,
    perPersonLimit: maths.perPersonLimit,
    priceOpen: 59900, // ₹599 in paise (handoff §1: ₹649 in stock, ₹599 open)
    priceInStock: 64900, // ₹649 in paise
    paidCount: 0, // "0 paid online" (handoff task description)
    heldJars: {},
    bottledJars: 22,
    writtenOff: 0,
    source: "Chaliyam", // handoff §1
    landedOn: "2026-08-31", // handoff §1: Landed 31 August 2026
    cookedOn: "2026-09-01", // handoff §1: Cooked 1 September 2026
    packedOn: PRINTED.packedOn, // handoff §1: Bottled 4 September 2026
    bestBefore: dates.bestBefore, // computed, and checked against the jar
    saleStopOn: dates.saleStopOn, // computed, and checked against the jar
    weightRaw: null,
    weightCleaned: null,
    weightCooked: null,
    halfReachedAt: null,
    halfApprovedAt: null,
    fullReachedAt: null,
    fullApprovedAt: null,
    pausedReason: null,
    pausedFrom: null,
    costs: {
      jarsLids: 0,
      boxInserts: 0,
      labelling: 0,
      gasPower: 0,
    },
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
}

function parseArgs(argv) {
  const args = { emulator: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--emulator") args.emulator = true;
    else if (arg === "--project") args.project = argv[++i] ?? null;
    else if (arg.startsWith("--project=")) args.project = arg.slice("--project=".length);
    else {
      console.error(`seed-batch-001: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.emulator && !args.project) {
  console.error(
    "seed-batch-001: pass --emulator for the local suite, or --project <id> for a real project.",
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
      "seed-batch-001: an emulator host is set in the environment but --emulator was not passed. Stopping.",
    );
    process.exit(2);
  }
}

const where = args.emulator
  ? `emulator (firestore ${process.env.FIRESTORE_EMULATOR_HOST})`
  : `project ${projectId}`;
console.log(`seed-batch-001: seeding batch 001 into the ${where}.`);

const app = initializeApp({ projectId });
const db = getFirestore(app);

let failed = false;

// Seed all ingredients first
let ingredientsCreated = 0;
for (const ingredient of INGREDIENTS) {
  const { id, ...fields } = ingredient;
  try {
    const ref = db.collection("ingredients").doc(id);
    const didCreate = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      const now = FieldValue.serverTimestamp();
      tx.create(ref, {
        ...fields,
        createdAt: now,
        createdBy: "seed",
        updatedAt: now,
        updatedBy: "seed",
      });
      return true;
    });

    if (didCreate) {
      ingredientsCreated += 1;
    }
  } catch (error) {
    failed = true;
    console.error(`  failed to seed ingredient ${id}: ${error?.message ?? error}`);
  }
}
console.log(`  ${ingredientsCreated} of ${INGREDIENTS.length} ingredients created or already exist`);

// Seed the recipe
let recipeCreated = false;
try {
  const ref = db.collection("recipes").doc("batch-001-recipe");
  const didCreate = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    const now = FieldValue.serverTimestamp();
    tx.create(ref, {
      ...createRecipe(),
      createdAt: now,
      createdBy: "seed",
      updatedAt: now,
      updatedBy: "seed",
    });
    return true;
  });
  recipeCreated = didCreate;
  console.log(`  recipe for batch 001 ${didCreate ? "created" : "already exists"}`);
} catch (error) {
  failed = true;
  console.error(`  failed to seed recipe: ${error?.message ?? error}`);
}

// Seed batch 001: idempotent on batchNo, not on document id.
// Only one batch 001 can ever exist (D21c: batch numbers are global and never reused).
let batchCreated = false;
try {
  const batchRef = db.collection("batches").doc(BATCH_REF);
  const batchCreatedInTx = await db.runTransaction(async (tx) => {
    // Check if batch 001 already exists by querying batchNo.
    const existing = await db
      .collectionGroup("batches")
      .where("batchNo", "==", "001")
      .limit(1)
      .get();

    if (!existing.empty) {
      // Batch 001 already seeded. Do not create a second one.
      return false;
    }

    // The document id too, as a belt-and-suspenders check. If something is
    // already sitting at this id but is not batch 001, stop loudly: quietly
    // reporting "already seeded" would leave no batch numbered 001 anywhere
    // and nobody any the wiser.
    const snap = await tx.get(batchRef);
    if (snap.exists) {
      const found = snap.get("batchNo");
      if (found !== "001") {
        throw new Error(
          `seed-batch-001: ${batchRef.path} already exists and is batch ${String(found)}, not 001. ` +
            `Refusing to touch it. Batch numbers are never reused, so work out what that document ` +
            `is before running this again.`,
        );
      }
      return false;
    }

    const now = FieldValue.serverTimestamp();
    tx.create(batchRef, {
      ...createBatch(),
      createdAt: now,
      createdBy: "seed",
      updatedAt: now,
      updatedBy: "seed",
    });
    return true;
  });
  batchCreated = batchCreatedInTx;
  console.log(`  batch 001 ${batchCreatedInTx ? "created" : "already exists"}`);
} catch (error) {
  failed = true;
  console.error(`  failed to seed batch 001: ${error?.message ?? error}`);
}

console.log(
  `seed-batch-001: ${batchCreated ? "batch 001 created" : "batch 001 already seeded"}, ` +
    `${recipeCreated ? "recipe created" : "recipe already seeded"}, ` +
    `${ingredientsCreated}/${INGREDIENTS.length} ingredients created.`,
);

if (failed) {
  console.error("seed-batch-001: finished with errors.");
  process.exit(1);
}
console.log("seed-batch-001: done.");
