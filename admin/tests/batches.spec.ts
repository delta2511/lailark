import { expect, test, type Page } from "@playwright/test";

import { BATCHES, COPY } from "../src/copy";
import {
  KITCHEN_PHONE,
  OTP,
  OWNER_PHONE,
  VIEWER_PHONE,
  acceptFixedOtp,
  deleteDocument,
  ensureAdminUser,
  patchDocument,
  readDocument,
  seedApproval,
  seedBatch,
  seedDocument,
  timestampValue,
} from "./emulator";

/**
 * M2.4: the Batches screens. The done-when is a Playwright walk: Kitchen
 * through Sourcing, Cooking and Bottled; Owner opening a batch, pausing and
 * resuming it, and answering an approval; plus the fill bar's half mark, the
 * clock, the approval badge, a refused transition, and a drift warning.
 *
 * Every starting state is seeded directly with admin rights (M2.3's own done
 * -when already walks the state machine end to end against the real
 * callable; this spec starts each scenario from the state it needs so each
 * test exercises one thing) and every forward move goes through the real
 * `transitionBatch`/`approveBatchFull` callables over the functions
 * emulator, the same way the app calls them.
 */

const PRAWNS = "m24-prawns";
const VINEGAR = "m24-vinegar";
const DATES = "m24-dates";
const RECIPE = "m24-recipe";
// M2.13: a recipe whose prawns and dates are both `isMain`, which is batch
// 001's own shape (both are named in the product name, so 5(2)(g) asks for a
// percentage against each). The bug this recipe exists to catch stored both
// under one line id.
const RECIPE_TWO_MAIN = "m24-recipe-2main";
const PRODUCT = "m24-prawns-pickle";

const REF_OWNER = "b-m24avn";
const REF_APPROVAL = "b-m24apv";
const REF_D15_OPEN = "b-m24d1a";
const REF_D15_DRAFT = "b-m24d1b";
const REF_KITCHEN = "b-m24ktc";
const REF_VIEWER = "b-m24vew";
const REF_FILL = "b-m24fbr";
const REF_MONEY = "b-m24mny";
const REF_BLANK = "b-m24bnk";
const REF_COSTS = "b-m24cst";
const REF_TWO_MAIN = "b-m242mn";
const REF_LEGACY = "b-m24lgc";
const REF_WINDOW = "b-m24wnd";
const REF_ORPHAN = "b-m24orp";

const ALL_REFS = [
  REF_OWNER,
  REF_APPROVAL,
  REF_D15_OPEN,
  REF_D15_DRAFT,
  REF_KITCHEN,
  REF_VIEWER,
  REF_FILL,
  REF_MONEY,
  REF_BLANK,
  REF_COSTS,
  REF_TWO_MAIN,
  REF_LEGACY,
  REF_WINDOW,
  REF_ORPHAN,
];

