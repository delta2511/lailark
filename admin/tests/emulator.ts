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
