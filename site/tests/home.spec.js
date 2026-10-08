import { test, expect } from "@playwright/test";

// The home page, rebuilt to the 8 Oct 2026 design (M5.12, D77 to D86).
//
// The invariants from the M3.2 spec all survive, adapted to the new page: no
// request off the site, no console error, no typed count, counts that degrade
// in words, exactly one dark band, the /batch/001 link, the abroad line with
// its wa.me href, and the FSSAI line. The video assertions are gone with the
// video (D79). What is new: the three cards and their links, the heading
// order, the mode-aware action (D84), the self-hosted fonts, and a
// reduced-motion pass.

const HERO =
  "Oil pickles from our kitchen in Kozhikode. Sumayya makes them by hand, patiently, with fish from Chaliyam and spices in the right measure. One small batch at a time.";
const ABROAD =
  "We ship all over India. Not outside it yet. If you are abroad, message us and we will find a way to get one to you.";
const ABROAD_HREF =
  "https://wa.me/918891923827?text=I%20am%20abroad%2C%20can%20I%20get%20a%20jar%3F";

// D80: squid and beef have no dates, and the slugs did not change with the
// names. D81: koorka is off the page and still in the data.
const CARDS = [
  ["Prawns and dates", "/pickles/prawns-and-dates"],
  ["Squid", "/pickles/squid-and-dates"],
  ["Beef", "/pickles/beef-and-dates"],
];

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** Stubs `/api/counts` with whatever this test needs it to answer. */
function stubCounts(page, body, status = 200) {
  return page.route("**/api/counts", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

test("the home page renders, and makes no request off the site", async ({
  page,
  baseURL,
}) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // ST1: no external request at all on this page. The four web fonts (D78)
  // are self-hosted, so they have to come from here like everything else.
  const requests = [];
  const localOrigin = new URL(baseURL).origin;
  page.on("request", (req) => requests.push(req.url()));

  await stubCounts(page, { products: {} });

  const response = await page.goto("/");
  expect(response.status()).toBe(200);

  const bodyText = squash(await page.locator("body").innerText());

  // D85: the hero paragraph is the h1, and the meta description carries it.
  await expect(page.locator("h1")).toHaveCount(1);
  expect(squash(await page.locator("h1").innerText())).toBe(HERO);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    HERO
  );

  // The section order the copy record fixes, top to bottom.
  const headings = await page.locator("main h1, main h2").allInnerTexts();
  expect(headings.map(squash)).toEqual([
    HERO,
    "പാകത്തിന് സ്നേഹം",
    "Three pickles",
    "Two houses",
    "പാകം",
    "How a jar reaches you",
    "The number on your jar",
    "A note from Sumayya",
    "The name",
  ]);

  // Exactly one dark band (D79: the hero is no longer the second one).
  await expect(page.locator(".hp-dark")).toHaveCount(1);

  // The three cards, each linking at its product page.
  await expect(page.locator(".hp-card")).toHaveCount(3);
  for (const [name, href] of CARDS) {
    const link = page.locator(`.hp-card__name a:text-is("${name}")`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", href);
  }

  // The batch record link, the abroad line, the FSSAI line.
  await expect(page.locator('a[href="/batch/001"]')).toHaveCount(1);
  expect(bodyText).toContain(ABROAD);
  await expect(page.locator(".home-abroad a")).toHaveAttribute(
    "href",
    ABROAD_HREF
  );
  expect(bodyText).toContain("FSSAI 21323244000035");

  // The video is gone, and nothing replaced it.
  await expect(page.locator("video")).toHaveCount(0);

  await page.waitForTimeout(500);

  expect(consoleErrors).toEqual([]);
  const foreign = requests.filter((url) => new URL(url).origin !== localOrigin);
  expect(foreign).toEqual([]);

  // Explicitly: every font came from this origin, and no font came from
  // anywhere else. Google Fonts is what the design reference loaded and what
  // production must never load (CLAUDE.md section 3).
  const fonts = requests.filter((url) => url.endsWith(".woff2"));
  expect(fonts.length).toBeGreaterThan(0);
  for (const url of fonts) {
    expect(url.startsWith(`${localOrigin}/assets/fonts/`)).toBe(true);
  }
});

test("no jar count is ever typed, and a missing /api/counts degrades in words", async ({
  page,
}) => {
  // CLAUDE.md section 3: every count on the site is computed, never typed.
  // With the endpoint absent the page must say so rather than print a number,
  // a zero, or nothing at all.
  await stubCounts(page, "", 500);
  await page.goto("/");

  const slots = page.locator(".home-count");
  await expect(slots).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) {
    await expect(slots.nth(i)).toHaveText("We cannot show the count just now.");
  }

  await expect(page.locator(".ds-jarmarks")).toHaveCount(0);

  // Nothing in the cards reads as a jar count: no bare integer beside the word
  // "jars", and no marks drawn. Scoped to the cards rather than the whole of
  // main, because "The number on your jar" prints batch 001's own record,
  // which is a printed-label fact ("22 jars, 200 g each.") and not a live
  // count: it is read out of content/batches/001.json, the same file
  // /batch/001 reads.
  const cardsText = squash(await page.locator(".hp-cards").innerText());
  expect(cardsText).not.toMatch(/\d+\s*jars?\b/i);
});

