import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

import { BATCHES, COPY } from "../src/copy";
import { OTP, OWNER_PHONE, acceptFixedOtp, deleteDocument } from "./emulator";

const run = promisify(execFile);

/**
 * M2.7: Seed batch 001 and verify the batch 001 screen shows the printed facts.
 *
 * The done-when is: "the batch 001 screen shows the printed facts."
 * - The number 001
 * - 22 bottled jars
 * - The packed date (4 September 2026)
 * - The best before date (4 March 2027)
 * - The state Archived
 *
 * The seed script writes the product, recipe, and batch 001 with every real
 * number from the v0 handoff §1 and §2. This test signs in as Owner and opens
 * batch 001 in the admin, then asserts the printed facts appear.
 */

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

async function openBatches(page: Page): Promise<void> {
  await page.getByTestId("tab-batches").click();
  await expect(page.getByTestId("screen-batches")).toBeVisible();
}

/**
 * The seed script itself is what runs here, not a hand-written copy of what it
 * is supposed to write. A test that seeded the documents itself would prove
 * the screen and nothing about the script, and the script is the deliverable:
 * it is what will be run against production the day batch 001 goes in.
 */
test.beforeAll(async () => {
  await run("node", ["functions/scripts/seed-batch-001.mjs", "--emulator"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
  });
});

// Batch 001 is archived and would otherwise sit in every later test's list.
test.afterAll(async () => {
  await deleteDocument("batches/b-001001");
});

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
});

test("Batch 001 appears on the admin Batches screen with printed facts", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openBatches(page);

  // D21c: the printed number is on the card only because the jars exist.
  const batch001Row = page.getByTestId("batch-row-b-001001");
  await expect(batch001Row).toBeVisible();
  await expect(batch001Row.getByTestId("card-label")).toHaveText("Batch 001");

  await batch001Row.click();
  await expect(page.getByTestId("batch-detail")).toBeVisible();

  // Assert the printed facts appear:
  // 1. The batch number: "Batch 001"
  await expect(page.getByTestId("detail-label")).toContainText("001");

  // 2. Bottled jars: 22
  await expect(page.getByTestId("view-bottledJars")).toHaveText("22");

  // 3. Packed date: 4 September 2026 (packedOn from the seed: "2026-09-04")
  await expect(page.getByTestId("view-packedOn")).toHaveText("2026-09-04");

  // 4. Best before: 4 March 2027 (bestBefore from the seed: "2027-03-04")
  await expect(page.getByTestId("view-bestBefore")).toHaveText("2027-03-04");

  // 5. State: Archived
  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.archived);
});
