#!/usr/bin/env node
/**
 * Seeds the admin allowlist: the two numbers in CLAUDE.md section 9.
 *
 *   node functions/scripts/seed-users.mjs --emulator
 *   node functions/scripts/seed-users.mjs --project lailark-staging
 *
 * Idempotent. Re-running finds the existing Auth users, re-asserts the claim
 * and leaves createdAt alone. It uses the Admin SDK directly rather than the
 * setRole callable, because seeding is exactly the bootstrap case: there is no
 * Owner yet to authorise the first call.
 *
 * Against a real project it needs application default credentials
 * (`gcloud auth application-default login`) and the project id spelled out.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const AUTH_EMULATOR = "127.0.0.1:9099";
const FIRESTORE_EMULATOR = "127.0.0.1:8080";

/** CLAUDE.md section 9, D13. Owner first so the last-Owner rule is never tripped. */
const SEED = [
  { name: "Shefin", phone: "+917736110087", role: "owner" },
  { name: "Sumayya", phone: "+919446587027", role: "kitchen" },
];

function parseArgs(argv) {
  const args = { emulator: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--emulator") args.emulator = true;
    else if (arg === "--project") args.project = argv[++i] ?? null;
    else if (arg.startsWith("--project=")) args.project = arg.slice("--project=".length);
    else {
      console.error(`seed-users: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.emulator && !args.project) {
  console.error(
    "seed-users: pass --emulator for the local suite, or --project <id> for a real project.",
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
      "seed-users: an emulator host is set in the environment but --emulator was not passed. Stopping.",
    );
    process.exit(2);
  }
}

const where = args.emulator
  ? `emulator (auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST}, firestore ${process.env.FIRESTORE_EMULATOR_HOST})`
  : `project ${projectId}`;
console.log(`seed-users: seeding the admin allowlist into the ${where}.`);

const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);

async function findOrCreate(phone) {
  try {
    return { user: await auth.getUserByPhoneNumber(phone), created: false };
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      return { user: await auth.createUser({ phoneNumber: phone }), created: true };
    }
    throw error;
  }
}

let failed = false;
for (const person of SEED) {
  try {
    const { user, created } = await findOrCreate(person.phone);
    await auth.setCustomUserClaims(user.uid, { role: person.role });

    const ref = db.collection("users").doc(user.uid);
    const existing = await ref.get();
    const now = FieldValue.serverTimestamp();
    await ref.set(
      {
        name: person.name,
        phone: person.phone,
        role: person.role,
        active: true,
        updatedAt: now,
        updatedBy: "seed",
        ...(existing.exists ? {} : { createdAt: now, createdBy: "seed" }),
      },
      { merge: true },
    );

    console.log(
      `  ${person.role.padEnd(7)} ${person.phone}  ${person.name}  uid=${user.uid}  ` +
        `${created ? "auth user created" : "auth user found"}, ` +
        `${existing.exists ? "users doc updated" : "users doc created"}`,
    );
  } catch (error) {
    failed = true;
    console.error(`  failed for ${person.phone}: ${error?.message ?? error}`);
  }
}

if (failed) {
  console.error("seed-users: finished with errors.");
  process.exit(1);
}
console.log("seed-users: done.");
