import { test, expect } from "@playwright/test";
import { POLICY_PAGES, policyPage, policyPageText } from "@lailark/shared";

// The five policy pages (M5.7, D66): `/orders`, `/shipping`, `/terms`,
// `/privacy`, `/contact`.
//
// ST1 applies as it does everywhere else on this site: no console error, and
// no request to any origin but the site's own. These pages are static text and
// call nothing at all, not even `/api/counts`, so the foreign-origin list is
// checked empty rather than allowing Razorpay.

function watchForeign(page, baseURL) {
  const foreign = [];
  const localOrigin = new URL(baseURL).origin;
  page.on("request", (req) => {
    if (new URL(req.url()).origin !== localOrigin) foreign.push(req.url());
  });
  return foreign;
}

function watchConsole(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

for (const policy of POLICY_PAGES) {
  test(`${policy.path} renders its text, with no console error and no foreign request`, async ({
    page,
    baseURL,
  }) => {
    const errors = watchConsole(page);
    const foreign = watchForeign(page, baseURL);

    const response = await page.goto(policy.path);
    expect(response.status()).toBe(200);

    await expect(page.locator("h1")).toHaveText(policy.heading);
    await expect(page).toHaveTitle(policy.title);

    // Every line of the page's own text is on the page. `policyPageText` is
    // also what goes into `policyVersions`, so this is the one assertion that
    // ties the stored version to what a customer actually sees.
    const body = await page.locator("body").innerText();
    for (const line of policyPageText(policy).split("\n")) {
      expect(body.replace(/\s+/g, " ")).toContain(line.replace(/\s+/g, " "));
    }

    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });
}

test("no policy page carries an em dash", async ({ page }) => {
  // CLAUDE.md section 3, absolute, and easiest of all to break in legal
  // prose. Asserted against the rendered HTML as well as the source, because
  // a dash could arrive through the renderer rather than the copy.
  for (const policy of POLICY_PAGES) {
    await page.goto(policy.path);
    const html = await page.content();
    expect(html.includes("—"), `${policy.path} has an em dash`).toBe(false);
    expect(html.includes("–"), `${policy.path} has an en dash`).toBe(false);
  }
});

test("every footer link resolves to a real page", async ({ page }) => {
  // A policy page cannot be linked before it exists. The footer is on every
  // page, so this also proves the home page's copy of it.
  await page.goto("/");
  const footer = page.locator("footer.ds-footer");
  const hrefs = await footer.locator("a").evaluateAll((links) =>
    links.map((a) => a.getAttribute("href")),
  );

  for (const policy of POLICY_PAGES) {
    expect(hrefs).toContain(policy.path);
  }

  for (const href of hrefs) {
    if (href.startsWith("tel:") || href.startsWith("mailto:")) continue;
    const response = await page.goto(href);
    expect(response.status(), `${href} did not resolve`).toBe(200);
  }
});

test("the footer is on the policy pages too, so a customer can reach the other four", async ({
  page,
}) => {
  await page.goto("/privacy");
  const links = page.locator("footer.ds-footer a");
  for (const policy of POLICY_PAGES) {
    await expect(links.filter({ hasText: policy.footerLabel }).first()).toHaveAttribute(
      "href",
      policy.path,
    );
  }
});

test("the phone number and the email are tappable, and the terms link the Orders page", async ({
  page,
}) => {
  await page.goto("/contact");
  await expect(page.locator('main a[href="tel:+918891923827"]').first()).toBeVisible();
  await expect(
    page.locator('main a[href="mailto:founder.lailark@gmail.com"]').first(),
  ).toBeVisible();

  await page.goto("/terms");
  await expect(page.locator('main a[href="/orders"]').first()).toBeVisible();
});

test("the Orders page says brief 10.4's paragraph and the no-fee line", async ({ page }) => {
  await page.goto("/orders");
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  expect(body).toContain(
    "Each jar is cooked for the person who ordered it, so we don't usually take " +
      "cancellations or returns.",
  );
  expect(body).toContain("We never charge a fee for cancelling.");
  expect(body).toContain("+91 88919 23827");
});

test("the contact page names the grievance officer and the two commitments", async ({ page }) => {
  await page.goto("/contact");
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  expect(body).toContain("Shefin Muhamed, co-founder");
  expect(body).toContain("within 48 hours");
  expect(body).toContain("within a month");
  expect(body).toContain("FSSAI 21323244000035");
});

test("the privacy page answers what, why, how long, where and how to ask", async ({ page }) => {
  await page.goto("/privacy");
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  expect(body).toContain("WhatsApp number");
  expect(body).toContain("Mumbai region");
  expect(body).toContain("books of account");
  expect(body).toContain("founder.lailark@gmail.com");
  // Section 20.5 and 20.6: the marketing consent is separate from the
  // transactional one, and never required to buy.
  expect(body).toContain("never make buying depend on it");
  expect(body).toContain("when a new batch opens");
  // And no fixed retention period is named (D66).
  expect(body).not.toMatch(/\b\d+\s+(months|years)\b/);
});

test("the terms name the current proprietorship and nothing about a future one", async ({
  page,
}) => {
  await page.goto("/terms");
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  expect(body).toContain("Lailark Kitchen is the trading name of Shefin Muhamed");
  expect(body).toContain("Neduvanchalil Veedu, Kunnamangalam, Kozhikode, Kerala, India, PIN 673571");
  // D66: no mention of the December entity change, and no GSTIN.
  expect(body).not.toMatch(/December|private limited|GSTIN/i);
  // Terms text is checked whole against the page above; this is the one line
  // the versioning makes true.
  expect(body).toContain("your order records the one that was live");
  expect(policyPage("terms").path).toBe("/terms");
});

test("no policy page shows a price or a dark pattern", async ({ page }) => {
  for (const policy of POLICY_PAGES) {
    await page.goto(policy.path);
    const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    expect(body).not.toMatch(/₹/);
    expect(body).not.toMatch(/hurry|only \d+ left|limited time|don't miss/i);
  }
});
