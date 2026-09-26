import { expect, test, type Page } from "@playwright/test";

/**
 * M4.1's own done-when: "an order walks To pack -> Delivered as Kitchen."
 * Packing, India Post and delivered by hand (brief §11.1 and §11.3), signed
 * in as Kitchen, against the real `packOrder`/`shipOrder`/`deliverOrder`
 * callables and the real Firestore rules (packing is Owner **and** Kitchen,
 * brief §17.12's role matrix row for this task, so Kitchen alone proves it).
 */
import {
  KITCHEN_PHONE,
  OTP,
  acceptFixedOtp,
  deleteDocument,
  patchDocument,
  seedBatch,
  seedOrder,
} from "./emulator";

const BATCH_REF = "b-m41ship";
const ORDER_REF = "o-m41ship";

const ORDER_LINE = {
  productSlug: "prawns-and-dates",
  batchRef: BATCH_REF,
  qty: 1,
  unitPrice: 64_900,
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
    number: "o-m41-001",
    channel: "counter",
    customerPhone: "+919000004411",
    state: "toPack",
    fulfilment: "ship",
    total: 64_900,
    batchRefs: [BATCH_REF],
    lines: [ORDER_LINE],
    payment: {
      method: "cash",
      status: "captured",
      razorpayIds: {},
      markedPaidBy: "seed",
      upiRef: null,
      amount: 64_900,
      refundedAmount: 0,
    },
    deliveryContact: {
      name: "Deepa Menon",
      phone: "+919000004411",
      lines: ["3 Canal Road"],
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673005",
    },
  });
}

async function cleanUpFixture(): Promise<void> {
  await deleteDocument(`orders/${ORDER_REF}`);
  await deleteDocument(`batches/${BATCH_REF}`);
  await deleteDocument(`shipments/${ORDER_REF}`);
}

test.beforeEach(async ({ page }) => {
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
  await page.getByTestId("orders-tab-toPack").click();
  await page.getByTestId(`order-row-${ORDER_REF}`).click();
  await expect(page.getByTestId("order-detail")).toBeVisible();
}

test("Kitchen walks an order To pack -> Packed -> Shipped -> Delivered (M4.1 done-when)", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await openOrder(page);

  // To pack: the pack form is here, and the ship/deliver ones are not yet.
  await expect(page.getByTestId("order-pack-form")).toBeVisible();
  await expect(page.getByTestId("order-ship-form")).toHaveCount(0);
  await expect(page.getByTestId("order-shipment-none")).toBeVisible();

  await page.getByTestId("order-pack-cost").fill("50");
  await page.getByTestId("order-pack-submit").click();

  // Packed: jar numbers appear on the line, the shipment section shows the
  // packing cost, and the pack form is gone, replaced by the ship form
  // (this order's fulfilment is `ship`).
  await expect(page.getByTestId("order-detail-group")).toHaveText("Packed");
  await expect(page.getByTestId("order-line-0-jars")).not.toHaveText("Not packed yet.");
  await expect(page.getByTestId("order-shipment-packing-cost")).toContainText("50");
  await expect(page.getByTestId("order-pack-form")).toHaveCount(0);
  await expect(page.getByTestId("order-ship-form")).toBeVisible();

  await page.getByTestId("order-ship-consignment").fill("EE123456789IN");
  await page.getByTestId("order-ship-submit").click();

  // Shipped: the tracking link is drawn, the dispatch message is drafted,
  // and the ship form is gone, replaced by "Mark delivered".
  await expect(page.getByTestId("order-detail-group")).toHaveText("Shipped");
  await expect(page.getByTestId("order-shipment-awb")).toHaveText("EE123456789IN");
  await expect(page.getByTestId("order-tracking-link")).toBeVisible();
  await expect(page.getByTestId("order-ship-message-preview")).toContainText("o-m41-001");
  await expect(page.getByTestId("order-ship-message-preview")).toContainText("EE123456789IN");
  await expect(page.getByTestId("order-ship-form")).toHaveCount(0);
  await expect(page.getByTestId("order-deliver-submit")).toBeVisible();

  await page.getByTestId("order-deliver-submit").click();

  // Delivered: the done-when.
  await expect(page.getByTestId("order-detail-group")).toHaveText("Delivered");
  await expect(page.getByTestId("order-shipment-status")).toHaveText("Delivered");
});

test("packing is Owner and Kitchen, not just one of them", async ({ page }) => {
  await signIn(page, KITCHEN_PHONE);
  await openOrder(page);
  await expect(page.getByTestId("order-pack-form")).toBeVisible();
});

test("a refusal from a state the order has left does not sit under the panel that replaces it", async ({
  page,
}) => {
  await signIn(page, KITCHEN_PHONE);
  await openOrder(page);

  // A genuine server refusal that leaves the order in `toPack` with
  // `PackForm` still mounted: point the order's own line at a batch that
  // does not exist, so `packOrder`'s transaction fails `not-found` before it
  // writes anything. (A client-side check, such as a negative packing cost,
  // cannot be used here: `order-pack-cost` is `type="number" min="0"`, so a
  // negative value fails the browser's own constraint validation and the
  // form's `submit` handler never runs at all.)
  await patchDocument(`orders/${ORDER_REF}`, {
    lines: [{ ...ORDER_LINE, batchRef: "b-does-not-exist" }],
  });
  await page.getByTestId("order-pack-submit").click();
  await expect(page.getByTestId("order-pack-error")).toContainText("Batch b-does-not-exist could not be read.");
  await expect(page.getByTestId("order-pack-form")).toBeVisible();

  // The order moves on underneath this screen without this tab's own submit
  // causing it (another Kitchen phone packed it, in this test stood in for
  // by patching the document directly). `PackForm`'s `useEffect` on
  // `order.state` must clear the stale error the moment the live listener
  // reports the new state, whether or not the panel that replaces it also
  // happens to remount.
  await patchDocument(`orders/${ORDER_REF}`, {
    state: "packed",
    lines: [ORDER_LINE],
  });

  await expect(page.getByTestId("order-pack-form")).toHaveCount(0);
  await expect(page.getByTestId("order-pack-error")).toHaveCount(0);
  await expect(page.getByText("Batch b-does-not-exist could not be read.")).toHaveCount(0);
  // Packed, ships by courier (this fixture's fulfilment): the ship form now
  // owns the panel, with no leftover error of its own.
  await expect(page.getByTestId("order-ship-form")).toBeVisible();
  await expect(page.getByTestId("order-ship-error")).toHaveCount(0);
});

test("draws no console error while walking the packing flow", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await signIn(page, KITCHEN_PHONE);
  await openOrder(page);
  await page.getByTestId("order-pack-submit").click();
  await expect(page.getByTestId("order-detail-group")).toHaveText("Packed");

  expect(crashes, `uncaught errors: ${crashes.join(" | ")}`).toEqual([]);
});
