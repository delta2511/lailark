import { test, expect } from "@playwright/test";

// The four hero product pages, M3.3. `/api/counts` is stubbed per test the
// same way home.spec.js does it: the endpoint itself is exercised against
// the emulator separately (functions/test/counts.test.ts).

const HEROES = [
  ["prawns-and-dates", "Prawns and dates"],
  ["squid-and-dates", "Squid and dates"],
  ["beef-and-dates", "Beef and dates"],
  ["koorka", "Koorka"],
];

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

async function withForeignRequestGuard(page, baseURL, run) {
  const foreignRequests = [];
  const localOrigin = new URL(baseURL).origin;
  page.on("request", (req) => {
    const origin = new URL(req.url()).origin;
    if (origin !== localOrigin) foreignRequests.push(req.url());
  });
  await run();
  expect(foreignRequests).toEqual([]);
}

test.describe("the four hero product pages render, with no console error", () => {
  for (const [slug, name] of HEROES) {
    test(`/pickles/${slug} renders ${name} with the Legal Metrology block`, async ({
      page,
      baseURL,
    }) => {
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(String(err)));

      await page.route("**/api/counts", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ products: {}, shipping: { rule: "free", flatFeePaise: 0 } }),
        })
      );

      await withForeignRequestGuard(page, baseURL, async () => {
        const response = await page.goto(`/pickles/${slug}`);
        expect(response.status()).toBe(200);
      });

      await expect(page.locator("h1")).toHaveText(name);

      // Legal Metrology, brief 20.3: every field, generated, not typed by
      // hand into the page for this one product.
      const bodyText = squash(await page.locator("body").innerText());
      expect(bodyText).toContain("200 g");
      expect(bodyText).toContain("Product of India");
      expect(bodyText).toContain("₹649 (incl. of all taxes)");
      expect(bodyText).toContain("₹3.25/g");
      expect(bodyText).toContain(
        "Lailark Kitchen. Neduvanchalil Veedu, Kunnamangalam, Kozhikode, Kerala, India, PIN 673571."
      );
      expect(bodyText).toContain("FSSAI 21323244000035");
      await expect(page.locator('a[href="tel:+918891923827"]').first()).toHaveCount(1);

      await page.waitForTimeout(300);
      expect(consoleErrors).toEqual([]);
    });
  }
});

test("a slug with no batch at all reads as not in the kitchen, never a number", async ({ page }) => {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: { "prawns-and-dates": { mode: "none" } },
        shipping: { rule: "free", flatFeePaise: 0 },
      }),
    })
  );
  await page.goto("/pickles/prawns-and-dates");

  await expect(page.locator(".product-live")).toHaveText("Not in the kitchen just now.");
  await expect(page.locator(".product-buy")).toHaveCount(0);
  await expect(page.locator(".ds-jarmarks")).toHaveCount(0);
});

test("/api/counts down: the page degrades to words, never a number and never a Buy button", async ({
  page,
}) => {
  await page.route("**/api/counts", (route) => route.fulfill({ status: 500, body: "" }));
  await page.goto("/pickles/prawns-and-dates");

  await expect(page.locator(".product-live")).toHaveText("We cannot show the count just now.");
  await expect(page.locator(".product-buy")).toHaveCount(0);
  await expect(page.locator(".ds-jarmarks")).toHaveCount(0);

  // A date must never borrow the count's sentence: both facts are printed on
  // the jar, so that is what an unreadable batch says.
  await expect(
    page.locator(".product-legal__row", { hasText: "Date of packing" }).locator("dd")
  ).toHaveText("Printed on the jar.");
  await expect(
    page.locator(".product-legal__row", { hasText: "Best before" }).locator("dd")
  ).toHaveText("Six months from packing, printed on the jar.");
  const legalBlock = await page.locator(".product-legal").innerText();
  expect(legalBlock).not.toContain("count");

  const mainText = squash(await page.locator("main").innerText());
  expect(mainText).not.toMatch(/\d+\s*jars?\b/i);
});

test("an in-stock batch past its sale stop hides Buy and still shows the count", async ({ page }) => {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: {
          "prawns-and-dates": {
            mode: "inStock",
            count: 4,
            total: 22,
            priceInStockPaise: 64_900,
            packedOn: "2020-01-01",
            bestBefore: "2020-07-01",
            // Long past: the Buy button must not render.
            saleStopOn: "2020-05-01",
          },
        },
        shipping: { rule: "free", flatFeePaise: 0 },
      }),
    })
  );
  await page.goto("/pickles/prawns-and-dates");

  await expect(page.locator(".ds-jarmarks")).toHaveAttribute("aria-label", "4 jars left of 22");
  await expect(page.locator(".product-buy")).toHaveCount(0);
  await expect(page.locator(".product-live__note")).toContainText("no longer sold online");
});

test("an in-stock batch still selling shows the count, price and a Buy button", async ({ page }) => {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: {
          "prawns-and-dates": {
            mode: "inStock",
            count: 4,
            total: 22,
            priceInStockPaise: 64_900,
            packedOn: "2026-09-04",
            bestBefore: "2027-03-04",
            saleStopOn: "2099-01-01",
          },
        },
        shipping: { rule: "free", flatFeePaise: 0 },
      }),
    })
  );
  await page.goto("/pickles/prawns-and-dates");

  await expect(page.locator(".ds-jarmarks")).toHaveAttribute("aria-label", "4 jars left of 22");
  await expect(page.locator(".product-buy")).toHaveText("Buy");
  await expect(page.locator(".product-live__reading")).toContainText("₹649");
  await expect(
    page.locator(".product-legal__row", { hasText: "Date of packing" }).locator("dd")
  ).toHaveText("4 Sep 2026");
  await expect(
    page.locator(".product-legal__row", { hasText: "Best before" }).locator("dd")
  ).toHaveText("4 Mar 2027");
});

