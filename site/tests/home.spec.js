import { test, expect } from "@playwright/test";

// The home page, M3.2. The v0 holding page and its copy are gone; this
// spec covers the page the story doc section 5 orders.

const LEDE = "Sumayya cooks them in small batches at our home in Kozhikode.";
const LEFTOVERS = "There is no stock here, only leftovers.";
const ABROAD =
  "We ship all over India. Not outside it yet. If you are abroad, message us and we will find a way to get one to you.";
const ABROAD_HREF =
  "https://wa.me/918891923827?text=I%20am%20abroad%2C%20can%20I%20get%20a%20jar%3F";
const HEROES = [
  ["Prawns and dates", "/pickles/prawns-and-dates"],
  ["Squid and dates", "/pickles/squid-and-dates"],
  ["Beef and dates", "/pickles/beef-and-dates"],
  ["Koorka", "/pickles/koorka"],
];

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

test("home renders the M3.2 page and makes no request off the site", async ({
  page,
  baseURL,
}) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // ST1: no external request other than Razorpay on the checkout step, and
  // there is no checkout on this page. The v0 Firestore fetch for
  // `config/site.notifyCtaVisible` (A7) is gone with the v0 page, so the
  // allowance it needed is gone too: nothing foreign at all.
  const foreignRequests = [];
  const localOrigin = new URL(baseURL).origin;
  page.on("request", (req) => {
    const origin = new URL(req.url()).origin;
    if (origin !== localOrigin) foreignRequests.push(req.url());
  });

  // /api/counts is M3.3's function. It is stubbed here so this spec reads
  // the page as it behaves once the endpoint exists: the two specs below
  // cover the missing and present cases on purpose. Without the stub the
  // browser logs the endpoint's own 404 as a console error, which is the
  // one console line the deployed site carries until M3.3 lands.
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ products: {} }),
    })
  );

  const response = await page.goto("/");
  expect(response.status()).toBe(200);

  const bodyText = squash(await page.locator("body").innerText());

  // The hero, and the sentence that makes the two-mode shop make sense.
  expect(bodyText).toContain(LEDE);
  expect(bodyText).toContain(LEFTOVERS);

  // The order the story doc section 5 fixes, top to bottom.
  const headings = await page.locator("main h1, main h2").allInnerTexts();
  expect(headings.map(squash)).toEqual([
    "Oil pickles from a house in Kunnamangalam",
    "What is in the kitchen today",
    // Shefin, 3 Oct 2026: the open-batch explainer moved up to sit directly
    // under the cards it explains, and "The note in the box" is gone.
    "An open batch",
    "Two houses",
    "The method",
    "How a batch works",
    "In stock",
    "The batch record",
    "The name",
  ]);

  // Exactly one dark band (story doc section 5).
  await expect(page.locator(".home-band")).toHaveCount(1);

  // The four jars, each linking at its product page.
  const jars = page.locator(".home-jar");
  await expect(jars).toHaveCount(4);
  for (const [name, href] of HEROES) {
    const link = page.locator(`.home-jar__name a:text-is("${name}")`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", href);
  }

  // The batch record link, and the abroad line with its wa.me href.
  await expect(page.locator('main a[href="/batch/001"]')).toHaveCount(1);
  expect(bodyText).toContain(ABROAD);
  await expect(page.locator(".home-abroad a")).toHaveAttribute(
    "href",
    ABROAD_HREF
  );

  // The video hero, with the mechanics the video doc requires.
  const video = page.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("autoplay", "");
  await expect(video).toHaveAttribute("muted", "");
  await expect(video).toHaveAttribute("loop", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(video).toHaveAttribute("poster", "/assets/jars-loop.jpg");

  // The footer's legal line survives from the design system.
  expect(bodyText).toContain("FSSAI 21323244000035");

  // Let the /api/counts fetch land (it 404s until M3.3) before asserting.
  await page.waitForTimeout(500);

  expect(consoleErrors).toEqual([]);
  expect(foreignRequests).toEqual([]);
});

