import { expect, test, type Page } from "@playwright/test";

import { COPY, PRODUCTS } from "../src/copy";
import {
  KITCHEN_PHONE,
  OTP,
  OWNER_PHONE,
  acceptFixedOtp,
  deleteDocument,
  seedDocument,
  setKitchenCanEditRecipes,
} from "./emulator";

/**
 * M2.1: Products, the Ingredients and Recipes screens, and D22's switch.
 *
 * Everything the screens read is seeded here through the emulator's admin
 * endpoint, never through the app: a test that seeds itself can say what the
 * numbers ought to be.
 *
 * The seed is a two line recipe, small enough to check by hand:
 *
 *   prawns  1,550 g, declares a percentage
 *   vinegar 2 L at 1.00 g/ml, 2,000 g in, 400 g stays
 *
 * Basis A divides by 3,550 g, so prawns are 43.7%, printed 44%.
 * Basis B divides by 1,550 + 400 = 1,950 g, so prawns are 79.5%, printed 79%.
 * Basis C divides by the 1,900 g finished weight, so prawns are 81.6%, 82%.
 */
const PRAWNS = "m21-prawns";
const VINEGAR = "m21-vinegar";
const RECIPE = "m21-recipe";

const SEEDED = [`ingredients/${PRAWNS}`, `ingredients/${VINEGAR}`, `recipes/${RECIPE}`];

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);

  await seedDocument(`ingredients/${PRAWNS}`, {
    labelName: "Prawns",
    allergenTags: ["Crustacean (Prawns)"],
    nutritionPer100g: { energyKcal: 99, proteinG: 24 },
    unitCost: 60000,
    unit: "g",
    source: "Chaliyam",
  });
  await seedDocument(`ingredients/${VINEGAR}`, {
    labelName: "Vinegar",
    allergenTags: [],
    nutritionPer100g: { energyKcal: 18, proteinG: 0 },
    unitCost: 5000,
    unit: "l",
    source: null,
    densityGPerMl: 1.0,
  });
  await seedDocument(`recipes/${RECIPE}`, {
    productSlug: "m21-prawns-and-dates",
    version: 1,
    percentageBasis: "B",
    expectedYieldJars: 10,
    finishedWeightG: 1900,
    storageText:
      "Cool, dry place away from sunlight; refrigerate after opening; clean dry spoon; keep prawns covered in oil.",
    claimsText: "No added preservatives. Prepared by traditional method.",
    lines: [
      { ingredientId: PRAWNS, qty: 1550, unit: "g", isMain: true, evaporates: false },
      { ingredientId: VINEGAR, qty: 2, unit: "l", isMain: false, evaporates: true, residueG: 400 },
    ],
  });
});