test("an open batch shows jars paid, the open price and its own Buy control", async ({ page }) => {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: {
          "squid-and-dates": { mode: "open", count: 5, total: 13, priceOpenPaise: 59_900 },
        },
        shipping: { rule: "free", flatFeePaise: 0 },
      }),
    })
  );
  await page.goto("/pickles/squid-and-dates");

  await expect(page.locator(".ds-jarmarks")).toHaveAttribute("aria-label", "5 jars paid of 13");
  await expect(page.locator(".product-buy")).toContainText("₹599");
  await expect(
    page.locator(".product-legal__row", { hasText: "Packed on" }).locator("dd")
  ).toContainText("Printed on the jar when bottled");
});

test("the shipping switch reads as flatFee shows the fee, not an invented charge", async ({ page }) => {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: {},
        shipping: { rule: "flatFee", flatFeePaise: 6_000 },
      }),
    })
  );
  await page.goto("/pickles/prawns-and-dates");

  await expect(page.locator(".product-shipping")).toHaveText("Shipping ₹60.");
});

// M3.8: booking closes when cooking starts (brief §7.5), and the share link
// travels from the product page into the checkout (brief §7.2 step 4).

async function stubCounts(page, entry) {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: { "prawns-and-dates": entry },
        shipping: { rule: "free", flatFeePaise: 0, freeFromJars: 2 },
      }),
    })
  );
}

test("a batch that is cooking draws its marks and offers no Buy (brief §7.5)", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await stubCounts(page, { mode: "cooking", count: 14, total: 19, available: 0 });
  await page.goto("/pickles/prawns-and-dates");

  await expect(page.locator(".product-live .ds-jarmarks")).toHaveAttribute(
    "aria-label",
    "14 jars paid of 19",
  );
  await expect(page.locator(".product-live__note")).toHaveText(
    "Being cooked now. Unpaid jars go on sale when bottled.",
  );
  // Nothing may be bought out of a batch on the stove.
  await expect(page.locator(".product-buy")).toHaveCount(0);

  // The notify-me the same sentence of the brief asks for, in D64's words.
  await expect(page.locator(".product-notify__label")).toHaveText(
    "Tell me when these jars go on sale",
  );
  await expect(page.locator(".product-notify__row button")).toHaveText("Tell me");

  // No countdown, no scarcity, no date (CLAUDE.md §3).
  const text = await page.locator(".product-live").innerText();
  expect(text).not.toMatch(/left|hurry|only|last chance|\bsoon\b/i);
  expect(text).not.toContain("\u2014");

  await page.waitForTimeout(200);
  expect(consoleErrors).toEqual([]);
});

test("the notify-me takes a number and says so, and sends it nowhere else", async ({
  page,
  baseURL,
}) => {
  const foreign = [];
  const localOrigin = new URL(baseURL).origin;
  page.on("request", (req) => {
    if (new URL(req.url()).origin !== localOrigin) foreign.push(req.url());
  });

  await stubCounts(page, { mode: "cooking", count: 14, total: 19, available: 0 });

  let sent = null;
  await page.route("**/api/notify", (route) => {
    sent = JSON.parse(route.request().postData() ?? "null");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/pickles/prawns-and-dates");
  await page.locator("#notify-contact-prawns-and-dates").fill("7736110087");
  await page.locator(".product-notify__row button").click();

  await expect(page.locator(".product-notify__done")).toHaveText(
    "We have your number. We will tell you when this batch is bottled.",
  );
  // The box is gone once it is answered: nothing to tap twice.
  await expect(page.locator(".product-notify__row")).toHaveCount(0);
  expect(sent).toEqual({
    contact: "7736110087",
    source: "cooking",
    productSlug: "prawns-and-dates",
  });
  expect(foreign).toEqual([]);
});

test("the notify-me says what is wrong with a number and keeps the box", async ({ page }) => {
  await stubCounts(page, { mode: "cooking", count: 14, total: 19, available: 0 });
  await page.route("**/api/notify", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "That does not look like a 10 digit Indian mobile number. Please check it.",
      }),
    }),
  );

  await page.goto("/pickles/prawns-and-dates");
  await page.locator("#notify-contact-prawns-and-dates").fill("12345");
  await page.locator(".product-notify__row button").click();

  await expect(page.locator(".product-notify__problem")).toHaveText(
    "That does not look like a 10 digit Indian mobile number. Please check it.",
  );
  // Still there to correct, and nothing claims we have their number.
  await expect(page.locator(".product-notify__row button")).toBeEnabled();
  await expect(page.locator(".product-notify__done")).toHaveCount(0);
});

test("the share code on the link is carried into the checkout", async ({ page }) => {
  await stubCounts(page, {
    mode: "open",
    count: 2,
    total: 18,
    available: 16,
    priceOpenPaise: 59_900,
    perPersonLimit: 4,
    shippingRule: null,
  });

  await page.goto("/pickles/prawns-and-dates?s=k3n9x2p1a7");
  await expect(page.locator(".product-buy")).toHaveAttribute(
    "href",
    "/checkout?p=prawns-and-dates&q=1&s=k3n9x2p1a7",
  );

  // A code that is not one is dropped rather than passed on.
  await page.goto("/pickles/prawns-and-dates?s=%3Cscript%3E");
  await expect(page.locator(".product-buy")).toHaveAttribute(
    "href",
    "/checkout?p=prawns-and-dates&q=1",
  );
});
