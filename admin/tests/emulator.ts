import type { Page } from "@playwright/test";

export const AUTH_EMULATOR = "http://127.0.0.1:9099";
export const FIRESTORE_EMULATOR = "http://127.0.0.1:8080";
export const PROJECT = "lailark";

/** CLAUDE.md section 8. */
export const OWNER_PHONE = "+91 7736110087";
export const KITCHEN_PHONE = "+91 9446587027";
export const STRANGER_PHONE = "+91 9999999999";
export const OTP = "123456";

/**
 * A Viewer, for M2.4: CLAUDE.md section 9 only lists Owner and Kitchen as
 * admin users at launch, so there is no Viewer number on the seeded
 * allowlist. This number is test-only infrastructure, provisioned by
 * `ensureAdminUser` below, never part of the launch roster in
 * `functions/scripts/seed-users.mjs`.
 */
export const VIEWER_PHONE = "+91 9000000131";

interface VerificationCode {
  code: string;
  phoneNumber: string;
  sessionInfo: string;
}

async function verificationCodes(): Promise<VerificationCode[]> {
  const res = await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`);
  if (!res.ok) throw new Error(`auth emulator returned ${res.status} for verificationCodes`);
  const body = (await res.json()) as { verificationCodes?: VerificationCode[] };
  return body.verificationCodes ?? [];
}

/**
 * Makes the OTP in CLAUDE.md section 8 true.
 *
 * The Auth emulator generates a random six digit code for every
 * accounts:sendVerificationCode and ignores the project's test phone numbers
 * (firebase-tools 15.30.1: state.createVerificationCode always calls
 * randomDigits(6)). So the test types 123456, exactly as section 8 says, and
 * this route swaps in the code the emulator actually issued for that session.
 *
 * It fails closed: if the swap does not happen, 123456 is simply wrong and the
 * sign-in fails.
 */
export async function acceptFixedOtp(page: Page): Promise<void> {
  await page.route("**/accounts:signInWithPhoneNumber*", async (route) => {
    const raw = route.request().postData();
    if (!raw) return route.continue();

    let body: { sessionInfo?: string; code?: string };
    try {
      body = JSON.parse(raw) as { sessionInfo?: string; code?: string };
    } catch {
      return route.continue();
    }

    if (body.code !== OTP || !body.sessionInfo) return route.continue();

    const match = (await verificationCodes()).find((c) => c.sessionInfo === body.sessionInfo);
    if (!match) return route.continue();

    return route.continue({ postData: JSON.stringify({ ...body, code: match.code }) });
  });
}

/* -------------------------------------------------------------------------- */
/* A role for a phone the launch allowlist does not carry (M2.4)              */
/* -------------------------------------------------------------------------- */

const IDENTITY_ADMIN_HEADERS = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const IDENTITY_BASE = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;

/**
 * The Auth emulator accepts `Authorization: Bearer owner` on the plain
 * Identity Toolkit REST surface exactly the way it accepts it on Firestore's:
 * it is the same convention the Admin SDK itself uses when it detects
 * `FIREBASE_AUTH_EMULATOR_HOST` (`firebase-admin/lib/auth/auth-api-request.js`,
 * `AuthHttpClient.getToken`). This finds or creates the Auth user for `phone`
 * and gives it `{ role }` as a custom claim, with no service account and no
 * new dependency: the same admin bypass, over `fetch`.
 */
export async function ensureAdminUser(phone: string, role: string): Promise<void> {
  // The Auth emulator matches phone numbers literally, and `signInWithPhoneNumber`
  // always signs in on the E.164 form `parseIndianMobile` produces (no space),
  // whatever formatting the UI's own text box was typed with. `phone` here may
  // be given in either spelling (`OWNER_PHONE`-style, for typing into the box,
  // or already E.164), so this strips whitespace before it ever reaches the
  // REST call, or the seeded user and the one that actually signs in would be
  // two different accounts.
  const e164 = phone.replace(/\s+/g, "");
  const lookup = await fetch(`${IDENTITY_BASE}/accounts:lookup`, {
    method: "POST",
    headers: IDENTITY_ADMIN_HEADERS,
    body: JSON.stringify({ phoneNumber: [e164] }),
  });
  const lookupBody = (await lookup.json()) as { users?: Array<{ localId: string }> };
  let uid = lookupBody.users?.[0]?.localId;

  if (!uid) {
    const created = await fetch(`${IDENTITY_BASE}/accounts`, {
      method: "POST",
      headers: IDENTITY_ADMIN_HEADERS,
      body: JSON.stringify({ phoneNumber: e164 }),
    });
    const createdBody = (await created.json()) as { localId?: string; error?: unknown };
    if (!createdBody.localId) {
      throw new Error(`could not create an auth user for ${e164}: ${JSON.stringify(createdBody)}`);
    }
    uid = createdBody.localId;
  }

  const updated = await fetch(`${IDENTITY_BASE}/accounts:update`, {
    method: "POST",
    headers: IDENTITY_ADMIN_HEADERS,
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ role }) }),
  });
  if (!updated.ok) {
    throw new Error(`could not set role for ${phone}: ${updated.status} ${await updated.text()}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Calling a callable as a role, without a browser (M2.5)                     */
/* -------------------------------------------------------------------------- */

export const FUNCTIONS_EMULATOR = "http://127.0.0.1:5001";
export const REGION = "asia-south1";
const API_KEY = "fake-api-key";

/**
 * A real ID token for one of the seeded numbers, carrying its role claim.
 *
 * The same route the app takes, over plain `fetch`: ask the Auth emulator for
 * a verification code, read the code it issued out of its own debug endpoint,
 * and sign in with it. `ensureAdminUser` must have set the claim first, or the
 * token comes back without a role, which is the whole thing being tested.
 *
 * This exists so "Owner only" can be tested where it is enforced. A screen
 * with no button on it proves nothing: the Kitchen's phone can call the
 * callable directly, so the test does exactly that and expects a refusal.
 */
export async function idTokenFor(phone: string): Promise<string> {
  const e164 = phone.replace(/\s+/g, "");
  const sent = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: e164, recaptchaToken: "ignored" }),
    },
  );
  const { sessionInfo } = (await sent.json()) as { sessionInfo?: string };
  if (!sessionInfo) throw new Error(`no sessionInfo for ${e164}`);

  const match = (await verificationCodes()).find((c) => c.sessionInfo === sessionInfo);
  if (!match) throw new Error(`no verification code for ${e164}`);

  const signedIn = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionInfo, code: match.code }),
    },
  );
  const body = (await signedIn.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`no idToken for ${e164}: ${JSON.stringify(body)}`);
  return body.idToken;
}

