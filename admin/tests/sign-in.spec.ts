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

test("the Owner number signs in and lands on Today, with Owner in Settings", async ({
  page,
}) => {
  const crashes: string[] = [];
  const failed: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes(EMULATOR_GAP)) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });

  await signIn(page, OWNER_PHONE);

  await expect(page.getByTestId("screen-today")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");

  await page.getByTestId("tab-more").click();
  await page.getByTestId("more-row-settings").click();

  await expect(page.getByTestId("signed-in")).toHaveText("Shefin");
  await expect(page.getByTestId("role")).toHaveText("Owner");
  await expect(page.getByTestId("phone")).toHaveText("+91 77361 10087");

  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
  expect(failed, `failed requests: ${failed.join(" | ")}`).toEqual([]);
});

test("the Kitchen number signs in and sees Kitchen in Settings", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await expect(page.getByTestId("screen-today")).toBeVisible();

  await page.goto("/more/settings");
  await expect(page.getByTestId("signed-in")).toHaveText("Sumayya");
  await expect(page.getByTestId("role")).toHaveText("Kitchen");
});

test("a number that is not on the list is refused, kindly, and ends signed out", async ({
  page,
}) => {
  await signIn(page, STRANGER_PHONE);

  await expect(page.getByTestId("denied")).toHaveText(COPY.notAllowed);
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();

  // The same code-form-into-phone-form diff as the sign-out path (M1.12): the
  // box that comes back has to be a real one, not the code box relabelled.
  const box = page.getByLabel(COPY.phoneLabel);
  expect(await box.getAttribute("maxlength")).toBeNull();
  await box.fill(OWNER_PHONE);
  await expect(box).toHaveValue(OWNER_PHONE);
  await box.fill("");

  // Signed out for real, not just hidden: nothing is left in the SDK's store.
  const reloaded = await page.reload();
  expect(reloaded?.ok()).toBe(true);
  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
});

test("the session survives a reload (ST4: sessions persist)", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await expect(page.getByTestId("screen-today")).toBeVisible();

  await page.reload();

  await expect(page.getByTestId("screen-today")).toBeVisible();
  await expect(page.getByLabel(COPY.phoneLabel)).toHaveCount(0);
});

test("Use another number returns a phone box that still takes a number (M1.12)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(OWNER_PHONE);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await expect(page.getByLabel(COPY.codeLabel)).toBeVisible();

  await page.getByRole("button", { name: COPY.useAnotherNumber }).click();

  const box = page.getByLabel(COPY.phoneLabel);
  await expect(box).toBeVisible();
  expect(await box.getAttribute("maxlength")).toBeNull();

  // The number just tried is still there to correct, and a different one can
  // be typed over it with real keystrokes.
  await expect(box).toHaveValue(OWNER_PHONE);
  await box.fill("");
  await box.click();
  await box.pressSequentially(KITCHEN_PHONE);
  await expect(box).toHaveValue(KITCHEN_PHONE);
});

test("a non Indian number is turned away before any code is sent", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill("+1 415 555 0100");
  await page.getByRole("button", { name: COPY.sendCode }).click();

  await expect(page.getByTestId("error")).toHaveText(COPY.phoneNotIndian);
  await expect(page.getByLabel(COPY.codeLabel)).toHaveCount(0);
});

/**
 * M1.12. Shefin signed out on a real phone and could not type into the phone
 * box until he reloaded: taps landed, the button showed its pressed state, and
 * no character ever appeared.
 *
 * `signOut` notifies onAuthStateChanged before it resolves, so for one render
 * the step was still "signedIn" while the session had gone. That render drew
 * the code form, and the next one diffed it into the phone form over the same
 * input, writing `maxlength="0"`: a box that takes no characters at all.
 *
 * Everything here reproduces against the Auth emulator, which is the point.
 * The assertions are: nothing typed carries over, the box takes real
 * keystrokes, the middle of the box is the box (an overlay would fail that),
 * nothing throws anywhere in the sequence, and the next number gets in.
 */
test("after signing out, the phone box can be typed into without a reload", async ({
  page,
}) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await signIn(page, OWNER_PHONE);
  await expect(page.getByTestId("screen-today")).toBeVisible();

  // Tapped, not navigated to: a page load would throw away exactly the state
  // this test is about.
  await page.getByTestId("tab-more").click();
  await page.getByTestId("more-row-settings").click();
  await expect(page.getByTestId("role")).toHaveText("Owner");
  await page.getByRole("button", { name: COPY.signOut }).click();

  // No reload anywhere below this line: a reload is the workaround, not the fix.
  const box = page.getByLabel(COPY.phoneLabel);
  await expect(box).toBeVisible();
  await expect(box).toBeEnabled();
  await expect(page.getByTestId("error")).toHaveCount(0);
  await expect(page.getByTestId("denied")).toHaveCount(0);
  await expect(box).toHaveValue("");

  // The box that came back is a fresh one, not the code box wearing a new set
  // of attributes. maxlength="0" is exactly what the bug looked like.
  expect(await box.getAttribute("maxlength")).toBeNull();

  // Nothing of reCAPTCHA's is loose on the body.
  expect(
    await page.evaluate(() =>
      [...document.body.children].filter(
        (el) => !el.id && !el.className && el.querySelector("iframe"),
      ).length,
    ),
  ).toBe(0);

  // The box is what a finger would actually hit.
  expect(
    await page.evaluate(() => {
      const input = document.getElementById("phone");
      if (!input) return "no input";
      const rect = input.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.round(rect.x + rect.width / 2),
        Math.round(rect.y + rect.height / 2),
      );
      return hit === input ? "the input" : `${hit?.tagName ?? "nothing"} over the input`;
    }),
  ).toBe("the input");

  // And it takes text, by a real click and real keystrokes.
  await box.click();
  await box.pressSequentially(KITCHEN_PHONE);
  await expect(box).toHaveValue(KITCHEN_PHONE);

  // The next number gets all the way in.
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await expect(page.getByLabel(COPY.codeLabel)).toBeVisible();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();

  // Lands on Today, not on the Settings page the sign out was tapped on.
  await expect(page.getByTestId("screen-today")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");

  await page.getByTestId("tab-more").click();
  await page.getByTestId("more-row-settings").click();
  await expect(page.getByTestId("role")).toHaveText("Kitchen");

  // Nothing threw on the way. The bug itself was silent, so this is the guard
  // that would have caught a cleanup step blowing up mid sign-out.
  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
  await expect(page.getByTestId("crashed")).toHaveCount(0);
});

test("the sign out button in Settings ends the session", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await expect(page.getByTestId("screen-today")).toBeVisible();

  await page.getByTestId("tab-more").click();
  await page.getByTestId("more-row-settings").click();
  await expect(page.getByTestId("role")).toHaveText("Kitchen");

  await page.getByRole("button", { name: COPY.signOut }).click();

  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(COPY.phoneLabel)).toBeVisible();
});
