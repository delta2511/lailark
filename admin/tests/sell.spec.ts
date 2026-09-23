import { isBatchRef } from "@lailark/shared";
import { expect, test, type Page } from "@playwright/test";

import { COPY, SELL } from "../src/copy";
import {
  KITCHEN_PHONE,
  OTP,
  OWNER_PHONE,
  VIEWER_PHONE,
  acceptFixedOtp,
  deleteDocument,
  ensureAdminUser,
  queryByField,
  readDocument,
  seedBatch,
  seedDocument,
  timestampValue,
} from "./emulator";

/**
 * M2.8, the Sell screen (brief sections 7A.1, 7A.6 and 17.3).
 *
 * **The done-when, the first test below:** Playwright sells a jar for cash as
 * Kitchen, and the order, the customer, the batch count and the audit trail
 * all update. It drives the real screen, which calls the real
 * `createCounterSale` over the functions emulator, which moves the count in a
 * real Firestore transaction. Every assertion about what was recorded is read
 * back out of Firestore with admin rights rather than off the screen, because
 * a screen can say anything.
 *
 * The rest are the lines of 7A.1 and 7A.6 that the *screen* is responsible
 * for: that a wrong digit is caught and offered back rather than quietly
 * inventing a stranger, that the kitchen's discount box says what D17 says,
 * and that a void puts the jar back on the batch. Where a rule is enforced on
 * the server, it is tested on the server, in
 * `functions/test/counter-sale.test.ts`: a screen with no discount box on it
 * proves nothing, because the phone can post straight to the callable.
 */

const PRODUCT = "m28-prawns-pickle";
const PRODUCT_NAME = "M28 Prawns Pickle";

const REF_SALE = "b-m28sa5";
const REF_NEAR = "b-m28nrm";
const REF_VOID = "b-m28vd7";
const REF_CAP = "b-m28cap";
const REF_LIMIT = "b-m28xyz";
const ALL_REFS = [REF_SALE, REF_NEAR, REF_VOID, REF_CAP, REF_LIMIT];

/** A printed number each, so the batch picker reads the way a jar does. */
const BATCH_NUMBERS: Record<string, string> = {
  [REF_SALE]: "801",
  [REF_NEAR]: "802",
  [REF_VOID]: "803",
  [REF_CAP]: "804",
  [REF_LIMIT]: "805",
};

// A batch reference is Crockford's base32 without i, l, o and u (D21c), and
// the callable refuses anything else. Caught here, at load, rather than as a
// puzzling 400 in the middle of a sale.
for (const ref of ALL_REFS) {
  if (!isBatchRef(ref)) throw new Error(`${ref} is not a valid batch reference`);
}

const PRICE_IN_STOCK = 64_900;

/**
 * A distinct number per test. Orders are never deleted by the app and the
 * `audit` trail is append-only, so two tests sharing a customer would be two
 * tests reading each other's history.
 */
const ASHA = "+919000010001";
const RAVI = "+919000010002";
/** One digit from RAVI: the last digit is a 2 in one and a 3 in the other. */
const RAVI_MISTYPED = "+919000010003";
const VOID_CUSTOMER = "+919000010004";
const NEW_PERSON = "+919000010005";
const CAP_CUSTOMER = "+919000010006";
const LIMIT_CUSTOMER = "+919000010007";

const ALL_CUSTOMERS = [
  ASHA,
  RAVI,
  RAVI_MISTYPED,
  VOID_CUSTOMER,
  NEW_PERSON,
  CAP_CUSTOMER,
  LIMIT_CUSTOMER,
];

function national(e164: string): string {
  return e164.replace("+91", "");
}

async function seedProduct(customLines: Array<{ description: string; amountPaise: number }> = []): Promise<void> {
  await seedDocument(`products/${PRODUCT}`, {
    name: PRODUCT_NAME,
    type: "hero",
    veg: false,
    hsn: "16052900",
    priceInStock: PRICE_IN_STOCK,
    priceOpen: 59_900,
    jarGrams: 200,
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: true,
    customLines,
  });
}

