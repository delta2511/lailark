import { expect, test, type Page } from "@playwright/test";

import { ORDER_GROUPS } from "@lailark/shared";

import { ORDERS } from "../src/copy";
import { expectReadable } from "./contrast";
import {
  OTP,
  OWNER_PHONE,
  acceptFixedOtp,
  deleteDocument,
  seedDocumentRecord,
  seedOrder,
  timestampValue,
} from "./emulator";

/**
 * M3.9: the Orders screen. The done-when is "every order created in M2 and
 * M3 is findable and readable", so this spec seeds one order per group
 * (including the A201 case, a `held` order whose payment already
 * `captured`) and walks: the groups render, a filter narrows, a search finds
 * by number and by pincode, the detail opens, and the paid-held order shows
 * its payment without anyone having to know to look for it.
 */

const REF_AWAITING = "o-m39awt";
const REF_HELD_PAID = "o-m39hpd"; // A201: held, but payment.status is captured.
const REF_PAID_WAITING = "o-m39pdw";
const REF_TO_PACK = "o-m39pck";
const REF_CLOSED = "o-m39cls";
// M3.9 round 3 (Shefin's phone check): a sixth order with no `createdAt` at
// all, the case a document written a moment ago can be in (the server
// timestamp lands on the second write). It has to render on the "All" tab
// without crashing or showing a bogus date.
const REF_NO_CREATED_AT = "o-m39noc";

const ALL_REFS = [REF_AWAITING, REF_HELD_PAID, REF_PAID_WAITING, REF_TO_PACK, REF_CLOSED, REF_NO_CREATED_AT];

// Distinct, increasing instants so "newest first" is a real assertion on
// rendered order, not just on the query. REF_CLOSED is the newest.
const CREATED_AWAITING = timestampValue("2026-09-20T04:00:00.000Z");
const CREATED_HELD_PAID = timestampValue("2026-09-21T04:00:00.000Z");
const CREATED_PAID_WAITING = timestampValue("2026-09-22T04:00:00.000Z");
const CREATED_TO_PACK = timestampValue("2026-09-23T04:00:00.000Z");
const CREATED_CLOSED = timestampValue("2026-09-24T04:00:00.000Z");

