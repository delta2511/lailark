// Tests for functions/scripts/seed-open-batch.mjs, the seed that makes one
// product actually sellable as an open (pre-order) batch so a real Razorpay
// test payment can be made on staging.
//
// The refusal tests need nothing but node. The rest need the Firestore
// emulator, and they start their **own** on the port in firebase.json rather
// than touching one that is already running: if 8080 is busy when this file
// loads, those tests are skipped with a message instead of writing into, or
// wiping, somebody's live emulator data.
//
// They also need functions to be built, because the sellability check runs
// the real `computeCounts` out of functions/lib rather than a second copy of
// what it does. `npm test` builds first; running this file on its own needs
// "npm run build --workspace @lailark/functions" beforehand, and says so.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SEED = resolve(ROOT, "functions", "scripts", "seed-open-batch.mjs");
const SEED_PRODUCTS = resolve(ROOT, "functions", "scripts", "seed-products.mjs");
const COUNTS_LIB = resolve(ROOT, "functions", "lib", "api", "counts.js");

const FIRESTORE_PORT = 8080;
const FIRESTORE_HOST = `127.0.0.1:${FIRESTORE_PORT}`;
const PROJECT_ID = "lailark"; // firebase.json has singleProjectMode
const PRODUCT_SLUG = "prawns-and-dates";
const BATCH_REF = "b-0pen15";
const RECIPE_ID = "seed-open-batch-recipe";
const INGREDIENT_ID = "seed-open-batch-prawns";
const PRICE_OPEN_PAISE = 59_900;
const PRICE_IN_STOCK_PAISE = 64_900;

/* -------------------------------------------------------------------------- */
/* No emulator needed: the guards                                             */
/* -------------------------------------------------------------------------- */