async function seedCatalogue(): Promise<void> {
  await seedDocument(`ingredients/${PRAWNS}`, {
    labelName: "M24 Prawns",
    allergenTags: ["Crustacean (Prawns)"],
    nutritionPer100g: { energyKcal: 99, proteinG: 24 },
    unitCost: 60000,
    unit: "g",
    source: "Chaliyam",
  });
  await seedDocument(`ingredients/${VINEGAR}`, {
    labelName: "M24 Vinegar",
    allergenTags: [],
    nutritionPer100g: { energyKcal: 18, proteinG: 0 },
    unitCost: 5000,
    unit: "l",
    source: null,
    densityGPerMl: 1.0,
  });
  await seedDocument(`recipes/${RECIPE}`, {
    productSlug: PRODUCT,
    version: 1,
    percentageBasis: "B",
    expectedYieldJars: 20,
    finishedWeightG: 4000,
    storageText: "Cool, dry place.",
    claimsText: "No added preservatives.",
    lines: [
      { ingredientId: PRAWNS, qty: 1550, unit: "g", isMain: true, evaporates: false },
      { ingredientId: VINEGAR, qty: 2, unit: "l", isMain: false, evaporates: true, residueG: 400 },
    ],
  });
  await seedDocument(`ingredients/${DATES}`, {
    labelName: "M24 Dates",
    allergenTags: [],
    nutritionPer100g: { energyKcal: 282, proteinG: 2 },
    unitCost: 30000,
    unit: "g",
    source: null,
  });
  await seedDocument(`recipes/${RECIPE_TWO_MAIN}`, {
    productSlug: PRODUCT,
    version: 1,
    percentageBasis: "B",
    expectedYieldJars: 20,
    finishedWeightG: 4000,
    storageText: "Cool, dry place.",
    claimsText: "No added preservatives.",
    lines: [
      { ingredientId: PRAWNS, qty: 1550, unit: "g", isMain: true, evaporates: false },
      { ingredientId: DATES, qty: 1000, unit: "g", isMain: true, evaporates: false },
    ],
  });
  await seedDocument(`products/${PRODUCT}`, {
    name: "M24 Prawns Pickle",
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

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedCatalogue();
});

test.afterEach(async () => {
  for (const ref of ALL_REFS) {
    await deleteDocument(`batches/${ref}/lines/main`);
    await deleteDocument(`batches/${ref}/lines/${PRAWNS}`);
    await deleteDocument(`batches/${ref}/lines/${DATES}`);
    await deleteDocument(`batches/${ref}/lines/${VINEGAR}`);
    await deleteDocument(`batches/${ref}`);
    await deleteDocument(`approvals/half-${ref}`);
    await deleteDocument(`approvals/open-${ref}`);
  }
  await deleteDocument(`recipes/${RECIPE}`);
  await deleteDocument(`recipes/${RECIPE_TWO_MAIN}`);
  await deleteDocument(`ingredients/${PRAWNS}`);
  await deleteDocument(`ingredients/${DATES}`);
  await deleteDocument(`ingredients/${VINEGAR}`);
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

async function openBatches(page: Page): Promise<void> {
  await page.getByTestId("tab-batches").click();
  await expect(page.getByTestId("screen-batches")).toBeVisible();
}

async function openBatch(page: Page, ref: string): Promise<void> {
  await openBatches(page);
  await page.getByTestId(`batch-row-${ref}`).click();
  await expect(page.getByTestId("batch-detail")).toBeVisible();
}

/* -------------------------------------------------------------------------- */
/* Owner: open a batch, pause and resume it                                   */
/* -------------------------------------------------------------------------- */

test("Owner opens a batch, then pauses and resumes it", async ({ page }) => {
  await seedBatch(REF_OWNER, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE,
    state: "draft",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
  });

  await signIn(page, OWNER_PHONE);
  await openBatch(page, REF_OWNER);

  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.draft);
  await expect(page.getByTestId("state-form")).toBeVisible();
  await expect(page.getByTestId("state-button")).toHaveText(BATCHES.openBatch);

  // Every optional field left blank: the batch opens with what it already has.
  await page.getByTestId("state-button").click();
  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.open);
  await expect(page.getByTestId("transition-error")).toHaveCount(0);

  // Open is pausable (D23): a secondary Pause control, not the big button.
  await expect(page.getByTestId("pause-button")).toBeVisible();
  await page.getByTestId("pause-button").click();
  await page.getByTestId("pause-reason").fill("no prawns at Beypore this week");
  await page.getByTestId("confirm-pause").click();

  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.paused);
  await expect(page.getByTestId("resume-button")).toBeVisible();

  // D23: resume returns to exactly the state it was paused from.
  await page.getByTestId("resume-button").click();
  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.open);
});

/* -------------------------------------------------------------------------- */
/* Owner: answer an approval. The clock and the badge appear, then clear.     */
/* -------------------------------------------------------------------------- */

test("Owner answers the half-reached approval: the badge and clock appear, then clear", async ({
  page,
}) => {
  const dueAt = new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000).toISOString();
  await seedBatch(REF_APPROVAL, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    mainIngredientName: "M24 Prawns",
    recipeId: RECIPE,
    state: "halfReached",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    halfReachedAt: timestampValue(),
  });
  await seedApproval(`half-${REF_APPROVAL}`, {
    kind: "halfReached",
    batchRef: REF_APPROVAL,
    draft: "Half the batch is paid for. We are arranging the prawns.",
    status: "waiting",
    dueAt: timestampValue(dueAt),
  });

  await signIn(page, OWNER_PHONE);
  await openBatch(page, REF_APPROVAL);

  await expect(page.getByTestId("detail-approval-badge")).toHaveText(BATCHES.approvalWaiting);
  await expect(page.getByTestId("detail-clock")).toHaveText(BATCHES.clock(BATCHES.clockDays(5)));

  await expect(page.getByTestId("state-button")).toHaveText(BATCHES.sayYesSourcing);
  await page.getByTestId("state-button").click();

  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.sourcing);
  // The half approval is answered: it is no longer waiting, so the badge and
  // clock both clear.
  await expect(page.getByTestId("detail-approval-badge")).toHaveCount(0);
  await expect(page.getByTestId("detail-clock")).toHaveCount(0);
});

/* -------------------------------------------------------------------------- */
/* A refused transition (D15) reads as a plain line, never a blank screen.    */
/* -------------------------------------------------------------------------- */

test("D15 refuses a second open batch of the same product with a plain line", async ({ page }) => {
  await seedBatch(REF_D15_OPEN, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE,
    state: "open",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
  });
  await seedBatch(REF_D15_DRAFT, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE,
    state: "draft",
    plannedJars: 20,
    bookableJars: 18,
    perPersonLimit: 4,
  });

  await signIn(page, OWNER_PHONE);
  await openBatch(page, REF_D15_DRAFT);

  await page.getByTestId("state-button").click();

  await expect(page.getByTestId("transition-error")).toContainText("D15");
  // The screen is still the batch detail, not a blank page.
  await expect(page.getByTestId("batch-detail")).toBeVisible();
  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.draft);
});

/* -------------------------------------------------------------------------- */
/* Kitchen: Sourcing, Cooking, Bottled, with the drift warning along the way. */
/* -------------------------------------------------------------------------- */