test("a payload that coerces to zero degrades in words, and sold out still draws", async ({
  page,
}) => {
  // Number(null), Number(false), Number([]) and Number("") are all 0, and 0 is
  // a valid integer, so a payload validated after coercion renders a confident
  // "0 jars left of 8" for data that carries no count at all. Sold out is the
  // case that must still draw: a real count of 0 out of a real total.
  await stubCounts(page, {
    products: {
      "prawns-and-dates": { mode: "inStock", count: null, total: 8 },
      "squid-and-dates": { mode: "inStock", count: "", total: 8 },
      "beef-and-dates": { mode: "inStock", count: 0, total: 22 },
    },
  });
  await page.goto("/");

  for (const name of ["Prawns and dates", "Squid"]) {
    const card = page.locator(".hp-card", { hasText: name });
    await expect(card.locator(".home-count")).toHaveText(
      "We cannot show the count just now."
    );
    await expect(card.locator(".ds-jarmarks")).toHaveCount(0);
  }

  const soldOut = page.locator(".hp-card", { hasText: "Beef" });
  await expect(soldOut.locator(".ds-jarmarks")).toHaveAttribute(
    "aria-label",
    "0 jars left of 22"
  );

  // Nothing fabricated a zero on a card.
  const cardsText = squash(await page.locator(".hp-cards").innerText());
  expect(cardsText).not.toMatch(/\b0\s*jars?\b/i);
});

test("counts arrive as marks, not as a number", async ({ page }) => {
  await stubCounts(page, {
    products: {
      "prawns-and-dates": { mode: "inStock", count: 3, total: 8 },
      "squid-and-dates": { mode: "open", count: 5, total: 13 },
      "beef-and-dates": { mode: "none" },
    },
  });
  await page.goto("/");

  const inStock = page.locator(".hp-card", { hasText: "Prawns and dates" });
  await expect(inStock.locator(".ds-jarmarks")).toHaveAttribute(
    "aria-label",
    "3 jars left of 8"
  );
  await expect(inStock.locator(".ds-jarmark")).toHaveCount(8);
  await expect(inStock.locator(".home-count__reading")).toContainText(
    "jars left in this batch ₹649"
  );

  const open = page.locator(".hp-card", { hasText: "Squid" });
  await expect(open.locator(".ds-jarmarks")).toHaveAttribute(
    "aria-label",
    "5 jars paid of 13"
  );
  await expect(open.locator(".home-count__reading")).toContainText(
    "jars paid into this batch ₹599"
  );

  // A product with no batch says so, never a zero.
  await expect(
    page.locator(".hp-card", { hasText: "Beef" }).locator(".home-count")
  ).toHaveText("Not in the kitchen just now.");

  // The visible reading still carries no digits: the marks are the count.
  const readings = await page.locator(".home-count__reading").allInnerTexts();
  for (const reading of readings) {
    expect(squash(reading).replace(/₹\d+/g, "")).not.toMatch(/\d/);
  }
});