/** Calls a callable over the functions emulator as the holder of `token`. */
export async function callCallable(
  name: string,
  token: string | null,
  data: Record<string, unknown>,
): Promise<{ status: number; result?: unknown; error?: { status?: string; message?: string } }> {
  const res = await fetch(`${FUNCTIONS_EMULATOR}/${PROJECT}/${REGION}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { status?: string; message?: string };
  };
  return { status: res.status, result: body.result, error: body.error };
}

/* -------------------------------------------------------------------------- */
/* Seeding, with admin rights (M2.1)                                          */
/* -------------------------------------------------------------------------- */

const DOCUMENTS = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents`;

/**
 * The Firestore emulator treats `Authorization: Bearer owner` as the Admin
 * SDK, so a seed written this way bypasses the security rules exactly the way
 * a Cloud Function would. That is what lets a test flip the Owner's
 * `settings/permissions.kitchenCanEditRecipes` switch, which no client role
 * but the Owner may write.
 */
const ADMIN_HEADERS = {
  Authorization: "Bearer owner",
  "Content-Type": "application/json",
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * `{ __ts: "2026-09-19T00:00:00.000Z" }` seeds a Firestore Timestamp field.
 * Needed for `createdAt`/`updatedAt` on a hand-seeded batch: the Batches list
 * orders by `createdAt` (brief 17.4, "newest first"), and Firestore drops a
 * document with no value at all for the field a query orders by, so a seeded
 * batch with a plain string or number there would silently never appear.
 */
export function timestampValue(iso: string = new Date().toISOString()): { readonly __ts: string } {
  return { __ts: iso };
}

function isTimestampMarker(value: Json): value is { readonly __ts: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "__ts" in value;
}

function typedValue(value: Json): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(typedValue) } };
  }
  if (isTimestampMarker(value)) {
    return { timestampValue: value.__ts };
  }
  return { mapValue: { fields: typedFields(value) } };
}

function typedFields(data: Record<string, Json>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typedValue(value)]));
}

/** Creates or replaces `documents/{path}` as the Admin SDK would. */
export async function seedDocument(path: string, data: Record<string, Json>): Promise<void> {
  const res = await fetch(`${DOCUMENTS}/${path}`, {
    method: "PATCH",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ fields: typedFields(data) }),
  });
  if (!res.ok) throw new Error(`seeding ${path} returned ${res.status}: ${await res.text()}`);
}

/**
 * Reads `documents/{path}` back as plain JavaScript, with admin rights, so a
 * test can assert what actually reached Firestore rather than what the screen
 * happens to be showing. Returns null when the document is not there.
 */
export async function readDocument(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${DOCUMENTS}/${path}`, { headers: ADMIN_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`reading ${path} returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { fields?: Record<string, unknown> };
  return plainFields(body.fields ?? {});
}

function plainValue(value: unknown): unknown {
  const v = value as Record<string, unknown>;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) {
    const inner = (v.arrayValue as { values?: unknown[] }).values ?? [];
    return inner.map(plainValue);
  }
  if ("mapValue" in v) {
    const inner = (v.mapValue as { fields?: Record<string, unknown> }).fields ?? {};
    return plainFields(inner);
  }
  return undefined;
}

function plainFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, plainValue(value)]));
}

/**
 * Sets only the named fields on `documents/{path}`, leaving every other field
 * alone (`seedDocument` replaces the whole document). M2.4's walk test needs
 * this: it may move the paid count, which is what makes a batch reach half,
 * without also seeding the state the trigger is supposed to compute.
 */