test("Kitchen walks a batch through Sourcing, Cooking and Bottled", async ({ page }) => {
  await seedBatch(REF_KITCHEN, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE,
    mainIngredientName: "M24 Prawns",
    state: "sourcing",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
  });

  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_KITCHEN);

  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.sourcing);
  await expect(page.getByTestId("state-button")).toHaveText(BATCHES.startCooking);

  // The recipe calls for 1,550 g of prawns; 2,000 g raw is deliberately well
  // off it, so the main ingredient's actual carries a drift warning from the
  // moment Cooking opens (14.1: the main ingredient's raw weight and price
  // are recorded here, and become the prawns line's actual).
  await page.getByTestId("state-field-landedOn").fill("2026-09-01");
  await page.getByTestId("state-field-source").fill("Beypore harbour");
  await page.getByTestId("state-field-weightRaw").fill("2000");
  await page.getByTestId("state-field-costRaw").fill("800");
  await page.getByTestId("state-button").click();

  await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.cooking);
  await expect(page.getByTestId("transition-error")).toHaveCount(0);

  // Cooking: cooked date and the two weights, edited in place.
  await page.getByTestId("input-cookedOn").fill("2026-09-02");
  await page.getByTestId("input-weightCleaned").fill("9000");
  await page.getByTestId("input-weightCooked").fill("7000");
  await page.getByTestId("input-weightCooked").blur();

  // Per-ingredient actuals, prefilled from the recipe. Prawns (the main
  // line) already carries the raw weight just submitted, and it drifts.
  // M2.13: that line is the prawns document, not a document called "main".
  await expect(page.getByTestId(`actual-weight-${PRAWNS}`)).toHaveValue("2000");
  await expect(page.getByTestId(`drift-warning-${PRAWNS}`)).toBeVisible();
  expect(await readDocument(`batches/${REF_KITCHEN}/lines/${PRAWNS}`)).toMatchObject({
    ingredientId: PRAWNS,
    qtyActual: 2000,
    costActual: 80_000,
  });
  expect(await readDocument(`batches/${REF_KITCHEN}/lines/main`)).toBeNull();

  // Vinegar opens on the recipe's own quantity (2 L at density 1.0 = 2,000
  // g), so it starts with no drift.
  await expect(page.getByTestId(`actual-weight-${VINEGAR}`)).toHaveValue("2000");
  await expect(page.getByTestId(`drift-warning-${VINEGAR}`)).toHaveCount(0);

  // Typing a wildly different actual raises the warning for that line too.
  await page.getByTestId(`actual-weight-${VINEGAR}`).fill("500");
  await page.getByTestId(`actual-cost-${VINEGAR}`).fill("120");
  await page.getByTestId(`actual-cost-${VINEGAR}`).blur();
  await expect(page.getByTestId(`drift-warning-${VINEGAR}`)).toBeVisible();

  // Bottle the batch: its own small form, not what was typed above.
  await expect(page.getByTestId("state-button")).toHaveText(BATCHES.bottleBatch);
  await page.getByTestId("state-field-weightCleaned").fill("9000");
  await page.getByTestId("state-field-weightCooked").fill("7000");
  await page.getByTestId("state-field-jarCount").fill("22");
  await page.getByTestId("state-field-packedOn").fill("2026-09-04");
  await page.getByTestId("state-button").click();

  await expect(page.getByTestId("transition-error")).toHaveCount(0);
  await expect(page.getByTestId("view-bottledJars")).toHaveText("22", { timeout: 15_000 });
  // 22 jars against 10 paid leaves surplus, so `onBatchWritten` moves the
  // batch straight on to In stock (8.2's automatic row). Bottled is a blink,
  // and asserting on it is a race this test used to lose about one run in
  // three. What matters is that the bottling figures landed.
  await expect(page.getByTestId("detail-state-chip")).toHaveText(
    new RegExp(`^(${BATCHES.stateLabel.bottled}|${BATCHES.stateLabel.inStock})$`),
  );
  await expect(page.getByTestId("view-bestBefore")).toHaveText("2027-03-04");
  // D21c: the batch is numbered only now, on the card and in the header.
  await expect(page.getByTestId("detail-label")).toContainText("Batch ");
  await expect(page.getByTestId("detail-label")).not.toContainText(REF_KITCHEN);

  // Bottling costs, entered per batch (14.1), edited in place.
  await page.getByTestId("input-cost-jarsLids").fill("450");
  await page.getByTestId("input-cost-jarsLids").blur();
  await expect(page.getByTestId("view-gasPower")).toBeVisible();

  // P&L has no real figures yet: the placeholder names M4.8, not a blank section.
  await expect(page.getByTestId("pnl-not-yet")).toHaveText(BATCHES.pnlNotYet);
});

/* -------------------------------------------------------------------------- */
/* Two main ingredients: two rows, two documents, neither writing the other's */
/* -------------------------------------------------------------------------- */