test("each card wears the state it is actually in, and nothing types one", async ({
  page,
}) => {
  // D75 and D83: the pills stay, and every one of them is derived from the
  // payload (CLAUDE.md section 3).
  await stubCounts(page, {
    products: {
      "prawns-and-dates": { mode: "inStock", count: 3, total: 8, available: 3 },
      "squid-and-dates": { mode: "open", count: 5, total: 13, available: 8 },
      "beef-and-dates": { mode: "cooking", count: 9, total: 13, available: 0 },
    },
  });
  await page.goto("/");

  const pill = (name) =>
    page.locator(".hp-card", { hasText: name }).locator(".home-jar__state");

  await expect(pill("Prawns and dates")).toHaveText("In stock");
  await expect(pill("Squid")).toHaveText("Not cooked yet");
  await expect(pill("Beef")).toHaveText("Cooking now");

  // The open batch carries its one line of mechanism on the card itself, and
  // nowhere else: an in-stock jar exists, so the line would be a lie there.
  await expect(
    page.locator(".hp-card", { hasText: "Squid" }).locator(".home-count__open")
  ).toHaveText("Pay now, your jar is kept for you. No date.");
  await expect(page.locator(".home-count__open")).toHaveCount(1);
});

test("a batch with every jar booked reads as full, and an untrusted count wears no pill", async ({
  page,
}) => {
  await stubCounts(page, {
    products: {
      "prawns-and-dates": { mode: "open", count: 13, total: 13, available: 0 },
      // Not a count this page may trust, so it may not wear a state.
      "squid-and-dates": { mode: "inStock", count: null, total: 8 },
      "beef-and-dates": { mode: "none" },
    },
  });
  await page.goto("/");

  await expect(
    page.locator(".hp-card", { hasText: "Prawns and dates" }).locator(".home-jar__state")
  ).toHaveText("Batch full");

  for (const name of ["Squid", "Beef"]) {
    await expect(
      page.locator(".hp-card", { hasText: name }).locator(".home-jar__state")
    ).toHaveCount(0);
  }
});

test("the card's action follows the mode it is in, and shows nothing it cannot be sure of", async ({
  page,
}) => {
  // D84: "Take a jar" in stock, "Book a jar" open, and nothing at all while a
  // batch is cooking, because createCheckout refuses that booking today.
  await stubCounts(page, {
    products: {
      "prawns-and-dates": {
        mode: "inStock",
        count: 3,
        total: 8,
        available: 3,
        packedOn: "2026-09-04",
      },
      "squid-and-dates": { mode: "open", count: 5, total: 13, available: 8 },
      "beef-and-dates": { mode: "cooking", count: 9, total: 13, available: 0 },
    },
  });
  await page.goto("/");

  const action = (name) =>
    page.locator(".hp-card", { hasText: name }).locator(".hp-card__action");

  await expect(action("Prawns and dates")).toHaveText("₹649Take a jar");
  await expect(
    action("Prawns and dates").locator("a")
  ).toHaveAttribute("href", "/pickles/prawns-and-dates");

  await expect(action("Squid")).toHaveText("₹599Book a jar");
  await expect(action("Squid").locator("a")).toHaveAttribute(
    "href",
    "/pickles/squid-and-dates"
  );

  // Cooking: brief section 7.5's line is what that card carries, and there is
  // no button and no price under it.
  await expect(action("Beef")).toHaveText("");
  await expect(action("Beef").locator("a")).toHaveCount(0);
  await expect(
    page.locator(".hp-card", { hasText: "Beef" }).locator(".home-count__note")
  ).toHaveText("Being cooked now. Unpaid jars go on sale when bottled.");

  // The bottled date is read off the payload, never typed, and only an
  // in-stock batch has one.
  await expect(
    page.locator(".hp-card", { hasText: "Prawns and dates" }).locator(".hp-card__meta")
  ).toHaveText("Bottled 4 Sep 2026 · 200 g");
  await expect(
    page.locator(".hp-card", { hasText: "Squid" }).locator(".hp-card__meta")
  ).toHaveText("200 g");
});

