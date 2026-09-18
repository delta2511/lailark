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
  bestBefore,
  bookableJars,
  formatCalDate,
  halfOfBookable,
  inStockAvailability,
  isPaise,
  isProtectedBatchField,
  parseCalDate,
  perPersonLimit as perPersonLimitOf,
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
 * and `none -> draft` is the row that creates it (and allocates its number:
 * see the note on `ALLOCATES_BATCH_NO` below).
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
 * Where the batch number is allocated.
 *
 * Section 8.2 puts "allocates the batch number" on Draft -> Open, and section
 * 18.1 makes the batch number the document id (`batches/{nnn}`). Both cannot
 * be true at once: a Draft is already a document, so it already needs an id.
 * The number is therefore allocated when the Draft is created, and the Draft
 * keeps it. Nothing about section 8.3 is given up by that: numbers stay
 * global, sequential, zero-padded and never reused, and no gap appears in the
 * sequence, because an abandoned Draft keeps its number rather than freeing
 * it. What Draft -> Open does is publish the number, which is the part a
 * customer ever sees.
 */
export const ALLOCATES_BATCH_NO = { from: NO_STATE, to: "draft" } as const;

const PAUSABLE: readonly BatchState[] = BATCH_STATES_PAUSABLE;

/**
 * Brief section 8.2, row for row. `pause` and `resume` are generated from
 * `BATCH_STATES_PAUSABLE` so section 8.1's "Paused <- from Open, Half reached,
 * Sourcing or Cooking" is stated once.
 */