test.afterEach(async () => {
  for (const path of SEEDED) await deleteDocument(path);
  // Leave the Owner's switch the way seed-users leaves it, so no later spec
  // inherits a kitchen that can edit recipes.
  await setKitchenCanEditRecipes(false);
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

async function openProducts(page: Page): Promise<void> {
  await page.getByTestId("tab-more").click();
  await page.getByTestId("more-row-products").click();
  await expect(page.getByTestId("screen-more-products")).toBeVisible();
}

/** Every box a person could type into, anywhere on the screen. */
function editInputs(page: Page) {
  return page.locator('[data-testid="screen-more-products"] input, [data-testid="screen-more-products"] select, [data-testid="screen-more-products"] textarea');
}

/* -------------------------------------------------------------------------- */
/* Owner                                                                      */
/* -------------------------------------------------------------------------- */

test("Owner opens Products and sees both lists", async ({ page }) => {
  await setKitchenCanEditRecipes(false);
  await signIn(page, OWNER_PHONE);
  await openProducts(page);

  await expect(page.getByTestId(`ingredient-row-${PRAWNS}`)).toBeVisible();
  await expect(page.getByTestId(`ingredient-row-${VINEGAR}`)).toBeVisible();
  await expect(page.getByTestId("read-only-note")).toHaveCount(0);

  await page.getByTestId("products-tab-recipes").click();
  await expect(page.getByTestId(`recipe-row-${RECIPE}`)).toBeVisible();
});

test("Owner creates an ingredient and it appears in the list", async ({ page }) => {
  await setKitchenCanEditRecipes(false);
  await signIn(page, OWNER_PHONE);
  await openProducts(page);

  await page.getByTestId("new-ingredient").click();
  await expect(page.getByTestId("ingredient-form")).toBeVisible();

  await page.getByLabel(PRODUCTS.labelName).fill("M21 Curry Leaves");
  await page.getByLabel(PRODUCTS.allergenTags).fill("");
  await page.getByLabel(PRODUCTS.unitCost).fill("12.50");
  await page.getByLabel(PRODUCTS.source).fill("Kunnamangalam");
  await page.getByLabel("Energy (kcal)").fill("108");
  await page.getByTestId("save-ingredient").click();

  await expect(page.getByTestId("save-error")).toHaveCount(0);
  await expect(page.getByTestId("ingredient-list").getByText("M21 Curry Leaves")).toBeVisible();

  // Tidy up: the id is Firestore's, so it is found by the row that carries it.
  const id = await page
    .getByTestId("ingredient-list")
    .locator("button", { hasText: "M21 Curry Leaves" })
    .getAttribute("data-testid");
  await deleteDocument(`ingredients/${(id ?? "").replace("ingredient-row-", "")}`);
});

test("Owner creates a recipe with lines and watches the label block build", async ({ page }) => {
  await setKitchenCanEditRecipes(false);
  await signIn(page, OWNER_PHONE);
  await openProducts(page);

  await page.getByTestId("products-tab-recipes").click();
  await page.getByTestId("new-recipe").click();
  await expect(page.getByTestId("recipe-form")).toBeVisible();

  await page.getByLabel(PRODUCTS.productSlug).fill("m21-new-pickle");
  await page.getByLabel(PRODUCTS.finishedWeightG).fill("1000");

  await page.getByTestId("add-line").click();
  await page.locator("#line-0-ingredient").selectOption(PRAWNS);
  await page.locator("#line-0-qty").fill("500");
  await page.locator("#line-0-main").check();

  // 500 g of prawns in 1,000 g of jar, and nothing boils off, so basis B
  // divides by the 500 g that is there: 100%.
  await expect(page.getByTestId("label-ingredients-line")).toHaveText("Prawns (100%).");

  await page.getByTestId("add-line").click();
  await page.locator("#line-1-ingredient").selectOption(VINEGAR);
  await page.locator("#line-1-qty").fill("500");

  // 500 g each now, so prawns are half of it.
  await expect(page.getByTestId("label-ingredients-line")).toHaveText("Prawns (50%), Vinegar.");
  await expect(page.getByTestId("label-allergen-line")).toHaveText(
    "Contains: Crustacean (Prawns).",
  );
  await expect(page.getByTestId("label-claims")).toHaveText(
    "No added preservatives. Prepared by traditional method.",
  );
  await expect(page.getByTestId("label-storage")).toHaveText(
    "Cool, dry place away from sunlight; refrigerate after opening; clean dry spoon; keep prawns covered in oil.",
  );

  await page.getByTestId("save-recipe").click();
  await expect(page.getByTestId("save-error")).toHaveCount(0);
  await expect(page.getByTestId("recipe-list").getByText("m21-new-pickle")).toBeVisible();

  const id = await page
    .getByTestId("recipe-list")
    .locator("button", { hasText: "m21-new-pickle" })
    .getAttribute("data-testid");
  await deleteDocument(`recipes/${(id ?? "").replace("recipe-row-", "")}`);
});

/**
 * M2.13. Two lines of one ingredient cannot have separate actuals on a
 * batch: those live in `batches/{ref}/lines` keyed by ingredient, and any
 * positional tiebreak swaps the two lines' typed weights and costs the
 * moment the lines are reordered. So the recipe does not allow the shape at
 * all: an ingredient already on a line is not offered on another one.
 */
test("an ingredient already on a line is not offered on a second line", async ({ page }) => {
  await setKitchenCanEditRecipes(false);
  await signIn(page, OWNER_PHONE);
  await openProducts(page);

  await page.getByTestId("products-tab-recipes").click();
  await page.getByTestId("new-recipe").click();
  await expect(page.getByTestId("recipe-form")).toBeVisible();

  await page.getByTestId("add-line").click();
  await page.locator("#line-0-ingredient").selectOption(PRAWNS);
  await page.getByTestId("add-line").click();

  // Prawns is gone from the second line's options; vinegar is still there.
  const second = page.locator("#line-1-ingredient");
  await expect(second.locator(`option[value="${PRAWNS}"]`)).toHaveCount(0);
  await expect(second.locator(`option[value="${VINEGAR}"]`)).toHaveCount(1);

  // And the first line still shows its own choice.
  await expect(page.locator("#line-0-ingredient")).toHaveValue(PRAWNS);
  await expect(page.locator(`#line-0-ingredient option[value="${PRAWNS}"]`)).toHaveCount(1);
});

test("Owner flips the basis switch and the percentages move", async ({ page }) => {
  await setKitchenCanEditRecipes(false);
  await signIn(page, OWNER_PHONE);
  await openProducts(page);

  await page.getByTestId("products-tab-recipes").click();
  await page.getByTestId(`recipe-row-${RECIPE}`).click();
  await expect(page.getByTestId("label-block")).toBeVisible();

  // B is the recipe's own basis and the engine's default (doc section 4).
  await expect(page.getByTestId("basis-B")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("label-ingredients-line")).toHaveText("Prawns (79%), Vinegar.");
  await expect(page.getByTestId(`percent-${PRAWNS}`)).toContainText("79.5");

  await page.getByTestId("basis-A").click();
  await expect(page.getByTestId("label-ingredients-line")).toHaveText("Vinegar, Prawns (44%).");
  await expect(page.getByTestId(`percent-${PRAWNS}`)).toContainText("43.7");

  await page.getByTestId("basis-C").click();
  await expect(page.getByTestId("label-ingredients-line")).toHaveText("Vinegar, Prawns (82%).");
  await expect(page.getByTestId(`percent-${PRAWNS}`)).toContainText("81.6");

  await page.getByTestId("basis-B").click();
  await expect(page.getByTestId("label-ingredients-line")).toHaveText("Prawns (79%), Vinegar.");

  // The allergen line never moves with the switch.
  await expect(page.getByTestId("label-allergen-line")).toHaveText("Contains: Crustacean (Prawns).");
});

/* -------------------------------------------------------------------------- */
/* Kitchen, D22                                                               */
/* -------------------------------------------------------------------------- */

test("Kitchen with the switch off reads everything and gets no edit inputs", async ({ page }) => {
  await setKitchenCanEditRecipes(false);
  await signIn(page, KITCHEN_PHONE);
  await openProducts(page);

  await expect(page.getByTestId("read-only-note")).toHaveText(PRODUCTS.readOnly);
  await expect(page.getByTestId("new-ingredient")).toHaveCount(0);
  await expect(page.getByTestId(`ingredient-row-${PRAWNS}`)).toBeVisible();
  await expect(editInputs(page)).toHaveCount(0);

  await page.getByTestId(`ingredient-row-${PRAWNS}`).click();
  await expect(page.getByTestId("ingredient-detail")).toBeVisible();
  await expect(page.getByTestId("ingredient-form")).toHaveCount(0);
  await expect(page.getByTestId("view-labelName")).toHaveText("Prawns");
  await expect(page.getByTestId("view-allergenTags")).toHaveText("Crustacean (Prawns)");
  await expect(page.getByTestId("view-unitCost")).toHaveText("₹600");
  await expect(page.getByTestId("view-source")).toHaveText("Chaliyam");
  await expect(editInputs(page)).toHaveCount(0);

  await page.getByRole("button", { name: PRODUCTS.backToProducts }).click();
  await page.getByTestId("products-tab-recipes").click();
  await page.getByTestId(`recipe-row-${RECIPE}`).click();

  await expect(page.getByTestId("recipe-detail")).toBeVisible();
  await expect(page.getByTestId("recipe-form")).toHaveCount(0);
  await expect(page.getByTestId(`view-line-${PRAWNS}`)).toContainText("1550 g");
  await expect(page.getByTestId(`view-line-${VINEGAR}`)).toContainText("2 l");
  await expect(page.getByTestId("label-ingredients-line")).toHaveText("Prawns (79%), Vinegar.");
  await expect(page.getByTestId("label-allergen-line")).toHaveText("Contains: Crustacean (Prawns).");
  await expect(editInputs(page)).toHaveCount(0);

  // The switch is a view control, so it still works read only.
  await page.getByTestId("basis-A").click();
  await expect(page.getByTestId("label-ingredients-line")).toHaveText("Vinegar, Prawns (44%).");
  await expect(editInputs(page)).toHaveCount(0);
});

test("Kitchen with the switch on gets the inputs and a save that succeeds", async ({ page }) => {
  await setKitchenCanEditRecipes(true);
  await signIn(page, KITCHEN_PHONE);
  await openProducts(page);

  await expect(page.getByTestId("read-only-note")).toHaveCount(0);
  await expect(page.getByTestId("new-ingredient")).toBeVisible();

  await page.getByTestId(`ingredient-row-${PRAWNS}`).click();
  await expect(page.getByTestId("ingredient-form")).toBeVisible();
  await expect(page.getByLabel(PRODUCTS.labelName)).toHaveValue("Prawns");

  await page.getByLabel(PRODUCTS.source).fill("Beypore");
  await page.getByTestId("save-ingredient").click();

  await expect(page.getByTestId("save-error")).toHaveCount(0);
  await expect(page.getByTestId("ingredient-list")).toBeVisible();

  // The save landed: reopening reads it back off the document.
  await page.getByTestId(`ingredient-row-${PRAWNS}`).click();
  await expect(page.getByLabel(PRODUCTS.source)).toHaveValue("Beypore");
});

test("Products draws no console error and paints no rust on a button or heading", async ({
  page,
}) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await setKitchenCanEditRecipes(false);
  await signIn(page, OWNER_PHONE);
  await openProducts(page);
  await page.getByTestId("products-tab-recipes").click();
  await page.getByTestId(`recipe-row-${RECIPE}`).click();
  await expect(page.getByTestId("label-block")).toBeVisible();

  const RUST = "rgb(163, 74, 40)";
  const offenders = await page.evaluate((rust) => {
    const elements = Array.from(document.querySelectorAll("button, h1, h2, h3, a"));
    return elements
      .filter((el) => getComputedStyle(el).color === rust)
      .map((el) => el.outerHTML.slice(0, 80));
  }, RUST);

  expect(offenders).toEqual([]);
  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);

  // Every tappable thing on the screen clears 48 px (Flow section 10).
  const buttons = page.locator('[data-testid="screen-more-products"] button');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    if (box) expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(48);
  }
});
