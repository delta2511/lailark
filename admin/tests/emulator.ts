import type { Page } from "@playwright/test";

export const AUTH_EMULATOR = "http://127.0.0.1:9099";
export const FIRESTORE_EMULATOR = "http://127.0.0.1:8080";
export const PROJECT = "lailark";

/** CLAUDE.md section 8. */
export const OWNER_PHONE = "+91 7736110087";
export const KITCHEN_PHONE = "+91 9446587027";
export const STRANGER_PHONE = "+91 9999999999";
export const OTP = "123456";

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
