import { test, expect } from "@playwright/test";

// `/o/<token>`, the private order page (brief §5, M3.8).
//
// **`/api/order/<token>` is stubbed here, so nothing in this file is
// coverage of the endpoint.** The static export has no server behind it, and
// a stub written by hand can only ever agree with itself: round 2 added
// `expect(body).not.toContain("prawns-and-dates")` to a stub that never
// contained the slug, which passed happily while the real endpoint was
// handing customers a URL. That assertion is gone. What this file checks is
// the page: how it draws a payload, and what it does when there is none.
//
// The endpoint is exercised for real against the emulator, in
// `functions/test/open-batch.test.ts`: "the private order link answers with
// the order and its documents" and the "a product the page cannot name"
// group, which drives a real web checkout and a real counter sale and then
// renames, blanks and deletes the product underneath them (A214).
//
// ST1 applies as it does everywhere else on this site: no request to any
// origin but the site's own, and not even Razorpay here. The stub carries
// the endpoint's field names and nothing more: it used to carry `state`,
// `channel`, `paymentStatus` and `paymentMethod`, which the endpoint no
// longer sends (D63, M3.8 round 2).

const TOKEN = "0123456789abcdef0123456789abcdef";

const ORDER = {
  order: {
    number: "o-7f3a2c",
    placedOnMillis: Date.UTC(2026, 8, 4, 6, 0),
    lines: [
      {
        description: "Prawns and dates",
        qty: 2,
        unitPricePaise: 59_900,
        batchNo: "003",
        jarNumbers: [9, 10],
      },
    ],
    shippingFeePaise: 0,
    totalPaise: 119_800,
    delivery: {
      name: "Asha",
      lines: ["12 Mill Road"],
      city: "Kozhikode",
      state: "KL",
      pincode: "673571",
    },
  },
  documents: [
    {
      kind: "receipt",
      number: "LK/26-27/0004",
      issuedOn: "2026-09-04",
      totalPaise: 119_800,
      url: null,
    },
  ],
};

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

test("shows the order and its documents, with no console error", async ({ page, baseURL }) => {
  const errors = watchConsole(page);
  const foreign = watchForeign(page, baseURL);

  let asked = null;
  await page.route("**/api/order/*", (route) => {
    asked = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ORDER),
    });
  });

  const response = await page.goto(`/o/${TOKEN}`);
  expect(response.status()).toBe(200);

  // The token travels in the path, exactly as brief §5 spells the link.
  await expect(page.locator(".order-facts")).toContainText("o-7f3a2c");
  expect(asked).toBe(`/api/order/${TOKEN}`);

  await expect(page.locator(".order-lines")).toContainText("Prawns and dates");
  await expect(page.locator(".order-lines")).toContainText("2 jars");
  await expect(page.locator(".order-lines a")).toHaveAttribute("href", "/batch/003");
  await expect(page.locator(".order-total")).toContainText("₹1,198");
  await expect(page.locator(".order-jars")).toContainText("9, 10");
  await expect(page.locator(".order-address")).toContainText("673571");
  await expect(page.locator(".order-documents")).toContainText("LK/26-27/0004");
  await expect(page.locator(".order-documents")).toContainText("Receipt");

  // No em dash anywhere a customer reads (CLAUDE.md §3).
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("\u2014");
  // The page draws none of the endpoint's internal vocabulary. (Whether the
  // endpoint sends a slug is not knowable from a stub: that is checked where
  // the endpoint runs, in `functions/test/open-batch.test.ts`.)
  expect(body).not.toContain("paidWaiting");
  expect(body).not.toContain("captured");

  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

test("says so plainly when the link matches no order", async ({ page }) => {
  const errors = watchConsole(page);
  await page.route("**/api/order/*", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not found" }),
    }),
  );

  await page.goto(`/o/${TOKEN}`);
  await expect(page.locator(".order-note")).toBeVisible();
  // Nothing about anybody's order leaks onto a page that found none.
  await expect(page.locator(".order-lines")).toHaveCount(0);
  await expect(page.locator(".order-address")).toHaveCount(0);
  await page.waitForTimeout(200);
  // The browser's own "404 (Not Found)" note for the fetch is not a fault in
  // the page: the 404 is the answer, and the page handled it. Anything else
  // in the console is.
  expect(errors.filter((line) => !line.includes("404 (Not Found)"))).toEqual([]);
});

test("a token that is not a token asks for nothing at all", async ({ page }) => {
  let asked = 0;
  await page.route("**/api/order/*", (route) => {
    asked += 1;
    return route.fulfill({ status: 404, body: "{}" });
  });

  await page.goto("/o/not-a-token");
  await expect(page.locator(".order-note")).toBeVisible();
  expect(asked).toBe(0);
});

test("the page itself carries nothing private and is noindexed", async ({ page }) => {
  // No stub: the static file is what is being read, before any fetch lands.
  await page.route("**/api/order/*", (route) => route.abort());
  const response = await page.goto(`/o/${TOKEN}`);
  const html = await response.text();
  expect(html).not.toContain(TOKEN);
  expect(html).toContain("noindex");
});

test("a document whose kind we have no word for prints no internal id", async ({ page }) => {
  await page.route("**/api/order/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...ORDER,
        documents: [
          {
            kind: "somethingNew",
            number: "LK/26-27/0009",
            issuedOn: "2026-09-04",
            totalPaise: 119_800,
            url: "javascript:alert(1)",
          },
        ],
      }),
    }),
  );

  await page.goto(`/o/${TOKEN}`);
  await expect(page.locator(".order-documents")).toContainText("LK/26-27/0009");
  await expect(page.locator(".order-documents")).toContainText("Document");
  await expect(page.locator(".order-documents")).not.toContainText("somethingNew");
  // A url that is not https is never drawn as a link at all.
  await expect(page.locator(".order-documents a")).toHaveCount(0);
});

test("a line we have no name for draws no description, not an empty column", async ({ page }) => {
  // A214, M3.8 round 3. The endpoint sends `""` rather than a URL slug when
  // the product has been renamed to nothing or deleted, and an older deploy
  // of it may still send a name that is nothing but spaces. Either way the
  // line keeps everything that is true about it and simply has no
  // description: no blank 10rem column where a name belongs, and no word we
  // would have had to invent (D63 approved this page's copy one by one).
  const errors = watchConsole(page);
  await page.route("**/api/order/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...ORDER,
        order: {
          ...ORDER.order,
          lines: [
            { ...ORDER.order.lines[0], description: "" },
            { ...ORDER.order.lines[0], description: "   ", batchNo: "004", jarNumbers: [11] },
          ],
        },
      }),
    }),
  );

  await page.goto(`/o/${TOKEN}`);
  await expect(page.locator(".order-lines li")).toHaveCount(2);
  // Not one description element, empty or otherwise, on either line.
  await expect(page.locator(".order-lines .order-line__what")).toHaveCount(0);
  // Everything else about the lines is still on the page.
  await expect(page.locator(".order-lines")).toContainText("2 jars");
  await expect(page.locator(".order-lines a").first()).toHaveAttribute("href", "/batch/003");
  await expect(page.locator(".order-lines")).toContainText("₹599");
  await expect(page.locator(".order-total")).toContainText("₹1,198");
  await expect(page.locator(".order-jars")).toContainText("9, 10");

  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});
