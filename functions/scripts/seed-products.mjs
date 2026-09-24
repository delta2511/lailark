#!/usr/bin/env node
/**
 * Seeds `products/{slug}`: the four heroes and three pipeline products,
 * brief section 17.8 and the sales flow doc section 2.
 *
 *   node functions/scripts/seed-products.mjs --emulator
 *   node functions/scripts/seed-products.mjs --project tree-quiz-74e04
 *
 * Idempotent, and more strictly than seed-users: a product that already
 * exists is left completely alone, field for field, not merged. Prices,
 * jar size and every other value here are only ever a starting point for
 * the Owner's own edits (M2.2 makes every one of them editable in place),
 * so a second run must never overwrite something Shefin has since changed
 * on staging or production. It uses the Admin SDK directly, the same as
 * seed-users.mjs, so it runs before there is an Owner signed in to write
 * through the app.
 *
 * Against a real project it needs application default credentials
 * (`gcloud auth application-default login`) and the project id spelled out.
 *
 * TODO(Q10): the brief gives only the HSN *chapter* (16 for prawns, squid,
 * beef, duck and rabbit; 20 for koorka and yam) and says to confirm the full
 * code with the CA (brief section 20.1: "chapter 16 for prawn, squid and
 * beef, chapter 20 for koorka; confirm with the CA"). The values below are
 * that two-digit chapter, not a finished HSN code, and the Owner can correct
 * them in place on the Products screen the day the CA confirms the rest.
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const AUTH_EMULATOR = "127.0.0.1:9099";
const FIRESTORE_EMULATOR = "127.0.0.1:8080";

const PRICE_IN_STOCK_PAISE = 64_900;
const PRICE_OPEN_PAISE = 59_900;
const JAR_GRAMS = 200;

/**
 * The four heroes and three pipeline products, sales flow doc section 2 and
 * CLAUDE.md section 9. Custom lines ship empty: nothing in the docs names a
 * real one yet, and the Products screen (M2.2) lets the Owner add one at any
 * time, at a set amount, without a code change.
 */
const PRODUCTS = [
  {
    slug: "prawns-and-dates",
    name: "Prawns and dates",
    type: "hero",
    veg: false,
    hsn: "16",
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: true,
  },
  {
    slug: "squid-and-dates",
    name: "Squid and dates",
    type: "hero",
    veg: false,
    hsn: "16",
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: true,
  },
  {
    // D12 and brief 11.5: the flat-fee shipping rule is built onto beef, but
    // the site ships free for everyone at launch, so it is not applied.
    slug: "beef-and-dates",
    name: "Beef and dates",
    type: "hero",
    veg: false,
    hsn: "16",
    shippingRule: "flatFee",
    seasonStart: null,
    seasonEnd: null,
    active: true,
  },
  {
    // The only vegetarian hero, and the only one with a season: roughly
    // November to February (sales flow doc section 2).
    slug: "koorka",
    name: "Koorka",
    type: "hero",
    veg: true,
    hsn: "20",
    shippingRule: "free",
    seasonStart: "11-01",
    seasonEnd: "02-28",
    active: true,
  },
  {
    // Pipeline: not yet launched, so `active` is false until the Owner
    // turns one on. Named plainly, "duck"/"yam"/"rabbit", because the docs
    // do not give them a customer-facing name yet (sales flow doc section
    // 2 names the pipeline this way, with no "and dates").
    slug: "duck",
    name: "Duck",
    type: "pipeline",
    veg: false,
    hsn: "16",
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: false,
  },
  {
    slug: "yam",
    name: "Yam",
    type: "pipeline",
    veg: true,
    hsn: "20",
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: false,
  },
  {
    slug: "rabbit",
    name: "Rabbit",
    type: "pipeline",
    veg: false,
    hsn: "16",
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: false,
  },
];

function parseArgs(argv) {
  const args = { emulator: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--emulator") args.emulator = true;
    else if (arg === "--project") args.project = argv[++i] ?? null;
    else if (arg.startsWith("--project=")) args.project = arg.slice("--project=".length);
    else {
      console.error(`seed-products: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.emulator && !args.project) {
  console.error(
    "seed-products: pass --emulator for the local suite, or --project <id> for a real project.",
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
      "seed-products: an emulator host is set in the environment but --emulator was not passed. Stopping.",
    );
    process.exit(2);
  }
}

const where = args.emulator
  ? `emulator (firestore ${process.env.FIRESTORE_EMULATOR_HOST})`
  : `project ${projectId}`;
console.log(`seed-products: seeding the catalogue into the ${where}.`);

const app = initializeApp({ projectId });
const db = getFirestore(app);

let failed = false;
let created = 0;
let left = 0;

for (const product of PRODUCTS) {
  const { slug, ...fields } = product;
  try {
    const ref = db.collection("products").doc(slug);
    const didCreate = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      const now = FieldValue.serverTimestamp();
      tx.create(ref, {
        ...fields,
        priceInStock: PRICE_IN_STOCK_PAISE,
        priceOpen: PRICE_OPEN_PAISE,
        jarGrams: JAR_GRAMS,
        customLines: [],
        createdAt: now,
        createdBy: "seed",
        updatedAt: now,
        updatedBy: "seed",
      });
      return true;
    });

    if (didCreate) {
      created += 1;
      console.log(`  ${slug.padEnd(16)} created (${product.type}, ${formatRupees(PRICE_IN_STOCK_PAISE)} in stock)`);
    } else {
      left += 1;
      console.log(`  ${slug.padEnd(16)} already exists, left alone`);
    }
  } catch (error) {
    failed = true;
    console.error(`  failed for ${slug}: ${error?.message ?? error}`);
  }
}

function formatRupees(paise) {
  return `Rs ${Math.floor(paise / 100)}`;
}

console.log(`seed-products: ${created} created, ${left} already there.`);

if (failed) {
  console.error("seed-products: finished with errors.");
  process.exit(1);
}
console.log("seed-products: done.");