/** An in-stock batch with `free` jars still on the shelf. */
async function seedInStock(ref: string, free: number): Promise<void> {
  await seedBatch(ref, {
    batchNo: BATCH_NUMBERS[ref],
    productSlug: PRODUCT,
    productName: PRODUCT_NAME,
    state: "inStock",
    plannedJars: 22,
    bookableJars: 19,
    // Brief 4.1: two jars per person on an in-stock batch.
    perPersonLimit: 2,
    bottledJars: 22,
    writtenOff: 0,
    paidCount: 22 - free,
    packedOn: "2026-09-04",
    createdAt: timestampValue("2026-09-04T06:00:00.000Z"),
  });
}

async function seedCustomer(phone: string, name: string, jars = 0, orders = 0): Promise<void> {
  await seedDocument(`customers/${phone}`, {
    name,
    email: null,
    country: "IN",
    consents: {
      updates: { given: false, at: null, by: null },
      marketing: { given: false, at: null, by: null },
    },
    shareCode: null,
    stats: { orders, jars, lastOrderAt: null },
    createdAt: timestampValue(),
    createdBy: "seed",
    updatedAt: timestampValue(),
    updatedBy: "seed",
  });
}

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedProduct();
});

test.afterEach(async () => {
  // Orders take no client write at all (`firestore.rules`), so nothing in the
  // app can clear them; the admin bypass can, and a test that left them would
  // be the next test's history.
  for (const phone of ALL_CUSTOMERS) {
    for (const order of await queryByField("orders", "customerPhone", phone)) {
      await deleteDocument(`orders/${order.number as string}`);
    }
    await deleteDocument(`customers/${phone}`);
  }
  for (const ref of ALL_REFS) await deleteDocument(`batches/${ref}`);
  await deleteDocument(`products/${PRODUCT}`);
  await deleteDocument("settings/discountCap");
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

async function openSell(page: Page): Promise<void> {
  await page.getByTestId("tab-sell").click();
  await expect(page.getByTestId("screen-sell")).toBeVisible();
}

/** Fills the customer, product and batch, leaving payment on its default. */
async function fillJarSale(page: Page, phone: string, ref: string): Promise<void> {
  await page.getByTestId("sale-phone").fill(national(phone));
  await page.getByTestId("sale-product").selectOption(PRODUCT);
  await expect(page.getByTestId("sale-batch")).toBeVisible();
  await page.getByTestId("sale-batch").selectOption(ref);
}

/* -------------------------------------------------------------------------- */
/* The done-when                                                              */
/* -------------------------------------------------------------------------- */

test("Kitchen sells a jar for cash, and the order, the customer, the batch count and the audit all update", async ({
  page,
}) => {
  await seedInStock(REF_SALE, 3);
  await seedCustomer(ASHA, "Asha");

  const before = await readDocument(`batches/${REF_SALE}`);
  expect(before?.paidCount).toBe(19);

  await signIn(page, KITCHEN_PHONE);
  await openSell(page);

  await fillJarSale(page, ASHA, REF_SALE);

  // Brief 7A.1 step 1: a known number brings its history with it.
  await expect(page.getByTestId("customer-history")).toBeVisible();
  await expect(page.getByTestId("sale-name")).toHaveValue("Asha");

  // Step 3: the price is prefilled from the batch and the total shows large.
  await expect(page.getByTestId("sale-total")).toHaveText("₹649");

  // Step 5: cash is the default, and it is what this sells for.
  await expect(page.getByTestId("sale-payment-cash")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("save-sale").click();
  await expect(page.getByTestId("sale-done")).toBeVisible();
  await expect(page.getByTestId("sold-line")).toContainText("₹649");

  /* ---- the order ----------------------------------------------------- */

  const sales = await queryByField("orders", "customerPhone", ASHA);
  expect(sales).toHaveLength(1);
  const order = sales[0];
  expect(order.channel).toBe("counter");
  // 7A.2: handed over now is delivered.
  expect(order.state).toBe("delivered");
  expect(order.total).toBe(PRICE_IN_STOCK);
  expect(order.batchRefs).toEqual([REF_SALE]);
  expect((order.payment as Record<string, unknown>).method).toBe("cash");
  expect((order.payment as Record<string, unknown>).status).toBe("captured");
  expect((order.payment as Record<string, unknown>).amount).toBe(PRICE_IN_STOCK);
  expect(order.discount).toBeNull();
  // M2.9, brief 13.1: "Counter sale: at save." The bill is issued in the same
  // commit as the sale. Nothing has been **sent** to the customer, though:
  // that is done by hand at launch (D32), so `billSentAt` is still null and
  // the sale is still voidable.
  // The serial itself is whatever the series is up to in this emulator run;
  // what is checked is the spelling, that the order and the document agree,
  // and that the document exists.
  expect(order.billNumber).toMatch(/^LK\/\d{2}-\d{2}\/\d{4,}$/);
  expect(order.billSentAt).toBeNull();
  const orderId = order.number as string;
  const billNumber = order.billNumber as string;
  const billId = billNumber.split("/").join("-");

  const bill = await readDocument(`documents/${billId}`);
  expect(bill?.kind).toBe("bill");
  expect(bill?.orderId).toBe(orderId);
  expect(bill?.total).toBe(PRICE_IN_STOCK);
  // GST is off, so all three taxes are written at zero (D26).
  expect(bill?.cgst).toBe(0);
  expect(bill?.sgst).toBe(0);
  expect(bill?.igst).toBe(0);

  /* ---- the customer -------------------------------------------------- */

  const customer = await readDocument(`customers/${ASHA}`);
  expect((customer?.stats as Record<string, number>).orders).toBe(1);
  expect((customer?.stats as Record<string, number>).jars).toBe(1);
  // Step 6: the tick that was on is recorded as consent given.
  expect(((customer?.consents as Record<string, Record<string, unknown>>).updates).given).toBe(true);

  /* ---- the batch count ------------------------------------------------ */

  const after = await readDocument(`batches/${REF_SALE}`);
  expect(after?.paidCount).toBe(20);

  /* ---- the trail, on all three, from the same commit ------------------ */

  const orderTrail = await queryByField("audit", "object", `orders/${orderId}`);
  expect(orderTrail).toHaveLength(1);
  expect(orderTrail[0].action).toBe("counterSale");

  const customerTrail = await queryByField("audit", "object", `customers/${ASHA}`);
  expect(customerTrail.map((entry) => entry.action)).toContain("counterSale");

  const batchTrail = await queryByField("audit", "object", `batches/${REF_SALE}`);
  const sold = batchTrail.filter((entry) => entry.action === "counterSale");
  expect(sold).toHaveLength(1);
  expect((sold[0].after as Record<string, number>).paidCount).toBe(20);

  /* ---- and it is on today's list, ready to be voided ------------------ */

  await page.getByTestId("new-sale-again").click();
  await expect(page.getByTestId(`sale-row-${orderId}`)).toBeVisible();

  /* ---- and its bill can be opened from the row (M2.9, D35) ------------ */

  await expect(page.getByTestId(`bill-number-${orderId}`)).toHaveText(billNumber);

  // The Kitchen cannot read `documents` or the bucket (both keep
  // `seesMoney()`), so this button is the only way it ever sees a bill: one
  // callable, one order, one short-lived link. What is checked here is that
  // the tap reaches the callable and comes back with a link to this order's
  // own bill; that the link really serves a PDF is checked against the
  // emulator in `functions/test/documents.test.ts`, where the bytes can be
  // read without a browser deciding how to display a PDF.
  const answered = page.waitForResponse(
    (response) => response.url().includes("billForOrder") && response.status() === 200,
  );
  const opened = page.context().waitForEvent("page");
  await page.getByTestId(`bill-${orderId}`).click();
  const body = (await (await answered).json()) as { result: { documentNumber: string; url: string } };
  expect(body.result.documentNumber).toBe(billNumber);
  expect(body.result.url).toContain(encodeURIComponent(`${billId}.pdf`));
  await expect(page.getByTestId(`void-error-${orderId}`)).toHaveCount(0);
  await (await opened).close();
});

/* -------------------------------------------------------------------------- */
/* A wrong digit does not quietly invent a stranger (7A.1 step 1)             */
/* -------------------------------------------------------------------------- */

test("a mistyped number stops the sale and offers back the customer it is one digit from", async ({
  page,
}) => {
  await seedInStock(REF_NEAR, 3);
  await seedCustomer(RAVI, "Ravi", 3, 2);

  await signIn(page, KITCHEN_PHONE);
  await openSell(page);

  await fillJarSale(page, RAVI_MISTYPED, REF_NEAR);

  // The screen already knows this number has never bought from us, because
  // `customers/{phone}` is simply not there.
  await expect(page.getByTestId("customer-new")).toBeVisible();
  await page.getByTestId("sale-name").fill("Ravee");
  await page.getByTestId("save-sale").click();

  // The server refuses once and hands back the near miss, which the screen
  // offers as one tap rather than making anybody retype.
  await expect(page.getByTestId("near-misses")).toBeVisible();
  await expect(page.getByTestId(`near-miss-${RAVI}`)).toBeVisible();
  await expect(page.getByTestId("near-misses")).toContainText("Ravi");

  // Nothing was created under the wrong number.
  expect(await readDocument(`customers/${RAVI_MISTYPED}`)).toBeNull();

  // Tapping the near miss puts the real customer in, and the sale goes through.
  await page.getByTestId(`near-miss-${RAVI}`).click();
  await expect(page.getByTestId("customer-history")).toContainText(SELL.history(3, 2));
  await page.getByTestId("save-sale").click();
  await expect(page.getByTestId("sale-done")).toBeVisible();

  // The jar went to Ravi, and the stranger was never created.
  const ravi = await readDocument(`customers/${RAVI}`);
  expect((ravi?.stats as Record<string, number>).jars).toBe(4);
  expect(await readDocument(`customers/${RAVI_MISTYPED}`)).toBeNull();
});

test("a number that really is new is added once the person says so", async ({ page }) => {
  await seedInStock(REF_NEAR, 3);

  await signIn(page, KITCHEN_PHONE);
  await openSell(page);

  await fillJarSale(page, NEW_PERSON, REF_NEAR);
  await page.getByTestId("sale-name").fill("New person");
  await page.getByTestId("save-sale").click();

  await expect(page.getByTestId("near-misses")).toBeVisible();
  await page.getByTestId("confirm-new-customer").click();

  await expect(page.getByTestId("sale-done")).toBeVisible();
  await expect(page.getByTestId("sold-customer-created")).toBeVisible();

  const created = await readDocument(`customers/${NEW_PERSON}`);
  expect(created?.name).toBe("New person");
  expect((created?.stats as Record<string, number>).jars).toBe(1);
});

/* -------------------------------------------------------------------------- */
/* The discount cap on the screen, decision D17                               */
/* -------------------------------------------------------------------------- */

test("the Kitchen's discount box says there is no cap until the Owner sets one, and then says the cap", async ({
  page,
}) => {
  await seedInStock(REF_CAP, 3);
  await seedCustomer(CAP_CUSTOMER, "Asha");
  await deleteDocument("settings/discountCap");

  await signIn(page, KITCHEN_PHONE);
  await openSell(page);
  await fillJarSale(page, CAP_CUSTOMER, REF_CAP);

  // D17 ships empty: no cap set means no kitchen discount at all.
  await expect(page.getByTestId("discount-rights")).toHaveText(SELL.discountNoRights);
  await expect(page.getByTestId("sale-discount")).toBeDisabled();

  // The Owner sets one, and the same screen picks it up live.
  await seedDocument("settings/discountCap", { kitchenCap: 5_000, reasonRequired: true });
  await expect(page.getByTestId("discount-rights")).toHaveText(SELL.discountCap("₹50"));
  await expect(page.getByTestId("sale-discount")).toBeEnabled();

  // One rupee past the cap is refused on the screen, and the save is closed.
  await page.getByTestId("sale-discount").fill("51");
  await page.getByTestId("sale-discount-reason").fill("regular customer");
  await expect(page.getByTestId("discount-error")).toHaveText(SELL.discountOverCap("₹50"));
  await expect(page.getByTestId("save-sale")).toBeDisabled();

  // Inside the cap, with a reason, it goes through and the order carries it.
  await page.getByTestId("sale-discount").fill("50");
  await expect(page.getByTestId("sale-total")).toHaveText("₹599");
  await page.getByTestId("save-sale").click();
  await expect(page.getByTestId("sale-done")).toBeVisible();

  const sales = await queryByField("orders", "customerPhone", CAP_CUSTOMER);
  expect(sales).toHaveLength(1);
  expect(sales[0].total).toBe(PRICE_IN_STOCK - 5_000);
  expect((sales[0].discount as Record<string, unknown>).amount).toBe(5_000);
  expect((sales[0].discount as Record<string, unknown>).reason).toBe("regular customer");
});

/* -------------------------------------------------------------------------- */
/* The void, brief 7A.6                                                       */
/* -------------------------------------------------------------------------- */

test("a sale entered by mistake is voided from today's list, and the jar goes back", async ({ page }) => {
  await seedInStock(REF_VOID, 3);
  await seedCustomer(VOID_CUSTOMER, "Wrong sale");

  await signIn(page, OWNER_PHONE);
  await openSell(page);
  await fillJarSale(page, VOID_CUSTOMER, REF_VOID);
  await page.getByTestId("save-sale").click();
  await expect(page.getByTestId("sale-done")).toBeVisible();

  const sales = await queryByField("orders", "customerPhone", VOID_CUSTOMER);
  const orderId = sales[0].number as string;
  expect((await readDocument(`batches/${REF_VOID}`))?.paidCount).toBe(20);

  await page.getByTestId("new-sale-again").click();
  await expect(page.getByTestId(`sale-row-${orderId}`)).toBeVisible();

  await page.getByTestId(`void-${orderId}`).click();
  await page.getByTestId(`void-reason-${orderId}`).fill("rang it up twice");
  await page.getByTestId(`void-confirm-${orderId}`).click();
  await expect(page.getByTestId(`void-done-${orderId}`)).toBeVisible();

  // The jar is back on the batch, and the order says it was voided and why.
  expect((await readDocument(`batches/${REF_VOID}`))?.paidCount).toBe(19);
  const voided = await readDocument(`orders/${orderId}`);
  expect(voided?.state).toBe("voided");
  expect(voided?.voidReason).toBe("rang it up twice");

  // The customer's history is not left inflated by a sale that did not happen.
  const customer = await readDocument(`customers/${VOID_CUSTOMER}`);
  expect((customer?.stats as Record<string, number>).jars).toBe(0);

  // Both the sale and the void are in the trail, on the order and the batch.
  const orderTrail = (await queryByField("audit", "object", `orders/${orderId}`)).map((e) => e.action);
  expect(orderTrail).toContain("counterSale");
  expect(orderTrail).toContain("counterSaleVoid");
  const batchTrail = (await queryByField("audit", "object", `batches/${REF_VOID}`)).map((e) => e.action);
  expect(batchTrail).toContain("counterSale");
  expect(batchTrail).toContain("counterSaleVoid");
});

/* -------------------------------------------------------------------------- */
/* Brief 17.12: a Viewer sells nothing                                        */
/* -------------------------------------------------------------------------- */

test("a Viewer gets today's list and no sale form", async ({ page }) => {
  await ensureAdminUser(VIEWER_PHONE, "viewer");

  await signIn(page, VIEWER_PHONE);
  await openSell(page);

  await expect(page.getByTestId("sell-viewer")).toHaveText(SELL.viewerCannotSell);
  await expect(page.getByTestId("new-sale")).toHaveCount(0);
  await expect(page.getByTestId("todays-sales")).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* The per-person limit, brief 7A.6: the Owner's row and his alone           */
/* -------------------------------------------------------------------------- */

/** A batch that lets one person have one jar, with four on the shelf. */
async function seedOneEach(): Promise<void> {
  await seedBatch(REF_LIMIT, {
    batchNo: BATCH_NUMBERS[REF_LIMIT],
    productSlug: PRODUCT,
    productName: PRODUCT_NAME,
    state: "inStock",
    plannedJars: 4,
    bookableJars: 3,
    perPersonLimit: 1,
    bottledJars: 4,
    writtenOff: 0,
    paidCount: 0,
    packedOn: "2026-09-04",
    createdAt: timestampValue("2026-09-04T06:00:00.000Z"),
  });
  await seedCustomer(LIMIT_CUSTOMER, "Regular");
}

/** Sells one jar, which is inside the limit, and starts a second sale. */
async function sellOneThenTryAnother(page: Page): Promise<void> {
  await fillJarSale(page, LIMIT_CUSTOMER, REF_LIMIT);
  await page.getByTestId("save-sale").click();
  await expect(page.getByTestId("sale-done")).toBeVisible();
  await page.getByTestId("new-sale-again").click();

  await fillJarSale(page, LIMIT_CUSTOMER, REF_LIMIT);
  await page.getByTestId("save-sale").click();
  await expect(page.getByTestId("sale-error")).toContainText("limited to 1 jar per person");
}

test("the Kitchen is told about the limit and has no way past it", async ({ page }) => {
  await seedOneEach();
  await signIn(page, KITCHEN_PHONE);
  await openSell(page);

  await sellOneThenTryAnother(page);

  await expect(page.getByTestId("override-limit")).toHaveCount(0);
  // The refused sale moved nothing.
  expect((await readDocument(`batches/${REF_LIMIT}`))?.paidCount).toBe(1);
  expect(await queryByField("orders", "customerPhone", LIMIT_CUSTOMER)).toHaveLength(1);
});

test("the Owner is offered the way past the limit, and the order records that he took it", async ({
  page,
}) => {
  await seedOneEach();
  await signIn(page, OWNER_PHONE);
  await openSell(page);

  await sellOneThenTryAnother(page);

  // Offered only after the limit has actually refused, never as a standing
  // switch: he sees the sentence he is overruling.
  await expect(page.getByTestId("override-limit")).toBeVisible();
  await page.getByTestId("override-limit-confirm").click();
  await expect(page.getByTestId("sale-done")).toBeVisible();

  expect((await readDocument(`batches/${REF_LIMIT}`))?.paidCount).toBe(2);
  const sales = await queryByField("orders", "customerPhone", LIMIT_CUSTOMER);
  expect(sales).toHaveLength(2);
  expect(sales.filter((order) => order.limitOverridden === true)).toHaveLength(1);
});

/* -------------------------------------------------------------------------- */
/* The screen itself: the same check its siblings get                         */
/* -------------------------------------------------------------------------- */

test("Sell draws no console error, paints no rust on a button or heading, and fits a phone", async ({
  page,
}) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  // The screen Sumayya uses is a phone at the counter, not a laptop.
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, KITCHEN_PHONE);
  await openSell(page);

  const RUST = "rgb(163, 74, 40)";
  const offenders = await page.evaluate((rust) => {
    const elements = Array.from(document.querySelectorAll("button, h1, h2, h3, a"));
    return elements
      .filter((el) => getComputedStyle(el).color === rust)
      .map((el) => el.outerHTML.slice(0, 80));
  }, RUST);
  expect(offenders, "rust is a number colour, never a button or heading").toEqual([]);

  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);

  // Nothing runs off the side of the phone, and every control is thumb-sized.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the screen scrolls sideways on a phone").toBeLessThanOrEqual(0);

  const buttons = page.locator('[data-testid="screen-sell"] button');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    if (box) expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(48);
  }
});
