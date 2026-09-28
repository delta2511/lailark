import { expect, test, type Page } from "@playwright/test";

/**
 * M4.5: recording a refund from the order screen, brief §12.3, decisions D31
 * and D65.
 *
 * Signed in as the **Owner**, against the real `recordRefund` and
 * `markOrderRefusal` callables and the real Firestore rules, because both are
 * Owner-only and money moves. The Kitchen half of that is tested where it is
 * enforced, which is the server (`functions/test/refunds.test.ts`): a screen
 * with no button on it proves nothing.
 *
 * The hold-to-confirm button is held with a real mouse press, because that is
 * the thing being tested. A click does nothing at all, which is the point
 * (brief §17.1: the only "are you sure" in this app is a hold, for an action
 * that leaves the system).
 */
import {
  KITCHEN_PHONE,
  OWNER_PHONE,
  OTP,
  VIEWER_PHONE,
  acceptFixedOtp,
  deleteAuditFor,
  deleteDocument,
  ensureAdminUser,
  readDocument,
  seedBatch,
  seedOrder,
} from "./emulator";

const BATCH_REF = "b-450045";
/**
 * A real order reference shape (`functions/src/orders/store.ts`'s `isOrderRef`:
 * `o-` and six of the reference alphabet), because `recordRefund` refuses
 * anything else before it opens its transaction.
 */
const ORDER_REF = "o-450045";
const PRICE = 64_900;

/** Longer than `HOLD_MS` (1200ms), with room for a slow machine. */
const HOLD_FOR_MS = 1_700;

const ORDER_LINE = {
  productSlug: "prawns-and-dates",
  batchRef: BATCH_REF,
  qty: 1,
  unitPrice: PRICE,
  customDescription: null,
  jarNumbers: [] as number[],
};

async function seedFixture(): Promise<void> {
  await seedBatch(BATCH_REF, {
    productSlug: "prawns-and-dates",
    productName: "Prawns and dates",
    state: "inStock",
    plannedJars: 22,
    bookableJars: 19,
    bottledJars: 22,
    paidCount: 1,
    jarsAssigned: 0,
  });
  await seedOrder(ORDER_REF, {
    // A real order's `number` is its own reference (A90), and `documents` are
    // found by it, so the fixture uses the same value the server would.
    number: ORDER_REF,
    channel: "counter",
    customerPhone: "+919000004512",
    // Paid, not packed: brief §12.3's "jar returns to the count if not packed".
    state: "readyForCollection",
    fulfilment: "collect",
    total: PRICE,
    batchRefs: [BATCH_REF],
    lines: [ORDER_LINE],
    paidAt: { __ts: new Date().toISOString() },
    payment: {
      method: "cash",
      status: "captured",
      razorpayIds: {},
      markedPaidBy: "seed",
      upiRef: null,
      amount: PRICE,
      refundedAmount: 0,
    },
    deliveryContact: {
      name: "Nisha Varma",
      phone: "+919000004512",
      lines: ["7 Temple Road"],
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673005",
    },
  });
}

async function cleanUpFixture(): Promise<void> {
  await deleteDocument(`orders/${ORDER_REF}`);
  await deleteDocument(`batches/${BATCH_REF}`);
  await deleteAuditFor(`orders/${ORDER_REF}`);
  await deleteAuditFor(`batches/${BATCH_REF}`);
  for (const id of [`cash-${ORDER_REF}-1`, `cash-${ORDER_REF}-2`, "upi-UPIM45SPEC"]) {
    await deleteDocument(`refunds/${id}`);
  }
}

test.beforeEach(async ({ page }) => {
  await ensureAdminUser(OWNER_PHONE, "owner");
  await ensureAdminUser(KITCHEN_PHONE, "kitchen");
  await ensureAdminUser(VIEWER_PHONE, "viewer");
  await acceptFixedOtp(page);
  await seedFixture();
});

