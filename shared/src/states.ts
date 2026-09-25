/**
 * The spellings.
 *
 * Every state, method, channel and role the system knows, as a string union
 * plus an `as const` array of the same values. The array is what security
 * rules, admin dropdowns and function validators iterate over, so there is one
 * place a spelling can be wrong, and a test that would catch it.
 */

/* -------------------------------------------------------------------------- */
/* Batch, brief section 8.1                                                   */
/* -------------------------------------------------------------------------- */

export const BATCH_STATES = [
  "draft",
  "open",
  "halfReached",
  "sourcing",
  "cooking",
  "bottled",
  "inStock",
  "soldOut",
  "archived",
  "paused",
] as const;
export type BatchState = (typeof BATCH_STATES)[number];

/**
 * The batch states in which a jar can still be booked at the open price.
 * Brief section 7.5: Rs 599 stays while the batch is Open or Sourcing, and
 * booking closes when cooking starts.
 */
export const BATCH_STATES_OPEN_FOR_BOOKING = ["open", "halfReached", "sourcing"] as const;

/** The batch states in which a bottled jar can be bought in stock at Rs 649. */
export const BATCH_STATES_IN_STOCK = ["bottled", "inStock"] as const;

/**
 * The batch states in which a booking that was **already made and paid for**
 * is still honoured, as opposed to the states in which a *new* booking may be
 * taken (`BATCH_STATES_OPEN_FOR_BOOKING`, above).
 *
 * **Decision, M3.8, answering A200.** Booking closes when cooking starts
 * (brief §7.5), and it closes here too: `readStockClaim` refuses `cooking`
 * with "not on sale", so nothing on the site or at the counter can take a
 * jar out of a batch on the stove. That is about people who have not paid.
 *
 * A capture landing on a lapsed hold is a different question. The customer
 * booked while the batch was Open, the money has arrived, and the only thing
 * that went wrong is that fifteen minutes passed between the Razorpay window
 * opening and the payment confirming, which is not something they did. Before
 * this group existed `cooking` fell through to `bookableJars: 0`, so that
 * customer was told there was no jar and the Owner got a concern to settle by
 * hand, while the pot on the stove had room for them.
 *
 * Honouring it cannot oversell. The reclaim is still `paid + live holds +
 * requested <= bookableJars`, on the batch as that transaction read it, and
 * `bookableJars` is the 90% cap (brief §7.1) that the pot was planned around.
 * A jar honoured here is a jar that was inside the cap the whole time.
 *
 * `paused`, `soldOut` and `archived` are deliberately **not** here (A198): a
 * paused batch is one somebody froze on purpose, and the other two have
 * nothing left to give.
 */
export const BATCH_STATES_HONOUR_PAID_BOOKING = [
  "open",
  "halfReached",
  "sourcing",
  "cooking",
] as const;

/**
 * Every state a batch can be paused from, and so every state it can resume to.
 *
 * **Decision D23**, answering Q13. The brief contradicted itself: §8.2's
 * transition table has a row "Any → Paused", while §8.1's diagram says
 * "Paused ← from Open, Half reached, Sourcing or Cooking". Shefin's answer is
 * §8.2's: a batch is pausable from Open, Half reached, Sourcing, Cooking, In
 * stock and Sold out. In stock is the one that mattered: without it there was
 * no way to freeze sales on a jar that turns out to be bad.
 *
 * The two states that are not here, and why:
 *
 *  - **Draft** is not on sale. There is nothing to freeze: a draft is not
 *    published, no jar can be held against it and no customer knows it exists.
 *    The Owner simply leaves it as a draft.
 *  - **Archived** is closed, with its P&L locked by the state itself (§8.2).
 *    Pausing it would reopen a batch whose books are shut.
 *
 * Resuming returns a batch to the state it was paused from, which the batch
 * remembers in `pausedFrom`: it is not the Owner's choice at resume time.
 */
export const BATCH_STATES_PAUSABLE = [
  "open",
  "halfReached",
  "sourcing",
  "cooking",
  "inStock",
  "soldOut",
] as const;

/** Brief section 8.1 and the transition table in 8.2, with D23's pause rows. */
export const BATCH_TRANSITIONS: Readonly<Record<BatchState, readonly BatchState[]>> = {
  // D23: a draft is not on sale, so there is nothing to pause.
  draft: ["open"],
  open: ["halfReached", "paused"],
  halfReached: ["sourcing", "paused"],
  sourcing: ["cooking", "paused"],
  cooking: ["bottled", "paused"],
  bottled: ["inStock", "soldOut"],
  inStock: ["soldOut", "paused"],
  soldOut: ["archived", "paused"],
  // D23: archived is closed and its P&L is locked. Nothing comes back out.
  archived: [],
  paused: [...BATCH_STATES_PAUSABLE],
};

/**
 * Whether a batch may move from `from` to `to`. Accepts plain `string` (and
 * `undefined`) because `from`/`to` are often a state string just read back
 * from Firestore, whose type at runtime is `unknown` to us however tightly
 * it's typed at compile time. An unrecognised state on either side is simply
 * not a valid transition, not a thrown error.
 */