export async function patchDocument(path: string, data: Record<string, Json>): Promise<void> {
  const mask = Object.keys(data)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOCUMENTS}/${path}?${mask}`, {
    method: "PATCH",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ fields: typedFields(data) }),
  });
  if (!res.ok) throw new Error(`patching ${path} returned ${res.status}: ${await res.text()}`);
}

/** Removes `documents/{path}`. Deleting something that is not there is fine. */
export async function deleteDocument(path: string): Promise<void> {
  const res = await fetch(`${DOCUMENTS}/${path}`, { method: "DELETE", headers: ADMIN_HEADERS });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleting ${path} returned ${res.status}: ${await res.text()}`);
  }
}

/** The Owner's Q4 switch (D22): the one setting only the Owner may write. */
export async function setKitchenCanEditRecipes(on: boolean): Promise<void> {
  await seedDocument("settings/permissions", { kitchenCanEditRecipes: on });
}

/* -------------------------------------------------------------------------- */
/* Batches (M2.4): a full document, in whatever state a test needs to start   */
/* from, matching the shape `functions/src/batches/transitions.ts` writes.    */
/* -------------------------------------------------------------------------- */

/** Every field a batch document carries, so a hand-seeded one never confuses the screen with a missing key. */
export function batchFields(overrides: Record<string, Json>): Record<string, Json> {
  const now = timestampValue();
  return {
    batchNo: null,
    productSlug: "",
    productName: null,
    recipeId: "",
    mainIngredientName: null,
    state: "draft",
    plannedJars: 0,
    bookableJars: 0,
    perPersonLimit: 0,
    // D44: automatic until the Owner types his own cap.
    perPersonLimitOverride: null,
    priceOpen: 59_900,
    priceInStock: 64_900,
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
    createdAt: now,
    updatedAt: now,
    updatedBy: "seed",
    ...overrides,
  };
}

/** Seeds `batches/{ref}` with admin rights, in whatever state a test needs to start from. */
export async function seedBatch(ref: string, overrides: Record<string, Json>): Promise<void> {
  await seedDocument(`batches/${ref}`, batchFields(overrides));
}

/** Seeds a waiting approval against a batch, with an optional production clock. */
export async function seedApproval(
  id: string,
  overrides: Record<string, Json>,
): Promise<void> {
  const now = timestampValue();
  await seedDocument(`approvals/${id}`, {
    kind: "halfReached",
    batchRef: "",
    // M2.5: which kitchen photo update this is about (D5), the Owner's "not
    // yet" reason, and the morning that deferral brings the card back on.
    updateId: null,
    draft: "",
    status: "waiting",
    answeredBy: null,
    at: null,
    reason: null,
    remindAt: null,
    dueAt: null,
    dueAtSupersededBy: null,
    sentAt: null,
    createdBy: "seed",
    createdAt: now,
    updatedAt: now,
    updatedBy: "seed",
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* Reading a collection back by one field (M2.8)                              */
/* -------------------------------------------------------------------------- */

/**
 * Every document in `collectionId` whose `fieldPath` equals `value`, read
 * with admin rights.
 *
 * M2.8 needs it for `audit`, which is keyed by the path of the thing it
 * describes rather than by a document id a test could know in advance: a
 * counter sale's order reference is minted inside the transaction, so the
 * only way to assert the trail exists is to ask for it by `object`. Read
 * with the admin bypass, so what is asserted is what really reached
 * Firestore rather than what a signed-in role happens to be allowed to see.
 */
export async function queryByField(
  collectionId: string,
  fieldPath: string,
  value: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${DOCUMENTS}:runQuery`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: "EQUAL",
            value: { stringValue: value },
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`querying ${collectionId} returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as Array<{ document?: { fields?: Record<string, unknown> } }>;
  return body
    .filter((row) => row.document !== undefined)
    .map((row) => plainFields(row.document?.fields ?? {}));
}

/**
 * Deletes every `audit/{id}` entry recorded against `objectPath` (both the
 * original write and any undo of it, since an undo is audited under the
 * same `object`, `write.ts`'s `undoAuditEntry`).
 *
 * `audit` is append-only and never cleaned up by the app itself (M1.8,
 * M2.6): a spec that writes to a fixed batch ref more than once, across
 * separate runs against the same long-lived emulator (`npm run emulators`,
 * CLAUDE.md section 7, not just the throwaway one `npm test` stands up),
 * leaves entries a later run's own assertions then count. `deleteDocument`
 * alone cannot reach these: they live by their own auto id, not by
 * `objectPath`, so this re-runs the same query `Timeline.tsx`'s own
 * `object == objectPath` uses and deletes what it finds.
 */
export async function deleteAuditFor(objectPath: string): Promise<void> {
  const res = await fetch(`${DOCUMENTS}:runQuery`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "audit" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "object" },
            op: "EQUAL",
            value: { stringValue: objectPath },
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`querying audit for ${objectPath} returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as Array<{ document?: { name?: string } }>;
  const names = body.map((row) => row.document?.name).filter((name): name is string => name !== undefined);
  for (const name of names) {
    const id = name.slice(name.lastIndexOf("/") + 1);
    await deleteDocument(`audit/${id}`);
  }
}