test("no jar count is ever typed, and a missing /api/counts degrades in words", async ({
  page,
}) => {
  // CLAUDE.md section 3: every count on the site is computed, never typed.
  // With the endpoint absent the page must say so rather than print a
  // number, a zero, or nothing at all.
  await page.route("**/api/counts", (route) => route.fulfill({ status: 500, body: "" }));
  await page.goto("/");

  const slots = page.locator(".home-count");
  await expect(slots).toHaveCount(4);
  for (let i = 0; i < 4; i += 1) {
    await expect(slots.nth(i)).toHaveText("We cannot show the count just now.");
  }

  // Nothing anywhere in main reads as a jar count: no bare integer beside
  // the word "jars", and no marks drawn.
  await expect(page.locator(".ds-jarmarks")).toHaveCount(0);
  const mainText = squash(await page.locator("main").innerText());
  expect(mainText).not.toMatch(/\d+\s*jars?\b/i);
});

test("a payload that coerces to zero degrades in words, and sold out still draws", async ({
  page,
}) => {
  // Number(null), Number(false), Number([]) and Number("") are all 0, and 0
  // is a valid integer, so a payload validated after coercion renders a
  // confident "0 jars left of 8" for data that carries no count at all.
  // Every one of these has to become words instead. Sold out is the case
  // that must still draw: a real count of 0 out of a real total.
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: {
          "prawns-and-dates": { mode: "inStock", count: null, total: 8 },
          "squid-and-dates": { mode: "inStock", count: "", total: 8 },
          "beef-and-dates": { mode: "open", count: 4, total: 0 },
          koorka: { mode: "inStock", count: 0, total: 22 },
        },
      }),
    })
  );
  await page.goto("/");

  for (const name of ["Prawns and dates", "Squid and dates", "Beef and dates"]) {
    const card = page.locator(".home-jar", { hasText: name });
    await expect(card.locator(".home-count")).toHaveText(
      "We cannot show the count just now."
    );
    await expect(card.locator(".ds-jarmarks")).toHaveCount(0);
  }

  // A sold-out batch is a real count and still draws its marks.
  const soldOut = page.locator(".home-jar", { hasText: "Koorka" });
  await expect(soldOut.locator(".ds-jarmarks")).toHaveAttribute(
    "aria-label",
    "0 jars left of 22"
  );

  // Nothing fabricated a zero anywhere on the page.
  const mainText = squash(await page.locator("main").innerText());
  expect(mainText).not.toMatch(/\b0\s*jars?\b/i);
});

test("counts arrive as marks, not as a number", async ({ page }) => {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: {
          "prawns-and-dates": { mode: "inStock", count: 3, total: 8 },
          "squid-and-dates": { mode: "open", count: 5, total: 13 },
          "beef-and-dates": { mode: "none" },
        },
      }),
    })
  );
  await page.goto("/");

  const inStock = page.locator(".home-jar", { hasText: "Prawns and dates" });
  await expect(inStock.locator(".ds-jarmarks")).toHaveAttribute(
    "aria-label",
    "3 jars left of 8"
  );
  await expect(inStock.locator(".ds-jarmark")).toHaveCount(8);
  await expect(inStock.locator(".home-count__reading")).toContainText(
    "jars left in this batch ₹649"
  );

  const open = page.locator(".home-jar", { hasText: "Squid and dates" });
  await expect(open.locator(".ds-jarmarks")).toHaveAttribute(
    "aria-label",
    "5 jars paid of 13"
  );
  await expect(open.locator(".home-count__reading")).toContainText(
    "jars paid into this batch ₹599"
  );

  // A product with no batch says so; one missing from the payload falls to
  // the unavailable reading, never to a zero.
  await expect(
    page.locator(".home-jar", { hasText: "Beef and dates" }).locator(".home-count")
  ).toHaveText("Not in the kitchen just now.");
  await expect(
    page.locator(".home-jar", { hasText: "Koorka" }).locator(".home-count")
  ).toHaveText("We cannot show the count just now.");

  // The visible reading still carries no digits: the marks are the count.
  const readings = await page.locator(".home-count__reading").allInnerTexts();
  for (const reading of readings) {
    expect(squash(reading).replace(/₹\d+/g, "")).not.toMatch(/\d/);
  }
});

