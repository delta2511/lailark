/**
 * The batch transition table of brief section 8.2, with no Firebase in it.
 *
 * Every decision the `transitionBatch` callable makes lives here: which row of
 * the table a request is, who may call that row, which inputs it asks for,
 * what the system computes, and what it flags for the Owner. The callable
 * does the Firestore work; this module decides what that work is, so the
 * whole table is unit-testable without an emulator. Same shape as
 * `auth/authorise.ts`.
 *
 * The arithmetic is never done here by hand: bookable, half, the per-person
 * limit, best before, the sale stop and the surplus all come from
 * `@lailark/shared`, so the site, the admin and the server cannot disagree
 * about what a number means.
 */

import {
  batchMaths,
  BATCH_STATES,
  BATCH_STATES_PAUSABLE,
  type BatchState,
  batchLabel,
  batchLabelCapitalised,
  bestBefore,
  bookableJars,
  customerMessage,
  formatCalDate,
  formatINR,
  FULL_CLOCK_DAYS,
  HALF_CLOCK_DAYS,
  halfOfBookable,
  inStockAvailability,
  ingredientInSentence,
  isBatchRef,
  checkCustomerText,
  isPaise,
  isProtectedBatchField,
  MRP_PAISE,
  type MessagesSettings,
  parseCalDate,
  perPersonLimit as perPersonLimitOf,
  productWordsFromSlug,
  ROLES,
  type Role,
  saleStopOn,
  surplusJars,
} from "@lailark/shared";

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** The subset of HttpsError codes this callable ever raises. */
export type ErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "failed-precondition"
  | "not-found";

