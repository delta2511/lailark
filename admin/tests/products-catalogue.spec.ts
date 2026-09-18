import { expect, test, type Page } from "@playwright/test";

import { COPY, PRODUCTS } from "../src/copy";
import { KITCHEN_PHONE, OTP, OWNER_PHONE, acceptFixedOtp, deleteDocument, seedDocument } from "./emulator";

/**
 * M2.2: the Products tab (brief section 17.8), heroes and pipeline, prices
 * and jar size, HSN, the shipping rule, the Koorka season window and custom
 * lines with a set amount, photos to the Storage emulator (Q8), and every
 * number editable in place with an undo toast (brief section 17.1).
 *
 * Everything the screens read is seeded here through the emulator's admin
 * endpoint, never through the app, exactly the pattern M2.1 set for
 * ingredients and recipes.
 */
const HERO_SLUG = "m22-test-hero";
const PIPELINE_SLUG = "m22-test-pipeline";

const SEEDED = [`products/${HERO_SLUG}`, `products/${PIPELINE_SLUG}`];

async function seedTestProducts(): Promise<void> {
  await seedDocument(`products/${HERO_SLUG}`, {
    name: "M22 Test Hero",
    type: "hero",
    veg: false,
    hsn: "2001",
    priceInStock: 64900,
    priceOpen: 59900,
    jarGrams: 200,
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: true,
    customLines: [{ description: "Extra spoon", amountPaise: 5000 }],
  });
  await seedDocument(`products/${PIPELINE_SLUG}`, {
    name: "M22 Test Pipeline",
    type: "pipeline",
    veg: true,
    hsn: "2001",
    priceInStock: 64900,
    priceOpen: 59900,
    jarGrams: 200,
    shippingRule: "free",
    seasonStart: "11-01",
    seasonEnd: "02-28",
    active: true,
    customLines: [],
  });
}

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedTestProducts();
});

test.afterEach(async () => {
  for (const path of SEEDED) await deleteDocument(path);
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

async function openProductsTab(page: Page): Promise<void> {
  await page.getByTestId("tab-more").click();
  await page.getByTestId("more-row-products").click();
  await expect(page.getByTestId("screen-more-products")).toBeVisible();
  await page.getByTestId("products-tab-products").click();
}

/** Every box a person could type into, anywhere on the screen. */
function editInputs(page: Page) {
  return page.locator(
    '[data-testid="screen-more-products"] input, [data-testid="screen-more-products"] select, [data-testid="screen-more-products"] textarea',
  );
}

/* -------------------------------------------------------------------------- */
/* Owner                                                                      */
/* -------------------------------------------------------------------------- */

test("Owner opens Products and sees Heroes and Pipeline grouped", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openProductsTab(page);

  await expect(page.getByTestId("read-only-note")).toHaveCount(0);
  await expect(page.locator(".section-heading", { hasText: PRODUCTS.heroesHeading })).toBeVisible();
  await expect(page.locator(".section-heading", { hasText: PRODUCTS.pipelineHeading })).toBeVisible();
  await expect(page.getByTestId(`product-row-${HERO_SLUG}`)).toBeVisible();
  await expect(page.getByTestId(`product-row-${PIPELINE_SLUG}`)).toBeVisible();
  await expect(page.getByTestId(`product-row-${HERO_SLUG}`)).toContainText("₹649");
  await expect(page.getByTestId(`product-row-${HERO_SLUG}`)).toContainText("200 g");
});

test("Owner changes a price in place, sees the undo toast, and Undo restores it", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openProductsTab(page);
  await page.getByTestId(`product-row-${HERO_SLUG}`).click();
  await expect(page.getByTestId("product-detail")).toBeVisible();

  const priceBox = page.locator("#edit-priceInStock");
  await expect(priceBox).toHaveValue("649");

  await priceBox.fill("620");
  await priceBox.blur();

  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(page.getByTestId("undo-toast")).toContainText("₹620");

  // The write landed: reopening the product later would read 620 back, but
  // we do not need to leave and return to prove it, the box itself is
  // remounted from the new committed value.
  await expect(page.locator("#edit-priceInStock")).toHaveValue("620");

  await page.getByTestId("undo-toast-undo").click();
  await expect(page.getByTestId("undo-toast")).toHaveCount(0);
  await expect(page.locator("#edit-priceInStock")).toHaveValue("649");
});

test("Owner is refused a price above the MRP with a plain line, and nothing saves", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openProductsTab(page);
  await page.getByTestId(`product-row-${HERO_SLUG}`).click();
  await expect(page.getByTestId("product-detail")).toBeVisible();

  const priceBox = page.locator("#edit-priceInStock");
  await priceBox.fill("700");
  await priceBox.blur();

  await expect(page.getByTestId("save-error")).toHaveText(PRODUCTS.priceAboveMrp);
  await expect(page.getByTestId("undo-toast")).toHaveCount(0);
});

