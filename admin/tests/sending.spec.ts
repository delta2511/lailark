import { expect, test, type Page } from "@playwright/test";

import { COPY, TODAY } from "../src/copy";
import {
  KITCHEN_PHONE,
  OTP,
  OWNER_PHONE,
  deleteDocument,
  acceptFixedOtp,
  readDocument,
  seedApproval,
  seedBatch,
  seedDocument,
  timestampValue,
} from "./emulator";

/**
 * M3.8, decision D32: the message the Owner said yes to is sent **by hand**,
 * one prefilled `wa.me` link per customer, each ticked when it goes.
 *
 * Nothing in this repo sends anything, and that is what every assertion here
 * is really about: the card offers a link the Owner taps himself, the tick
 * goes through the Owner-only callable, and `sentAt` on the approval stays
 * null through all of it.
 *
 * The list itself is not seeded. It is built by the real `onApprovalWritten`
 * trigger from the batch's real paid orders, so what is on screen is what a
 * yes actually produces.
 */

const PRODUCT = "m38-prawns-pickle";
const REF = "b-m38snd";
const APPROVAL = `half-${REF}`;
const ORDER_PAID = "o-m38paid";
const ORDER_HELD = "o-m38held";
const ASHA = "+919000031111";
const NOBODY = "+919000032222";

const DRAFT = "Half the batch is paid for. We are arranging the prawns now.";

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedDocument(`products/${PRODUCT}`, {
    name: "M38 Prawns Pickle",
    type: "hero",
    veg: false,
    hsn: "2001",
    priceInStock: 64_900,
    priceOpen: 59_900,
    jarGrams: 200,
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: true,
    customLines: [],
  });
  await seedBatch(REF, {
    productSlug: PRODUCT,
    productName: "M38 Prawns Pickle",
    recipeId: "m38-recipe",
    state: "sourcing",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    halfReachedAt: timestampValue(),
  });
  await seedDocument(`customers/${ASHA}`, { name: "Asha", country: "IN" });

  // One customer who really paid into the batch...
  await seedDocument(`orders/${ORDER_PAID}`, {
    number: ORDER_PAID,
    channel: "web",
    customerPhone: ASHA,
    state: "paidWaiting",
    lines: [{ productSlug: PRODUCT, batchRef: REF, qty: 2, unitPrice: 59_900, jarNumbers: [] }],
    batchRefs: [REF],
    total: 119_800,
  });
  // ...and one whose capture bought no jar (A203): money recorded, order
  // still held, nothing sold. Telling them "half the batch is paid for"
  // would be telling them something untrue, so they are not on the list.
  await seedDocument(`orders/${ORDER_HELD}`, {
    number: ORDER_HELD,
    channel: "web",
    customerPhone: NOBODY,
    state: "held",
    lines: [{ productSlug: PRODUCT, batchRef: REF, qty: 1, unitPrice: 59_900, jarNumbers: [] }],
    batchRefs: [REF],
    total: 59_900,
    payment: { method: "razorpay", status: "captured" },
  });
});

test.afterEach(async () => {
  await deleteDocument(`approvals/${APPROVAL}`);
  await deleteDocument(`orders/${ORDER_PAID}`);
  await deleteDocument(`orders/${ORDER_HELD}`);
  await deleteDocument(`customers/${ASHA}`);
  await deleteDocument(`batches/${REF}`);
  await deleteDocument(`products/${PRODUCT}`);
});

/** The approval as it stands the moment the Owner has said yes. */
async function seedApproved(): Promise<void> {
  await seedApproval(APPROVAL, {
    kind: "halfReached",
    batchRef: REF,
    draft: DRAFT,
    status: "approved",
    answeredBy: "seed",
    at: timestampValue(),
  });
}

/** The real `onApprovalWritten` trigger, which runs off the request path. */
async function waitForList(): Promise<void> {
  await expect
    .poll(async () => (await readDocument(`approvals/${APPROVAL}`))?.recipients, {
      timeout: 20_000,
    })
    .toHaveLength(1);
}

test("the approved message becomes a list of people, and the Owner sends each one himself", async ({
  page,
}) => {
  await seedApproved();

  // The trigger builds the list off the batch's real paid orders.
  await waitForList();

  await signIn(page, OWNER_PHONE);

  const card = page.getByTestId(`sending-card-${APPROVAL}`);
  await expect(card).toBeVisible();
  await expect(page.getByTestId(`sending-draft-${APPROVAL}`)).toHaveText(DRAFT);
  await expect(page.getByTestId(`sending-remaining-${APPROVAL}`)).toHaveText(
    TODAY.sendingRemaining(1, 1),
  );

  // The customer whose capture sold nothing is not on the list (A203).
  await expect(page.getByTestId(`sending-row-${APPROVAL}-${NOBODY}`)).toHaveCount(0);

  // A prefilled WhatsApp link, for the Owner to tap. Nothing is sent by us.
  const link = page.getByTestId(`sending-open-${APPROVAL}-${ASHA}`);
  const href = await link.getAttribute("href");
  expect(href).toContain("https://wa.me/919000031111");
  expect(href).toContain(encodeURIComponent("Half the batch is paid for"));

  await page.getByTestId(`sending-tick-${APPROVAL}-${ASHA}`).click();

  // Ticked, the list closes itself, and the card leaves Today.
  await expect(card).toHaveCount(0);

  const approval = await readDocument(`approvals/${APPROVAL}`);
  const rows = approval?.recipients as Array<Record<string, unknown>>;
  expect(rows[0]?.phone).toBe(ASHA);
  expect(rows[0]?.sentAt).not.toBeNull();
  expect(approval?.closedAt).not.toBeNull();
  // The one line that matters: nothing here claims a machine sent it.
  expect(approval?.sentAt).toBeNull();
});

test("the Kitchen sees the list and none of its controls, brief §17.12", async ({ page }) => {
  await seedApproved();
  await waitForList();

  await signIn(page, KITCHEN_PHONE);
  await expect(page.getByTestId(`sending-card-${APPROVAL}`)).toBeVisible();
  await expect(page.getByTestId(`sending-tick-${APPROVAL}-${ASHA}`)).toHaveCount(0);
  await expect(page.getByTestId(`sending-close-${APPROVAL}`)).toHaveCount(0);
  await expect(page.getByTestId(`sending-owner-only-${APPROVAL}`)).toBeVisible();
});

test("the Owner can close a list he has not finished", async ({ page }) => {
  await seedApproved();
  await waitForList();

  await signIn(page, OWNER_PHONE);
  await page.getByTestId(`sending-close-${APPROVAL}`).click();
  await expect(page.getByTestId(`sending-card-${APPROVAL}`)).toHaveCount(0);

  const approval = await readDocument(`approvals/${APPROVAL}`);
  expect(approval?.closedAt).not.toBeNull();
  // Closed without being sent: the row is still untouched, honestly.
  const rows = approval?.recipients as Array<Record<string, unknown>>;
  expect(rows[0]?.sentAt).toBeNull();
  expect(approval?.sentAt).toBeNull();
});