async function seedOrders(): Promise<void> {
  await seedOrder(REF_AWAITING, {
    number: "o-m39-001",
    channel: "web",
    customerPhone: "+919000000001",
    state: "held",
    total: 59_900,
    payment: {
      method: "razorpay",
      status: "created",
      razorpayIds: {},
      markedPaidBy: null,
      upiRef: null,
      amount: 59_900,
      refundedAmount: 0,
    },
    deliveryContact: {
      name: "Asha Menon",
      phone: "+919000000001",
      lines: ["12 Beach Road"],
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673001",
    },
    createdAt: CREATED_AWAITING,
  });

  // A201: the capture ended as a concern and the order stays `held`, but the
  // money genuinely arrived. This is the one this whole task exists to make
  // visible without opening the order.
  await seedOrder(REF_HELD_PAID, {
    number: "o-m39-002",
    channel: "web",
    customerPhone: "+919000000002",
    state: "held",
    total: 64_900,
    payment: {
      method: "razorpay",
      status: "captured",
      razorpayIds: { paymentId: "pay_m39test" },
      markedPaidBy: null,
      upiRef: null,
      amount: 64_900,
      refundedAmount: 0,
    },
    deliveryContact: {
      name: "Rahul Nair",
      phone: "+919000000002",
      lines: ["4 Hill View"],
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673002",
    },
    createdAt: CREATED_HELD_PAID,
  });

  await seedOrder(REF_PAID_WAITING, {
    number: "o-m39-003",
    channel: "counter",
    customerPhone: "+919000000003",
    state: "paidWaiting",
    fulfilment: "ship",
    total: 59_900,
    batchRefs: ["b-m39batch"],
    payment: {
      method: "cash",
      status: "captured",
      razorpayIds: {},
      markedPaidBy: "seed",
      upiRef: null,
      amount: 59_900,
      refundedAmount: 0,
    },
    deliveryContact: {
      name: "Priya Das",
      phone: "+919000000003",
      lines: ["9 Market Street"],
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673003",
    },
    createdAt: CREATED_PAID_WAITING,
  });

  await seedOrder(REF_TO_PACK, {
    number: "o-m39-004",
    channel: "web",
    customerPhone: "+919000000004",
    state: "toPack",
    fulfilment: "ship",
    total: 64_900,
    token: "abcdef0123456789abcdef0123456789",
    payment: {
      method: "razorpay",
      status: "captured",
      razorpayIds: { paymentId: "pay_m39toPack" },
      markedPaidBy: null,
      upiRef: null,
      amount: 64_900,
      refundedAmount: 0,
    },
    deliveryContact: {
      name: "Vinod Kumar",
      phone: "+919000000004",
      lines: ["1 Lake Road"],
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673004",
    },
    createdAt: CREATED_TO_PACK,
  });
  await seedDocumentRecord("LK-26-27-0004", {
    kind: "bill",
    number: "LK/26-27/0004",
    orderId: REF_TO_PACK,
    orderNumber: "o-m39-004",
    total: 64_900,
  });

  await seedOrder(REF_CLOSED, {
    number: "o-m39-005",
    channel: "web",
    customerPhone: "+919000000005",
    state: "closed",
    total: 59_900,
    payment: {
      method: "razorpay",
      status: "captured",
      razorpayIds: { paymentId: "pay_m39closed" },
      markedPaidBy: null,
      upiRef: null,
      amount: 59_900,
      refundedAmount: 0,
    },
    deliveryContact: null,
    createdAt: CREATED_CLOSED,
  });

  // No `createdAt` at all: a document written a moment ago, before the
  // server timestamp has landed. `millisOf` (Today's own helper, reused by
  // `OrderCard`) already treats this as "unreadable", so the card should
  // render with no date/time slot rather than crashing or showing a bogus
  // one, and the order still has to be findable on "All".
  await seedOrder(REF_NO_CREATED_AT, {
    number: "o-m39-006",
    channel: "web",
    customerPhone: "+919000000006",
    state: "closed",
    total: 59_900,
    payment: {
      method: "razorpay",
      status: "captured",
      razorpayIds: { paymentId: "pay_m39nocreated" },
      markedPaidBy: null,
      upiRef: null,
      amount: 59_900,
      refundedAmount: 0,
    },
    deliveryContact: null,
    createdAt: null,
  });
}

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedOrders();
});