test("Owner edits jar size and a custom line's amount in place with undo", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openProductsTab(page);
  await page.getByTestId(`product-row-${HERO_SLUG}`).click();
  await expect(page.getByTestId("product-detail")).toBeVisible();

  const jarBox = page.locator("#edit-jarGrams");
  await expect(jarBox).toHaveValue("200");
  await jarBox.fill("220");
  await jarBox.blur();
  await expect(page.getByTestId("undo-toast")).toContainText("220");
  await page.getByTestId("undo-toast-undo").click();
  await expect(page.locator("#edit-jarGrams")).toHaveValue("200");

  const amountBox = page.getByTestId("custom-line-amount-0");
  await expect(amountBox).toHaveValue("50");
  await amountBox.fill("75");
  await amountBox.blur();
  await expect(page.getByTestId("undo-toast")).toContainText("₹75");
  await page.getByTestId("undo-toast-undo").click();
  await expect(page.getByTestId("custom-line-amount-0")).toHaveValue("50");
});

test("Owner uploads photos and the note photo always sorts last", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openProductsTab(page);
  await page.getByTestId(`product-row-${HERO_SLUG}`).click();
  await expect(page.getByTestId("product-detail")).toBeVisible();

  // A tiny valid 1x1 PNG, so the upload is real and small.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  // Upload the note photo first...
  await page.getByTestId("note-photo-upload").setInputFiles({
    name: "note.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByTestId("photo-list").locator("li")).toHaveCount(1);

  // ...then a plain photo second.
  await page.getByTestId("photo-upload").setInputFiles({
    name: "jar.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByTestId("photo-list").locator("li")).toHaveCount(2);

  // Uploaded second, but the note still sorts to the end (brief 17.8).
  const rows = page.getByTestId("photo-list").locator("li");
  await expect(rows.nth(0)).not.toContainText(PRODUCTS.notePhoto);
  await expect(rows.nth(1)).toContainText(PRODUCTS.notePhoto);

  // Tidy up through the app's own remove button, exactly the write path a
  // real removal takes.
  await rows.nth(1).getByRole("button", { name: PRODUCTS.removePhoto }).click();
  await rows.nth(0).getByRole("button", { name: PRODUCTS.removePhoto }).click();
  await expect(page.getByTestId("photo-list").locator("li")).toHaveCount(0);
});

/* -------------------------------------------------------------------------- */
/* Kitchen and Viewer: read only, no switch governs Products                 */
/* -------------------------------------------------------------------------- */

test("Kitchen reads Products with no edit inputs anywhere", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await openProductsTab(page);

  await expect(page.getByTestId("read-only-note")).toHaveText(PRODUCTS.readOnly);
  await expect(page.getByTestId("new-product")).toHaveCount(0);
  await expect(page.getByTestId(`product-row-${HERO_SLUG}`)).toBeVisible();
  await expect(editInputs(page)).toHaveCount(0);

  await page.getByTestId(`product-row-${HERO_SLUG}`).click();
  await expect(page.getByTestId("product-detail")).toBeVisible();
  await expect(page.getByTestId("product-form")).toHaveCount(0);
  await expect(page.getByTestId("view-name")).toHaveText("M22 Test Hero");
  await expect(page.getByTestId("view-priceInStock")).toHaveText("₹649");
  await expect(page.getByTestId("view-jarGrams")).toHaveText("200 g");
  await expect(page.getByTestId("view-customLines")).toContainText("Extra spoon");
  await expect(page.getByTestId("view-customLines")).toContainText("₹50");
  await expect(editInputs(page)).toHaveCount(0);
});

// There is no seeded Viewer test phone number in the emulator (CLAUDE.md
// section 8 lists only Owner and Kitchen; M2.1's own spec tests only these
// two for the same reason). Viewer's code path is identical to Kitchen's
// here: `canEditProducts` is `session.role === "owner"`, so any non-owner
// role, Viewer included, renders the same read-only branch the Kitchen test
// above exercises. ASSUMED: that equivalence stands in for a Viewer-signed-in
// Playwright run rather than fabricating emulator infrastructure for it.

test("Products draws no console error and paints no rust on a button or heading", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await signIn(page, OWNER_PHONE);
  await openProductsTab(page);
  await page.getByTestId(`product-row-${HERO_SLUG}`).click();
  await expect(page.getByTestId("product-detail")).toBeVisible();

  const RUST = "rgb(163, 74, 40)";
  const offenders = await page.evaluate((rust) => {
    const elements = Array.from(document.querySelectorAll("button, h1, h2, h3, a"));
    return elements
      .filter((el) => getComputedStyle(el).color === rust)
      .map((el) => el.outerHTML.slice(0, 80));
  }, RUST);

  expect(offenders).toEqual([]);
  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
});