/**
 * M2.13. Batch 001's recipe flags prawns and dates both `isMain`, and the
 * actuals screen used to key every main line under the literal id "main", so
 * the two rows were one document: typing a cost against prawns moved the one
 * against dates, and the second row's boxes looked as though they never
 * saved. This test is that exact shape, asserted on the stored documents
 * rather than on the screen, because it is the documents the P&L will read.
 */
test("two main ingredients take two independent weights and costs", async ({ page }) => {
  await seedBatch(REF_TWO_MAIN, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE_TWO_MAIN,
    mainIngredientName: "M24 Prawns",
    state: "cooking",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    landedOn: "2026-09-01",
    source: "Beypore harbour",
    weightRaw: 2000,
  });

  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_TWO_MAIN);

  // Two rows, one per recipe line, each with its own pair of boxes.
  await expect(page.getByTestId("actuals-list").locator("li")).toHaveCount(2);

  await page.getByTestId(`actual-weight-${PRAWNS}`).fill("1600");
  await page.getByTestId(`actual-weight-${PRAWNS}`).blur();
  await page.getByTestId(`actual-cost-${PRAWNS}`).fill("900");
  await page.getByTestId(`actual-cost-${PRAWNS}`).blur();

  await page.getByTestId(`actual-weight-${DATES}`).fill("1100");
  await page.getByTestId(`actual-weight-${DATES}`).blur();
  await page.getByTestId(`actual-cost-${DATES}`).fill("400");
  await page.getByTestId(`actual-cost-${DATES}`).blur();

  // Neither box moved when the other was typed.
  await expect(page.getByTestId(`actual-weight-${PRAWNS}`)).toHaveValue("1600");
  await expect(page.getByTestId(`actual-cost-${PRAWNS}`)).toHaveValue("900");
  await expect(page.getByTestId(`actual-weight-${DATES}`)).toHaveValue("1100");
  await expect(page.getByTestId(`actual-cost-${DATES}`)).toHaveValue("400");

  // A reload is what proves the figures are in Firestore and not in
  // component state: the boxes come back filled from the documents alone.
  // The open batch is not in the URL, so a reload lands on Today and the
  // batch is opened again: the boxes are filled from the documents alone.
  await page.reload();
  await openBatch(page, REF_TWO_MAIN);
  await expect(page.getByTestId(`actual-weight-${PRAWNS}`)).toHaveValue("1600");
  await expect(page.getByTestId(`actual-cost-${PRAWNS}`)).toHaveValue("900");
  await expect(page.getByTestId(`actual-weight-${DATES}`)).toHaveValue("1100");
  await expect(page.getByTestId(`actual-cost-${DATES}`)).toHaveValue("400");

  // Two documents, each carrying its own ingredient's numbers, in paise.
  await expect
    .poll(async () => await readDocument(`batches/${REF_TWO_MAIN}/lines/${PRAWNS}`))
    .toMatchObject({ ingredientId: PRAWNS, qtyActual: 1600, costActual: 90_000 });
  await expect
    .poll(async () => await readDocument(`batches/${REF_TWO_MAIN}/lines/${DATES}`))
    .toMatchObject({ ingredientId: DATES, qtyActual: 1100, costActual: 40_000 });
});

/**
 * M2.13. A batch cooked before the fix has one `lines/main` document, and it
 * may carry a cost somebody typed. That money is not moved between
 * documents and not dropped: the row the document names goes on reading and
 * writing it, and every other row, the second main line included, gets its
 * own.
 */
test("a line document left under the old \"main\" id keeps its money and its row", async ({ page }) => {
  await seedBatch(REF_LEGACY, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE_TWO_MAIN,
    mainIngredientName: "M24 Prawns",
    state: "cooking",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    weightRaw: 2000,
  });
  // What the old code left behind: prawns' weight and a cost typed by hand.
  await seedDocument(`batches/${REF_LEGACY}/lines/main`, {
    ingredientId: PRAWNS,
    qtyActual: 2000,
    costActual: 80_000,
    createdBy: "seed",
    createdAt: timestampValue(),
    updatedBy: "seed",
    updatedAt: timestampValue(),
  });

  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_LEGACY);

  // The prawns row opens on the money that is already there, not on a blank
  // box and not on the recipe's own quantity.
  await expect(page.getByTestId(`actual-weight-${PRAWNS}`)).toHaveValue("2000");
  await expect(page.getByTestId(`actual-cost-${PRAWNS}`)).toHaveValue("800");
  // Dates, the other main line, is a row of its own with nothing typed in it.
  await expect(page.getByTestId(`actual-cost-${DATES}`)).toHaveValue("");

  // Typing on dates writes dates' own document and leaves the old one alone.
  await page.getByTestId(`actual-cost-${DATES}`).fill("400");
  await page.getByTestId(`actual-cost-${DATES}`).blur();
  await expect
    .poll(async () => (await readDocument(`batches/${REF_LEGACY}/lines/${DATES}`))?.costActual)
    .toBe(40_000);
  expect(await readDocument(`batches/${REF_LEGACY}/lines/main`)).toMatchObject({
    ingredientId: PRAWNS,
    costActual: 80_000,
  });

  // Typing on prawns updates that same old document: the ₹800 is replaced by
  // the new figure, not duplicated into a second document that a P&L would
  // then count twice.
  await page.getByTestId(`actual-cost-${PRAWNS}`).fill("850");
  await page.getByTestId(`actual-cost-${PRAWNS}`).blur();
  await expect
    .poll(async () => (await readDocument(`batches/${REF_LEGACY}/lines/main`))?.costActual)
    .toBe(85_000);
  expect(await readDocument(`batches/${REF_LEGACY}/lines/${PRAWNS}`)).toBeNull();

  // And it survives a reload: still one document for prawns, still the old
  // one, with the new figure in it.
  await page.reload();
  await openBatch(page, REF_LEGACY);
  await expect(page.getByTestId(`actual-cost-${PRAWNS}`)).toHaveValue("850");
  await expect(page.getByTestId(`actual-cost-${DATES}`)).toHaveValue("400");
  expect(await readDocument(`batches/${REF_LEGACY}/lines/${PRAWNS}`)).toBeNull();
  await expect(page.getByTestId("orphan-lines")).toHaveCount(0);
});

