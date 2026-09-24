import { test, expect } from "@playwright/test";

test("the internal design-system demo renders every primitive with zero foreign requests", async ({
  page,
  baseURL,
}) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const foreignRequests = [];
  const localOrigin = new URL(baseURL).origin;
  page.on("request", (req) => {
    const origin = new URL(req.url()).origin;
    if (origin !== localOrigin) foreignRequests.push(req.url());
  });

  const response = await page.goto("/internal/design-system");
  expect(response.status()).toBe(200);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).toContain("Ink");
  expect(bodyText).toContain("Paper");
  expect(bodyText).toContain("Rust");
  expect(bodyText).toContain("Leaf");
  expect(bodyText).toContain("Grey");
  expect(bodyText).toContain("Hairline");
  expect(bodyText).toContain("Sample heading, editorial serif");

  // The jar-count marks: a screen reader gets the number and its
  // meaning, not a row of meaningless glyphs.
  await expect(
    page.getByRole("img", { name: "0 jars left", exact: true })
  ).toBeVisible();
  // One jar reads as one jar, not "1 jars".
  await expect(
    page.getByRole("img", { name: "1 jar left of 40", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "12 jars left of 40", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "27 jars paid of 30", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "40 jars left of 40", exact: true })
  ).toBeVisible();

  await expect(page.locator("a[href='/orders']")).toHaveCount(1);

  // Give any deferred work a moment to settle before asserting the
  // request and console-error lists.
  await page.waitForTimeout(500);

  expect(consoleErrors).toEqual([]);
  expect(foreignRequests).toEqual([]);
});

test("the demo route is marked noindex and kept out of robots.txt", async ({
  page,
  request,
}) => {
  const response = await page.goto("/internal/design-system");
  const robotsMeta = page.locator("meta[name='robots']");
  await expect(robotsMeta).toHaveAttribute("content", /noindex/);
  expect(response.status()).toBe(200);

  const robotsTxt = await request.get("/robots.txt");
  const body = await robotsTxt.text();
  expect(body).toContain("Disallow: /internal/");
});
