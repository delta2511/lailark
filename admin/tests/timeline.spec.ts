import { expect, test, type Page } from "@playwright/test";

import { BATCHES, COPY, TIMELINE } from "../src/copy";
import {
  KITCHEN_PHONE,
  OTP,
  acceptFixedOtp,
  deleteAuditFor,
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
 *
 * M2.14: the per-ingredient actuals on Cooking (`CookingActuals.tsx`) get
 * the same undo, superseding A79. `REF_ACTUALS` below is seeded straight
 * into `cooking` with a one-line recipe, rather than walked through
 * `sourcing`, because the done-when only asks about the actuals boxes
 * themselves.
 */
const PRODUCT = "m26-prawns-pickle";
const REF_DONE_WHEN = "b-m26dwn";
const REF_RACE = "b-m26rce";
const REF_REDO = "b-m26rdo";
const REF_ACTUALS = "b-m214act";
const REF_ACTUALS_RACE = "b-m214acr";
const ALL_REFS = [REF_DONE_WHEN, REF_RACE, REF_REDO, REF_ACTUALS, REF_ACTUALS_RACE];

const PRAWNS = "m214-prawns";
const RECIPE = "m214-recipe";

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
  await seedDocument(`ingredients/${PRAWNS}`, {
    labelName: "M214 Prawns",
    allergenTags: ["Crustacean (Prawns)"],
    nutritionPer100g: { energyKcal: 99, proteinG: 24 },
    unitCost: 60000,
    unit: "g",
    source: "Chaliyam",
  });
  await seedDocument(`recipes/${RECIPE}`, {
    productSlug: PRODUCT,
    version: 1,
    percentageBasis: "B",
    expectedYieldJars: 20,
    finishedWeightG: 4000,
    lines: [{ ingredientId: PRAWNS, qty: 1550, unit: "g", isMain: true, evaporates: false }],
  });
}

// A distinct batch reference per test: two tests running concurrently or
// sharing one Firestore listener would otherwise see each other's history
// on the same timeline while both are live. `afterEach` below deletes each
// ref's `audit` trail and `lines/*` documents as well as the batch itself
// (round 2: `audit` is append-only and a batch delete does not cascade to
// its subcollections, so leaving either behind orphaned re-runs of this
// suite against the same long-lived emulator), but a distinct ref per test
// still keeps one test's still-running writes from ever showing up on
// another test's screen. Each test below reads and writes only its own
// batch's `object` path.
test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedCatalogue();
  for (const ref of [REF_DONE_WHEN, REF_RACE, REF_REDO]) {
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
  // Each on its own batch ref, and so its own `lines/{id}` document: unlike
  // `batches/{ref}` itself, a subcollection document is not deleted by
  // `deleteDocument("batches/{ref}")` in `afterEach`, so two tests sharing
  // one ref here would see each other's actuals the same way the other
  // three tests above must not share one ref for the timeline itself.
  for (const ref of [REF_ACTUALS, REF_ACTUALS_RACE]) {
    await seedBatch(ref, {
      productSlug: PRODUCT,
      productName: "M26 Prawns Pickle",
      recipeId: RECIPE,
      mainIngredientName: "M214 Prawns",
      state: "cooking",
      plannedJars: 22,
      bookableJars: 19,
      perPersonLimit: 4,
      paidCount: 11,
      weightRaw: 1600,
    });
  }
});

test.afterEach(async () => {
  // `audit` is append-only and `batches/{ref}` deletion does not cascade to
  // subcollections (round 2 finding): a fixed ref reused by a second run
  // against the same long-lived emulator would otherwise see the previous
  // run's `lines/{id}` document and both runs' `audit` entries, and count
  // both. Delete the audit trail and the lines documents before the batch
  // itself, so nothing here depends on delete order.
  for (const ref of ALL_REFS) await deleteAuditFor(`batches/${ref}`);
  for (const ref of [REF_ACTUALS, REF_ACTUALS_RACE]) {
    await deleteAuditFor(`batches/${ref}/lines/${PRAWNS}`);
    await deleteDocument(`batches/${ref}/lines/${PRAWNS}`);
  }
  for (const ref of ALL_REFS) await deleteDocument(`batches/${ref}`);
  await deleteDocument(`products/${PRODUCT}`);
  await deleteDocument(`recipes/${RECIPE}`);
  await deleteDocument(`ingredients/${PRAWNS}`);
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

/* -------------------------------------------------------------------------- */
/* M2.14: undo on a per-ingredient actual (Cooking), superseding A79          */
/* -------------------------------------------------------------------------- */

test("Kitchen edits an ingredient's actual cost, undoes it, and sees both in the timeline", async ({
  page,
}) => {
  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_ACTUALS);

  await expect(page.getByTestId("timeline-empty")).toBeVisible();

  const costBox = page.getByTestId(`actual-cost-${PRAWNS}`);
  await expect(costBox).toHaveValue("");
  await costBox.fill("800");
  await costBox.blur();

  // The write landed, and the toast this task exists to fix showed up.
  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(page.getByTestId("undo-toast")).toContainText(BATCHES.actualCost);
  await expect(costBox).toHaveValue("800");

  await expect(page.getByTestId("timeline-empty")).toHaveCount(0);
  await expect(timelineEntries(page)).toHaveCount(1);
  // The line document did not exist yet, so this first edit is a `create`,
  // not an `update` (`saveBatchLine`'s `isNew`): the timeline reads that as
  // "Created.", the same as any other first write to a document.
  await expect(timelineEntries(page).first()).toContainText(TIMELINE.createdLine);

  // Undo restores the box, empty again (there was nothing before)...
  await page.getByTestId("undo-toast-undo").click();
  await expect(costBox).toHaveValue("");

  // ...and both the edit and the undo are on the timeline, undo newest first.
  await expect(timelineEntries(page)).toHaveCount(2);
  // `describeEntry` humanises the field name before handing it to
  // `TIMELINE.undidLine` (`Timeline.tsx`'s `humaniseField`): "costActual" on
  // the timeline reads "cost Actual", the same rule "source" already passed
  // through unchanged in the test above.
  await expect(timelineEntries(page).first()).toContainText(TIMELINE.undidLine("cost Actual"));
  await expect(timelineEntries(page).nth(1)).toContainText(TIMELINE.createdLine);
});

/* -------------------------------------------------------------------------- */
/* The same race guard applies to an actual: a concurrent edit is not lost    */
/* -------------------------------------------------------------------------- */

test("Undo on an actual refuses when the field changed again since the write", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_ACTUALS_RACE);

  const costBox = page.getByTestId(`actual-cost-${PRAWNS}`);
  await costBox.fill("800");
  await costBox.blur();
  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(timelineEntries(page)).toHaveCount(1);

  // Sumayya's phone, landing a write this test does not control, inside the
  // 8 second window: admin rights, bypassing the rules, standing in for a
  // second client racing the same line document.
  await patchDocument(`batches/${REF_ACTUALS_RACE}/lines/${PRAWNS}`, { costActual: 91_000 });
  await expect(costBox).toHaveValue("910");

  await page.getByTestId("undo-toast-undo").click();

  await expect(page.getByTestId("actuals-undo-error")).toHaveText(BATCHES.undoRaced);
  await expect(costBox).toHaveValue("910");
  await expect(page.getByTestId("undo-toast")).toHaveCount(0);

  // Nothing was written by the refused undo: still exactly the one edit.
  await expect(timelineEntries(page)).toHaveCount(1);
});