/**
 * M2.13 round 1. The listener behind the actuals opens empty, and a row
 * resolved against that empty list binds to its own ingredient id instead of
 * the legacy `lines/main` it should adopt. A commit inside that window used
 * to create a second document for one ingredient: the legacy money then sat
 * in the subcollection unseen, uneditable, and counted twice by anything
 * summing it. There is nothing to type into until the lines have loaded.
 */
test("nothing can be typed into the actuals before the lines have loaded", async ({ page }) => {
  await seedBatch(REF_WINDOW, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE_TWO_MAIN,
    mainIngredientName: "M24 Prawns",
    state: "cooking",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    weightRaw: 2000,
  });
  await seedDocument(`batches/${REF_WINDOW}/lines/main`, {
    ingredientId: PRAWNS,
    qtyActual: 2000,
    costActual: 80_000,
    createdBy: "seed",
    createdAt: timestampValue(),
    updatedBy: "seed",
    updatedAt: timestampValue(),
  });

  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_WINDOW);

  // The instant the detail is on screen, either the boxes are not there yet
  // or they already carry the legacy figures. What must never happen is a
  // box that exists and is empty, because that is the box that writes a
  // second document.
  const costNow = await page.getByTestId(`actual-cost-${PRAWNS}`).inputValue().catch(() => null);
  expect(costNow === null || costNow === "800").toBe(true);

  await expect(page.getByTestId(`actual-cost-${PRAWNS}`)).toHaveValue("800");
  await page.getByTestId(`actual-cost-${PRAWNS}`).fill("810");
  await page.getByTestId(`actual-cost-${PRAWNS}`).blur();

  await expect
    .poll(async () => (await readDocument(`batches/${REF_WINDOW}/lines/main`))?.costActual)
    .toBe(81_000);
  // One document for prawns, not two.
  expect(await readDocument(`batches/${REF_WINDOW}/lines/${PRAWNS}`)).toBeNull();
});

/**
 * M2.13 round 1. Swapping a mis-picked ingredient on the recipe is an
 * ordinary thing to do, and it used to strand whatever had been typed
 * against the old one: no row read it, nobody could correct it, and a sum
 * over the subcollection still counted it. It is named on the screen
 * instead, and never reassigned to another ingredient.
 */
test("a cost recorded against an ingredient the recipe dropped is named, not hidden", async ({
  page,
}) => {
  await seedBatch(REF_ORPHAN, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    // This recipe lists dates and vinegar. Nothing on it is prawns.
    recipeId: RECIPE,
    mainIngredientName: "M24 Prawns",
    state: "cooking",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    weightRaw: 2000,
  });
  await seedDocument(`batches/${REF_ORPHAN}/lines/${DATES}`, {
    ingredientId: DATES,
    qtyActual: 900,
    costActual: 30_000,
    createdBy: "seed",
    createdAt: timestampValue(),
    updatedBy: "seed",
    updatedAt: timestampValue(),
  });

  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_ORPHAN);

  // The recipe's own two lines are there, with nothing typed in them.
  await expect(page.getByTestId(`actual-cost-${PRAWNS}`)).toHaveValue("");
  // And the dates figures, which no row on this recipe claims, are on the
  // screen with the ingredient named and the amount in rupees.
  await expect(page.getByTestId("orphan-lines")).toBeVisible();
  await expect(page.getByTestId(`orphan-line-${DATES}`)).toContainText("M24 Dates");
  await expect(page.getByTestId(`orphan-line-${DATES}`)).toContainText("900 g");
  await expect(page.getByTestId(`orphan-line-${DATES}`)).toContainText("300");

  // Nothing was moved to say so.
  expect(await readDocument(`batches/${REF_ORPHAN}/lines/${DATES}`)).toMatchObject({
    ingredientId: DATES,
    costActual: 30_000,
  });
});

/* -------------------------------------------------------------------------- */
/* Viewer: everything reads, nothing is an input                              */
/* -------------------------------------------------------------------------- */

