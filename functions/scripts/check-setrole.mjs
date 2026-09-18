#!/usr/bin/env node
/**
 * Exercises the `setRole` callable against the running emulator suite.
 *
 *   npm run emulators            # in one terminal (auth, firestore, functions)
 *   node functions/scripts/check-setrole.mjs
 *
 * This is the integration counterpart to the unit tests in
 * functions/src/auth/authorise.test.ts: same matrix, real HTTP, real claims.
 * It is not wired into `npm test`, which keeps the test run free of a
 * compiled functions build.
 */
const AUTH = "http://127.0.0.1:9099";
const PROJECT = "lailark";
const CALLABLE = `http://127.0.0.1:5001/${PROJECT}/asia-south1/setRole`;
const KEY = "fake-api-key";

const OWNER = "+917736110087";
const KITCHEN = "+919446587027";

async function json(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** A real ID token for a phone number, through the emulator's phone flow. */
async function idTokenFor(phone) {
  const sent = await json(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, recaptchaToken: "ignored" }),
    },
  );
  const { sessionInfo } = sent.body;
  const codes = await json(`${AUTH}/emulator/v1/projects/${PROJECT}/verificationCodes`);
  const match = codes.body.verificationCodes.find((c) => c.sessionInfo === sessionInfo);
  const signedIn = await json(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionInfo, code: match.code }),
    },
  );
  if (!signedIn.body.idToken) throw new Error(`no idToken for ${phone}: ${JSON.stringify(signedIn)}`);
  return signedIn.body.idToken;
}

async function call(data, idToken) {
  return json(CALLABLE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (wanted ${expected})`}`);
}

const ownerToken = await idTokenFor(OWNER);
const kitchenToken = await idTokenFor(KITCHEN);

console.log("setRole against the emulator:");

const anon = await call({ phone: "+919999900001", role: "viewer" }, null);
check("no token", anon.body.error?.status, "UNAUTHENTICATED");

const kitchen = await call({ phone: "+919999900001", role: "viewer" }, kitchenToken);
check("Kitchen caller", kitchen.body.error?.status, "PERMISSION_DENIED");

const bad = await call({ phone: "+919999900001", role: "boss" }, ownerToken);
check("bad role", bad.body.error?.status, "INVALID_ARGUMENT");

const badPhone = await call({ phone: "9999900001", role: "viewer" }, ownerToken);
check("phone not E.164", badPhone.body.error?.status, "INVALID_ARGUMENT");

const bootstrap = await call(
  { phone: "+919999900001", role: "owner", bootstrapSecret: "anything" },
  null,
);
check("bootstrap on a seeded users list", bootstrap.body.error?.status, "FAILED_PRECONDITION");

const made = await call(
  { phone: "+919999900001", role: "viewer", name: "Viewer for the CA" },
  ownerToken,
);
check("Owner creates a Viewer", made.body.result?.role, "viewer");
console.log(`       result: ${JSON.stringify(made.body.result ?? made.body)}`);

const demote = await call({ phone: OWNER, role: "kitchen" }, ownerToken);
check("demoting the only Owner", demote.body.error?.status, "FAILED_PRECONDITION");

const again = await call({ phone: "+919999900001", role: "kitchen" }, ownerToken);
check("Owner moves that user to Kitchen", again.body.result?.role, "kitchen");

if (failures > 0) {
  console.error(`check-setrole: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("check-setrole: all checks passed.");