function runSeed(argv, env = {}) {
  return spawnSync(process.execPath, [SEED, ...argv], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("refuses the production project id without --force", () => {
  const { status, stderr } = runSeed(["--project", "lailark"], {
    FIRESTORE_EMULATOR_HOST: "",
    FIREBASE_AUTH_EMULATOR_HOST: "",
  });
  assert.equal(status, 2);
  assert.match(stderr, /refusing/i);
  assert.match(stderr, /lailark/);
  assert.match(stderr, /--force/);
  // It must not have got as far as talking to Firestore.
  assert.doesNotMatch(stderr, /credential/i);
});

test("refuses to run with neither --emulator nor --project", () => {
  const { status, stderr } = runSeed([]);
  assert.equal(status, 2);
  assert.match(stderr, /--emulator/);
  assert.match(stderr, /--project/);
});

test("refuses an unknown argument", () => {
  const { status, stderr } = runSeed(["--emulator", "--open-everything"]);
  assert.equal(status, 2);
  assert.match(stderr, /unknown argument --open-everything/);
});

test("refuses --project with an emulator host in the environment", () => {
  const { status, stderr } = runSeed(["--project", "tree-quiz-74e04"], {
    FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST,
  });
  assert.equal(status, 2);
  assert.match(stderr, /emulator host is set/);
});

/* -------------------------------------------------------------------------- */
/* Against the emulator                                                       */
/* -------------------------------------------------------------------------- */

function portOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (answer) => {
      socket.destroy();
      resolvePromise(answer);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitFor(predicate, timeoutMs, everyMs = 400) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

let emulator = null;
let skipReason = null;
let db = null;
let computeCounts = null;

async function startEmulator() {
  if (await portOpen(FIRESTORE_PORT)) {
    return `something is already listening on ${FIRESTORE_HOST}. These tests start their own Firestore emulator and will not write into one they did not start.`;
  }
  if (!existsSync(COUNTS_LIB)) {
    return `${COUNTS_LIB} not found. Run "npm run build --workspace @lailark/functions" first.`;
  }
  const child = spawn(
    "firebase",
    ["emulators:start", "--only", "firestore", "--project", PROJECT_ID],
    { cwd: ROOT, stdio: "ignore", detached: true },
  );
  let spawnError = null;
  child.once("error", (error) => (spawnError = error));
  const up = await waitFor(async () => spawnError === null && (await portOpen(FIRESTORE_PORT)), 90_000);
  if (spawnError) return `could not start the Firestore emulator: ${spawnError.message}`;
  if (!up) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    return "the Firestore emulator did not come up within 90s.";
  }
  emulator = child;
  return null;
}

before(async () => {
  skipReason = await startEmulator();
  if (skipReason !== null) return;

  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  db = getFirestore(initializeApp({ projectId: PROJECT_ID }, "seed-open-batch-test"));

  // The real endpoint's own computation, not a second copy of it.
  computeCounts = createRequire(import.meta.url)(COUNTS_LIB).computeCounts;

  // /api/counts only reports a product that is in the catalogue and active.
  const products = spawnSync(process.execPath, [SEED_PRODUCTS, "--emulator"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(products.status, 0, products.stderr);
});

after(() => {
  if (emulator === null) return;
  try {
    process.kill(-emulator.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
});

describe("against the emulator", () => {
  test("creates the ingredient, the recipe and one open batch with no number", async (t) => {
    if (skipReason !== null) return t.skip(skipReason);

    const first = spawnSync(process.execPath, [SEED, "--emulator"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);

    const ingredient = await db.collection("ingredients").doc(INGREDIENT_ID).get();
    assert.ok(ingredient.exists, "the ingredient was not created");
    assert.equal(ingredient.get("labelName"), "Prawns");

    const recipe = await db.collection("recipes").doc(RECIPE_ID).get();
    assert.ok(recipe.exists, "the recipe was not created");
    assert.equal(recipe.get("productSlug"), PRODUCT_SLUG);
    const mains = recipe.get("lines").filter((line) => line.isMain === true);
    assert.equal(mains.length, 1, "the recipe must name exactly one main ingredient");
    assert.equal(mains[0].ingredientId, INGREDIENT_ID);

    const batch = await db.collection("batches").doc(BATCH_REF).get();
    assert.ok(batch.exists, "the batch was not created");
    assert.equal(batch.get("state"), "open");
    assert.equal(batch.get("productSlug"), PRODUCT_SLUG);
    assert.equal(batch.get("recipeId"), RECIPE_ID);
    // D21c: no number until bottling, and written as an explicit null.
    assert.equal(batch.get("batchNo"), null);
    assert.ok("batchNo" in batch.data(), "batchNo must be present as an explicit null");
    // Integers in paise, ₹599 open and ₹649 in stock, never above the MRP.
    assert.equal(batch.get("priceOpen"), PRICE_OPEN_PAISE);
    assert.equal(batch.get("priceInStock"), PRICE_IN_STOCK_PAISE);
    assert.ok(Number.isInteger(batch.get("priceOpen")));
    assert.ok(Number.isInteger(batch.get("priceInStock")));
    assert.ok(batch.get("priceOpen") <= PRICE_IN_STOCK_PAISE);
    // The 90% cap and the quarter, as batchMaths gives them for 20 planned.
    assert.equal(batch.get("plannedJars"), 20);
    assert.equal(batch.get("bookableJars"), 18);
    assert.equal(batch.get("perPersonLimit"), 4);
    assert.equal(batch.get("paidCount"), 0);
    assert.deepEqual(batch.get("heldJars"), {});
  });

  test("consumes no numbered resource: counters is untouched", async (t) => {
    if (skipReason !== null) return t.skip(skipReason);
    // A228/A229 are both a seed writing a numbered resource without moving
    // its counter. This seed writes no number at all (D21c), so the claim to
    // check is the strong one: after the seed, there is no counter document.
    const counters = await db.collection("counters").get();
    assert.equal(
      counters.size,
      0,
      `seed-open-batch touched counters: ${counters.docs.map((d) => d.id).join(", ")}`,
    );
  });

  test("/api/counts reports the product as bookable rather than none", async (t) => {
    if (skipReason !== null) return t.skip(skipReason);

    const payload = await computeCounts(db);
    const entry = payload.products[PRODUCT_SLUG];
    assert.ok(entry, `${PRODUCT_SLUG} is missing from /api/counts`);
    assert.equal(entry.mode, "open", `mode is ${entry.mode}, so nothing can be booked`);
    assert.equal(entry.priceOpenPaise, PRICE_OPEN_PAISE);
    assert.equal(entry.total, 18);
    assert.equal(entry.count, 0);
    assert.ok(entry.available >= 1, `available is ${entry.available}: no jar to sell`);
    assert.equal(entry.perPersonLimit, 4);
  });

  test("running twice creates nothing a second time and doubles nothing", async (t) => {
    if (skipReason !== null) return t.skip(skipReason);

    const before = await db.collection("batches").doc(BATCH_REF).get();
    const second = spawnSync(process.execPath, [SEED, "--emulator"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already exists/);
    assert.match(second.stdout, /already open/);

    // One batch for this recipe, not two. Scoped to this seed's own recipe so
    // any other batch in the emulator cannot make this pass or fail wrongly.
    const ours = await db.collection("batches").where("recipeId", "==", RECIPE_ID).get();
    assert.equal(ours.size, 1, "a second run created another batch");

    const after = await db.collection("batches").doc(BATCH_REF).get();
    assert.deepEqual(after.get("plannedJars"), before.get("plannedJars"));
    assert.deepEqual(after.get("bookableJars"), before.get("bookableJars"));
    assert.equal(after.get("paidCount"), 0);
    assert.equal(after.get("state"), "open");
    assert.equal(after.get("batchNo"), null);
    // Nothing was rewritten: the open step found it open and wrote no update.
    assert.equal(
      after.get("updatedAt")?.toMillis?.(),
      before.get("updatedAt")?.toMillis?.(),
    );

    const ingredients = await db
      .collection("ingredients")
      .where("labelName", "==", "Prawns")
      .get();
    assert.ok(
      ingredients.docs.filter((d) => d.id === INGREDIENT_ID).length === 1,
      "the ingredient was created twice",
    );

    const counters = await db.collection("counters").get();
    assert.equal(counters.size, 0, "a second run touched counters");
  });

  test("does not wind a batch that has moved on back to open", async (t) => {
    if (skipReason !== null) return t.skip(skipReason);

    // Booking closes when the pot goes on (brief §7.5). A re-run of the seed
    // must never reopen it at ₹599.
    await db.collection("batches").doc(BATCH_REF).update({ state: "cooking" });
    try {
      const again = spawnSync(process.execPath, [SEED, "--emulator"], { cwd: ROOT, encoding: "utf8" });
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /left alone: it is cooking/);
      const batch = await db.collection("batches").doc(BATCH_REF).get();
      assert.equal(batch.get("state"), "cooking");
    } finally {
      await db.collection("batches").doc(BATCH_REF).update({ state: "open" });
    }
  });
});