test("Viewer sees the batch and gets no inputs anywhere", async ({ page }) => {
  const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  await seedBatch(REF_VIEWER, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE,
    state: "halfReached",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    halfReachedAt: timestampValue(),
  });
  await seedApproval(`half-${REF_VIEWER}`, {
    batchRef: REF_VIEWER,
    draft: "Half the batch is paid for.",
    status: "waiting",
    dueAt: timestampValue(dueAt),
  });

  // CLAUDE.md section 9 seeds only Owner and Kitchen at launch, so this is
  // the one test that provisions a Viewer directly against the Auth
  // emulator with admin rights (`ensureAdminUser`), the same "Bearer owner"
  // convention `seedDocument` already uses for Firestore.
  await ensureAdminUser(VIEWER_PHONE, "viewer");
  await signIn(page, VIEWER_PHONE);
  await openBatch(page, REF_VIEWER);

  await expect(page.getByTestId("detail-approval-badge")).toBeVisible();
  await expect(page.getByTestId("detail-clock")).toBeVisible();
  // A Viewer has no row on any state (brief 17.12: Viewer does nothing), so
  // the primary control is always a waiting line, never a form.
  await expect(page.getByTestId("state-waiting")).toBeVisible();
  await expect(page.getByTestId("state-form")).toHaveCount(0);
  await expect(page.getByTestId("pause-button")).toHaveCount(0);
  await expect(page.getByTestId("resume-button")).toHaveCount(0);

  const inputs = page.locator(
    '[data-testid="batch-detail"] input, [data-testid="batch-detail"] select, [data-testid="batch-detail"] textarea',
  );
  await expect(inputs).toHaveCount(0);
});

/* -------------------------------------------------------------------------- */
/* The fill bar: paid of bookable, and the half mark at half of bookable.     */
/* -------------------------------------------------------------------------- */

test("the fill bar fills to paid of bookable and draws the half mark at half of bookable", async ({
  page,
}) => {
  // Bookable 20, half is 10 (exactly 50%). Paid 6 of 20 is 30%.
  await seedBatch(REF_FILL, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE,
    state: "open",
    plannedJars: 22,
    bookableJars: 20,
    perPersonLimit: 4,
    paidCount: 6,
  });

  await signIn(page, OWNER_PHONE);
  await openBatch(page, REF_FILL);

  const fill = page.getByTestId("fill-bar-fill").first();
  const half = page.getByTestId("fill-bar-half-mark").first();

  await expect(fill).toHaveCSS("width", /.*/);
  const fillStyle = await fill.getAttribute("style");
  const halfStyle = await half.getAttribute("style");
  expect(fillStyle).toContain("30%");
  expect(halfStyle).toContain("50%");
});

/* -------------------------------------------------------------------------- */
/* No console error, no rust on a button or heading, every button 48px tall.  */
/* -------------------------------------------------------------------------- */

test("Batches draws no console error and paints no rust on a button or heading", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await seedBatch(REF_OWNER, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE,
    state: "draft",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
  });

  await signIn(page, OWNER_PHONE);
  await openBatch(page, REF_OWNER);

  const RUST = "rgb(163, 74, 40)";
  const offenders = await page.evaluate((rust) => {
    const elements = Array.from(document.querySelectorAll("button, h1, h2, h3, a"));
    return elements
      .filter((el) => getComputedStyle(el).color === rust)
      .map((el) => el.outerHTML.slice(0, 80));
  }, RUST);

  expect(offenders).toEqual([]);
  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);

  const buttons = page.locator('[data-testid="screen-batches"] button');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    if (box) expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(48);
  }
});

/* -------------------------------------------------------------------------- */
/* Money and weights: what actually reaches Firestore                         */
/* -------------------------------------------------------------------------- */

/**
 * The two boxes on one actuals row own one field each. Committing the weight
 * must never carry the cost with it: the cost the person typed a moment ago
 * may not have come back down the listener yet, and a two-field write would
 * put a zero where their money was.
 *
 * Both `change` events are dispatched inside one synchronous task, which is
 * the live reproduction ("in the same tick"): each handler sees the same
 * stale snapshot, so a two-field write is guaranteed to lose one of them.
 */
test("a cost and a weight typed in the same tick both reach Firestore", async ({ page }) => {
  await seedBatch(REF_MONEY, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    mainIngredientName: "M24 Prawns",
    recipeId: RECIPE,
    state: "cooking",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    weightRaw: 2000,
  });

  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_MONEY);
  await expect(page.getByTestId(`actual-cost-${PRAWNS}`)).toBeVisible();

  await page.evaluate(
    (ingredientId: string) => {
      const fire = (testId: string, value: string): void => {
        const box = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
        if (!box) throw new Error(`no box ${testId}`);
        box.value = value;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
      };
      fire(`actual-cost-${ingredientId}`, "500");
      fire(`actual-weight-${ingredientId}`, "1700");
    },
    PRAWNS,
  );

  await expect
    .poll(async () => (await readDocument(`batches/${REF_MONEY}/lines/${PRAWNS}`))?.qtyActual, {
      timeout: 10_000,
    })
    .toBe(1700);

  const line = await readDocument(`batches/${REF_MONEY}/lines/${PRAWNS}`);
  expect(line?.costActual, "the ₹500 must not have been wiped by the weight commit").toBe(50_000);
});

