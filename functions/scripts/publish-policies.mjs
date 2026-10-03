#!/usr/bin/env node
/**
 * Publishes the five policy pages into `policyVersions` (M5.7, D66).
 *
 *   node functions/scripts/publish-policies.mjs --emulator
 *   node functions/scripts/publish-policies.mjs --project tree-quiz-74e04
 *
 * The words are `@lailark/shared`'s `POLICY_PAGES`, the same module the site
 * renders and the same module `createCheckout` derives an order's
 * `policyVersion` from, so this script types no copy of its own. The version
 * is `POLICY_SET_VERSION`, a fingerprint of the five pages' text: editing a
 * sentence gives the set a new id, so a second run after an edit publishes a
 * new version beside the old one rather than rewriting text somebody's order
 * already points at.
 *
 * Idempotent, and strictly so: a document that exists is left exactly as it
 * is, field for field. `publishedAt` is the day a version first appeared and
 * re-running must not move it. Nothing is ever deleted here, because an order
 * from last year is only readable against the policy of its day.
 *
 * `createCheckout` publishes the live set itself, once per instance, so the
 * pages are never missing when an order needs them. This script is for
 * putting them in place before the first customer arrives rather than a
 * moment after, and for seeing what is published.
 *
 * It refuses the production project id (`lailark`) without `--force`, like its
 * siblings: publishing is harmless, but a wrong `--project` on a seeding
 * script is not a habit worth having.
 *
 * Against a real project it needs application default credentials
 * (`gcloud auth application-default login`) and the project id spelled out.
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  POLICY_PAGES,
  POLICY_SET_VERSION,
  policyPageText,
  policyVersionDocId,
} from "@lailark/shared";

const FIRESTORE_EMULATOR = "127.0.0.1:8080";
const COLLECTION = "policyVersions";

function parseArgs(argv) {
  const args = { emulator: false, project: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--emulator") args.emulator = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--project") args.project = argv[++i] ?? null;
    else if (arg.startsWith("--project=")) args.project = arg.slice("--project=".length);
    else {
      console.error(`publish-policies: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.emulator && !args.project) {
  console.error(
    "publish-policies: pass --emulator for the local suite, or --project <id> for a real project.",
  );
  process.exit(2);
}

let projectId;
if (args.emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= FIRESTORE_EMULATOR;
  projectId = args.project ?? process.env.GCLOUD_PROJECT ?? "lailark";
  process.env.GCLOUD_PROJECT ??= projectId;
} else {
  projectId = args.project;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      "publish-policies: an emulator host is set in the environment but --emulator was not passed. Stopping.",
    );
    process.exit(2);
  }
  if (projectId === "lailark" && !args.force) {
    console.error(
      "publish-policies: refusing to write to the production project (lailark) without " +
        "--force. Pass --emulator for the local suite, --project tree-quiz-74e04 for " +
        "staging, or --force if you really mean production.",
    );
    process.exit(2);
  }
}

const where = args.emulator
  ? `emulator (firestore ${process.env.FIRESTORE_EMULATOR_HOST})`
  : `project ${projectId}`;
console.log(`publish-policies: publishing ${POLICY_SET_VERSION} into the ${where}.`);

const app = initializeApp({ projectId });
const db = getFirestore(app);

let created = 0;
let untouched = 0;
let failed = false;

for (const page of POLICY_PAGES) {
  const id = policyVersionDocId(POLICY_SET_VERSION, page.kind);
  try {
    const ref = db.collection(COLLECTION).doc(id);
    const existing = await ref.get();
    if (existing.exists) {
      untouched += 1;
      console.log(`  ${page.path.padEnd(10)} ${id}  already published, left alone`);
      continue;
    }
    const now = FieldValue.serverTimestamp();
    await ref.create({
      kind: page.kind,
      text: policyPageText(page),
      path: page.path,
      setVersion: POLICY_SET_VERSION,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: "seed",
    });
    created += 1;
    console.log(`  ${page.path.padEnd(10)} ${id}  published`);
  } catch (error) {
    failed = true;
    console.error(`  failed for ${page.path}: ${error?.message ?? error}`);
  }
}

console.log(
  `publish-policies: ${created} published, ${untouched} already there. ` +
    `Orders placed against this build record policyVersion "${POLICY_SET_VERSION}".`,
);

process.exit(failed ? 1 : 0);
