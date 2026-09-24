import { expect, test, type Page } from "@playwright/test";

import { COPY } from "../src/copy";
import { expectReadable } from "./contrast";
import { KITCHEN_PHONE, OTP, OWNER_PHONE, acceptFixedOtp } from "./emulator";

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

const EMULATOR_GAP = "/v2/recaptchaConfig";

test("all five bottom tabs render their title and empty state, and the URL changes", async ({
  page,
}) => {
  await signIn(page, OWNER_PHONE);

  const tabs: Array<{ testId: string; title: string; screen: string; path: string }> = [
    { testId: "tab-sell", title: "Sell", screen: "screen-sell", path: "/sell" },
    { testId: "tab-batches", title: "Batches", screen: "screen-batches", path: "/batches" },
    { testId: "tab-orders", title: "Orders", screen: "screen-orders", path: "/orders" },
    { testId: "tab-more", title: "More", screen: "screen-more", path: "/more" },
    { testId: "tab-today", title: "Today", screen: "screen-today", path: "/" },
  ];

  for (const tab of tabs) {
    await page.getByTestId(tab.testId).click();
    await expect(page.getByRole("heading", { name: tab.title, exact: true })).toBeVisible();
    await expect(page.getByTestId(tab.screen)).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe(tab.path);
  }
});

test("More lists all six rows for Owner", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await page.getByTestId("tab-more").click();

  for (const key of ["concerns", "products", "customers", "agent", "money", "settings"]) {
    await expect(page.getByTestId(`more-row-${key}`)).toBeVisible();
  }
});

test("More lists five rows for Kitchen: no Money", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await page.getByTestId("tab-more").click();

  for (const key of ["concerns", "products", "customers", "agent", "settings"]) {
    await expect(page.getByTestId(`more-row-${key}`)).toBeVisible();
  }
  await expect(page.getByTestId("more-row-money")).toHaveCount(0);
});

test("Kitchen cannot land on Money by a deep link either", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await page.goto("/more/money");
  await expect(page.getByTestId("screen-more")).toBeVisible();
});

test("each More row opens its own empty screen with a back affordance to More", async ({
  page,
}) => {
  await signIn(page, OWNER_PHONE);
  await page.getByTestId("tab-more").click();
  await page.getByTestId("more-row-concerns").click();

  await expect(page.getByTestId("screen-more-concerns")).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/more/concerns");

  await page.getByRole("button", { name: COPY.back }).click();
  await expect(page.getByTestId("screen-more")).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/more");
});

test("a deep link to /orders loads directly when already signed in", async ({ page }) => {
  await signIn(page, OWNER_PHONE);

  await page.goto("/orders");
  await expect(page.getByTestId("screen-orders")).toBeVisible();
  await expect(page.getByTestId("tab-orders")).toHaveAttribute("aria-current", "page");
});

test("no console errors beyond the documented recaptchaConfig probe", async ({ page }) => {
  const crashes: string[] = [];
  const failed: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes(EMULATOR_GAP)) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });

  await signIn(page, OWNER_PHONE);
  await page.getByTestId("tab-sell").click();
  await page.getByTestId("tab-batches").click();
  await page.getByTestId("tab-orders").click();
  await page.getByTestId("tab-more").click();
  await page.getByTestId("more-row-settings").click();

  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
  expect(failed, `failed requests: ${failed.join(" | ")}`).toEqual([]);
});

test("manifest is linked, the service worker registers, and the iOS capable meta is present", async ({
  page,
}) => {
  await page.goto("/");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toContain("manifest.webmanifest");

  const appleCapable = await page
    .locator('meta[name="apple-mobile-web-app-capable"]')
    .getAttribute("content");
  expect(appleCapable).toBe("yes");

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return reg !== undefined;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("no button, heading or link is painted rust", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await page.getByTestId("tab-more").click();

  const RUST = "rgb(163, 74, 40)";
  const offenders = await page.evaluate((rust) => {
    const elements = Array.from(document.querySelectorAll("button, h1, h2, h3, a"));
    return elements
      .filter((el) => getComputedStyle(el).color === rust)
      .map((el) => el.outerHTML.slice(0, 80));
  }, RUST);

  expect(offenders).toEqual([]);
});

test("every bottom-bar item is at least 48px tall, and Sell is bigger than the rest", async ({
  page,
}) => {
  await signIn(page, OWNER_PHONE);

  const testIds = ["tab-today", "tab-sell", "tab-batches", "tab-orders", "tab-more"];
  const boxes: Record<string, { width: number; height: number }> = {};
  for (const testId of testIds) {
    const box = await page.getByTestId(testId).boundingBox();
    if (!box) throw new Error(`${testId} has no bounding box`);
    expect(box.height, `${testId} height`).toBeGreaterThanOrEqual(48);
    boxes[testId] = { width: box.width, height: box.height };
  }

  const others = testIds.filter((id) => id !== "tab-sell");
  for (const id of others) {
    expect(boxes["tab-sell"].height, "sell taller than " + id).toBeGreaterThan(boxes[id].height);
    expect(boxes["tab-sell"].width, "sell wider than " + id).toBeGreaterThan(boxes[id].width);
  }
});

/**
 * Every bottom-bar label stays readable no matter which tab is active
 * (M2.22).
 *
 * The Sell button was invisible exactly while Sell itself was the active
 * tab: `.bottom-bar-item-sell` painted paper on ink, `.bottom-bar-item.active`
 * then overrode the colour back to ink, and the word "Sell" sat on its own
 * background, 1:1, only in that one state. Every other tab's active state
 * was, and still is, ink on paper and fine. A test that checked the bar on a
 * single screen (as `every bottom-bar item is at least 48px tall` above
 * does, and as every screen spec that clicks a tab does) cannot see that:
 * it has to actually make each tab the active one in turn and check the
 * whole row each time, Sell's own label included.
 */
test("every bottom-bar label is readable, on every tab, including Sell's own", async ({
  page,
}) => {
  await signIn(page, OWNER_PHONE);

  const testIds = ["tab-today", "tab-sell", "tab-batches", "tab-orders", "tab-more"];

  for (const activeTestId of testIds) {
    await page.getByTestId(activeTestId).click();
    await expect(page.getByTestId(activeTestId)).toHaveAttribute("aria-current", "page");

    for (const testId of testIds) {
      const label = page.getByTestId(testId).locator("span");
      await expectReadable(label, `${testId} label while ${activeTestId} is active`);
    }
  }
});