test.afterEach(async () => {
  await cleanUpFixture();
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Six digit code").fill(OTP);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

async function openOrder(page: Page): Promise<void> {
  await page.getByTestId("tab-orders").click();
  await page.getByTestId("orders-tab-readyForCollection").click();
  await page.getByTestId(`order-row-${ORDER_REF}`).click();
  await expect(page.getByTestId("order-detail")).toBeVisible();
}

/**
 * Presses and holds the record button long enough for it to fire.
 *
 * `hover()` rather than `mouse.move` to a bounding box: the refund panel is
 * near the bottom of a long detail page, and `boundingBox` reports coordinates
 * relative to the viewport whether or not the element is inside it, so pressing
 * at those coordinates without scrolling first presses empty space.
 */
async function holdToRecord(page: Page): Promise<void> {
  const button = page.getByTestId("order-refund-submit");
  await button.hover();
  await page.mouse.down();
  await expect(button).toHaveAttribute("data-holding", "yes");
  await page.waitForTimeout(HOLD_FOR_MS);
  await page.mouse.up();
  // No assertion on the button afterwards: a full refund replaces the form with
  // "the whole payment has been returned", so the button is gone by then. The
  // "no" side of this is asserted in the tap test, where nothing unmounts.
}

test("the Owner records a cash refund, the jar goes back and a document is issued (M4.5 done-when)", async ({
  page,
}) => {
  await signIn(page, OWNER_PHONE);
  await openOrder(page);

  await expect(page.getByTestId("order-refund-section")).toBeVisible();
  await expect(page.getByTestId("order-refund-paid")).toContainText("649");
  await expect(page.getByTestId("order-refunds-none")).toBeVisible();

  await page.getByTestId("order-refund-method").selectOption("cash");
  await page.getByTestId("order-refund-amount").fill("649");
  await page.getByTestId("order-refund-note").fill("Changed their mind at the door");

  await holdToRecord(page);

  // The order is refunded, the money is on it, and the panel says the jar is
  // back on sale.
  await expect(page.getByTestId("order-detail-group")).toHaveText("Refunded");
  await expect(page.getByTestId("order-refund-done")).toContainText("back on sale");
  await expect(page.getByTestId("order-payment-status")).toHaveText("Refunded");
  await expect(page.getByTestId("order-refund-returned")).toContainText("649");
  await expect(page.getByTestId("order-refund-nothing-left")).toBeVisible();

  // The refund is recorded and its document exists, which is the done-when.
  await expect(page.getByTestId(`order-refund-cash-${ORDER_REF}-1`)).toBeVisible();
  // Brief §13.1: this order carries no bill, so the document is a refund note.
  const documents = page.getByTestId("order-documents-list");
  await expect(documents).toContainText("refundNote");

  // And the count really moved, read straight off Firestore rather than off the
  // screen: the jar came back in the same commit as the refund.
  const batch = await readDocument(`batches/${BATCH_REF}`);
  expect(batch?.paidCount).toBe(0);
  const order = await readDocument(`orders/${ORDER_REF}`);
  expect((order?.refund as Record<string, unknown>).fullyRefunded).toBe(true);
  expect((order?.refund as Record<string, unknown>).jarsReturned).toBe(1);
});

test("a tap does nothing: only a hold records the refund", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrder(page);

  await page.getByTestId("order-refund-method").selectOption("cash");
  await page.getByTestId("order-refund-amount").fill("649");
  await page.getByTestId("order-refund-note").fill("a slip of the thumb");

  // A plain click, and then a press released well before the hold completes.
  const button = page.getByTestId("order-refund-submit");
  await button.click();
  await button.hover();
  await page.mouse.down();
  // The fill has started, so the press really did land on the button.
  await expect(button).toHaveAttribute("data-holding", "yes");
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(button).toHaveAttribute("data-holding", "no");

  // Nothing happened: no refund, no document, no count moved.
  await expect(page.getByTestId("order-refund-done")).toHaveCount(0);
  await expect(page.getByTestId("order-refunds-none")).toBeVisible();
  await expect(page.getByTestId("order-detail-group")).toHaveText("Ready for collection");
  const batch = await readDocument(`batches/${BATCH_REF}`);
  expect(batch?.paidCount).toBe(1);
});

test("a partial refund records the money and leaves the jar where it is", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrder(page);

  await page.getByTestId("order-refund-method").selectOption("cash");
  await page.getByTestId("order-refund-amount").fill("200");
  await page.getByTestId("order-refund-note").fill("something for the broken lid");
  await holdToRecord(page);

  await expect(page.getByTestId("order-refund-done")).toContainText("No jar went back");
  await expect(page.getByTestId("order-payment-status")).toHaveText("Partly refunded");
  await expect(page.getByTestId("order-refund-left")).toContainText("449");
  // Still to be collected, because the customer is still owed the jar.
  await expect(page.getByTestId("order-detail-group")).toHaveText("Ready for collection");
  const batch = await readDocument(`batches/${BATCH_REF}`);
  expect(batch?.paidCount).toBe(1);
});

