import { expect, test, type Page } from "@playwright/test";

import { BATCHES, COPY, TODAY } from "../src/copy";
import {
  KITCHEN_PHONE,
  OTP,
  OWNER_PHONE,
  VIEWER_PHONE,
  acceptFixedOtp,
  callCallable,
  deleteDocument,
  ensureAdminUser,
  idTokenFor,
  readDocument,
  seedApproval,
  seedBatch,
  seedDocument,
  timestampValue,
} from "./emulator";

/**
 * M2.5: Today's "Waiting on you" and its Clocks.
 *
 * The done-when, first test below: a half-reached batch shows on Today, and
 * pressing yes moves it to Sourcing with the message recorded as approved and
 * unsent. Every answer here goes through the real callables over the
 * functions emulator, exactly as the app calls them, and every assertion
 * about what was recorded is read back out of Firestore with admin rights
 * rather than off the screen.
 *
 * The line every test is really guarding: **nothing is sent.** `sentAt` is
 * null before the yes and null after it. Sending arrives in M5.
 */

const PRODUCT = "m25-prawns-pickle";
const RECIPE = "m25-recipe";

const REF_HALF = "b-m25haf";
const REF_EDIT = "b-m25edt";
const REF_NOTYET = "b-m25nty";
const REF_ROLES = "b-m25rze";
const REF_PHOTO = "b-m25pht";
const REF_FULL = "b-m25fwz";

const ALL_REFS = [REF_HALF, REF_EDIT, REF_NOTYET, REF_ROLES, REF_PHOTO, REF_FULL];
const ALL_APPROVALS = [
  `half-${REF_HALF}`,
  `half-${REF_NOTYET}`,
  `half-${REF_ROLES}`,
  `half-${REF_FULL}`,
  `full-${REF_FULL}`,
  `open-${REF_EDIT}`,
  `photo-${REF_PHOTO}-u1`,
];

const HALF_DRAFT = "Half the batch is paid for. We are arranging the prawns now.";
const OPEN_DRAFT = "A batch of M25 Prawns Pickle is open for booking at ₹599.";

/** A batch that has reached half and is waiting on the Owner. */
async function seedHalfReached(ref: string): Promise<void> {
  await seedBatch(ref, {
    productSlug: PRODUCT,
    productName: "M25 Prawns Pickle",
    mainIngredientName: "M25 Prawns",
    recipeId: RECIPE,
    state: "halfReached",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
    halfReachedAt: timestampValue(),
  });
}

