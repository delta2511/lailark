import { test, expect } from "@playwright/test";

const LEDE =
  "A small kitchen in Kunnamangalam, Kozhikode. We make oil pickles in batches of fifteen to forty jars. When a batch is gone it is gone, and the next one starts.";
const NOTE =
  "The site is still being built. This address will not change, so anything printed on a jar will keep working.";
const CTA_HREF =
  "https://wa.me/918891923827?text=Tell%20me%20when%20a%20batch%20opens";

test("home renders the v0 copy, footer and video background, staying local except Firestore", async ({
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
  const allowedForeign = "https://firestore.googleapis.com";
  page.on("request", (req) => {
    const origin = new URL(req.url()).origin;
    if (origin !== localOrigin && origin !== allowedForeign) {
      foreignRequests.push(req.url());
    }
  });

  const response = await page.goto("/");
  expect(response.status()).toBe(200);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).toContain(LEDE);
  expect(bodyText).toContain(NOTE);
  expect(bodyText).toContain("FSSAI 21323244000035");

  const cta = page.locator("a.cta");
  await expect(cta).toHaveAttribute("href", CTA_HREF);

  const video = page.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("autoplay", "");
  await expect(video).toHaveAttribute("muted", "");
  await expect(video).toHaveAttribute("loop", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(video).toHaveAttribute("poster", "/assets/jars-loop.jpg");

  // Give the fire-and-forget config fetch a moment to land (or fail) before
  // asserting the request list, and the console a moment to report errors.
  await page.waitForTimeout(500);

  expect(consoleErrors).toEqual([]);
  expect(foreignRequests).toEqual([]);
});