test("D65: a refusal mark can be set with the refund, taken off, and put back", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrder(page);

  await page.getByTestId("order-refund-method").selectOption("cash");
  await page.getByTestId("order-refund-amount").fill("649");
  await page.getByTestId("order-refund-note").fill("sent it back");
  await page.getByTestId("order-refund-refusal-reason").fill("Abusive on the phone");
  await holdToRecord(page);

  await expect(page.getByTestId("order-refusal-state")).toContainText("stays spent");
  // The jar still goes back: refusing a person is not a reason to lose a jar.
  const batch = await readDocument(`batches/${BATCH_REF}`);
  expect(batch?.paidCount).toBe(0);

  // Off again, because a mark made in error must not follow a customer.
  await page.getByTestId("order-refusal-clear").click();
  await expect(page.getByTestId("order-refusal-state")).toContainText("may buy from the batch again");

  // And back on, afterwards, which is the second half of D65.
  await page.getByTestId("order-refusal-reason").fill("Understood later");
  await page.getByTestId("order-refusal-save").click();
  await expect(page.getByTestId("order-refusal-state")).toContainText("stays spent");
});

test("the server's own refusal is shown, and nothing is recorded", async ({ page }) => {
  await signIn(page, OWNER_PHONE);
  await openOrder(page);

  // More than was paid. The panel has no client-side ceiling on purpose: the
  // amount is checked against what really arrived, inside the transaction.
  await page.getByTestId("order-refund-method").selectOption("cash");
  await page.getByTestId("order-refund-amount").fill("700");
  await page.getByTestId("order-refund-note").fill("too much");
  await holdToRecord(page);

  await expect(page.getByTestId("order-refund-error")).toContainText("Only");
  await expect(page.getByTestId("order-refunds-none")).toBeVisible();
  const batch = await readDocument(`batches/${BATCH_REF}`);
  expect(batch?.paidCount).toBe(1);
});

test("draws no console error while recording a refund", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await signIn(page, OWNER_PHONE);
  await openOrder(page);
  await page.getByTestId("order-refund-method").selectOption("cash");
  await page.getByTestId("order-refund-amount").fill("649");
  await page.getByTestId("order-refund-note").fill("no console noise please");
  await holdToRecord(page);
  await expect(page.getByTestId("order-refund-done")).toBeVisible();

  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
});

/**
 * Money moves, so `recordRefund` and `markOrderRefusal` refuse both of these at
 * the server too (`functions/test/refunds.test.ts`), which is where it counts.
 * This is the other half: neither role is shown a button it cannot use, and
 * neither sees the refusal mark that decides a customer's allowance. One test
 * per role rather than a loop, so each gets its own signed-in context.
 */
for (const [role, phone] of [
  ["Kitchen", KITCHEN_PHONE],
  ["a Viewer", VIEWER_PHONE],
] as const) {
  test(`the refund panel is the Owner's alone: ${role} never sees it`, async ({ page }) => {
    await signIn(page, phone);
    await openOrder(page);

    await expect(page.getByTestId("order-refund-section")).toHaveCount(0);
    await expect(page.getByTestId("order-refund-submit")).toHaveCount(0);
    await expect(page.getByTestId("order-refusal-form")).toHaveCount(0);
    // The rest of the order is still theirs to read, so this is the panel being
    // absent rather than the screen failing to load.
    await expect(page.getByTestId("order-payment-amount")).toContainText("649");
  });
}