export function canTransitionBatch(from: BatchState, to: BatchState): boolean;
export function canTransitionBatch(from: string | undefined, to: string | undefined): boolean;
export function canTransitionBatch(from: string | undefined, to: string | undefined): boolean {
  if (from === undefined || to === undefined) return false;
  if (!(BATCH_STATES as readonly string[]).includes(from)) return false;
  return BATCH_TRANSITIONS[from as BatchState].includes(to as BatchState);
}

/* -------------------------------------------------------------------------- */
/* Order and payment, brief section 9                                         */
/* -------------------------------------------------------------------------- */

export const ORDER_STATES = [
  "draft",
  "held",
  "awaitingPayment",
  "expired",
  "paidWaiting",
  "toPack",
  "readyForCollection",
  "packed",
  "shipped",
  "delivered",
  "deliveryProblem",
  "claim",
  "changeRequested",
  "paused",
  "refunded",
  "voided",
  "closed",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** Section 9.1 marks these "Terminal": nothing more is expected. */
export const ORDER_STATES_TERMINAL = ["expired", "voided", "closed"] as const;

/** Section 9.1 answers "Concern" for these: a concern document is raised. */
export const ORDER_STATES_RAISING_CONCERN = [
  "deliveryProblem",
  "claim",
  "changeRequested",
  "paused",
] as const;

/** Money is in and the jar is owed. Section 9.1. */
export const ORDER_STATES_PAID = [
  "paidWaiting",
  "toPack",
  "readyForCollection",
  "packed",
  "shipped",
  "delivered",
] as const;

/** `created -> authorized -> captured -> (refund recorded)`. Section 9.2. */
export const PAYMENT_STATUSES = [
  "created",
  "authorized",
  "captured",
  "partlyRefunded",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Decision D10 gives the counter both UPI paths. */
export const PAYMENT_METHODS = [
  "razorpay",
  "cash",
  "upiToAccount",
  "paymentLink",
  "razorpayQr",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods that confirm by Razorpay webhook rather than by a person. */
export const PAYMENT_METHODS_ONLINE = ["razorpay", "paymentLink", "razorpayQr"] as const;

/** Every order carries a channel. Brief section 9.1. */
export const ORDER_CHANNELS = ["web", "counter", "phone", "whatsapp", "abroad"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** Brief section 18.1, `orders/{id}.fulfilment`. */
export const FULFILMENT_MODES = ["ship", "handedOver", "collect"] as const;
export type FulfilmentMode = (typeof FULFILMENT_MODES)[number];

/* -------------------------------------------------------------------------- */
/* Money documents, brief sections 13.3 and 18.1                              */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_KINDS = ["receipt", "bill", "refundNote", "creditNote"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const REFUND_METHODS = ["razorpay", "upi", "cash"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_STATUSES = ["pending", "processed", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* Shipping, brief section 18.1                                               */
/* -------------------------------------------------------------------------- */

export const COURIERS = ["shiprocket", "indiaPost"] as const;
export type Courier = (typeof COURIERS)[number];

export const SHIPMENT_STATUSES = [
  "created",
  "labelled",
  "pickupScheduled",
  "picked",
  "inTransit",
  "outForDelivery",
  "delivered",
  "undelivered",
  "rto",
  "lost",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Brief section 4.2: the shipping switch has three positions. */
export const SHIPPING_RULES = ["free", "flatFee", "freeOnTwo"] as const;
export type ShippingRule = (typeof SHIPPING_RULES)[number];

/* -------------------------------------------------------------------------- */
/* Agent, brief section 18.1                                                  */
/* -------------------------------------------------------------------------- */

export const APPROVAL_KINDS = ["halfReached", "full", "broadcast", "photoUpdate"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = ["waiting", "approved", "notYet", "edited", "dropped"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const CONCERN_TYPES = [
  "yieldShortfall",
  "deliveryProblem",
  "claim",
  "changeRequested",
  "batchPaused",
  "batchStalled",
  "heldPaymentAgeing",
  "refundRequest",
  "paymentMismatch",
  "technicalFailure",
] as const;
export type ConcernType = (typeof CONCERN_TYPES)[number];

export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/* -------------------------------------------------------------------------- */
/* System, brief section 3 and decision D13                                   */
/* -------------------------------------------------------------------------- */

export const ROLES = ["owner", "kitchen", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PRODUCT_TYPES = ["hero", "pipeline"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const POLICY_KINDS = ["orders", "privacy", "terms", "shipping"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export const SETTINGS_NAMES = [
  "gst",
  "shipping",
  "dispatch",
  "holds",
  "shelfLife",
  "courier",
  "prefixes",
  "discountCap",
  "pincodes",
  "permissions",
  // D24: the three customer messages, the Owner's to edit. See messages.ts.
  "messages",
] as const;
export type SettingsName = (typeof SETTINGS_NAMES)[number];