test.afterEach(async () => {
  for (const ref of ALL_REFS) {
    await deleteDocument(`orders/${ref}`);
  }
  await deleteDocument("documents/LK-26-27-0004");
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Six digit code").fill(OTP);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

async function openOrders(page: Page): Promise<void> {
  await page.getByTestId("tab-orders").click();
  await expect(page.getByTestId("screen-orders")).toBeVisible();
}

test("every group renders, and Ships today is a derived view over paid, unpacked orders", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);

  // "All" is the default tab (M3.9 round 3), so Ships today needs an
  // explicit click here: paidWaiting + toPack, ship fulfilment only.
  await page.getByTestId("orders-tab-shipsToday").click();
  await expect(page.getByTestId(`order-row-${REF_PAID_WAITING}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_TO_PACK}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_AWAITING}`)).toHaveCount(0);

  await page.getByTestId("orders-tab-awaitingPayment").click();
  await expect(page.getByTestId(`order-row-${REF_AWAITING}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_HELD_PAID}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_PAID_WAITING}`)).toHaveCount(0);

  // A201: the held-but-paid order shows a money badge right on the card,
  // inside the very group whose name would otherwise say "not paid yet".
  await expect(page.getByTestId(`order-row-${REF_HELD_PAID}`).getByTestId("order-card-paid-badge")).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_AWAITING}`).getByTestId("order-card-paid-badge")).toHaveCount(0);

  await page.getByTestId("orders-tab-closed").click();
  await expect(page.getByTestId(`order-row-${REF_CLOSED}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_AWAITING}`)).toHaveCount(0);
});

test("the channel filter narrows the list", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await page.getByTestId("orders-tab-paidWaiting").click();
  await expect(page.getByTestId(`order-row-${REF_PAID_WAITING}`)).toBeVisible();

  await page.getByTestId("orders-filter-channel").selectOption("counter");
  await expect(page.getByTestId(`order-row-${REF_PAID_WAITING}`)).toBeVisible();

  await page.getByTestId("orders-filter-channel").selectOption("web");
  await expect(page.getByTestId(`order-row-${REF_PAID_WAITING}`)).toHaveCount(0);
});

test("search finds an order by its own number and by pincode", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await page.getByTestId("orders-tab-awaitingPayment").click();

  await page.getByTestId("orders-search").fill("o-m39-002");
  await expect(page.getByTestId(`order-row-${REF_HELD_PAID}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_AWAITING}`)).toHaveCount(0);

  await page.getByTestId("orders-search").fill("673001");
  await expect(page.getByTestId(`order-row-${REF_AWAITING}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_HELD_PAID}`)).toHaveCount(0);
});

test("search finds an order by its bill number", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await page.getByTestId("orders-tab-toPack").click();
  await expect(page.getByTestId(`order-row-${REF_TO_PACK}`)).toBeVisible();

  await page.getByTestId("orders-search").fill("26-27/0004");
  await expect(page.getByTestId(`order-row-${REF_TO_PACK}`)).toBeVisible();
});

test("the detail opens, and a held-but-captured order shows its payment (A201)", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await page.getByTestId("orders-tab-awaitingPayment").click();
  await page.getByTestId(`order-row-${REF_HELD_PAID}`).click();

  await expect(page.getByTestId("order-detail")).toBeVisible();
  await expect(page.getByTestId("order-detail-number")).toHaveText("o-m39-002");
  await expect(page.getByTestId("order-detail-paid-badge")).toBeVisible();
  await expect(page.getByTestId("order-payment-status")).toHaveText(ORDERS.paymentStatusLabel.captured);
  await expect(page.getByTestId("order-payment-amount")).toContainText("649");

  // Every section brief 17.5 names is drawn, even where M3.9 has nothing to
  // show yet (shipment/tracking are M4.1, Concerns is M4.4).
  await expect(page.getByTestId("order-shipment-none")).toBeVisible();
  await expect(page.getByTestId("order-concerns-none")).toBeVisible();

  // A hard reload on the deep link still resolves to the same order.
  await page.reload();
  await expect(page.getByTestId("order-detail-number")).toHaveText("o-m39-002");
});

test("the bill's wa.me link carries the order number, total and private link", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await page.getByTestId("orders-tab-toPack").click();
  await page.getByTestId(`order-row-${REF_TO_PACK}`).click();

  const preview = page.getByTestId("order-bill-preview");
  await expect(preview).toContainText("o-m39-004");
  await expect(preview).toContainText("649");
  await expect(preview).toContainText("/o/abcdef0123456789abcdef0123456789");
  await expect(page.getByTestId("order-bill-send")).toBeVisible();
});

/**
 * The bill preview carries the private order URL, one long unbreakable
 * string. At phone width it used to run off the edge of its box: the box's
 * whole job is to let the Owner read the message, link included, before he
 * sends it, so a clipped link defeats the point. `.bill-preview` wraps it;
 * this checks every ancestor up to the shell actually stays inside the
 * viewport rather than clipping.
 */
test("the bill preview wraps its link at phone width instead of overflowing", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await page.getByTestId("orders-tab-toPack").click();
  await page.getByTestId(`order-row-${REF_TO_PACK}`).click();

  await expect(page.getByTestId("order-bill-preview")).toContainText("/o/abcdef0123456789abcdef0123456789");

  const overflow = await page.evaluate(() => {
    const selectors: Record<string, string> = {
      "field-value (bill preview)": '[data-testid="order-bill-preview"]',
      detail: ".detail",
      orders: ".orders",
      "shell-content": ".shell-content",
    };
    const results: Record<string, { scrollWidth: number; clientWidth: number }> = {};
    for (const [label, selector] of Object.entries(selectors)) {
      const el = document.querySelector(selector);
      if (el) results[label] = { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    }
    results["document"] = {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
    return results;
  });

  for (const [id, { scrollWidth, clientWidth }] of Object.entries(overflow)) {
    expect(scrollWidth, `${id}: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`).toBeLessThanOrEqual(
      clientWidth,
    );
  }
});

test("an order written before M3.8 has no token, so no wa.me link is drawn, only a plain line saying why (A206)", async ({
  page,
}) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await page.getByTestId("orders-tab-closed").click();
  await page.getByTestId(`order-row-${REF_CLOSED}`).click();

  // REF_CLOSED was seeded with the default `token: null`.
  await expect(page.getByTestId("order-bill-no-token")).toBeVisible();
  await expect(page.getByTestId("order-bill-send")).toHaveCount(0);
});

/**
 * M3.9 round 2: the group selector was eleven full-width buttons stacked
 * down the page (no `.chip` class, so the app's default full-width button
 * rule applied), pushing the first order card two screens down at phone
 * width. Fixed by giving the tabs `.tab-row`/`.chip`/`.chip-on`, the same
 * pair M2.21 and M2.22 already needed a contrast test for: a selected chip
 * paints its label in `--paper` on a `--ink` background, and a CSS
 * specificity accident there is exactly the kind of thing that made Undo and
 * Sell invisible in those two bugs.
 */
test("every order-group chip is readable, selected or not, at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, OWNER_PHONE);
  await openOrders(page);

  const tabIds = ["all", "shipsToday", ...ORDER_GROUPS].map((group) => `orders-tab-${group}`);

  for (const activeTestId of tabIds) {
    await page.getByTestId(activeTestId).click();
    await expect(page.getByTestId(activeTestId)).toHaveAttribute("aria-current", "page");
    await expectReadable(page.getByTestId(activeTestId), `${activeTestId} while active`);
  }

  // And the very first tab, unselected, stays readable too (not just the
  // active one at each step).
  await expectReadable(page.getByTestId(tabIds[0]), `${tabIds[0]} while inactive`);
});

/**
 * The done-when for the phone-width fix itself: at 375x812, the first order
 * card is visible without scrolling. The eleven tabs now wrap to a handful of
 * short rows instead of stacking as full-width buttons, so the list below
 * them starts within the first screen.
 */
test("at phone width, the first order card is visible without scrolling past the tabs", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, OWNER_PHONE);
  await openOrders(page);

  // "All" (the default tab) has orders in this seed, but so does every
  // other tab used elsewhere in this spec: switch to a specific group the
  // same way the other specs above do, so this test is about the tabs'
  // layout, not about which tab happens to be open.
  await page.getByTestId("orders-tab-paidWaiting").click();
  const card = page.getByTestId(`order-row-${REF_PAID_WAITING}`);
  await expect(card).toBeVisible();
  await expect(card).toBeInViewport();
});

test("Orders draws no console error and paints no rust on a button or heading", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await page.getByTestId("orders-tab-awaitingPayment").click();
  await page.getByTestId(`order-row-${REF_HELD_PAID}`).click();
  await expect(page.getByTestId("order-detail")).toBeVisible();

  const RUST = "rgb(163, 74, 40)";
  const offenders = await page.evaluate((rust) => {
    const elements = Array.from(document.querySelectorAll("button, h1, h2, h3, a"));
    return elements
      .filter((el) => getComputedStyle(el).color === rust)
      .map((el) => el.outerHTML.slice(0, 80));
  }, RUST);

  expect(offenders).toEqual([]);
  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
});

/**
 * M3.9 round 3 (Shefin's phone check): "a button to show all orders
 * together". "All" opens by default and ignores the group entirely, unlike
 * every other tab, so every seeded order (including the A201 held-but-paid
 * one and the one with no `createdAt` at all) has to show up on it with no
 * tab click needed.
 */
test('the "All" tab shows every seeded order, with no click needed', async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);

  await expect(page.getByTestId("orders-tab-all")).toHaveAttribute("aria-current", "page");
  for (const ref of ALL_REFS) {
    await expect(page.getByTestId(`order-row-${ref}`)).toBeVisible();
  }
});

/**
 * The query is already `orderBy("createdAt", "desc")` (`orders/data.ts`),
 * but this asserts the thing Shefin actually asked for: the order the cards
 * render in on screen, not just the order the query returns. A order with no
 * usable `createdAt` (REF_NO_CREATED_AT) is excluded from the expected
 * order rather than pinned to a position: Firestore sorts a null field
 * lowest, which this test does not need to assert to prove "newest first".
 */
test("orders render newest first on the All tab", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);

  const expectedNewestFirst = [REF_CLOSED, REF_TO_PACK, REF_PAID_WAITING, REF_HELD_PAID, REF_AWAITING];

  await expect(page.getByTestId(`order-row-${REF_AWAITING}`)).toBeVisible();

  const renderedOrder = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid="order-list"] > li [data-testid^="order-row-"]')).map(
      (el) => (el as HTMLElement).dataset.testid,
    );
  });
  const renderedRefs = renderedOrder.map((testId) => (testId ?? "").replace("order-row-", ""));
  const renderedKnownRefs = renderedRefs.filter((ref) => expectedNewestFirst.includes(ref));

  expect(renderedKnownRefs).toEqual(expectedNewestFirst);
});

/**
 * The date/time slot (M3.9 round 3): visible on an ordinary card, and absent
 * without crashing or showing "Invalid Date" on a card whose order has no
 * usable `createdAt` (A card written a moment ago can be in exactly this
 * state, before the server timestamp lands).
 */
test("a card shows when the order was placed, and a missing createdAt renders safely", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await signIn(page, OWNER_PHONE);
  await openOrders(page);

  // CREATED_CLOSED is 2026-09-24T04:00:00.000Z, which is 09:30 the same
  // calendar day in Asia/Kolkata (+05:30, no day rollover at this hour).
  await expect(page.getByTestId(`order-row-${REF_CLOSED}`).getByTestId("order-card-created-at")).toHaveText(
    "24 Sep, 9:30 am",
  );

  const noCreatedAtCard = page.getByTestId(`order-row-${REF_NO_CREATED_AT}`);
  await expect(noCreatedAtCard).toBeVisible();
  await expect(noCreatedAtCard.getByTestId("order-card-created-at")).toHaveCount(0);
  await expect(noCreatedAtCard).not.toContainText("Invalid Date");

  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
});

/**
 * "All" means every group, not "ignore the filters" (the task's own
 * wording): the batch, channel and search filters still have to narrow the
 * list while "All" is the active tab.
 */
test("search and the batch/channel filters still narrow while All is selected", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrders(page);
  await expect(page.getByTestId("orders-tab-all")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("orders-filter-channel").selectOption("counter");
  await expect(page.getByTestId(`order-row-${REF_PAID_WAITING}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_AWAITING}`)).toHaveCount(0);
  await page.getByTestId("orders-filter-channel").selectOption("all");

  await page.getByTestId("orders-filter-batch").selectOption("b-m39batch");
  await expect(page.getByTestId(`order-row-${REF_PAID_WAITING}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_TO_PACK}`)).toHaveCount(0);
  await page.getByTestId("orders-filter-batch").selectOption("all");

  await page.getByTestId("orders-search").fill("o-m39-002");
  await expect(page.getByTestId(`order-row-${REF_HELD_PAID}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${REF_AWAITING}`)).toHaveCount(0);
});