/**
 * An empty box is not a number. Clearing a weight and blurring is a person
 * mid-edit or changing their mind, never an instruction to store a zero.
 */
test("clearing a weight box leaves the stored weight alone, and a typed 0 still writes", async ({
  page,
}) => {
  await seedBatch(REF_BLANK, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    mainIngredientName: "M24 Prawns",
    recipeId: RECIPE,
    state: "cooking",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    weightRaw: 2000,
    weightCleaned: 5000,
    weightCooked: 4000,
  });

  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_BLANK);

  await expect(page.getByTestId("input-weightCleaned")).toHaveValue("5000");
  await page.getByTestId("input-weightCleaned").fill("");
  await page.getByTestId("input-weightCleaned").blur();
  // Blank is never a write: the box shows the stored weight again.
  await expect(page.getByTestId("input-weightCleaned")).toHaveValue("5000");

  // Whitespace alone is the same non-answer.
  await page.getByTestId("input-weightCleaned").fill("   ");
  await page.getByTestId("input-weightCleaned").blur();

  // A deliberate zero is a real number and still saves.
  await page.getByTestId("input-weightCooked").fill("0");
  await page.getByTestId("input-weightCooked").blur();
  await expect
    .poll(async () => (await readDocument(`batches/${REF_BLANK}`))?.weightCooked, { timeout: 10_000 })
    .toBe(0);

  const batch = await readDocument(`batches/${REF_BLANK}`);
  expect(batch?.weightCleaned, "a cleared box must not have zeroed the stored weight").toBe(5000);
});

/**
 * A cost is money. Below zero is not a cost, and nothing silently swallows it:
 * the person is told, and Firestore never sees it.
 */
test("a negative bottling cost is refused on screen and never reaches Firestore", async ({ page }) => {
  await seedBatch(REF_COSTS, {
    productSlug: PRODUCT,
    productName: "M24 Prawns Pickle",
    recipeId: RECIPE,
    state: "bottled",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    bottledJars: 22,
    packedOn: "2026-09-04",
    bestBefore: "2027-03-04",
  });

  await signIn(page, KITCHEN_PHONE);
  await openBatch(page, REF_COSTS);

  await page.getByTestId("input-cost-jarsLids").fill("-50");
  await page.getByTestId("input-cost-jarsLids").blur();
  await expect(page.getByTestId("costs-error")).toHaveText(BATCHES.costInvalid);

  // A typed amount finer than a paisa is rounded to the nearest paise, not
  // refused and never stored as a float: ₹12.345 is ₹12.35. That is
  // `rupeesToPaise`, the one conversion every price box in the admin goes
  // through since M2.2, so a cost and a price cannot round differently.
  await page.getByTestId("input-cost-jarsLids").fill("12.345");
  await page.getByTestId("input-cost-jarsLids").blur();
  await expect(page.getByTestId("costs-error")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        ((await readDocument(`batches/${REF_COSTS}`))?.costs as Record<string, unknown> | undefined)
          ?.jarsLids,
      { timeout: 10_000 },
    )
    .toBe(1235);

  // Zero is a perfectly good cost, and it saves.
  await page.getByTestId("input-cost-boxInserts").fill("0");
  await page.getByTestId("input-cost-boxInserts").blur();
  await expect(page.getByTestId("costs-error")).toHaveCount(0);

  // A normal cost saves too.
  await page.getByTestId("input-cost-labelling").fill("450");
  await page.getByTestId("input-cost-labelling").blur();
  await expect
    .poll(
      async () =>
        ((await readDocument(`batches/${REF_COSTS}`))?.costs as Record<string, unknown> | undefined)
          ?.labelling,
      { timeout: 10_000 },
    )
    .toBe(45_000);

  // The negative amount never landed: jars and lids still holds the rounded
  // ₹12.35 typed after it, and never -5000.
  const costs = (await readDocument(`batches/${REF_COSTS}`))?.costs as Record<string, unknown>;
  expect(costs.jarsLids, "a negative rupee amount must never become negative paise").toBe(1235);
});

/* -------------------------------------------------------------------------- */
/* The done-when, literally: one batch, both people, no seeded state          */
/* -------------------------------------------------------------------------- */

/**
 * M2.4's done-when is one walk, not six fragments: Shefin creates the batch
 * on the form and opens it, Sumayya cooks and bottles it, and the label is
 * the internal reference the whole way until the jars exist (D21c, A64).
 *
 * Nothing about this batch is seeded. The only write that is not a tap is the
 * paid count, which is a customer's doing rather than either of theirs, and
 * which the `onBatchWritten` trigger turns into Half reached by itself. The
 * two people sign in in two browser contexts, because they are two people on
 * two phones.
 */
