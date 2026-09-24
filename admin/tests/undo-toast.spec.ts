/**
 * The undo toast itself (M2.21), not any one screen that raises one.
 *
 * `UndoToast` is one component with one stylesheet rule, shared by the batch
 * fields, the Cooking actuals and the products screens. It was broken in all
 * of them at once, for the same reason, and no screen's own spec noticed:
 * every one of them asserted the Undo button was present and clickable, and
 * it was. It was also invisible, #17150f on #17150f, because `button.quiet`
 * (element plus class) outranked `.undo-toast-button` (class alone) and the
 * paper background never applied.
 *
 * This file guards the component. A screen's spec should go on testing what
 * its own undo does; what "the toast can be read at all" means lives here, so
 * the next person to raise a toast is covered without knowing to add this.
 */
import { expect, test, type Page } from "@playwright/test";

import { BATCHES, COPY } from "../src/copy";
import { expectReadable, measureContrast, MIN_CONTRAST } from "./contrast";
import {
  OTP,
  OWNER_PHONE,
  acceptFixedOtp,
  deleteDocument,
  seedBatch,
  seedDocument,
} from "./emulator";

const PRODUCT = "m21-prawns-pickle";
const RECIPE = "m21-recipe";
const PRAWNS = "m21-prawns";
const REF = "b-m21tst";

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedDocument(`ingredients/${PRAWNS}`, {
    labelName: "M21 Prawns",
    allergenTags: ["Crustacean (Prawns)"],
    nutritionPer100g: { energyKcal: 99, proteinG: 24 },
    unitCost: 60_000,
    unit: "g",
    source: "Chaliyam",
  });
  await seedDocument(`recipes/${RECIPE}`, {
    productSlug: PRODUCT,
    version: 1,
    percentageBasis: "B",
    expectedYieldJars: 20,
    finishedWeightG: 4000,
    storageText: "Cool, dry place.",
    claimsText: "No added preservatives.",
    lines: [{ ingredientId: PRAWNS, qty: 1550, unit: "g", isMain: true, evaporates: false }],
  });
  await seedDocument(`products/${PRODUCT}`, {
    name: "M21 Prawns Pickle",
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
  await seedBatch(REF, {
    productSlug: PRODUCT,
    productName: "M21 Prawns Pickle",
    recipeId: RECIPE,
    state: "open",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    perPersonLimitOverride: null,
    paidCount: 2,
    priceOpen: 59_900,
    priceInStock: 64_900,
  });
});

test.afterEach(async () => {
  await deleteDocument(`batches/${REF}`);
  await deleteDocument(`recipes/${RECIPE}`);
  await deleteDocument(`ingredients/${PRAWNS}`);
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

/** Any in-place edit raises the one shared toast. This uses the cheapest. */
async function raiseToast(page: Page): Promise<void> {
  await page.getByTestId("tab-batches").click();
  await expect(page.getByTestId("screen-batches")).toBeVisible();
  await page.getByTestId(`batch-row-${REF}`).click();
  await expect(page.getByTestId("batch-detail")).toBeVisible();
  await page.getByTestId("input-priceOpen").fill("575");
  await page.getByTestId("input-priceOpen").blur();
  await expect(page.getByTestId("undo-toast")).toBeVisible();
}

test("the Undo button can actually be read on the toast", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await raiseToast(page);

  const button = page.getByTestId("undo-toast-undo");
  await expect(button).toHaveText(BATCHES.undo);

  // The bug, named: identical colours give exactly 1.00:1, and every
  // "is it there, can I click it" assertion passes straight through that.
  const measured = await measureContrast(button);
  expect(measured.color).not.toBe(measured.background);
  await expectReadable(button, "the Undo button");

  // It is the button the rule always intended: ink on paper, not ink on the
  // toast's ink. Asserted as the resolved colours rather than the tokens, so
  // a rule that silently stops applying cannot pass this.
  expect(measured.color).toBe("rgb(23, 21, 15)");
  expect(measured.background).toBe("rgb(250, 248, 244)");
});

test("the toast's own message is readable too, and stays so while focused", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await raiseToast(page);

  // Paper on ink, the other way round from the button, and the reason the
  // button had to fight for its background in the first place.
  await expectReadable(page.getByTestId("undo-toast-message"), "the toast message");

  // Focus is the other state with the same problem, from a different rule:
  // the global ring is `2px solid var(--ink)` at a 2px offset, which on this
  // one dark surface would paint an ink ring on ink. The label must stay
  // readable with the button focused, and the ring must not be the toast's
  // own colour.
  //
  // The pseudo-class is forced over CDP rather than focused with `.focus()`,
  // because a programmatic focus on a button does not match `:focus-visible`
  // in Chromium: `outlineColor` then reports `currentColor` (the button's own
  // ink) and the assertion would be measuring a ring that is not being drawn.
  // Forcing it is what puts the rule on screen.
  const button = page.getByTestId("undo-toast-undo");
  await button.focus();
  await expect(button).toBeFocused();
  await expectReadable(button, "the Undo button while focused");

  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const { root } = await client.send("DOM.getDocument");
  const { nodeId } = await client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: '[data-testid="undo-toast-undo"]',
  });
  await client.send("CSS.forcePseudoState", {
    nodeId,
    forcedPseudoClasses: ["focus", "focus-visible"],
  });

  const ring = await button.evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
  });
  const toastBackground = await page
    .getByTestId("undo-toast")
    .evaluate((el) => getComputedStyle(el).backgroundColor);

  // A ring is actually drawn...
  expect(ring.style).not.toBe("none");
  expect(ring.width).not.toBe("0px");
  // ...and it is paper, not the ink it sits on.
  expect(ring.color).toBe("rgb(250, 248, 244)");
  expect(ring.color).not.toBe(toastBackground);
});

/**
 * The guard on the guard. If `measureContrast` ever stopped resolving the
 * effective background (by reading `transparent` as white, say) it would
 * report a comfortable ratio for the exact bug it exists to catch, and the
 * two tests above would pass forever while Shefin saw nothing. So this
 * recreates the broken rule on the live page and checks the helper fails it.
 */
test("the contrast check itself catches the bug it was written for", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await raiseToast(page);

  const button = page.getByTestId("undo-toast-undo");
  await button.evaluate((el) => {
    // Exactly what `button.quiet` left behind before the fix.
    (el as HTMLElement).style.setProperty("background", "transparent", "important");
    (el as HTMLElement).style.setProperty("color", "#17150f", "important");
  });

  const broken = await measureContrast(button);
  expect(broken.background).toBe("rgb(23, 21, 15)"); // walked up to the toast
  expect(broken.ratio).toBeLessThan(MIN_CONTRAST);
  expect(broken.ratio).toBeCloseTo(1, 2);
});
