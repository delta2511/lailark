import { expect, test, type Page } from "@playwright/test";

import { BATCHES, COPY, TIMELINE } from "../src/copy";
import {
  KITCHEN_PHONE,
  OTP,
  acceptFixedOtp,
  deleteDocument,
  patchDocument,
  seedBatch,
  seedDocument,
} from "./emulator";

/**
 * M2.6: the `audit` collection, the timeline on the batch, and undo reading
 * its `before` back for 8 seconds.
 *
 * Done when: editing a batch field, undoing it, and seeing both in the
 * timeline works. Two more scenarios prove the parts of the brief that are
 * easy to get wrong and easy to fake with a screenshot:
 *
 * - **The undo race.** The document can change again inside the 8 second
 *   window, from the other phone. `patchDocument` here stands in for
 *   Sumayya's phone (it writes with admin rights, bypassing the rules, the
 *   same way a function or a second browser tab would land a write this
 *   test does not control). Undo must refuse rather than overwrite it.
 * - **Undoing an undo.** The undo toast is itself the product of a write, so
 *   it gets its own Undo, and clicking it a second time is a plain redo:
 *   back to the value the first edit set.
 */
const PRODUCT = "m26-prawns-pickle";
const REF_DONE_WHEN = "b-m26dwn";
const REF_RACE = "b-m26rce";
const REF_REDO = "b-m26rdo";
const ALL_REFS = [REF_DONE_WHEN, REF_RACE, REF_REDO];

async function seedCatalogue(): Promise<void> {
  await seedDocument(`products/${PRODUCT}`, {
    name: "M26 Prawns Pickle",
    type: "hero",
    veg: false,
    hsn: "2001",
    priceInStock: 64_900,
    priceOpen: 59_900,
    jarGrams: 200,
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: true,
    customLines: [],
  });
}

// A distinct batch reference per test: `audit` entries are append-only
// (M1.8, M2.6) and never cleaned up between tests, so two tests sharing one
// reference would see each other's history on the same timeline. Each test
// below reads and writes only its own batch's `object` path.
test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedCatalogue();
  for (const ref of ALL_REFS) {
    await seedBatch(ref, {
      productSlug: PRODUCT,
      productName: "M26 Prawns Pickle",
      state: "sourcing",
      plannedJars: 22,
      bookableJars: 19,
      perPersonLimit: 4,
      paidCount: 11,
      source: "Beypore market",
    });
  }
});

test.afterEach(async () => {
  for (const ref of ALL_REFS) await deleteDocument(`batches/${ref}`);
  await deleteDocument(`products/${PRODUCT}`);
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

async function openBatch(page: Page, ref: string): Promise<void> {
  await page.getByTestId("tab-batches").click();
  await expect(page.getByTestId("screen-batches")).toBeVisible();
  await page.getByTestId(`batch-row-${ref}`).click();
  await expect(page.getByTestId("batch-detail")).toBeVisible();
}

function timelineEntries(page: Page) {
  return page.getByTestId("timeline-list").locator(".timeline-entry");
}

/* -------------------------------------------------------------------------- */
/* Done when: edit, undo, both in the timeline                                */
/* -------------------------------------------------------------------------- */

test("Kitchen edits a batch field, undoes it, and sees both in the timeline", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_DONE_WHEN);

  // Starts empty: a fresh batch has no history yet.
  await expect(page.getByTestId("timeline-empty")).toBeVisible();

  const sourceBox = page.locator("#edit-source");
  await expect(sourceBox).toHaveValue("Beypore market");
  await sourceBox.fill("Chaliyam market");
  await sourceBox.blur();

  // The write landed, and offered undo.
  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(page.getByTestId("undo-toast")).toContainText(
    BATCHES.fieldChanged(BATCHES.source, "Chaliyam market"),
  );
  await expect(sourceBox).toHaveValue("Chaliyam market");

  // The edit is on the timeline before anyone touches Undo.
  await expect(page.getByTestId("timeline-empty")).toHaveCount(0);
  await expect(timelineEntries(page)).toHaveCount(1);
  await expect(timelineEntries(page).first()).toContainText(TIMELINE.changedFields("source"));

  // Undo restores the field...
  await page.getByTestId("undo-toast-undo").click();
  await expect(page.locator("#edit-source")).toHaveValue("Beypore market");

  // ...and the undo is its own line on the timeline: both the edit and the
  // undo are there, the undo newest first.
  await expect(timelineEntries(page)).toHaveCount(2);
  await expect(timelineEntries(page).first()).toContainText(TIMELINE.undidLine("source"));
  await expect(timelineEntries(page).nth(1)).toContainText(TIMELINE.changedFields("source"));
});

/* -------------------------------------------------------------------------- */
/* The undo race: the document changed under it                               */
/* -------------------------------------------------------------------------- */

test("Undo refuses when the field changed again since the write, and overwrites nothing", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_RACE);

  const sourceBox = page.locator("#edit-source");
  await sourceBox.fill("Chaliyam market");
  await sourceBox.blur();
  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(timelineEntries(page)).toHaveCount(1);

  // Sumayya's phone, landing a write this test does not control, inside the
  // 8 second window: admin rights, bypassing the rules, standing in for a
  // second client (or a function) writing the same field.
  await patchDocument(`batches/${REF_RACE}`, { source: "Vaikom market" });
  await expect(page.locator("#edit-source")).toHaveValue("Vaikom market");

  // The toast is still up (its own 8 second clock has not run out), but
  // undoing it now must not silently throw away Vaikom.
  await page.getByTestId("undo-toast-undo").click();

  await expect(page.getByTestId("batch-field-error")).toHaveText(BATCHES.undoRaced);
  await expect(page.locator("#edit-source")).toHaveValue("Vaikom market");
  await expect(page.getByTestId("undo-toast")).toHaveCount(0);

  // Nothing was written by the refused undo: still exactly the one edit.
  await expect(timelineEntries(page)).toHaveCount(1);
});

/* -------------------------------------------------------------------------- */
/* Undoing an undo: a plain redo, and a third line on the timeline            */
/* -------------------------------------------------------------------------- */

test("Undoing an undo is a redo, and the timeline carries all three", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_REDO);

  const sourceBox = page.locator("#edit-source");
  await sourceBox.fill("Chaliyam market");
  await sourceBox.blur();
  await expect(page.getByTestId("undo-toast")).toBeVisible();

  await page.getByTestId("undo-toast-undo").click();
  await expect(page.locator("#edit-source")).toHaveValue("Beypore market");
  await expect(page.getByTestId("undo-toast")).toContainText(BATCHES.undone);
  await expect(timelineEntries(page)).toHaveCount(2);

  // Undo, on the undo's own toast: back to what the first edit set.
  await page.getByTestId("undo-toast-undo").click();
  await expect(page.locator("#edit-source")).toHaveValue("Chaliyam market");
  await expect(timelineEntries(page)).toHaveCount(3);
  await expect(timelineEntries(page).first()).toContainText(TIMELINE.undidLine("source"));
});
