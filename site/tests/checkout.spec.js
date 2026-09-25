import { test, expect } from "@playwright/test";

// The checkout page, M3.5. `/api/counts` and `/api/checkout` are both
// stubbed: the endpoints themselves are exercised against the emulator
// (functions/test/checkout.test.ts and counts.test.ts), and what is being
// checked here is the page.
//
// ST1: the customer site makes no external request other than Razorpay on
// the checkout step. So this file asserts exactly that, twice over: the only
// foreign origin the checkout page may touch is checkout.razorpay.com, and a
// product page may touch none at all.

const RAZORPAY_ORIGIN = "https://checkout.razorpay.com";

const IN_STOCK = {
  products: {
    "prawns-and-dates": {
      mode: "inStock",
      count: 4,
      total: 22,
      available: 4,
      priceInStockPaise: 64_900,
      packedOn: "2026-09-04",
      bestBefore: "2027-03-04",
      saleStopOn: "2099-01-01",
      perPersonLimit: 2,
      // A product carrying no fee rule of its own follows the global switch.
      shippingRule: null,
    },
  },
  shipping: { rule: "free", flatFeePaise: 0 },
};

/**
 * Stubs `/api/counts`, and stands in for the Razorpay script with a tiny
 * fake so the test never leaves the machine but the page still takes the
 * same code path it takes in front of a customer.
 */