test.beforeEach(async ({ page }) => {
  await acceptFixedOtp(page);
  await seedDocument(`products/${PRODUCT}`, {
    name: "M25 Prawns Pickle",
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
});

test.afterEach(async () => {
  for (const id of ALL_APPROVALS) await deleteDocument(`approvals/${id}`);
  for (const ref of ALL_REFS) {
    await deleteDocument(`batches/${ref}/updates/u1`);
    await deleteDocument(`batches/${ref}`);
  }
  await deleteDocument(`products/${PRODUCT}`);
});

async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(COPY.phoneLabel).fill(phone);
  await page.getByRole("button", { name: COPY.sendCode }).click();
  await page.getByLabel(COPY.codeLabel).fill(OTP);
  await page.getByRole("button", { name: COPY.verify }).click();
  await expect(page.getByTestId("screen-today")).toBeVisible();
}

/* -------------------------------------------------------------------------- */
/* The done-when                                                              */
/* -------------------------------------------------------------------------- */

test("a half-reached batch shows on Today, and yes moves it to Sourcing with the message recorded as sent-pending", async ({
  page,
}) => {
  const dueAt = new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000).toISOString();
  await seedHalfReached(REF_HALF);
  await seedApproval(`half-${REF_HALF}`, {
    kind: "halfReached",
    batchRef: REF_HALF,
    draft: HALF_DRAFT,
    status: "waiting",
    dueAt: timestampValue(dueAt),
  });

  await signIn(page, OWNER_PHONE);

  // It is on Today, under "Waiting on you", with its batch, what it asks, and
  // the message that would go out.
  const card = page.getByTestId(`approval-card-half-${REF_HALF}`);
  await expect(card).toBeVisible();
  await expect(page.getByTestId(`approval-batch-half-${REF_HALF}`)).toContainText("M25 Prawns Pickle");
  await expect(page.getByTestId(`approval-ask-half-${REF_HALF}`)).toHaveText(
    TODAY.askHalfReached(10, 19),
  );
  await expect(page.getByTestId(`approval-draft-half-${REF_HALF}`)).toHaveText(HALF_DRAFT);

  // The clock the server started, read off the approval and not recomputed.
  await expect(page.getByTestId(`clock-row-${REF_HALF}`)).toBeVisible();
  await expect(page.getByTestId(`clock-kind-${REF_HALF}`)).toHaveText(TODAY.clockHalf);
  await expect(page.getByTestId(`clock-left-${REF_HALF}`)).toHaveText(BATCHES.clockDays(5));

  await page.getByTestId(`approval-yes-half-${REF_HALF}`).click();

  // The card leaves Today: it is answered.
  await expect(card).toHaveCount(0);

  // The batch moved, through `transitionBatch`, which is the one door.
  await expect
    .poll(async () => (await readDocument(`batches/${REF_HALF}`))?.state)
    .toBe("sourcing");
  const batch = await readDocument(`batches/${REF_HALF}`);
  expect(batch?.halfApprovedAt).not.toBeNull();

  // And the message is recorded as approved, pending send. Nothing went out.
  const approval = await readDocument(`approvals/half-${REF_HALF}`);
  expect(approval?.status).toBe("approved");
  expect(approval?.draft).toBe(HALF_DRAFT);
  expect(approval?.answeredBy).toBeTruthy();
  expect(approval?.at).not.toBeNull();
  expect(approval?.sentAt).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* Not yet, with a reason                                                     */
/* -------------------------------------------------------------------------- */

test("not yet with a reason records the reason and leaves the batch where it is", async ({
  page,
}) => {
  await seedHalfReached(REF_NOTYET);
  await seedApproval(`half-${REF_NOTYET}`, {
    kind: "halfReached",
    batchRef: REF_NOTYET,
    draft: HALF_DRAFT,
    status: "waiting",
    dueAt: timestampValue(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()),
  });

  await signIn(page, OWNER_PHONE);

  await page.getByTestId(`approval-not-yet-half-${REF_NOTYET}`).click();
  // A reason is not optional: tomorrow's card has to make sense.
  await page.getByTestId(`approval-confirm-not-yet-half-${REF_NOTYET}`).click();
  await expect(page.getByTestId(`approval-error-half-${REF_NOTYET}`)).toHaveText(
    TODAY.reasonRequired,
  );

  await page.getByTestId(`approval-reason-half-${REF_NOTYET}`).fill("no prawns at Beypore this week");
  await page.getByTestId(`approval-confirm-not-yet-half-${REF_NOTYET}`).click();

  // The card is put off until the morning, so it leaves Today.
  await expect(page.getByTestId(`approval-card-half-${REF_NOTYET}`)).toHaveCount(0);

  const approval = await readDocument(`approvals/half-${REF_NOTYET}`);
  expect(approval?.status).toBe("notYet");
  expect(approval?.reason).toBe("no prawns at Beypore this week");
  expect(approval?.remindAt).not.toBeNull();
  expect(approval?.sentAt).toBeNull();

  // Nothing moved, and the clock is still counting: the commitment stands.
  const batch = await readDocument(`batches/${REF_NOTYET}`);
  expect(batch?.state).toBe("halfReached");
  expect(batch?.halfApprovedAt).toBeNull();
  await expect(page.getByTestId(`clock-row-${REF_NOTYET}`)).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* Edit then yes                                                              */
/* -------------------------------------------------------------------------- */

test("edit then yes records the edited text, not the draft", async ({ page }) => {
  await seedBatch(REF_EDIT, {
    productSlug: PRODUCT,
    productName: "M25 Prawns Pickle",
    recipeId: RECIPE,
    state: "open",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
  });
  await seedApproval(`open-${REF_EDIT}`, {
    kind: "broadcast",
    batchRef: REF_EDIT,
    draft: OPEN_DRAFT,
    status: "waiting",
  });

  await signIn(page, OWNER_PHONE);

  await expect(page.getByTestId(`approval-ask-open-${REF_EDIT}`)).toHaveText(TODAY.askBatchOpen);
  await page.getByTestId(`approval-edit-open-${REF_EDIT}`).click();

  // The box opens on the draft, so an edit is a change to what he read.
  const box = page.getByTestId(`approval-message-open-${REF_EDIT}`);
  await expect(box).toHaveValue(OPEN_DRAFT);
  await box.fill("A batch of prawns pickle is open at ₹599. We cook a small number of jars.");
  await page.getByTestId(`approval-confirm-edit-open-${REF_EDIT}`).click();

  await expect(page.getByTestId(`approval-card-open-${REF_EDIT}`)).toHaveCount(0);

  const approval = await readDocument(`approvals/open-${REF_EDIT}`);
  expect(approval?.status).toBe("edited");
  expect(approval?.draft).toBe(
    "A batch of prawns pickle is open at ₹599. We cook a small number of jars.",
  );
  expect(approval?.sentAt).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* Owner only, and not because the button is hidden                           */
/* -------------------------------------------------------------------------- */

test("Kitchen and Viewer see no answer controls, and the server refuses them", async ({ page }) => {
  await ensureAdminUser(VIEWER_PHONE, "viewer");
  await seedHalfReached(REF_ROLES);
  await seedApproval(`half-${REF_ROLES}`, {
    kind: "halfReached",
    batchRef: REF_ROLES,
    draft: HALF_DRAFT,
    status: "waiting",
  });

  await signIn(page, KITCHEN_PHONE);

  // The Kitchen sees what is waiting on Shefin, and cannot answer it.
  await expect(page.getByTestId(`approval-card-half-${REF_ROLES}`)).toBeVisible();
  await expect(page.getByTestId(`approval-owner-only-half-${REF_ROLES}`)).toHaveText(TODAY.ownerOnly);
  await expect(page.getByTestId(`approval-yes-half-${REF_ROLES}`)).toHaveCount(0);
  await expect(page.getByTestId(`approval-not-yet-half-${REF_ROLES}`)).toHaveCount(0);
  await expect(page.getByTestId(`approval-edit-half-${REF_ROLES}`)).toHaveCount(0);

  // The screen is a courtesy. This is the enforcement: the same calls, made
  // directly with each role's own ID token, over the functions emulator.
  for (const phone of [KITCHEN_PHONE, VIEWER_PHONE]) {
    const token = await idTokenFor(phone);

    const notYet = await callCallable("answerApproval", token, {
      id: `half-${REF_ROLES}`,
      answer: "notYet",
      data: { reason: "not mine to answer" },
    });
    expect(notYet.error?.status, `answerApproval notYet as ${phone}`).toBe("PERMISSION_DENIED");

    const yes = await callCallable("answerApproval", token, {
      id: `half-${REF_ROLES}`,
      answer: "yes",
      data: {},
    });
    expect(yes.error?.status, `answerApproval yes as ${phone}`).toBe("PERMISSION_DENIED");

    // And the door the half-reached yes actually goes through.
    const transition = await callCallable("transitionBatch", token, {
      ref: REF_ROLES,
      to: "sourcing",
      data: {},
    });
    expect(transition.error?.status, `transitionBatch as ${phone}`).toBe("PERMISSION_DENIED");
  }

  // Nothing was recorded and nothing moved.
  const approval = await readDocument(`approvals/half-${REF_ROLES}`);
  expect(approval?.status).toBe("waiting");
  expect(approval?.answeredBy).toBeNull();
  expect((await readDocument(`batches/${REF_ROLES}`))?.state).toBe("halfReached");
});

/* -------------------------------------------------------------------------- */
/* An approval with no message, and the full clock                            */
/* -------------------------------------------------------------------------- */

test("a photo update with no message has no edit, and a full batch shows the 3 day clock overdue", async ({
  page,
}) => {
  // A kitchen photo with no line on it (D5): there is still something to say
  // yes to, and nothing at all to rewrite.
  await seedBatch(REF_PHOTO, {
    productSlug: PRODUCT,
    productName: "M25 Prawns Pickle",
    recipeId: RECIPE,
    state: "sourcing",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 10,
  });
  await seedDocument(`batches/${REF_PHOTO}/updates/u1`, {
    photoPath: `batches/${REF_PHOTO}/u1.jpg`,
    kitchenLine: "",
    messageText: "",
    approvedBy: null,
    sentAt: null,
    createdBy: "seed",
  });
  await seedApproval(`photo-${REF_PHOTO}-u1`, {
    kind: "photoUpdate",
    batchRef: REF_PHOTO,
    updateId: "u1",
    draft: "",
    status: "waiting",
  });

  // A batch that filled up, whose 3 day clock has run out (A61: the full
  // approval carries the live clock, the half one's was superseded).
  await seedBatch(REF_FULL, {
    productSlug: `${PRODUCT}-2`,
    productName: "M25 Prawns Pickle",
    recipeId: RECIPE,
    state: "halfReached",
    plannedJars: 22,
    bookableJars: 19,
    perPersonLimit: 4,
    paidCount: 19,
    halfReachedAt: timestampValue(),
    fullReachedAt: timestampValue(),
  });
  await seedApproval(`half-${REF_FULL}`, {
    kind: "halfReached",
    batchRef: REF_FULL,
    draft: HALF_DRAFT,
    status: "waiting",
    dueAt: null,
    dueAtSupersededBy: `full-${REF_FULL}`,
  });
  await seedApproval(`full-${REF_FULL}`, {
    kind: "full",
    batchRef: REF_FULL,
    draft: "The batch is full.",
    status: "waiting",
    dueAt: timestampValue(new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()),
  });

  await signIn(page, OWNER_PHONE);

  // No message, so no edit affordance, but still a yes and a not yet.
  await expect(page.getByTestId(`approval-no-message-photo-${REF_PHOTO}-u1`)).toHaveText(
    TODAY.noMessage,
  );
  await expect(page.getByTestId(`approval-edit-photo-${REF_PHOTO}-u1`)).toHaveCount(0);
  await expect(page.getByTestId(`approval-yes-photo-${REF_PHOTO}-u1`)).toBeVisible();

  // Exactly one clock on the full batch, and it is the 3 day one, overdue.
  await expect(page.getByTestId(`clock-row-${REF_FULL}`)).toHaveCount(1);
  await expect(page.getByTestId(`clock-kind-${REF_FULL}`)).toHaveText(TODAY.clockFull);
  await expect(page.getByTestId(`clock-left-${REF_FULL}`)).toHaveText(BATCHES.clockOverdue);

  // The Owner says yes to the photo. The update itself is stamped approved,
  // and still unsent (D5).
  await page.getByTestId(`approval-yes-photo-${REF_PHOTO}-u1`).click();
  await expect(page.getByTestId(`approval-card-photo-${REF_PHOTO}-u1`)).toHaveCount(0);

  const approval = await readDocument(`approvals/photo-${REF_PHOTO}-u1`);
  expect(approval?.status).toBe("approved");
  expect(approval?.sentAt).toBeNull();

  const update = await readDocument(`batches/${REF_PHOTO}/updates/u1`);
  expect(update?.approvedBy).toBeTruthy();
  expect(update?.sentAt).toBeNull();
});