/* -------------------------------------------------------------------------- */
/* Shefin, 3 Oct 2026: the state pills, the whole-card tap, the logo link     */
/* -------------------------------------------------------------------------- */

test("each card wears the state it is actually in, and nothing types one", async ({
  page,
}) => {
  // Every pill is derived from the payload (CLAUDE.md section 3), so the
  // four cards here are four different states from one stubbed response.
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: {
          "prawns-and-dates": { mode: "inStock", count: 3, total: 8, available: 3 },
          "squid-and-dates": { mode: "open", count: 5, total: 13, available: 8 },
          "beef-and-dates": { mode: "cooking", count: 9, total: 13, available: 0 },
          koorka: { mode: "inStock", count: 0, total: 22, available: 0 },
        },
      }),
    })
  );
  await page.goto("/");

  const pill = (name) =>
    page.locator(".home-jar", { hasText: name }).locator(".home-jar__state");

  await expect(pill("Prawns and dates")).toHaveText("In stock");
  await expect(pill("Squid and dates")).toHaveText("Not cooked yet");
  await expect(pill("Beef and dates")).toHaveText("Cooking now");
  // Bottled, and every jar gone.
  await expect(pill("Koorka")).toHaveText("Sold out");

  // The open batch carries its one line of mechanism on the card itself.
  await expect(
    page.locator(".home-jar", { hasText: "Squid and dates" }).locator(".home-count__open")
  ).toHaveText("Pay now, your jar is kept for you. No date.");
  // And nowhere else: an in-stock jar exists, so the line would be a lie.
  await expect(page.locator(".home-count__open")).toHaveCount(1);
});

test("a batch with every jar booked reads as full, and an untrusted count wears no pill", async ({
  page,
}) => {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: {
          "prawns-and-dates": { mode: "open", count: 13, total: 13, available: 0 },
          // Not a count this page may trust, so it may not wear a state.
          "squid-and-dates": { mode: "inStock", count: null, total: 8 },
          "beef-and-dates": { mode: "none" },
        },
      }),
    })
  );
  await page.goto("/");

  await expect(
    page.locator(".home-jar", { hasText: "Prawns and dates" }).locator(".home-jar__state")
  ).toHaveText("Batch full");

  // A bad payload, a product with no batch, and a product missing from the
  // payload altogether all wear nothing rather than guessing.
  for (const name of ["Squid and dates", "Beef and dates", "Koorka"]) {
    await expect(
      page.locator(".home-jar", { hasText: name }).locator(".home-jar__state")
    ).toHaveCount(0);
  }
});

test("the whole jar card is the tap target, with one link in it", async ({ page }) => {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ products: {} }),
    })
  );
  await page.goto("/");

  const card = page.locator(".home-jar", { hasText: "Koorka" });
  // Still exactly one anchor per card: the overlay is a pseudo-element, so
  // a screen reader hears one link rather than the card twice.
  await expect(card.locator("a")).toHaveCount(1);

  // A click in the card's own padding, well away from the title, navigates.
  // Through the locator rather than raw mouse coordinates: the fourth card
  // sits below the fold, and a bare page.mouse.click never scrolls to it.
  const box = await card.boundingBox();
  await card.click({ position: { x: box.width - 12, y: box.height - 12 } });
  await expect(page).toHaveURL(/\/pickles\/koorka\/?$/);
});

test("the logo goes home from every page", async ({ page }) => {
  for (const path of ["/pickles/koorka", "/batch/001", "/shipping", "/privacy"]) {
    await page.goto(path);
    const home = page.locator(".ds-header__home");
    await expect(home).toHaveCount(1);
    await expect(home).toHaveAttribute("href", "/");
    // One accessible name, not "Lailark Lailark": the mark is decorative.
    await expect(home).toHaveText("Lailark");
  }

  // And it is a real link, not an attribute nobody can use.
  await page.goto("/shipping");
  await page.locator(".ds-header__home").click();
  await expect(page).toHaveURL(/\/$/);
});