async function stub(page, counts = IN_STOCK) {
  await page.route("**/api/counts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(counts),
    })
  );
  await page.route(`${RAZORPAY_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `window.Razorpay = function (options) {
        window.__razorpayOptions = options;
        return { open: () => { window.__razorpayOpened = true; options.handler({}); } };
      };`,
    })
  );
}

function watchForeign(page, baseURL, allowed = []) {
  const foreign = [];
  const localOrigin = new URL(baseURL).origin;
  page.on("request", (req) => {
    const origin = new URL(req.url()).origin;
    if (origin !== localOrigin && !allowed.includes(origin)) foreign.push(req.url());
  });
  return foreign;
}

async function fillTheForm(page) {
  await page.fill("#checkout-name", "Asha");
  await page.fill("#checkout-phone", "9446587027");
  await page.fill("#checkout-line1", "12 Mill Road");
  await page.fill("#checkout-city", "Kozhikode");
  await page.fill("#checkout-state", "KL");
  await page.fill("#checkout-pincode", "673571");
  await page.check("#checkout-updates");
}

test("the checkout page shows the jar, the price and the total, with no console error", async ({
  page,
  baseURL,
}) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await stub(page);
  const foreign = watchForeign(page, baseURL, [RAZORPAY_ORIGIN]);

  const response = await page.goto("/checkout?p=prawns-and-dates&q=1");
  expect(response.status()).toBe(200);

  await expect(page.locator(".checkout-jar h2")).toHaveText("Prawns and dates");
  await expect(page.locator(".ds-jarmarks")).toHaveAttribute("aria-label", "4 jars left of 22");
  await expect(page.locator(".checkout-total")).toContainText("₹649");
  await expect(page.locator(".checkout-total")).toContainText("Free");
  await expect(page.locator(".checkout-pay")).toHaveText("Pay ₹649");

  await page.waitForTimeout(300);
  expect(consoleErrors).toEqual([]);
  // ST1: nothing but Razorpay, and only here.
  expect(foreign).toEqual([]);
});

test("no page other than checkout asks for the Razorpay script", async ({ page, baseURL }) => {
  await stub(page);
  const foreign = watchForeign(page, baseURL);
  await page.goto("/pickles/prawns-and-dates");
  await page.waitForTimeout(300);
  expect(foreign).toEqual([]);
});

test("the Buy button on a product page leads to this jar's checkout", async ({ page }) => {
  await stub(page);
  await page.goto("/pickles/prawns-and-dates");
  await expect(page.locator(".product-buy")).toHaveAttribute(
    "href",
    "/checkout?p=prawns-and-dates&q=1"
  );
});

test("it offers at most two jars in stock, and the total follows the picker", async ({ page }) => {
  await stub(page);
  await page.goto("/checkout?p=prawns-and-dates&q=1");

  const options = page.locator("#checkout-qty option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toHaveText("1 jar");

  await page.selectOption("#checkout-qty", "2");
  await expect(page.locator(".checkout-pay")).toHaveText("Pay ₹1,298");
});

test("the shipping fee is printed before the Pay button, never sprung at payment", async ({
  page,
}) => {
  await stub(page, {
    products: IN_STOCK.products,
    shipping: { rule: "flatFee", flatFeePaise: 6_000 },
  });
  await page.goto("/checkout?p=prawns-and-dates&q=1");

  await expect(page.locator(".checkout-total")).toContainText("₹60");
  await expect(page.locator(".checkout-pay")).toHaveText("Pay ₹709");
});

test("the product's own shipping rule is what the total follows, never the global one alone", async ({
  page,
}) => {
  // The drift this test exists for: `content/products.json` carries no
  // shipping rule, so the page used to compute the global rule for every
  // product while `createCheckout` read `products/{slug}.shippingRule`. The
  // moment the global switch left "free", the two sums disagreed and every
  // order on a product with a rule of its own was refused at the Pay button
  // (brief 4.2). The rule now comes down with the counts.
  await stub(page, {
    products: {
      "prawns-and-dates": { ...IN_STOCK.products["prawns-and-dates"], shippingRule: "free" },
    },
    shipping: { rule: "flatFee", flatFeePaise: 6_000, freeFromJars: 2 },
  });
  await page.goto("/checkout?p=prawns-and-dates&q=1");

  await expect(page.locator(".checkout-total")).toContainText("Free");
  await expect(page.locator(".checkout-pay")).toHaveText("Pay ₹649");
});

test("a jar somebody else is paying for is not offered in the picker", async ({ page }) => {
  // Brief 9.3: an open batch's marks are the paid jars, so only `available`
  // knows a live hold has taken one. Nineteen bookable, seventeen paid, one
  // being paid for right now: one jar to offer, not two.
  await stub(page, {
    products: {
      "squid-and-dates": {
        mode: "open",
        count: 17,
        total: 19,
        available: 1,
        priceOpenPaise: 59_900,
        perPersonLimit: 4,
        shippingRule: "free",
      },
    },
    shipping: { rule: "free", flatFeePaise: 0 },
  });
  await page.goto("/checkout?p=squid-and-dates&q=2");

  const options = page.locator("#checkout-qty option");
  await expect(options).toHaveCount(1);
  await expect(page.locator(".checkout-pay")).toHaveText("Pay ₹599");
});

test("it sends the server exactly the figure it printed, and opens Razorpay", async ({ page }) => {
  await stub(page);

  let sent = null;
  await page.route("**/api/checkout", async (route) => {
    sent = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          orderId: "o-7f3a2c",
          totalPaise: 64_900,
          lineDescription: "Prawns and dates, batch 001",
          razorpayKeyId: "rzp_test_stub",
          razorpayOrderId: "order_stub",
          customerName: "Asha",
          customerPhone: "+919446587027",
          customerEmail: null,
          holdExpiresAtMillis: Date.now() + 15 * 60_000,
        },
      }),
    });
  });

  await page.goto("/checkout?p=prawns-and-dates&q=1");
  await fillTheForm(page);
  await page.click(".checkout-pay");

  await expect(page.locator(".checkout-done h2")).toHaveText("Paid");
  expect(sent.data.expectedTotalPaise).toBe(64_900);
  expect(sent.data.productSlug).toBe("prawns-and-dates");
  expect(sent.data.customerPhone).toBe("9446587027");
  expect(sent.data.consents).toEqual({ updates: true, marketing: false });
  expect(typeof sent.data.clientRef).toBe("string");

  const options = await page.evaluate(() => window.__razorpayOptions);
  expect(options.order_id).toBe("order_stub");
  expect(options.key).toBe("rzp_test_stub");
  expect(options.notes.lailark_order_id).toBe("o-7f3a2c");
});

test("a lapsed hold is not retried on the dead order, it starts a fresh checkout", async ({
  page,
}) => {
  // `clientRef` is minted once per page mount so a double tap takes one
  // hold. The cost is that a tap fifteen minutes later carries it too, and
  // the server used to hand back the dead order as something to pay for. It
  // refuses now, and the page has to start again rather than retry into the
  // same refusal forever, so the next tap must carry a different ref.
  await stub(page);
  const refs = [];
  await page.route("**/api/checkout", async (route) => {
    const sent = JSON.parse(route.request().postData() ?? "{}");
    refs.push(sent.data.clientRef);
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          status: "ABORTED",
          message:
            "Your jars were kept for fifteen minutes and that time has passed. Please start again.",
          details: { reason: "holdLapsed" },
        },
      }),
    });
  });

  await page.goto("/checkout?p=prawns-and-dates&q=1");
  await fillTheForm(page);
  await page.click(".checkout-pay");
  await expect(page.locator(".checkout-problem")).toContainText("that time has passed");

  await page.click(".checkout-pay");
  await expect.poll(() => refs.length).toBe(2);
  expect(refs[0]).not.toBe(refs[1]);
  expect(typeof refs[1]).toBe("string");
});

test("a changed order starts a fresh checkout, and a paid one never does", async ({ page }) => {
  // `orderChanged` is safe to start again on: the server has already put the
  // first jars back. `alreadyPaid` is not, and that is the whole difference:
  // minting a fresh reference there would let the next tap buy a second jar
  // for an order that is already paid for.
  const refsFor = async (reason) => {
    const refs = [];
    await page.route("**/api/checkout", async (route) => {
      refs.push(JSON.parse(route.request().postData() ?? "{}").data.clientRef);
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: { status: "ABORTED", message: `refused: ${reason}`, details: { reason } },
        }),
      });
    });
    await page.goto("/checkout?p=prawns-and-dates&q=1");
    await fillTheForm(page);
    await page.click(".checkout-pay");
    await expect(page.locator(".checkout-problem")).toContainText(reason);
    await page.click(".checkout-pay");
    await expect.poll(() => refs.length).toBe(2);
    await page.unroute("**/api/checkout");
    return refs;
  };

  await stub(page);
  const changed = await refsFor("orderChanged");
  expect(changed[0]).not.toBe(changed[1]);

  const paid = await refsFor("alreadyPaid");
  expect(paid[0]).toBe(paid[1]);
});

test("any other refusal keeps the same clientRef, so a retry cannot double the hold", async ({
  page,
}) => {
  // A network or gateway failure may well have left a hold behind. Minting
  // a fresh ref there would take a second jar out of the count for one
  // customer, which is the thing the ref exists to prevent.
  await stub(page);
  const refs = [];
  await page.route("**/api/checkout", async (route) => {
    refs.push(JSON.parse(route.request().postData() ?? "{}").data.clientRef);
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          status: "ABORTED",
          message: "Someone is paying for the last jar, check back in 15 minutes.",
        },
      }),
    });
  });

  await page.goto("/checkout?p=prawns-and-dates&q=1");
  await fillTheForm(page);
  await page.click(".checkout-pay");
  await expect(page.locator(".checkout-problem")).toContainText("last jar");
  await page.click(".checkout-pay");
  await expect.poll(() => refs.length).toBe(2);
  expect(refs[0]).toBe(refs[1]);
});

test("a refusal from the server is shown in the server's own words", async ({ page }) => {
  await stub(page);
  await page.route("**/api/checkout", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          status: "ABORTED",
          message: "Someone is paying for the last jar, check back in 15 minutes.",
        },
      }),
    })
  );

  await page.goto("/checkout?p=prawns-and-dates&q=1");
  await fillTheForm(page);
  await page.click(".checkout-pay");

  await expect(page.locator(".checkout-problem")).toHaveText(
    "Someone is paying for the last jar, check back in 15 minutes."
  );
  await expect(page.locator(".checkout-done")).toHaveCount(0);
});

test("a batch past its sale stop offers no way to pay", async ({ page }) => {
  await stub(page, {
    products: {
      "prawns-and-dates": {
        ...IN_STOCK.products["prawns-and-dates"],
        saleStopOn: "2020-01-01",
      },
    },
    shipping: { rule: "free", flatFeePaise: 0 },
  });
  await page.goto("/checkout?p=prawns-and-dates&q=1");

  await expect(page.locator(".checkout-waiting")).toContainText("no longer sold online");
  await expect(page.locator(".checkout-pay")).toHaveCount(0);
});

test("a sold-out batch offers no way to pay and never draws a zero total", async ({ page }) => {
  await stub(page, {
    products: {
      "prawns-and-dates": { ...IN_STOCK.products["prawns-and-dates"], count: 0, available: 0 },
    },
    shipping: { rule: "free", flatFeePaise: 0 },
  });
  await page.goto("/checkout?p=prawns-and-dates&q=1");

  await expect(page.locator(".checkout-pay")).toHaveCount(0);
  const text = await page.locator("main").innerText();
  expect(text).not.toContain("₹0");
});

test("/api/counts down: the page says so and offers no Pay button", async ({ page }) => {
  await page.route("**/api/counts", (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/checkout?p=prawns-and-dates&q=1");

  await expect(page.locator(".checkout-waiting")).toContainText(
    "We cannot show the count just now."
  );
  await expect(page.locator(".checkout-pay")).toHaveCount(0);
});

test("arriving with no product at all is a sentence, not an empty form", async ({ page }) => {
  await stub(page);
  await page.goto("/checkout");

  await expect(page.locator(".checkout-waiting")).toContainText("Please pick a pickle first.");
  await expect(page.locator(".checkout-pay")).toHaveCount(0);
});

test("the page carries no em dash and no countdown", async ({ page }) => {
  await stub(page);
  await page.goto("/checkout?p=prawns-and-dates&q=1");
  const text = await page.locator("body").innerText();
  // CLAUDE.md section 3: no em dashes, no dark patterns.
  expect(text).not.toMatch(/[—–]/);
  expect(text.toLowerCase()).not.toMatch(/hurry|only \d+ left|people are looking|expires in/);
});