test("one batch, created on the form, walked by Owner and Kitchen to a number", async ({
  page,
  browser,
}) => {
  // ---- Shefin creates the draft on the form ----
  await signIn(page, OWNER_PHONE);
  await openBatches(page);
  await page.getByTestId("new-batch").click();

  await page.locator("#new-batch-product").selectOption(PRODUCT);
  await page.locator("#new-batch-recipe").selectOption(RECIPE);
  await page.locator("#new-batch-jars").fill("20");
  await page.locator("#new-batch-price-open").fill("599");
  await page.locator("#new-batch-price-in-stock").fill("649");
  await page.getByTestId("submit-create-batch").click();

  await expect(page.getByTestId("batch-detail")).toBeVisible();
  await expect(page.getByTestId("create-batch-error")).toHaveCount(0);

  // D21c: a draft is named by its internal reference, never by a number.
  const draftLabel = (await page.getByTestId("detail-label").textContent()) ?? "";
  expect(draftLabel).toMatch(/^draft b-[0-9a-z]{6}$/i);
  const ref = draftLabel.replace(/^draft /i, "").trim();

  try {
    // ---- Shefin opens it ----
    await expect(page.getByTestId("state-button")).toHaveText(BATCHES.openBatch);
    await page.getByTestId("state-button").click();
    await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.open);
    await expect(page.getByTestId("view-bookableJars")).toHaveText("18");
    await expect(page.getByTestId("detail-label")).toContainText(ref);

    // ---- Customers pay for half of the bookable jars ----
    // Not a tap either of them makes: the count is the one thing a customer
    // moves, and `onBatchWritten` reads it and moves the batch on its own.
    await patchDocument(`batches/${ref}`, { paidCount: 9 });
    await expect(page.getByTestId("detail-state-chip")).toHaveText(
      BATCHES.stateLabel.halfReached,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("detail-approval-badge")).toBeVisible();

    // ---- Shefin says yes, and the sourcing starts ----
    await expect(page.getByTestId("state-button")).toHaveText(BATCHES.sayYesSourcing);
    await page.getByTestId("state-button").click();
    await expect(page.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.sourcing);
    // Still no number: the jars do not exist yet.
    await expect(page.getByTestId("detail-label")).toContainText(ref);

    // ---- Sumayya, on her own phone, cooks and bottles it ----
    const kitchenContext = await browser.newContext();
    const kitchen = await kitchenContext.newPage();
    try {
      await acceptFixedOtp(kitchen);
      await signIn(kitchen, KITCHEN_PHONE);
      await openBatch(kitchen, ref);

      await expect(kitchen.getByTestId("detail-label")).toContainText(ref);
      await expect(kitchen.getByTestId("state-button")).toHaveText(BATCHES.startCooking);
      await kitchen.getByTestId("state-field-landedOn").fill("2026-09-01");
      await kitchen.getByTestId("state-field-source").fill("Beypore harbour");
      await kitchen.getByTestId("state-field-weightRaw").fill("1600");
      await kitchen.getByTestId("state-field-costRaw").fill("800");
      await kitchen.getByTestId("state-button").click();
      await expect(kitchen.getByTestId("detail-state-chip")).toHaveText(BATCHES.stateLabel.cooking);

      await expect(kitchen.getByTestId("state-button")).toHaveText(BATCHES.bottleBatch);
      await kitchen.getByTestId("state-field-weightCleaned").fill("9000");
      await kitchen.getByTestId("state-field-weightCooked").fill("7000");
      await kitchen.getByTestId("state-field-jarCount").fill("20");
      await kitchen.getByTestId("state-field-packedOn").fill("2026-09-04");
      await kitchen.getByTestId("state-button").click();

      await expect(kitchen.getByTestId("transition-error")).toHaveCount(0);

      // Bottled is a blink, not a resting place: 20 jars bottled against 9
      // paid leaves surplus, and `onBatchWritten` puts the batch In stock on
      // its own within the same breath (8.2's automatic row). So what is
      // waited on is the thing the person actually came for, the number, and
      // the state is then allowed to be either.
      await expect(kitchen.getByTestId("detail-label")).toHaveText(/^Batch \d{3}$/, {
        timeout: 15_000,
      });
      await expect(kitchen.getByTestId("detail-state-chip")).toHaveText(
        new RegExp(`^(${BATCHES.stateLabel.bottled}|${BATCHES.stateLabel.inStock})$`),
      );
      await expect(kitchen.getByTestId("view-bottledJars")).toHaveText("20");

      // D21c: the internal reference is gone from the label now that the jars
      // exist and carry a printed number.
      const bottledLabel = (await kitchen.getByTestId("detail-label").textContent()) ?? "";
      expect(bottledLabel).not.toContain(ref);
    } finally {
      await kitchenContext.close();
    }

    // Shefin's screen, still open on the same batch, shows the number too.
    await expect(page.getByTestId("detail-label")).toHaveText(/^Batch \d{3}$/, { timeout: 15_000 });
  } finally {
    await deleteDocument(`batches/${ref}/lines/main`);
    await deleteDocument(`batches/${ref}/lines/${VINEGAR}`);
    await deleteDocument(`batches/${ref}`);
    await deleteDocument(`approvals/half-${ref}`);
    await deleteDocument(`approvals/open-${ref}`);
  }
});