export const BATCH_TRANSITION_TABLE: readonly TransitionRow[] = [
  {
    from: NO_STATE,
    to: "draft",
    callers: ["owner"],
    requires: ["productSlug", "recipeId", "plannedJars", "priceOpen", "priceInStock"],
    optional: [],
    computes: ["batchNo", "bookableJars", "perPersonLimit"],
    flags: [],
    note: "Creates the batch and allocates its number from counters/batch.",
  },
  {
    from: "draft",
    to: "open",
    callers: ["owner"],
    requires: [],
    optional: ["plannedJars", "priceOpen", "priceInStock", "limitPerPerson"],
    computes: ["bookableJars", "perPersonLimit"],
    flags: ["approval:broadcast"],
    note: "Publishes the card. The opted-in list is offered a message, which waits for the Owner.",
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
      // Section 8.2's "Generates label data and the /batch/<nnn> page".
      "M5.6: generate the label data and publish the /batch/<nnn> page",
    ],
    note: "Computes best before, the shelf-life stop and the surplus. Raises a yield Concern if short.",
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
  ...PAUSABLE.map(
    (from): TransitionRow => ({
      from,
      to: "paused",
      callers: ["owner"],
      requires: ["reason"],
      optional: [],
      computes: ["pausedReason"],
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
      computes: ["pausedReason"],
      flags: [],
      note: "The Owner resumes the batch into the state it was paused from.",
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
  /** Absent only for the row that creates a batch. */
  readonly batchNo?: string;
  readonly to: BatchState;
  /** The row's inputs, unvalidated. Validated per row by `planTransition`. */
  readonly data: Readonly<Record<string, unknown>>;
}

/** The batch as the transaction read it. Plain values, no Firestore types. */
export interface BatchView {
  readonly batchNo: string;
  readonly state: string | undefined;
  readonly productSlug: string;
  readonly recipeId: string;
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
}

/** Another batch of the same product, for decision D15. */
export interface SiblingBatch {
  readonly batchNo: string;
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
  readonly nowMillis: number;
}

/* -------------------------------------------------------------------------- */
/* What the callable is told to do                                            */
/* -------------------------------------------------------------------------- */

export interface PlannedApproval {
  /** Deterministic, so a re-run cannot raise the same approval twice. */
  readonly id: string;
  readonly kind: "halfReached" | "full" | "broadcast" | "photoUpdate";
  readonly batchNo: string;
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
  readonly id: string;
  readonly type: "yieldShortfall" | "batchPaused";
  readonly batchNo: string;
  readonly customerPhone: string | null;
  readonly orderId: string | null;
  readonly summary: string;
  readonly proposal: string | null;
  readonly urgent: boolean;
}

/** `batches/{nnn}/lines/{id}`: what the pot actually used. */
export interface PlannedLine {
  readonly id: string;
  readonly ingredientId: string;
  readonly qtyActual: number;
  readonly costActual: number;
}

export interface TransitionPlan {
  readonly row: TransitionRow;
  /** null on the create row: the transaction allocates the number. */
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
/** "Starts 5-day clock", brief 8.2 and 7.3. */
export const HALF_CLOCK_DAYS = 5;
/** "3-day production clock replaces the 5-day" once the batch is full. */
export const FULL_CLOCK_DAYS = 3;

/* -------------------------------------------------------------------------- */
/* Messages that wait for the Owner                                           */
/* -------------------------------------------------------------------------- */

/**
 * Nothing in this file is sent. Every line below lands in an `approvals`
 * document and waits for the Owner (CLAUDE.md section 3, decision D5).
 *
 * Two of the four are drafted in the brief and are copied character for
 * character. The other two are not drafted anywhere, and customer-facing
 * wording may never be invented here, so they carry a TODO(Q11) the Owner
 * edits before the message can go out.
 */
export const APPROVAL_DRAFTS = {
  /** Brief 7.2 step 7, drafted for prawns. Any other product needs wording. */
  half: (productSlug: string): string =>
    productSlug === "prawns-pickle" || productSlug === "prawn-pickle"
      ? "Half the batch is paid for. We are arranging the prawns now."
      : `TODO(Q11) half-reached wording for ${productSlug}. Brief 7.2 drafts the prawns line: "Half the batch is paid for. We are arranging the prawns now."`,
  /** Brief 7.2 step 9 and 8.2, drafted and product-neutral. */
  full: (): string => "The batch is full.",
  open: (productSlug: string): string =>
    `TODO(Q11) batch-open wording for ${productSlug}. Brief 8.2 says the opted-in list is offered a "batch open" message and the Owner approves the send.`,
  inStock: (productSlug: string): string =>
    `TODO(Q11) back-in-stock wording for ${productSlug}. Brief 8.2 says the notify-me list is offered a message and the Owner approves the send.`,
} as const;

/** Deterministic approval ids, so a trigger that fires twice raises one. */
export function approvalId(kind: string, batchNo: string): string {
  return `${kind}-${batchNo}`;
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
  if (blocker.state === "paused") {
    return (
      `Batch ${blocker.batchNo} of ${productSlug} is paused, which is not cooking. ` +
      `Only one batch of a product is open at a time (D15): resume batch ` +
      `${blocker.batchNo} and get it cooking before opening a second.`
    );
  }
  return (
    `Batch ${blocker.batchNo} of ${productSlug} is still ${stateWords(blocker.state)}. ` +
    `Only one batch of a product is open at a time (D15): a second can open once batch ` +
    `${blocker.batchNo} is cooking.`
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

const BATCH_NO = /^\d{3,}$/;

/** The shape check, before anything is read from Firestore. */
export function parseTransitionRequest(raw: unknown): { ok: true; value: TransitionRequest } | Failure {
  if (typeof raw !== "object" || raw === null) {
    return invalid("transitionBatch needs an object with `to`, and `batchNo` unless it is a new batch.");
  }
  const data = raw as Record<string, unknown>;

  if (typeof data.to !== "string" || !(BATCH_STATES as readonly string[]).includes(data.to)) {
    return invalid(`to must be one of ${BATCH_STATES.join(", ")}.`);
  }

  let batchNo: string | undefined;
  if (data.batchNo !== undefined && data.batchNo !== null) {
    if (typeof data.batchNo !== "string" || !BATCH_NO.test(data.batchNo)) {
      return invalid("batchNo must be the zero-padded batch number, for example \"001\".");
    }
    batchNo = data.batchNo;
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
      ...(batchNo === undefined ? {} : { batchNo }),
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

  if (batch === null && request.batchNo !== undefined) {
    return fail("not-found", `There is no batch ${request.batchNo}.`);
  }
  if (batch !== null && request.to === "draft") {
    return fail("failed-precondition", `Batch ${batch.batchNo} already exists.`);
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
      return planCreate(row, request, caller.uid, nowMillis);
    case "draft->open":
      return planOpen(row, request, context, batch as BatchView);
    case "halfReached->sourcing":
      return planApproveHalf(row, request, batch as BatchView, nowMillis);
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
): Planned | Failure {
  const d = request.data;
  const productSlug = text(d.productSlug, "productSlug", 80);
  if (isFailure(productSlug)) return productSlug;
  const recipeId = text(d.recipeId, "recipeId", 120);
  if (isFailure(recipeId)) return recipeId;
  const plannedJars = wholeNumber(d.plannedJars, "plannedJars", 1);
  if (isFailure(plannedJars)) return plannedJars;
  const priceOpen = paise(d.priceOpen, "priceOpen", 1);
  if (isFailure(priceOpen)) return priceOpen;
  const priceInStock = paise(d.priceInStock, "priceInStock", 1);
  if (isFailure(priceInStock)) return priceInStock;

  const maths = batchMaths(plannedJars);
  if (maths.bookableJars < 1) {
    return invalid(`${plannedJars} planned jars leaves no bookable jar at the 90% cap.`);
  }

  return {
    ok: true,
    value: {
      row,
      batchNo: null,
      patch: {
        productSlug,
        recipeId,
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
    const parsed = paise(d.priceOpen, "priceOpen", 1);
    if (isFailure(parsed)) return parsed;
    priceOpen = parsed;
  }
  let priceInStock = batch.priceInStock;
  if (d.priceInStock !== undefined) {
    const parsed = paise(d.priceInStock, "priceInStock", 1);
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
      batchNo: batch.batchNo,
      patch: {
        state: "open",
        plannedJars,
        bookableJars: bookable,
        perPersonLimit: limit,
        priceOpen,
        priceInStock,
        pausedReason: null,
      },
      stampFields: ["updatedAt"],
      approvals: [
        {
          id: approvalId("open", batch.batchNo),
          kind: "broadcast",
          batchNo: batch.batchNo,
          draft: APPROVAL_DRAFTS.open(batch.productSlug),
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
): Planned | Failure {
  let message: string | null = null;
  if (request.data.messageText !== undefined && request.data.messageText !== null) {
    const parsed = text(request.data.messageText, "messageText", MAX_MESSAGE);
    if (isFailure(parsed)) return parsed;
    message = parsed;
  }

  return {
    ok: true,
    value: {
      row,
      batchNo: batch.batchNo,
      patch: { state: "sourcing" },
      stampFields: ["updatedAt", "halfApprovedAt"],
      approvals: [
        {
          id: approvalId("half", batch.batchNo),
          kind: "halfReached",
          batchNo: batch.batchNo,
          draft: message ?? APPROVAL_DRAFTS.half(batch.productSlug),
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
  const lines: PlannedLine[] = [
    {
      id: "main",
      ingredientId: context.mainIngredientId ?? "main",
      qtyActual: weightRaw,
      costActual: costRaw,
    },
  ];

  return {
    ok: true,
    value: {
      row,
      batchNo: batch.batchNo,
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

  const surplus = surplusJars(jars, batch.paidCount);
  const jarsShort = Math.max(0, batch.paidCount - jars);

  const concerns: PlannedConcern[] = [];
  if (jarsShort > 0) {
    // Brief 7.7: the shortfall falls on the most recently paid orders, with a
    // Concern per affected customer proposing a jar from the next batch at
    // Rs 599 or a refund.
    const shares = yieldShortfallAllocation(context.paidOrders, jarsShort);
    for (const share of shares) {
      concerns.push({
        id: `yield-${batch.batchNo}-${share.orderId}`,
        type: "yieldShortfall",
        batchNo: batch.batchNo,
        customerPhone: share.customerPhone,
        orderId: share.orderId,
        summary: `Batch ${batch.batchNo} bottled ${jars} jars against ${batch.paidCount} paid. This order is ${share.jarsShort} jar${share.jarsShort === 1 ? "" : "s"} short.`,
        proposal: "A jar from the next batch of the same product at Rs 599, or a refund.",
        urgent: true,
      });
    }
    if (shares.length === 0) {
      concerns.push({
        id: `yield-${batch.batchNo}`,
        type: "yieldShortfall",
        batchNo: batch.batchNo,
        customerPhone: null,
        orderId: null,
        summary: `Batch ${batch.batchNo} bottled ${jars} jars against ${batch.paidCount} paid: ${jarsShort} short.`,
        proposal: "A jar from the next batch of the same product at Rs 599, or a refund.",
        urgent: true,
      });
    }
  }

  return {
    ok: true,
    value: {
      row,
      batchNo: batch.batchNo,
      patch: {
        state: "bottled",
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

  const concerns: PlannedConcern[] = context.paidOrders.map((order) => ({
    id: `paused-${batch.batchNo}-${order.id}`,
    type: "batchPaused" as const,
    batchNo: batch.batchNo,
    customerPhone: order.customerPhone,
    orderId: order.id,
    summary: `Batch ${batch.batchNo} is paused: ${reason}`,
    proposal: null,
    urgent: false,
  }));

  return {
    ok: true,
    value: {
      row,
      batchNo: batch.batchNo,
      patch: { state: "paused", pausedReason: reason },
      stampFields: ["updatedAt"],
      approvals: [],
      concerns,
      lines: [],
      computed: { pausedFrom: batch.state ?? "", concerns: concerns.length },
    },
  };
}

function planResume(row: TransitionRow, batch: BatchView): Planned | Failure {
  return {
    ok: true,
    value: {
      row,
      batchNo: batch.batchNo,
      patch: { state: row.to, pausedReason: null },
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
  readonly batchNo: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface FullApprovalPlan {
  readonly batchNo: string;
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
  if (typeof data.batchNo !== "string" || !BATCH_NO.test(data.batchNo)) {
    return invalid('batchNo must be the zero-padded batch number, for example "001".');
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

  return { ok: true, value: { batchNo: data.batchNo, data: given } };
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
    return fail("not-found", `There is no batch ${request.batchNo}.`);
  }
  if (batch.fullReachedAt === null) {
    return fail(
      "failed-precondition",
      `Batch ${batch.batchNo} is not full yet, so there is nothing to say yes to.`,
    );
  }

  if (batch.fullApprovedAt !== null) {
    return {
      ok: true,
      value: {
        batchNo: batch.batchNo,
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
    const parsed = text(request.data.messageText, "messageText", MAX_MESSAGE);
    if (isFailure(parsed)) return parsed;
    message = parsed;
  }

  return {
    ok: true,
    value: {
      batchNo: batch.batchNo,
      patch: {},
      stampFields: ["updatedAt", "fullApprovedAt"],
      approvals: [
        {
          id: approvalId("full", batch.batchNo),
          kind: "full",
          batchNo: batch.batchNo,
          draft: message ?? APPROVAL_DRAFTS.full(),
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
          id: approvalId("half", batch.batchNo),
          kind: "halfReached",
          batchNo: batch.batchNo,
          draft: APPROVAL_DRAFTS.half(batch.productSlug),
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
          id: approvalId("full", batch.batchNo),
          kind: "full",
          batchNo: batch.batchNo,
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
          id: approvalId("half", batch.batchNo),
          supersededBy: approvalId("full", batch.batchNo),
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
            id: approvalId("inStock", batch.batchNo),
            kind: "broadcast",
            batchNo: batch.batchNo,
            draft: APPROVAL_DRAFTS.inStock(batch.productSlug),
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
