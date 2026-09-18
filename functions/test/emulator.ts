/**
 * The emulator harness for the batch state machine.
 *
 * `firebase emulators:exec` starts Firestore, Auth and Functions around these
 * tests (see the `test` script in package.json), so the callable, its
 * transaction and both triggers are the real deployed code paths, called over
 * real HTTP with a real ID token carrying a real role claim.
 *
 * Nothing in here is compiled into `lib/`: tsconfig only includes `src`.
 */

process.env.GCLOUD_PROJECT ??= "lailark";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export const PROJECT = process.env.GCLOUD_PROJECT ?? "lailark";
export const AUTH_HOST = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
export const FIRESTORE_HOST = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
export const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST ?? "http://127.0.0.1:5001";
const API_KEY = "fake-api-key";

/** CLAUDE.md section 9, plus a Viewer and a number with no role at all. */
export const PHONES = {
  owner: "+917736110087",
  kitchen: "+919446587027",
  viewer: "+919000000111",
  noRole: "+919000000222",
} as const;

export type Who = keyof typeof PHONES;

export function db(): Firestore {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  return getFirestore();
}

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Everything in Firestore, gone. Auth users and their claims survive. */
export async function clearFirestore(): Promise<void> {
  const res = await fetch(
    `${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`could not clear Firestore: ${res.status}`);
}

/**
 * The promise is cached, not the token: a race test fires six calls at once,
 * and six concurrent sign-ins for the same number would race to create the
 * same Auth user.
 */
const tokens = new Map<string, Promise<string>>();

/**
 * A real ID token for one of the four numbers, carrying the role claim the
 * Firestore rules and every callable read. The claim is set with the Admin
 * SDK before the sign-in, so the token the emulator issues already has it.
 */
export function idTokenFor(who: Who): Promise<string> {
  const cached = tokens.get(who);
  if (cached) return cached;
  const fresh = signIn(who);
  tokens.set(who, fresh);
  return fresh;
}

async function signIn(who: Who): Promise<string> {
  const phone = PHONES[who];
  const auth = getAuth(db().app);
  let uid: string;
  try {
    uid = (await auth.getUserByPhoneNumber(phone)).uid;
  } catch {
    try {
      uid = (await auth.createUser({ phoneNumber: phone })).uid;
    } catch {
      uid = (await auth.getUserByPhoneNumber(phone)).uid;
    }
  }
  await auth.setCustomUserClaims(uid, who === "noRole" ? {} : { role: roleOf(who) });

  const sent = await json(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, recaptchaToken: "ignored" }),
    },
  );
  const sessionInfo: string = sent.body.sessionInfo;
  const codes = await json(`${AUTH_HOST}/emulator/v1/projects/${PROJECT}/verificationCodes`);
  const match = codes.body.verificationCodes.find(
    (c: { sessionInfo: string }) => c.sessionInfo === sessionInfo,
  );
  if (!match) throw new Error(`no verification code for ${phone}`);
  const signedIn = await json(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionInfo, code: match.code }),
    },
  );
  const token: string | undefined = signedIn.body.idToken;
  if (!token) throw new Error(`no idToken for ${phone}: ${JSON.stringify(signedIn.body)}`);
  return token;
}

function roleOf(who: Who): string {
  return who === "owner" ? "owner" : who === "kitchen" ? "kitchen" : "viewer";
}

/** Calls any callable as `who`, or as nobody when `who` is null. */
export async function callFunction(
  name: string,
  who: Who | null,
  data: Record<string, unknown>,
) {
  const token = who === null ? null : await idTokenFor(who);
  const res = await json(`${FUNCTIONS_HOST}/${PROJECT}/asia-south1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, result: res.body.result, error: res.body.error };
}

/** Calls `transitionBatch` as `who`, or as nobody when `who` is null. */
export async function transition(who: Who | null, data: Record<string, unknown>) {
  return callFunction("transitionBatch", who, data);
}

/** Calls `approveBatchFull` as `who`: section 8.2's owner yes on the full flag. */
export async function approveFull(who: Who | null, data: Record<string, unknown>) {
  return callFunction("approveBatchFull", who, data);
}

/** The same call, but a failure is a thrown error with the message in it. */
export async function mustTransition(who: Who | null, data: Record<string, unknown>) {
  const out = await transition(who, data);
  if (!out.result) {
    throw new Error(`transitionBatch ${JSON.stringify(data)} failed: ${JSON.stringify(out.error)}`);
  }
  return out.result;
}

/** One `approvals/{id}` document, or null. */
export async function approvalDoc(id: string) {
  const snap = await db().collection("approvals").doc(id).get();
  return snap.exists ? (snap.data() ?? null) : null;
}

export async function batchDoc(batchNo: string) {
  const snap = await db().collection("batches").doc(batchNo).get();
  const data = snap.data();
  if (!data) throw new Error(`no batch ${batchNo}`);
  return data;
}

/**
 * Triggers are delivered out of band, so every assertion about one waits for
 * it rather than assuming it has landed. Fails with the last value seen.
 */
export async function waitFor<T>(
  what: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    last = await read();
    if (ready(last)) return last;
    if (Date.now() > until) {
      throw new Error(`timed out waiting for ${what}; last saw ${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Waits for a batch to be in one of `states`. */
export async function waitForState(batchNo: string, ...states: string[]) {
  return waitFor(
    `batch ${batchNo} to be ${states.join(" or ")}`,
    async () => {
      const snap = await db().collection("batches").doc(batchNo).get();
      return snap.data() ?? {};
    },
    (data) => states.includes(String(data.state)),
  );
}

/**
 * Money arriving, as M3's hold-and-pay transaction will write it. The tests
 * cannot call that yet (it is M2.8 and M3), so they write `paidCount` with
 * admin rights, which is exactly what that transaction will do.
 */
export async function setPaidCount(batchNo: string, paidCount: number): Promise<void> {
  await db().collection("batches").doc(batchNo).update({ paidCount });
}
