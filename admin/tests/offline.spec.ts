import { expect, test } from "@playwright/test";

import { COPY } from "../src/copy";
import { OTP, OWNER_PHONE, acceptFixedOtp } from "./emulator";

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
});

/**
 * ASSUMED (M1.7, see src/shell/OfflinePill.tsx): the pill answers the
 * browser's own online/offline events, so this test drives it with
 * `context.setOffline`, not a Firestore metadata trick.
 */
test("the offline pill appears when the network goes away and clears when it returns", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(OWNER_PHONE);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();

  await expect(page.getByTestId("offline-pill")).toHaveCount(0);

  await context.setOffline(true);
  await expect(page.getByTestId("offline-pill")).toHaveText(COPY.offline);

  await context.setOffline(false);
  await expect(page.getByTestId("offline-pill")).toHaveCount(0);
});