test("an unavailable count shows no price and no button", async ({ page }) => {
  // Printing an in-stock price on a card that turns out to be an open batch
  // would be a wrong price, so the slot waits rather than guessing.
  await stubCounts(page, "", 500);
  await page.goto("/");

  await expect(page.locator(".home-count").first()).toHaveText(
    "We cannot show the count just now."
  );
  await expect(page.locator(".hp-card__action a")).toHaveCount(0);
  for (const slot of await page.locator(".hp-card__action").all()) {
    expect(squash(await slot.innerText())).toBe("");
  }
  // And no rupee figure anywhere on a card.
  const cardsText = squash(await page.locator(".hp-cards").innerText());
  expect(cardsText).not.toContain("₹");
});

test("the whole jar card is the tap target, with its two links and no more", async ({
  page,
}) => {
  await stubCounts(page, {
    products: {
      "prawns-and-dates": { mode: "inStock", count: 3, total: 8, available: 3 },
    },
  });
  await page.goto("/");

  // D71: the card's own anchor is the one on the title, stretched over the
  // card by a pseudo-element, plus the one action anchor. No third link, so a
  // screen reader does not hear the card three times.
  const card = page.locator(".hp-card", { hasText: "Prawns and dates" });
  await expect(card.locator("a")).toHaveCount(2);

  // A click in the card's own padding, away from both anchors, navigates.
  const box = await card.boundingBox();
  await card.click({ position: { x: box.width - 8, y: 8 } });
  await expect(page).toHaveURL(/\/pickles\/prawns-and-dates\/?$/);
});

test("under reduced motion the page is all there and at full strength", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubCounts(page, {
    products: {
      "prawns-and-dates": { mode: "inStock", count: 3, total: 8, available: 3 },
    },
  });
  await page.goto("/");

  // Every section is visible: the scroll reveal is an enhancement, never a
  // gate, so nothing may be left at opacity 0 or pushed down the page.
  for (const section of await page.locator(".hp-rv").all()) {
    await expect(section).toBeVisible();
    const style = await section.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, transform: cs.transform, animation: cs.animationName };
    });
    expect(Number(style.opacity)).toBe(1);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(style.transform);
  }

  // "Just enough." in both places (D86), the second one at full strength
  // rather than the faint end of its animation.
  const enough = page.locator(".hp-enough");
  await expect(enough).toHaveText("Just enough.");
  expect(
    Number(await enough.evaluate((el) => getComputedStyle(el).opacity))
  ).toBe(1);
  expect(
    squash(await page.locator(".hp-pakam__lede").innerText())
  ).toContain("പാകത്തിന്. Just enough.");

  // The പാകം word rests full rather than empty: its fill sits at the brim,
  // which is the bottom of the gradient's travel.
  const word = page.locator(".hp-fillword");
  await expect(word).toHaveText("പാകം");
  const fill = await word.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { pos: cs.backgroundPosition, animation: cs.animationName };
  });
  expect(fill.animation).toBe("none");
  expect(fill.pos).toContain("100%");

  // Nothing on the page is animating at all.
  const animating = await page.evaluate(
    () => document.getAnimations().filter((a) => a.playState === "running").length
  );
  expect(animating).toBe(0);

  // And the words are still all there.
  const bodyText = squash(await page.locator("body").innerText());
  expect(bodyText).toContain(HERO);
  expect(bodyText).toContain(ABROAD);
  expect(bodyText).toContain("FSSAI 21323244000035");
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

  // The home page has its own header (D77: scoped to this page), with the
  // same shape: one anchor around the mark and the wordmark (D70).
  const brand = page.locator(".hp-brand");
  await expect(brand).toHaveCount(1);
  await expect(brand).toHaveAttribute("href", "/");
  await expect(brand).toHaveAccessibleName("Lailark Kitchen, home");
});