export type Failure = { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/**
 * The "from" of the first row. A batch that does not exist yet has no state,
 * and `none -> draft` is the row that creates it. It does **not** allocate a
 * number: see the note on `ALLOCATES_BATCH_NO` below.
 */
export const NO_STATE = "none" as const;
export type TransitionFrom = BatchState | typeof NO_STATE;

/** Who a row of the table may be called by. `system` means a trigger, never a person. */
export type TransitionCaller = Role | "system";

export interface TransitionRow {
  readonly from: TransitionFrom;
  readonly to: BatchState;
  /** Section 8.2's "Who", as roles. `["system"]` is an automatic transition. */
  readonly callers: readonly TransitionCaller[];
  /** Section 8.2's "Button asks for": the inputs this row requires. */
  readonly requires: readonly string[];
  /** Inputs this row accepts but does not insist on. */
  readonly optional: readonly string[];
  /** Section 8.2's "System does", as the fields it writes. */
  readonly computes: readonly string[];
  /** What is raised for the Owner. Nothing here ever reaches a customer. */
  readonly flags: readonly string[];
  /**
   * Parts of section 8.2's "System does" for this row that a later milestone
   * owns, each naming that milestone. Listed rather than silently dropped, so
   * the gap between the table and the code is visible in the table itself.
   */
  readonly later?: readonly string[];
  /** One line for the admin, and for the report. */
  readonly note: string;
}

/**
 * Where the printed batch number is allocated. **Decision D21c.**
 *
 * ⚠ This diverges from brief §8.2 on purpose. §8.2's table puts "allocates the
 * batch number" on Draft -> Open, and §18.1 makes the number the document id
 * (`batches/{nnn}`). D21c overrides both. A batch now has two names:
 *
 *  - an **internal reference**, `b-7f3a2c`, which is the document id, is fixed
 *    from the moment the draft is created and never changes, so no order,
 *    concern, approval, audit entry or subcollection is ever re-pointed;
 *  - the **printed number**, the `batchNo` field, allocated here, at Cooking
 *    -> Bottled, inside the same transaction as the rest of that step.
 *
 * Allocating at bottling is what makes the number mean something: it sits
 * beside the label data, so a number always means jars that exist, and the
 * sequence can never have a hole, because a batch that is abandoned before
 * bottling never took a number to leave behind.
 *
 * Do not "fix" this back to §8.2. If you move this row, `/batch/<nnn>` starts
 * resolving to batches that were never cooked, and the printed sequence gets
 * gaps where drafts were abandoned.
 */
export const ALLOCATES_BATCH_NO = { from: "cooking", to: "bottled" } as const;

const PAUSABLE: readonly BatchState[] = BATCH_STATES_PAUSABLE;

/**
 * Brief section 8.2, row for row. `pause` and `resume` are generated from
 * `BATCH_STATES_PAUSABLE`, which decision D23 settled as Open, Half reached,
 * Sourcing, Cooking, In stock and Sold out, so the list is stated once.
 */
export const BATCH_TRANSITION_TABLE: readonly TransitionRow[] = [
  {
    from: NO_STATE,
    to: "draft",
    callers: ["owner"],
    requires: ["productSlug", "recipeId", "plannedJars", "priceOpen", "priceInStock"],
    optional: [],
    // D21c: no `batchNo` here. The draft gets its fixed internal reference as
    // its document id and stays unnumbered until it is bottled.
    computes: ["bookableJars", "perPersonLimit"],
    flags: [],
    note: "Creates the batch under a fixed internal reference. No number until it is bottled (D21c).",
  },
  {
    from: "draft",
    to: "open",
    callers: ["owner"],
    requires: [],
    optional: ["plannedJars", "priceOpen", "priceInStock", "limitPerPerson"],
    computes: ["bookableJars", "perPersonLimit"],
    flags: ["approval:broadcast"],
    // ⚠ Brief §8.2 puts "allocates the batch number" on this row and §8.4 shows
    // an open batch at `/batch/<nnn>` with live counts. Decision D21c moved
    // both: the number is stamped at bottling (see ALLOCATES_BATCH_NO), and an
    // open batch is booked and watched on its **product page**, because
    // `/batch/<nnn>` exists only from bottling and is always a record. Do not
    // put an allocation back on this row.
    note: "Publishes the card on the product page. The opted-in list is offered a message, which waits for the Owner.",
  },
  {
    from: "open",
    to: "halfReached",
    callers: ["system"],
    requires: [],
    optional: [],
    computes: ["halfReachedAt"],
    flags: ["approval:halfReached"],
    note: "Automatic at half of bookable. Starts the 5 day clock and asks the Owner.",
  },
  {
    from: "halfReached",
    to: "sourcing",
    callers: ["owner"],
    requires: [],
    optional: ["messageText"],
    computes: ["halfApprovedAt"],
    flags: ["approval:halfReached:answered"],
    note: "The Owner says yes. The half message is recorded as approved, pending send.",
  },
  {
    from: "sourcing",
    to: "cooking",
    callers: ["kitchen", "owner"],
    requires: ["landedOn", "source", "weightRaw", "costRaw"],
    optional: ["cookedOn"],
    // No `bookingClosed` field: booking closes by state alone. `cooking` is
    // not in BATCH_STATES_OPEN_FOR_BOOKING, so the card and the hold
    // transaction stop offering Rs 599 the moment this row is written, and a
    // flag that said the same thing could only ever disagree with the state.
    computes: ["landedOn", "source", "weightRaw", "cookedOn"],
    flags: ["line:main"],
    note: "Closes booking at Rs 599 (brief 7.5) and starts the batch timeline.",
  },
  {
    from: "cooking",
    to: "bottled",
    callers: ["kitchen", "owner"],
    requires: ["weightCleaned", "weightCooked", "jarCount", "packedOn"],
    optional: [],
    computes: [
      // D21c: the printed number is stamped here, from counters/batch, inside
      // this same transaction. It sits beside the label data, so a number
      // always means jars that exist.
      "batchNo",
      "weightCleaned",
      "weightCooked",
      "bottledJars",
      "packedOn",
      "bestBefore",
      "saleStopOn",
      "surplus",
    ],
    flags: ["concern:yieldShortfall"],
    later: [
      // Section 8.2's "Issues bills for open-batch orders". Bills need the
      // document series and the order, neither of which exists yet.
      "M2.9: issue bills for the open-batch orders of this batch",
      // Section 8.2's "Generates label data and the /batch/<nnn> page", which
      // D21c makes possible only from here: the number exists from this row on.
      "M5.6: generate the label data and publish the /batch/<nnn> page",
    ],
    note: "Stamps the printed batch number (D21c), computes best before, the shelf-life stop and the surplus. Raises a yield Concern if short.",
  },
  {
    from: "bottled",
    to: "inStock",
    callers: ["system"],
    requires: [],
    optional: [],
    computes: [],
    flags: ["approval:broadcast"],
    note: "Automatic when surplus > 0. The surplus goes on sale at Rs 649.",
  },
  {
    from: "bottled",
    to: "soldOut",
    callers: ["system"],
    requires: [],
    optional: [],
    computes: [],
    flags: [],
    note: "Automatic when the pot gave no surplus (decision A28).",
  },
  {
    from: "inStock",
    to: "soldOut",
    callers: ["system"],
    requires: [],
    optional: [],
    computes: [],
    flags: [],
    note: "Automatic when no jar is free. The card flips to the next batch or notify-me.",
  },
  {
    from: "soldOut",
    to: "archived",
    callers: ["system"],
    requires: [],
    optional: [],
    computes: [],
    flags: [],
    note: "Automatic once every order in the batch is closed. The P&L is locked by the state.",
  },
  // D23: pausable from Open, Half reached, Sourcing, Cooking, In stock and
  // Sold out. Draft is not on sale, so there is nothing to freeze; Archived is
  // closed with its P&L locked by the state. Neither is on PAUSABLE.
  ...PAUSABLE.map(
    (from): TransitionRow => ({
      from,
      to: "paused",
      callers: ["owner"],
      requires: ["reason"],
      optional: [],
      // `pausedFrom` is how resume knows where to go back to: the batch
      // remembers, rather than the Owner choosing again at resume time.
      computes: ["pausedReason", "pausedFrom"],
      flags: ["concern:batchPaused"],
      note: "Freezes sales. A Concern per paid customer. Customers hear nothing until the Owner answers.",
    }),
  ),
  ...PAUSABLE.map(
    (to): TransitionRow => ({
      from: "paused",
      to,
      callers: ["owner"],
      requires: [],
      optional: [],
      computes: ["pausedReason", "pausedFrom"],
      flags: [],
      note: "The Owner resumes the batch into the state it was paused from (D23).",
    }),
  ),
];

const ROW_BY_KEY = new Map<string, TransitionRow>(
  BATCH_TRANSITION_TABLE.map((row) => [`${row.from}->${row.to}`, row]),
);

export function transitionRow(from: TransitionFrom, to: string): TransitionRow | undefined {
  return ROW_BY_KEY.get(`${from}->${to}`);
}

/** Every row a trigger owns, so the callable can refuse them by name. */
export function isAutomatic(row: TransitionRow): boolean {
  return row.callers.length === 1 && row.callers[0] === "system";
}

/* -------------------------------------------------------------------------- */
/* What the callable is handed                                                */
/* -------------------------------------------------------------------------- */

export interface TransitionRequest {
  /**
   * The batch's internal reference, `"b-7f3a2c"`, which is its document id.
   * Absent only for the row that creates a batch. D21c: a batch is never
   * addressed by its printed number, because it has none until it is bottled
   * and the reference works at every point in its life.
   */
  readonly ref?: string;
  readonly to: BatchState;
  /** The row's inputs, unvalidated. Validated per row by `planTransition`. */
  readonly data: Readonly<Record<string, unknown>>;
}

/** The batch as the transaction read it. Plain values, no Firestore types. */
export interface BatchView {
  /** The document id: the fixed internal reference, `"b-7f3a2c"` (D21c). */
  readonly ref: string;
  /** The printed number, `"001"`, or null before bottling (D21c). */
  readonly batchNo: string | null;
  readonly state: string | undefined;
  readonly productSlug: string;
  /** `products/{slug}.name`, copied onto the batch when it was created. */
  readonly productName: string | null;
  readonly recipeId: string;
  /** The main ingredient's label name, for the half-reached message (D24). */
  readonly mainIngredientName: string | null;
  readonly plannedJars: number;
  readonly bookableJars: number;
  readonly perPersonLimit: number;
  readonly priceOpen: number;
  readonly priceInStock: number;
  readonly paidCount: number;
  readonly bottledJars: number;
  readonly writtenOff: number;
  readonly packedOn: string | null;
  readonly halfReachedAt: number | null;
  readonly fullReachedAt: number | null;
  readonly fullApprovedAt: number | null;
  /** The state this batch was paused from, or null. D23 resumes into it. */
  readonly pausedFrom: string | null;
}

/** Another batch of the same product, for decision D15. */
export interface SiblingBatch {
  readonly ref: string;
  readonly batchNo: string | null;
  readonly state: string;
}

/** A paid order in this batch, for the yield shortfall and the pause Concerns. */
export interface PaidOrderView {
  readonly id: string;
  readonly customerPhone: string | null;
  readonly jars: number;
  /** Epoch millis. Brief 7.7: the shortfall falls on the most recently paid. */
  readonly paidAtMillis: number;
}

export interface TransitionContext {
  readonly caller: { readonly uid: string | null; readonly role: unknown };
  /** null when the batch does not exist (the `none -> draft` row). */
  readonly batch: BatchView | null;
  /** Other batches of the same product. D15 reads this. */
  readonly siblings: readonly SiblingBatch[];
  /** Paid orders in this batch, if the collection is there to read. */
  readonly paidOrders: readonly PaidOrderView[];
  /** The main ingredient of the batch's recipe, when it could be read. */
  readonly mainIngredientId: string | null;
  /**
   * The product's name and the main ingredient's label name, read once when
   * the batch is created and then kept on the batch document. Only the create
   * row uses these; every later row reads them off the `BatchView` instead, so
   * no transaction after the first pays for the catalogue lookup.
   */
  readonly productName?: string | null;
  readonly mainIngredientName?: string | null;
  /**
   * `settings/messages` as read, or null. D24: the Owner's wording for the
   * three customer messages, which wins over the drafts in `@lailark/shared`.
   */
  readonly messages?: Partial<MessagesSettings> | null;
  /**
   * The draft already sitting on the approval the Owner is answering, when
   * there is one.
   *
   * **What is approved is what he read.** The approval was raised carrying a
   * draft, that draft is the sentence Today put in front of him, and his yes
   * records it rather than a fresh render of the template. The two are
   * normally the same sentence; they stop being the same the moment
   * `settings/messages` (D24) is edited between the raise and the yes, and at
   * that moment re-rendering would quietly approve a line nobody had read.
   */
  readonly existingApprovalDraft?: string | null;
  /**
   * The printed number this transaction has just taken from `counters/batch`,
   * or null on every row that does not allocate one. D21c: only Cooking ->
   * Bottled allocates, and the callable reads the counter before it plans, so
   * the number is issued and written in one transaction.
   */
  readonly allocatedBatchNo?: string | null;
  readonly nowMillis: number;
}

/* -------------------------------------------------------------------------- */
/* What the callable is told to do                                            */
/* -------------------------------------------------------------------------- */

export interface PlannedApproval {
  /**
   * Deterministic, so a re-run cannot raise the same approval twice, and keyed
   * on the batch's **internal reference**, not its printed number (D21c). An
   * approval is raised long before the batch has a number, and bottling must
   * not change the id of anything already written.
   */
  readonly id: string;
  readonly kind: "halfReached" | "full" | "broadcast" | "photoUpdate";
  readonly batchRef: string;
  /**
   * `batches/{batchRef}/updates/{updateId}` for a photo update (D5), absent
   * for every other kind: the Owner's yes has to know which update it is
   * stamping `approvedBy` on.
   */
  readonly updateId?: string;
  readonly draft: string;
  readonly status: "waiting" | "approved" | "edited";
  /** The production clock, in epoch millis, or null when the row has none. */
  readonly dueAtMillis: number | null;
  /** True to answer an approval that already exists rather than raise a new one. */
  readonly answer: boolean;
}

/**
 * One approval whose production clock has been replaced by another's.
 *
 * Brief 8.2: "3-day production clock replaces the 5-day". Replaces, not joins,
 * so the half approval's `dueAt` is cleared rather than left running beside
 * the full one's. Only a clock on an approval still waiting is cancelled: once
 * the Owner has answered, the clock it was on is spent anyway.
 */
export interface PlannedClockCancel {
  /** The approval whose `dueAt` is cleared. */
  readonly id: string;
  /** The approval whose clock replaced it, recorded as `dueAtSupersededBy`. */
  readonly supersededBy: string;
}

export interface PlannedConcern {
  /** Deterministic, and keyed on the internal reference for D21c's reason. */
  readonly id: string;
  readonly type: "yieldShortfall" | "batchPaused";
  readonly batchRef: string;
  readonly customerPhone: string | null;
  readonly orderId: string | null;
  readonly summary: string;
  readonly proposal: string | null;
  readonly urgent: boolean;
}

/** `batches/{ref}/lines/{id}`: what the pot actually used. */
export interface PlannedLine {
  readonly id: string;
  readonly ingredientId: string;
  readonly qtyActual: number;
  readonly costActual: number;
}

export interface TransitionPlan {
  readonly row: TransitionRow;
  /**
   * The batch's internal reference, or null on the create row, where the
   * transaction mints one (D21c).
   */
  readonly ref: string | null;
  /**
   * The printed number this row stamps, or null on every row that does not.
   * Only Cooking -> Bottled stamps one (D21c).
   */
  readonly batchNo: string | null;
  /** Plain field values to merge onto the batch document. */
  readonly patch: Readonly<Record<string, unknown>>;
  /** Fields the callable sets to the server timestamp. */
  readonly stampFields: readonly string[];
  readonly approvals: readonly PlannedApproval[];
  readonly concerns: readonly PlannedConcern[];
  readonly lines: readonly PlannedLine[];
  /** Numbers the admin shows back, and the tests assert. */
  readonly computed: Readonly<Record<string, number | string>>;
}

export type Planned = { readonly ok: true; readonly value: TransitionPlan };

/* -------------------------------------------------------------------------- */
/* The clocks, brief 7.3 and 8.2                                              */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Starts 5-day clock" (brief 8.2 and 7.3) and "3-day production clock
 * replaces the 5-day" once the batch is full.
 *
 * Both live in `@lailark/shared` from M2.5 on, because Today's Clocks section
 * has to name the same two numbers this table starts, and re-exported here so
 * every caller of the transition table still finds them where they were.
 */
export { FULL_CLOCK_DAYS, HALF_CLOCK_DAYS };

/* -------------------------------------------------------------------------- */
/* Messages that wait for the Owner                                           */
/* -------------------------------------------------------------------------- */

/**
 * Nothing in this file is sent. Every line below lands in an `approvals`
 * document with `sentAt` null and waits for the Owner (CLAUDE.md section 3,
 * decision D5).
 *
 * **Decision D24, answering Q11.** The batch-open, half-reached and
 * back-in-stock wording used to be a `TODO(Q11)` here, because customer-facing
 * copy may not be invented in a function. Shefin's answer: Claude drafts the
 * three and the Owner can edit them. The drafts now live in `@lailark/shared`
 * (`DEFAULT_CUSTOMER_MESSAGES`), the Owner's edits live in `settings/messages`,
 * and `customerMessage` picks the edit when there is one. "The batch is full."
 * stays as it is: it is drafted in brief 7.2 step 9 and names no product.
 *
 * Every draft is rendered from the batch, never typed: the product name and
 * the main ingredient are read off the batch document, and the price is
 * formatted from paise, so no message can quote a price the batch does not
 * carry.
 */

/** What a message is rendered against, taken off the batch itself. */
function messageValues(
  batch: Pick<BatchView, "productSlug" | "productName" | "mainIngredientName">,
  pricePaise: number,
) {
  return {
    product: batch.productName ?? productWordsFromSlug(batch.productSlug),
    ingredient: ingredientInSentence(batch.mainIngredientName ?? ""),
    price: formatINR(pricePaise),
  };
}

export const APPROVAL_DRAFTS = {
  /** Brief 7.2 step 7, now rendered for whatever the main ingredient is. */
  half: (
    batch: Pick<BatchView, "productSlug" | "productName" | "mainIngredientName" | "priceOpen">,
    messages?: Partial<MessagesSettings> | null,
  ): string => customerMessage("halfReached", messageValues(batch, batch.priceOpen), messages),
  /** Brief 7.2 step 9 and 8.2, drafted and product-neutral. */
  full: (): string => "The batch is full.",
  /** Brief 8.2, Draft -> Open, at the open price. */
  open: (
    batch: Pick<BatchView, "productSlug" | "productName" | "mainIngredientName" | "priceOpen">,
    messages?: Partial<MessagesSettings> | null,
  ): string => customerMessage("batchOpen", messageValues(batch, batch.priceOpen), messages),
  /** Brief 8.2, Bottled -> In stock, at the in-stock price. */
  inStock: (
    batch: Pick<
      BatchView,
      "productSlug" | "productName" | "mainIngredientName" | "priceInStock"
    >,
    messages?: Partial<MessagesSettings> | null,
  ): string => customerMessage("backInStock", messageValues(batch, batch.priceInStock), messages),
} as const;

/**
 * Deterministic approval ids, so a trigger that fires twice raises one.
 *
 * Keyed on the batch's internal reference (D21c). Approval and concern ids
 * must be stable across bottling: the half approval raised while the batch was
 * open is the same document the Owner answers after it is numbered, and
 * nothing re-points it.
 */
export function approvalId(kind: string, batchRef: string): string {
  return `${kind}-${batchRef}`;
}

/** The same, for a concern. Same reason, same key. */
export function concernId(kind: string, batchRef: string, orderId?: string | null): string {
  return orderId ? `${kind}-${batchRef}-${orderId}` : `${kind}-${batchRef}`;
}

/**
 * The approval a kitchen photo update raises. **Decision D5.**
 *
 * One per update, keyed on the batch reference and the update's own id, so a
 * kitchen that adds three photos to one batch raises three approvals and a
 * trigger that fires twice on one update raises one (A63).
 */
export function photoUpdateApprovalId(batchRef: string, updateId: string): string {
  return `photo-${batchRef}-${updateId}`;
}

/** `batches/{ref}/updates/{id}` as the pure planner reads it. */
export interface BatchUpdateView {
  readonly id: string;
  readonly batchRef: string;
  /** What the Kitchen wrote for the customers, or "" if she wrote nothing. */
  readonly messageText: string;
  /** The Kitchen's own note beside the photo. */
  readonly kitchenLine: string;
  readonly photoPath: string | null;
  /** Set once the Owner has said yes. An update already approved raises nothing. */
  readonly approvedBy: string | null;
}

/**
 * The approval for one kitchen photo update, or null when there is nothing to
 * raise: an update the Owner has already approved does not come back.
 *
 * **Nothing here is written by Claude.** The draft is what the Kitchen typed,
 * her message if she wrote one and her line beside the photo if she did not.
 * An update with neither raises an approval with an empty draft, which Today
 * shows as a photo to approve with no message to send, and offers no edit.
 * That is deliberate: the Owner still has to say yes before the photo reaches
 * anyone (D5), and no copy is invented on the way (CLAUDE.md section 5).
 */
export function planPhotoUpdateApproval(update: BatchUpdateView): PlannedApproval | null {
  if (update.approvedBy !== null && update.approvedBy !== "") return null;
  const draft = update.messageText.trim() !== "" ? update.messageText.trim() : update.kitchenLine.trim();
  return {
    id: photoUpdateApprovalId(update.batchRef, update.id),
    kind: "photoUpdate",
    batchRef: update.batchRef,
    updateId: update.id,
    draft,
    status: "waiting",
    // A photo update has no production clock: brief 7.3 and 8.2 put the 5 day
    // and 3 day clocks on half reached and full, and on nothing else.
    dueAtMillis: null,
    answer: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Decision D15                                                               */
/* -------------------------------------------------------------------------- */

/**
 * D15: one batch of a product open at a time, and a second may open only once
 * the first is cooking. A Draft does not block: a Draft is not on sale.
 *
 * `paused` blocks too. D15's condition is that the first batch is *cooking*,
 * and a paused batch is not cooking: it is a batch that was open, half
 * reached, sourcing or cooking and has been frozen, whose customers are
 * waiting on a Concern the Owner has not answered. Opening a second batch of
 * the same product while the first is frozen is exactly what D15 forbids, and
 * it would put the paused batch's customers behind a newer one. The Owner
 * resumes the first, or waits until it is cooking.
 */
export const D15_BLOCKING_STATES: readonly BatchState[] = [
  "open",
  "halfReached",
  "sourcing",
  "paused",
];

/** The batch that stands in the way of opening another, or null. */
export function blockingOpenBatch(siblings: readonly SiblingBatch[]): SiblingBatch | null {
  return (
    siblings.find((b) => (D15_BLOCKING_STATES as readonly string[]).includes(b.state)) ?? null
  );
}

export function d15Message(blocker: SiblingBatch, productSlug: string): string {
  // D21c: the blocker is named by its printed number if it has one, and by its
  // internal reference if it does not. A batch that blocks another is open,
  // half reached, sourcing or paused, so in practice it never has a number yet
  // and Shefin reads the reference, which is what the admin list shows too.
  const named = batchLabel(blocker.batchNo, blocker.ref, blocker.state);
  const Named = batchLabelCapitalised(blocker.batchNo, blocker.ref, blocker.state);
  if (blocker.state === "paused") {
    return (
      `${Named} of ${productSlug} is paused, which is not cooking. ` +
      `Only one batch of a product is open at a time (D15): resume ${named} ` +
      `and get it cooking before opening a second.`
    );
  }
  return (
    `${Named} of ${productSlug} is still ${stateWords(blocker.state)}. ` +
    `Only one batch of a product is open at a time (D15): a second can open once ` +
    `${named} is cooking.`
  );
}

const STATE_WORDS: Readonly<Record<string, string>> = {
  draft: "a draft",
  open: "open",
  halfReached: "half reached and waiting on you",
  sourcing: "sourcing",
  cooking: "cooking",
  bottled: "bottled",
  inStock: "in stock",
  soldOut: "sold out",
  archived: "archived",
  paused: "paused",
};

export function stateWords(state: string): string {
  return STATE_WORDS[state] ?? state;
}

/** How a row of the table reads in an admin message. */
export function rowWords(row: TransitionRow): string {
  return row.from === NO_STATE
    ? "Creating a batch"
    : `${stateWords(row.from)} to ${stateWords(row.to)}`;
}

/* -------------------------------------------------------------------------- */
/* Brief 7.7: the yield shortfall falls on the most recently paid             */
/* -------------------------------------------------------------------------- */

export interface ShortfallShare {
  readonly orderId: string;
  readonly customerPhone: string | null;
  readonly jarsShort: number;
}

/**
 * Brief 7.7. Jars short are taken off the most recently paid orders first,
 * one order at a time, until the shortfall is covered.
 */
export function yieldShortfallAllocation(
  paidOrders: readonly PaidOrderView[],
  jarsShort: number,
): readonly ShortfallShare[] {
  if (jarsShort <= 0) return [];
  const newestFirst = [...paidOrders].sort((a, b) => b.paidAtMillis - a.paidAtMillis);
  const shares: ShortfallShare[] = [];
  let left = jarsShort;
  for (const order of newestFirst) {
    if (left <= 0) break;
    const taken = Math.min(order.jars, left);
    if (taken > 0) {
      shares.push({ orderId: order.id, customerPhone: order.customerPhone, jarsShort: taken });
      left -= taken;
    }
  }
  return shares;
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                         */
/* -------------------------------------------------------------------------- */

function fail(code: ErrorCode, message: string): Failure {
  return { ok: false, code, message };
}

function invalid(message: string): Failure {
  return fail("invalid-argument", message);
}

/** The shape check, before anything is read from Firestore. */
export function parseTransitionRequest(raw: unknown): { ok: true; value: TransitionRequest } | Failure {
  if (typeof raw !== "object" || raw === null) {
    return invalid("transitionBatch needs an object with `to`, and `ref` unless it is a new batch.");
  }
  const data = raw as Record<string, unknown>;

  if (typeof data.to !== "string" || !(BATCH_STATES as readonly string[]).includes(data.to)) {
    return invalid(`to must be one of ${BATCH_STATES.join(", ")}.`);
  }

  // D21c: a batch is addressed by its internal reference, which it has from
  // the moment it is a draft. The printed number is a field and is not an
  // address: `batchNo` is on the protected list and is refused below with the
  // rest of them.
  let ref: string | undefined;
  if (data.ref !== undefined && data.ref !== null) {
    if (typeof data.ref !== "string" || !isBatchRef(data.ref)) {
      return invalid('ref must be the batch reference, for example "b-7f3a2c".');
    }
    ref = data.ref;
  }

  const inputs = data.data;
  if (inputs !== undefined && (typeof inputs !== "object" || inputs === null || Array.isArray(inputs))) {
    return invalid("data must be an object of the inputs this transition asks for.");
  }

  // A40: the protected fields are the server's, the Owner included. No client
  // may hand one in under any name, so a request carrying one is refused
  // before a single document is read. The jar count and the per-person limit
  // the buttons ask for come in as `jarCount` and `limitPerPerson` precisely
  // so that no input of this callable is ever spelled like a protected field.
  const smuggled = Object.keys((inputs as Record<string, unknown> | undefined) ?? {}).filter(
    (key) => isProtectedBatchField(key),
  );
  if (smuggled.length > 0) {
    return invalid(
      `The server computes ${smuggled.sort().join(", ")}; ${smuggled.length === 1 ? "it is" : "they are"} not yours to send.`,
    );
  }

  return {
    ok: true,
    value: {
      ...(ref === undefined ? {} : { ref }),
      to: data.to as BatchState,
      data: (inputs as Record<string, unknown> | undefined) ?? {},
    },
  };
}

function wholeNumber(value: unknown, field: string, min: number): number | Failure {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    return invalid(`${field} must be a whole number of at least ${min}.`);
  }
  return value;
}

function positiveNumber(value: unknown, field: string): number | Failure {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return invalid(`${field} must be a number greater than zero.`);
  }
  return value;
}

function paise(value: unknown, field: string, min = 0): number | Failure {
  if (!isPaise(value) || (value as number) < min) {
    return invalid(
      `${field} must be a whole number of paise of at least ${min}, never rupees and never a decimal.`,
    );
  }
  return value as number;
}

/**
 * A price a customer is charged, as opposed to a cost the kitchen pays.
 *
 * CLAUDE.md section 3: never above the ₹649 MRP. That is printed on the jar,
 * so it is not a preference, and the two screens that set a batch price are
 * both a typed box. `paise()` only ever had a floor, which left nothing at all
 * between an Owner's slip of the thumb and a batch open at ₹9,999.
 */
function sellingPaise(value: unknown, field: string): number | Failure {
  const parsed = paise(value, field, 1);
  if (isFailure(parsed)) return parsed;
  if (parsed > MRP_PAISE) {
    return invalid(
      `${field} is ${formatINR(parsed)}, above the ${formatINR(MRP_PAISE)} printed on the jar. A jar is never sold above its MRP.`,
    );
  }
  return parsed;
}

function text(value: unknown, field: string, max: number): string | Failure {
  if (typeof value !== "string" || value.trim() === "") {
    return invalid(`${field} must be some text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) return invalid(`${field} must be ${max} characters or fewer.`);
  return trimmed;
}

function isoDate(value: unknown, field: string): string | Failure {
  if (typeof value !== "string") return invalid(`${field} must be a date like 2026-09-04.`);
  try {
    return formatCalDate(parseCalDate(value));
  } catch {
    return invalid(`${field} must be a date like 2026-09-04.`);
  }
}

/**
 * The Owner's own wording for a message a customer will read. Everything
 * `text()` checks, and then CLAUDE.md section 3's rule about how Lailark
 * sounds: no long dashes. The check lives in `@lailark/shared` because the
 * same sentence can arrive through three different callables.
 */
function customerText(value: unknown, field: string): string | Failure {
  const parsed = text(value, field, MAX_MESSAGE);
  if (isFailure(parsed)) return parsed;
  const check = checkCustomerText(parsed);
  return check.ok ? parsed : invalid(check.message);
}

function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && (value as Failure).ok === false;
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The whole of section 8.2 in one function: find the row, check the caller,
 * check the inputs, compute what the row computes, and say what it flags.
 * Nothing here reads or writes anything.
 */
export function planTransition(
  request: TransitionRequest,
  context: TransitionContext,
): Planned | Failure {
  const { caller, batch, nowMillis } = context;

  if (caller.uid === null) {
    return fail("unauthenticated", "Sign in first.");
  }
  const role = typeof caller.role === "string" && (ROLES as readonly string[]).includes(caller.role)
    ? (caller.role as Role)
    : null;
  if (role === null) {
    return fail("permission-denied", "This number is not on the Lailark admin list.");
  }

  const from: TransitionFrom = batch === null ? NO_STATE : ((batch.state ?? NO_STATE) as TransitionFrom);

  if (batch === null && request.ref !== undefined) {
    return fail("not-found", `There is no batch ${request.ref}.`);
  }
  if (batch !== null && request.to === "draft") {
    return fail(
      "failed-precondition",
      `${batchLabelCapitalised(batch.batchNo, batch.ref, batch.state)} already exists.`,
    );
  }

  const row = transitionRow(from, request.to);
  if (!row) {
    return fail(
      "failed-precondition",
      from === NO_STATE
        ? `A new batch starts as a draft, not as ${stateWords(request.to)}.`
        : `A batch that is ${stateWords(from)} cannot go to ${stateWords(request.to)}.`,
    );
  }

  if (isAutomatic(row)) {
    return fail(
      "failed-precondition",
      `${stateWords(row.from)} to ${stateWords(row.to)} happens on its own, it is not a button.`,
    );
  }
  if (!(row.callers as readonly string[]).includes(role)) {
    return fail(
      "permission-denied",
      `Only ${row.callers.join(" or ")} can move a batch from ${stateWords(row.from)} to ${stateWords(row.to)}.`,
    );
  }

  // Section 8.2's "Button asks for" is a closed list. Anything else in the
  // request is a mistake or an attempt, and either way it is refused rather
  // than quietly dropped.
  const allowed = new Set<string>([...row.requires, ...row.optional]);
  const unexpected = Object.keys(request.data).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    return invalid(
      `${rowWords(row)} asks for ${allowed.size === 0 ? "nothing" : [...allowed].join(", ")}, not ${unexpected
        .sort()
        .join(", ")}.`,
    );
  }
  const missing = row.requires.filter((key) => request.data[key] === undefined);
  if (missing.length > 0) {
    return invalid(`${rowWords(row)} asks for ${missing.join(", ")}.`);
  }

  switch (`${row.from}->${row.to}`) {
    case "none->draft":
      return planCreate(
        row,
        request,
        caller.uid,
        nowMillis,
        context.productName,
        context.mainIngredientName,
      );
    case "draft->open":
      return planOpen(row, request, context, batch as BatchView);
    case "halfReached->sourcing":
      return planApproveHalf(
        row,
        request,
        batch as BatchView,
        nowMillis,
        context.messages,
        context.existingApprovalDraft,
      );
    case "sourcing->cooking":
      return planStartCooking(row, request, context, batch as BatchView);
    case "cooking->bottled":
      return planBottle(row, request, context, batch as BatchView);
    default:
      if (row.to === "paused") return planPause(row, request, context, batch as BatchView);
      return planResume(row, batch as BatchView);
  }
}

const MAX_SOURCE = 120;
const MAX_REASON = 300;
const MAX_MESSAGE = 1000;

function planCreate(
  row: TransitionRow,
  request: TransitionRequest,
  uid: string,
  nowMillis: number,
  productName: string | null | undefined,
  mainIngredientName: string | null | undefined,
): Planned | Failure {
  const d = request.data;
  const productSlug = text(d.productSlug, "productSlug", 80);
  if (isFailure(productSlug)) return productSlug;
  const recipeId = text(d.recipeId, "recipeId", 120);
  if (isFailure(recipeId)) return recipeId;
  const plannedJars = wholeNumber(d.plannedJars, "plannedJars", 1);
  if (isFailure(plannedJars)) return plannedJars;
  const priceOpen = sellingPaise(d.priceOpen, "priceOpen");
  if (isFailure(priceOpen)) return priceOpen;
  const priceInStock = sellingPaise(d.priceInStock, "priceInStock");
  if (isFailure(priceInStock)) return priceInStock;

  const maths = batchMaths(plannedJars);
  if (maths.bookableJars < 1) {
    return invalid(`${plannedJars} planned jars leaves no bookable jar at the 90% cap.`);
  }

  return {
    ok: true,
    value: {
      row,
      // The transaction mints the internal reference; this row has no printed
      // number to give, and will not have one until it is bottled (D21c).
      ref: null,
      batchNo: null,
      patch: {
        // D21c: the printed number is absent until bottling, and it is written
        // as an explicit null so that "no number yet" is a fact on the document
        // rather than a missing field that could be read either way.
        batchNo: null,
        productSlug,
        // D24: the product's name and the main ingredient's label name are
        // copied here once, so every later customer message can be drafted
        // without reading the catalogue inside a transaction.
        productName: productName ?? null,
        recipeId,
        mainIngredientName: mainIngredientName ?? null,
        state: "draft",
        plannedJars,
        bookableJars: maths.bookableJars,
        perPersonLimit: maths.perPersonLimit,
        priceOpen,
        priceInStock,
        paidCount: 0,
        heldJars: {},
        bottledJars: 0,
        writtenOff: 0,
        source: null,
        landedOn: null,
        cookedOn: null,
        packedOn: null,
        bestBefore: null,
        saleStopOn: null,
        weightRaw: null,
        weightCleaned: null,
        weightCooked: null,
        halfReachedAt: null,
        halfApprovedAt: null,
        fullReachedAt: null,
        fullApprovedAt: null,
        pausedReason: null,
        pausedFrom: null,
        costs: { jarsLids: 0, boxInserts: 0, labelling: 0, gasPower: 0 },
        pnl: {
          revenue: 0,
          ingredientCost: 0,
          packagingCost: 0,
          shippingCost: 0,
          gatewayFees: 0,
          writeOffCost: 0,
          margin: 0,
        },
        createdBy: uid,
      },
      stampFields: ["createdAt", "updatedAt"],
      approvals: [],
      concerns: [],
      lines: [],
      computed: {
        plannedJars,
        bookableJars: maths.bookableJars,
        halfJars: maths.halfJars,
        perPersonLimit: maths.perPersonLimit,
        createdAtMillis: nowMillis,
      },
    },
  };
}

function planOpen(
  row: TransitionRow,
  request: TransitionRequest,
  context: TransitionContext,
  batch: BatchView,
): Planned | Failure {
  const d = request.data;

  const blocker = blockingOpenBatch(context.siblings);
  if (blocker) {
    return fail("failed-precondition", d15Message(blocker, batch.productSlug));
  }

  let plannedJars = batch.plannedJars;
  if (d.plannedJars !== undefined) {
    const parsed = wholeNumber(d.plannedJars, "plannedJars", 1);
    if (isFailure(parsed)) return parsed;
    plannedJars = parsed;
  }
  let priceOpen = batch.priceOpen;
  if (d.priceOpen !== undefined) {
    const parsed = sellingPaise(d.priceOpen, "priceOpen");
    if (isFailure(parsed)) return parsed;
    priceOpen = parsed;
  }
  let priceInStock = batch.priceInStock;
  if (d.priceInStock !== undefined) {
    const parsed = sellingPaise(d.priceInStock, "priceInStock");
    if (isFailure(parsed)) return parsed;
    priceInStock = parsed;
  }

  const bookable = bookableJars(plannedJars);
  if (bookable < 1) {
    return invalid(`${plannedJars} planned jars leaves no bookable jar at the 90% cap.`);
  }
  // Brief 17.4: bookable can never drop below paid.
  if (bookable < batch.paidCount) {
    return fail(
      "failed-precondition",
      `${plannedJars} planned jars gives ${bookable} bookable, and ${batch.paidCount} are already paid for.`,
    );
  }

  let limit = perPersonLimitOf(bookable);
  if (d.limitPerPerson !== undefined) {
    const parsed = wholeNumber(d.limitPerPerson, "limitPerPerson", 1);
    if (isFailure(parsed)) return parsed;
    if (parsed > bookable) {
      return invalid(`limitPerPerson cannot be more than the ${bookable} bookable jars.`);
    }
    limit = parsed;
  }

  return {
    ok: true,
    value: {
      row,
      ref: batch.ref,
      // D21c: opening a batch does not number it. Brief §8.2 said it did.
      batchNo: null,
      patch: {
        state: "open",
        plannedJars,
        bookableJars: bookable,
        perPersonLimit: limit,
        priceOpen,
        priceInStock,
        pausedReason: null,
        pausedFrom: null,
      },
      stampFields: ["updatedAt"],
      approvals: [
        {
          // Keyed on the reference, so the Owner answers the same document
          // whether the batch is numbered by then or not.
          id: approvalId("open", batch.ref),
          kind: "broadcast",
          batchRef: batch.ref,
          draft: APPROVAL_DRAFTS.open({ ...batch, priceOpen }, context.messages),
          status: "waiting",
          dueAtMillis: null,
          answer: false,
        },
      ],
      concerns: [],
      lines: [],
      computed: {
        plannedJars,
        bookableJars: bookable,
        halfJars: halfOfBookable(bookable),
        perPersonLimit: limit,
        priceOpen,
        priceInStock,
      },
    },
  };
}

function planApproveHalf(
  row: TransitionRow,
  request: TransitionRequest,
  batch: BatchView,
  nowMillis: number,
  messages: Partial<MessagesSettings> | null | undefined,
  existingDraft: string | null | undefined,
): Planned | Failure {
  let message: string | null = null;
  if (request.data.messageText !== undefined && request.data.messageText !== null) {
    const parsed = customerText(request.data.messageText, "messageText");
    if (isFailure(parsed)) return parsed;
    message = parsed;
  }

  return {
    ok: true,
    value: {
      row,
      ref: batch.ref,
      batchNo: null,
      patch: { state: "sourcing" },
      stampFields: ["updatedAt", "halfApprovedAt"],
      approvals: [
        {
          id: approvalId("half", batch.ref),
          kind: "halfReached",
          batchRef: batch.ref,
          // What the Owner approved, in order: his own edit, then the draft
          // he was shown, then a fresh render for an approval that has gone
          // missing (a batch moved by hand, a replay).
          draft: message ?? existingDraft ?? APPROVAL_DRAFTS.half(batch, messages),
          status: message === null ? "approved" : "edited",
          dueAtMillis: null,
          answer: true,
        },
      ],
      concerns: [],
      lines: [],
      computed: { halfApprovedAtMillis: nowMillis },
    },
  };
}

function planStartCooking(
  row: TransitionRow,
  request: TransitionRequest,
  context: TransitionContext,
  batch: BatchView,
): Planned | Failure {
  const d = request.data;
  const landedOn = isoDate(d.landedOn, "landedOn");
  if (isFailure(landedOn)) return landedOn;
  const source = text(d.source, "source", MAX_SOURCE);
  if (isFailure(source)) return source;
  const weightRaw = positiveNumber(d.weightRaw, "weightRaw");
  if (isFailure(weightRaw)) return weightRaw;
  const costRaw = paise(d.costRaw, "costRaw");
  if (isFailure(costRaw)) return costRaw;

  let cookedOn: string | null = null;
  if (d.cookedOn !== undefined && d.cookedOn !== null) {
    const parsed = isoDate(d.cookedOn, "cookedOn");
    if (isFailure(parsed)) return parsed;
    cookedOn = parsed;
  }

  // Brief 14.1: the main ingredient's raw weight and price are recorded
  // against the batch between Sourcing and Cooking.
  //
  // M2.13: keyed by the ingredient, not by the literal id "main". The
  // actuals screen keys every line by its ingredient (`admin/src/batches/
  // lineIds.ts`), because a recipe may flag two lines `isMain` (batch 001
  // does: prawns and dates are both named in the product name) and one id
  // for both made them one document. This line is the same document that
  // screen's main row edits, so it moves with it.
  //
  // A recipe with no main ingredient at all keeps the old id, and its
  // `ingredientId` is then the same placeholder string rather than a real
  // ingredient: nobody's `isMain` line can claim it, so the actuals screen
  // shows it as a figure recorded against no ingredient in the recipe
  // (`OrphanLines`) instead of hiding it. `costRaw` has no other home on the
  // batch, so not writing it would lose it outright. Whether this transition
  // should be refused for a recipe that names no main ingredient is a
  // lifecycle question for Shefin, not something this task decides.
  const mainId = context.mainIngredientId ?? "main";
  const lines: PlannedLine[] = [
    {
      id: mainId,
      ingredientId: mainId,
      qtyActual: weightRaw,
      costActual: costRaw,
    },
  ];

  return {
    ok: true,
    value: {
      row,
      ref: batch.ref,
      batchNo: null,
      // Booking closes at Rs 599 by the state alone (brief 7.5): `cooking` is
      // not in BATCH_STATES_OPEN_FOR_BOOKING, so the card and every hold
      // transaction stop offering the open price from this write on.
      patch: { state: "cooking", landedOn, source, weightRaw, cookedOn },
      stampFields: ["updatedAt"],
      approvals: [],
      concerns: [],
      lines,
      computed: { weightRaw, costRaw, landedOn },
    },
  };
}

function planBottle(
  row: TransitionRow,
  request: TransitionRequest,
  context: TransitionContext,
  batch: BatchView,
): Planned | Failure {
  const d = request.data;
  const weightCleaned = positiveNumber(d.weightCleaned, "weightCleaned");
  if (isFailure(weightCleaned)) return weightCleaned;
  const weightCooked = positiveNumber(d.weightCooked, "weightCooked");
  if (isFailure(weightCooked)) return weightCooked;
  const jars = wholeNumber(d.jarCount, "jarCount", 0);
  if (isFailure(jars)) return jars;
  const packedOn = isoDate(d.packedOn, "packedOn");
  if (isFailure(packedOn)) return packedOn;

  // D21c: **this is where the printed number is stamped.** The callable read
  // `counters/batch` in this same transaction and handed the number down; if
  // it did not, the row cannot proceed, because a bottled batch without a
  // number would be jars with nothing printed on them.
  const batchNo = context.allocatedBatchNo ?? null;
  if (batchNo === null) {
    return fail(
      "failed-precondition",
      "No batch number was allocated for this bottling. The number comes from counters/batch inside this transaction (D21c).",
    );
  }
  const named = `Batch ${batchNo}`;

  const surplus = surplusJars(jars, batch.paidCount);
  const jarsShort = Math.max(0, batch.paidCount - jars);

  const concerns: PlannedConcern[] = [];
  if (jarsShort > 0) {
    // Brief 7.7: the shortfall falls on the most recently paid orders, with a
    // Concern per affected customer proposing a jar from the next batch at
    // Rs 599 or a refund.
    //
    // The ids are keyed on the internal reference, not on the number that was
    // allocated a few lines above, so a concern id stays the same shape at
    // every point in a batch's life (D21c). The summary the Owner reads names
    // the printed number, because by now there is one.
    const shares = yieldShortfallAllocation(context.paidOrders, jarsShort);
    for (const share of shares) {
      concerns.push({
        id: concernId("yield", batch.ref, share.orderId),
        type: "yieldShortfall",
        batchRef: batch.ref,
        customerPhone: share.customerPhone,
        orderId: share.orderId,
        summary: `${named} bottled ${jars} jars against ${batch.paidCount} paid. This order is ${share.jarsShort} jar${share.jarsShort === 1 ? "" : "s"} short.`,
        proposal: "A jar from the next batch of the same product at Rs 599, or a refund.",
        urgent: true,
      });
    }
    if (shares.length === 0) {
      concerns.push({
        id: concernId("yield", batch.ref),
        type: "yieldShortfall",
        batchRef: batch.ref,
        customerPhone: null,
        orderId: null,
        summary: `${named} bottled ${jars} jars against ${batch.paidCount} paid: ${jarsShort} short.`,
        proposal: "A jar from the next batch of the same product at Rs 599, or a refund.",
        urgent: true,
      });
    }
  }

  return {
    ok: true,
    value: {
      row,
      ref: batch.ref,
      batchNo,
      patch: {
        state: "bottled",
        // The printed number, beside the label data it belongs with (D21c).
        batchNo,
        weightCleaned,
        weightCooked,
        bottledJars: jars,
        packedOn,
        bestBefore: formatCalDate(bestBefore(packedOn)),
        saleStopOn: formatCalDate(saleStopOn(packedOn)),
      },
      stampFields: ["updatedAt"],
      approvals: [],
      concerns,
      lines: [],
      computed: {
        batchNo,
        bottledJars: jars,
        surplus,
        jarsShort,
        packedOn,
        bestBefore: formatCalDate(bestBefore(packedOn)),
        saleStopOn: formatCalDate(saleStopOn(packedOn)),
      },
    },
  };
}

function planPause(
  row: TransitionRow,
  request: TransitionRequest,
  context: TransitionContext,
  batch: BatchView,
): Planned | Failure {
  const reason = text(request.data.reason, "reason", MAX_REASON);
  if (isFailure(reason)) return reason;

  const named = batchLabelCapitalised(batch.batchNo, batch.ref, batch.state);
  const concerns: PlannedConcern[] = context.paidOrders.map((order) => ({
    id: concernId("paused", batch.ref, order.id),
    type: "batchPaused" as const,
    batchRef: batch.ref,
    customerPhone: order.customerPhone,
    orderId: order.id,
    summary: `${named} is paused: ${reason}`,
    proposal: null,
    urgent: false,
  }));

  return {
    ok: true,
    value: {
      row,
      ref: batch.ref,
      batchNo: null,
      // D23: the batch remembers where it was, so resume has somewhere to
      // return to. `row.from` rather than `batch.state` because the row is
      // what was matched and validated; they are the same value.
      patch: { state: "paused", pausedReason: reason, pausedFrom: row.from },
      stampFields: ["updatedAt"],
      approvals: [],
      concerns,
      lines: [],
      computed: { pausedFrom: row.from, concerns: concerns.length },
    },
  };
}

/**
 * D23: resuming returns the batch to the state it was paused from, and to no
 * other. The batch remembers it in `pausedFrom`, so this is a check rather
 * than a choice: a request to resume somewhere else is refused, even from the
 * Owner, because "resume" is not a way to move a batch about.
 *
 * A paused batch with no `pausedFrom` is one paused before this field existed,
 * or moved by hand. The Owner is told, rather than the batch being dropped
 * into a state nobody chose.
 */
function planResume(row: TransitionRow, batch: BatchView): Planned | Failure {
  if (batch.pausedFrom === null) {
    return fail(
      "failed-precondition",
      `${batchLabelCapitalised(batch.batchNo, batch.ref, batch.state)} does not record which state it was paused from, so it cannot be resumed. Set it, or move the batch by hand.`,
    );
  }
  if (batch.pausedFrom !== row.to) {
    return fail(
      "failed-precondition",
      `${batchLabelCapitalised(batch.batchNo, batch.ref, batch.state)} was paused from ${stateWords(batch.pausedFrom)}, so it resumes to ${stateWords(batch.pausedFrom)}, not to ${stateWords(row.to)}.`,
    );
  }
  return {
    ok: true,
    value: {
      row,
      ref: batch.ref,
      batchNo: null,
      patch: { state: row.to, pausedReason: null, pausedFrom: null },
      stampFields: ["updatedAt"],
      approvals: [],
      concerns: [],
      lines: [],
      computed: { resumedTo: row.to },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The last row of 8.2: "Batch full (90% booked), then owner yes"             */
/* -------------------------------------------------------------------------- */

/**
 * The full approval is the one row of section 8.2 that is not a state hop.
 *
 * "Batch full (90% booked) | Automatic flag, then owner yes | Optional edit |
 * 3-day production clock replaces the 5-day | 'The batch is full', after yes."
 * The flag half of it is `nextAutomaticStep`; this is the owner-yes half. The
 * batch does not move, so it cannot be a row of `BATCH_TRANSITION_TABLE`,
 * whose rows are all `from -> to`. It is an answer to a waiting approval, in
 * exactly the shape of `halfReached -> sourcing`: Owner only, an optional edit
 * of the message, the batch stamped, the approval marked approved or edited,
 * and nothing sent.
 */
export const FULL_APPROVAL_ROW = {
  /** Brief 17.12: approving a customer message is the Owner's, and only his. */
  callers: ["owner"] as readonly TransitionCaller[],
  requires: [] as readonly string[],
  optional: ["messageText"] as readonly string[],
  computes: ["fullApprovedAt"] as readonly string[],
  flags: ["approval:full:answered"] as readonly string[],
  note: "The Owner says yes to the full message. The batch does not move: full is a flag.",
} as const;

/** What the `approveBatchFull` callable is handed, before validation. */
export interface FullApprovalRequest {
  /** The batch's internal reference. D21c: never the printed number. */
  readonly ref: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface FullApprovalPlan {
  readonly ref: string;
  readonly patch: Readonly<Record<string, unknown>>;
  readonly stampFields: readonly string[];
  readonly approvals: readonly PlannedApproval[];
  /** True when the Owner had already said yes and this call changed nothing. */
  readonly alreadyApproved: boolean;
  readonly computed: Readonly<Record<string, number | string>>;
}

export type FullApprovalPlanned = { readonly ok: true; readonly value: FullApprovalPlan };

/** The shape check for `approveBatchFull`, before anything is read. */
export function parseFullApprovalRequest(
  raw: unknown,
): { ok: true; value: FullApprovalRequest } | Failure {
  if (typeof raw !== "object" || raw === null) {
    return invalid("approveBatchFull needs an object with `batchNo`.");
  }
  const data = raw as Record<string, unknown>;
  if (typeof data.ref !== "string" || !isBatchRef(data.ref)) {
    return invalid('ref must be the batch reference, for example "b-7f3a2c".');
  }

  const inputs = data.data;
  if (inputs !== undefined && (typeof inputs !== "object" || inputs === null || Array.isArray(inputs))) {
    return invalid("data must be an object of the inputs this approval asks for.");
  }
  const given = (inputs as Record<string, unknown> | undefined) ?? {};

  // A40, exactly as `parseTransitionRequest` applies it: `fullApprovedAt` is a
  // protected field, and the Owner stamps it by saying yes, never by sending it.
  const smuggled = Object.keys(given).filter((key) => isProtectedBatchField(key));
  if (smuggled.length > 0) {
    return invalid(
      `The server computes ${smuggled.sort().join(", ")}; ${smuggled.length === 1 ? "it is" : "they are"} not yours to send.`,
    );
  }
  const allowed = new Set<string>([...FULL_APPROVAL_ROW.requires, ...FULL_APPROVAL_ROW.optional]);
  const unexpected = Object.keys(given).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    return invalid(
      `Answering the full approval asks for ${[...allowed].join(", ")}, not ${unexpected.sort().join(", ")}.`,
    );
  }

  return { ok: true, value: { ref: data.ref, data: given } };
}

/**
 * The Owner's yes on "The batch is full." Stamps `fullApprovedAt` and marks
 * the approval approved (or edited, when he rewrote the line). Never sets
 * `sentAt`: sending is M5, and D5 is that nothing reaches a customer without
 * the Owner having said yes first, which is what this records.
 *
 * Answering twice is harmless: the second call finds `fullApprovedAt` already
 * there, writes nothing, and answers `alreadyApproved`. The first yes is the
 * one that stands, so a double tap cannot move the stamp.
 */
export function planFullApproval(
  request: FullApprovalRequest,
  context: TransitionContext,
): FullApprovalPlanned | Failure {
  const { caller, batch } = context;

  if (caller.uid === null) {
    return fail("unauthenticated", "Sign in first.");
  }
  const role = typeof caller.role === "string" && (ROLES as readonly string[]).includes(caller.role)
    ? (caller.role as Role)
    : null;
  if (role === null) {
    return fail("permission-denied", "This number is not on the Lailark admin list.");
  }
  if (!(FULL_APPROVAL_ROW.callers as readonly string[]).includes(role)) {
    return fail(
      "permission-denied",
      "Only the owner can say yes to the batch-full message.",
    );
  }
  if (batch === null) {
    return fail("not-found", `There is no batch ${request.ref}.`);
  }
  if (batch.fullReachedAt === null) {
    return fail(
      "failed-precondition",
      `${batchLabelCapitalised(batch.batchNo, batch.ref, batch.state)} is not full yet, so there is nothing to say yes to.`,
    );
  }

  if (batch.fullApprovedAt !== null) {
    return {
      ok: true,
      value: {
        ref: batch.ref,
        patch: {},
        stampFields: [],
        approvals: [],
        alreadyApproved: true,
        computed: { fullApprovedAtMillis: batch.fullApprovedAt },
      },
    };
  }

  let message: string | null = null;
  if (request.data.messageText !== undefined && request.data.messageText !== null) {
    const parsed = customerText(request.data.messageText, "messageText");
    if (isFailure(parsed)) return parsed;
    message = parsed;
  }

  return {
    ok: true,
    value: {
      ref: batch.ref,
      patch: {},
      stampFields: ["updatedAt", "fullApprovedAt"],
      approvals: [
        {
          id: approvalId("full", batch.ref),
          kind: "full",
          batchRef: batch.ref,
          draft: message ?? context.existingApprovalDraft ?? APPROVAL_DRAFTS.full(),
          status: message === null ? "approved" : "edited",
          dueAtMillis: null,
          answer: true,
        },
      ],
      alreadyApproved: false,
      computed: { fullApprovedAtMillis: context.nowMillis },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The automatic rows, brief 8.2. Decided here, written by the triggers.      */
/* -------------------------------------------------------------------------- */

export interface AutomaticStep {
  readonly to: BatchState | null;
  /** Fields to merge, beside the state. */
  readonly patch: Readonly<Record<string, unknown>>;
  readonly stampFields: readonly string[];
  readonly approvals: readonly PlannedApproval[];
  /** Clocks this step replaces. Brief 8.2's "replaces the 5-day". */
  readonly cancelClocks: readonly PlannedClockCancel[];
  readonly reason: string;
}

export const NO_STEP: AutomaticStep = {
  to: null,
  patch: {},
  stampFields: [],
  approvals: [],
  cancelClocks: [],
  reason: "nothing to do",
};

export interface AutomaticContext {
  readonly batch: BatchView;
  readonly heldJars: Readonly<Record<string, { qty: number; expiresAt: number }>>;
  /** Orders in this batch that are not finished. Only read when sold out. */
  readonly openOrders: number;
  /** `settings/messages` as read, or null: the Owner's wording (D24). */
  readonly messages?: Partial<MessagesSettings> | null;
  readonly nowMillis: number;
}

/**
 * The one decision function every trigger runs. It answers with at most one
 * step, and every step's precondition is false once that step is written, so
 * a trigger that re-fires on its own write finds nothing to do and stops.
 * That is what stops the loop: not a flag on the document, but a table whose
 * rows are each true exactly once.
 */
export function nextAutomaticStep(context: AutomaticContext): AutomaticStep {
  const { batch, nowMillis } = context;
  const bookable = batch.bookableJars;
  const half = bookable > 0 ? halfOfBookable(bookable) : 0;

  // The half hop is checked before the full flag, and that order is what
  // keeps exactly one clock live. A batch that fills in a single payment
  // still gets both stamps, one firing after the other; taking half first
  // means the half approval and its 5 day clock always exist before the full
  // flag is raised, so the full flag has something to supersede. The other
  // order raised the 3 day clock first and then created a 5 day one beside
  // it, which is the "replaces" of 8.2 read as "joins".
  if (batch.state === "open" && batch.halfReachedAt === null && half > 0 && batch.paidCount >= half) {
    return {
      to: "halfReached",
      patch: {},
      stampFields: ["halfReachedAt", "updatedAt"],
      approvals: [
        {
          id: approvalId("half", batch.ref),
          kind: "halfReached",
          batchRef: batch.ref,
          draft: APPROVAL_DRAFTS.half(batch, context.messages),
          status: "waiting",
          dueAtMillis: nowMillis + HALF_CLOCK_DAYS * DAY_MS,
          answer: false,
        },
      ],
      cancelClocks: [],
      reason: `paid ${batch.paidCount} of ${half} needed for half of ${bookable} bookable`,
    };
  }

  // "Batch full (90% booked)": a flag, not a state, and it can be raised in
  // any of the booking states.
  if (
    batch.fullReachedAt === null &&
    bookable > 0 &&
    batch.paidCount >= bookable &&
    ["open", "halfReached", "sourcing"].includes(batch.state ?? "")
  ) {
    return {
      to: null,
      patch: {},
      stampFields: ["fullReachedAt", "updatedAt"],
      approvals: [
        {
          id: approvalId("full", batch.ref),
          kind: "full",
          batchRef: batch.ref,
          draft: APPROVAL_DRAFTS.full(),
          status: "waiting",
          // The 3 day production clock, brief 8.2.
          dueAtMillis: nowMillis + FULL_CLOCK_DAYS * DAY_MS,
          answer: false,
        },
      ],
      // ...which *replaces* the 5 day one, rather than running beside it.
      cancelClocks: [
        {
          id: approvalId("half", batch.ref),
          supersededBy: approvalId("full", batch.ref),
        },
      ],
      reason: `paid ${batch.paidCount} of ${bookable} bookable: the batch is full`,
    };
  }

  if (batch.state === "bottled") {
    const surplus = surplusJars(batch.bottledJars, batch.paidCount);
    if (surplus > 0) {
      return {
        to: "inStock",
        patch: {},
        stampFields: ["updatedAt"],
        approvals: [
          {
            id: approvalId("inStock", batch.ref),
            kind: "broadcast",
            batchRef: batch.ref,
            draft: APPROVAL_DRAFTS.inStock(batch, context.messages),
            status: "waiting",
            dueAtMillis: null,
            answer: false,
          },
        ],
        cancelClocks: [],
        reason: `${surplus} jar${surplus === 1 ? "" : "s"} of surplus go on sale in stock`,
      };
    }
    return {
      to: "soldOut",
      patch: {},
      stampFields: ["updatedAt"],
      approvals: [],
      cancelClocks: [],
      reason: "the pot gave no surplus (A28)",
    };
  }

  if (batch.state === "inStock") {
    const availability = inStockAvailability({
      bottledJars: batch.bottledJars,
      paidCount: batch.paidCount,
      heldJars: context.heldJars,
      writtenOff: batch.writtenOff,
      now: nowMillis,
    });
    // A jar held by somebody who is paying is not a jar that has gone.
    if (availability.available === 0 && availability.liveHeldJars === 0) {
      return {
        to: "soldOut",
        patch: {},
        stampFields: ["updatedAt"],
        approvals: [],
        cancelClocks: [],
        reason: "no jar is free",
      };
    }
  }

  if (batch.state === "soldOut" && context.openOrders === 0) {
    return {
      to: "archived",
      patch: {},
      stampFields: ["updatedAt"],
      approvals: [],
      // The state is the lock: nothing recomputes the P&L of an archived batch.
      cancelClocks: [],
      reason: "every order in the batch is closed, the P&L is locked",
    };
  }

  return NO_STEP;
}
