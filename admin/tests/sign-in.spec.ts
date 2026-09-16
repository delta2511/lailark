import { expect, test, type Page } from "@playwright/test";

import { COPY } from "../src/copy";
import {
  KITCHEN_PHONE,
  OTP,
  OWNER_PHONE,
  STRANGER_PHONE,
  acceptFixedOtp,
} from "./emulator";

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();

  await expect(page.getByLabel(COPY.codeLabel)).toBeVisible();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
}

/**
 * The Auth emulator (firebase-tools 15.30.1) answers 501 Not Implemented for
 * the SDK's reCAPTCHA Enterprise config probe. That is an emulator gap, not an
 * app fault, so it is the one request allowed to fail.
 */
const EMULATOR_GAP = "/v2/recaptchaConfig";

test("the Owner number signs in and sees Owner", async ({ page }) => {
  const crashes: string[] = [];
  const failed: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes(EMULATOR_GAP)) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });

  await signIn(page, OWNER_PHONE);

  await expect(page.getByTestId("signed-in")).toHaveText("Signed in as Shefin");
  await expect(page.getByTestId("role")).toHaveText("Owner");
  await expect(page.getByText("+91 77361 10087")).toBeVisible();
  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
  expect(failed, `failed requests: ${failed.join(" | ")}`).toEqual([]);
});

test("the Kitchen number signs in and sees Kitchen", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);

  await expect(page.getByTestId("signed-in")).toHaveText("Signed in as Sumayya");
  await expect(page.getByTestId("role")).toHaveText("Kitchen");
});

test("a number that is not on the list is refused, kindly, and ends signed out", async ({
  page,
}) => {
  await signIn(page, STRANGER_PHONE);

  await expect(page.getByTestId("denied")).toHaveText(COPY.notAllowed);
  await expect(page.getByTestId("role")).toHaveCount(0);
  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();

  // Signed out for real, not just hidden: nothing is left in the SDK's store.
  const reloaded = await page.reload();
  expect(reloaded?.ok()).toBe(true);
  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();
  await expect(page.getByTestId("role")).toHaveCount(0);
});

test("the session survives a reload (ST4: sessions persist)", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await expect(page.getByTestId("role")).toHaveText("Owner");

  await page.reload();

  await expect(page.getByTestId("signed-in")).toHaveText("Signed in as Shefin");
  await expect(page.getByTestId("role")).toHaveText("Owner");
  await expect(page.getByLabel(COPY.phoneLabel)).toHaveCount(0);
});

test("a non Indian number is turned away before any code is sent", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill("+1 415 555 0100");
  await page.getByRole("button", { name: COPY.sendCode }).click();

  await expect(page.getByTestId("error")).toHaveText(COPY.phoneNotIndian);
  await expect(page.getByLabel(COPY.codeLabel)).toHaveCount(0);
});

test("the sign out button ends the session", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await expect(page.getByTestId("role")).toHaveText("Kitchen");

  await page.getByRole("button", { name: COPY.signOut }).click();

  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();
});
