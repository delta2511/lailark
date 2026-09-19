/** `batches` and its subcollections. Brief section 18.1. */

import type { Paise } from "../money.js";
import type { BatchState } from "../states.js";
import type { ActorId, BaseDoc, IsoDate, Timestamp } from "./base.js";

/**
 * One live hold on the batch document, keyed by order id. Section 9.3.
 *
 * `customerPhone` is not in section 18.1's field list, which spells the map as
 * `heldJars{orderId: {qty, expiresAt}}`. It is here because §7.2 step 3 checks
 * the per-person limit "across all their orders in this batch", and a hold is
 * one of those orders: without the number on the hold itself, the hold
 * transaction cannot tell whose live holds it is looking at, and the limit
 * could only be enforced against orders that have already been paid. Batches
 * are readable by the three admin roles alone (`firestore.rules`), so no
 * customer number is exposed by keeping it here.
 */
export interface BatchHold {
  readonly qty: number;
  readonly expiresAt: Timestamp;
  /** E.164, the `customers/{phoneE164}` document id of §18.1. */
  readonly customerPhone: string;
}

export interface BatchCosts {
  readonly jarsLids: Paise;
  readonly boxInserts: Paise;
  readonly labelling: Paise;
  readonly gasPower: Paise;
}

export interface BatchPnl {
  readonly revenue: Paise;
  readonly ingredientCost: Paise;
  readonly packagingCost: Paise;
  readonly shippingCost: Paise;
  readonly gatewayFees: Paise;
  readonly writeOffCost: Paise;
  readonly margin: Paise;
}

/**
 * `batches/{ref}`. **Decision D21c: a batch has two names.**
 *
 * The document id is the **internal reference**, `b-` plus six lowercase
 * base32 characters (`"b-7f3a2c"`, see `isBatchRef`). It is fixed for the
 * batch's whole life, from draft onwards, and it never changes, so no order,
 * concern, approval, audit entry or subcollection ever has to be re-pointed.
 *
 * `batchNo` is the **printed** number, zero padded to three digits (`"001"`),
 * global across products, sequential, never reused. It is null until the jars
 * are bottled, and it is allocated from `counters/batch` inside the same
 * transaction as the rest of Cooking -> Bottled. That is a divergence from
 * brief §8.2, which allocates it at Draft -> Open; D21c overrides that line so
 * that a number always means jars that exist and the sequence can never have a
 * hole. `/batch/<nnn>` therefore exists only from bottling and is always a
 * record; an open batch is watched on its product page instead.
 *
 * Anything that resolves a batch by its printed number queries this field.
 * Nothing resolves one by the document id.
 */
export interface Batch extends BaseDoc {
  /**
   * The printed batch number, `"001"`, or null before bottling. Server
   * allocated at Cooking -> Bottled, and a protected field: no client writes
   * it, the Owner included.
   */
  readonly batchNo: string | null;
  readonly productSlug: string;
  /**
   * The product as a customer knows it, copied from `products/{slug}.name`
   * when the batch is created. Kept on the batch so a customer message can be
   * drafted (D24) without reading the catalogue inside every transaction.
   */
  readonly productName: string | null;
  readonly recipeId: string;
  /** The main ingredient's label name, for the half-reached message (D24). */
  readonly mainIngredientName: string | null;
  readonly state: BatchState;
  readonly plannedJars: number;
  /** `floor(plannedJars * 9 / 10)`. This is the number the card shows. */
  readonly bookableJars: number;
  readonly perPersonLimit: number;
  readonly priceOpen: Paise;
  readonly priceInStock: Paise;
  /** Changed only inside a transaction on this document. */
  readonly paidCount: number;
  readonly heldJars: Readonly<Record<string, BatchHold>>;
  readonly bottledJars: number;
  readonly writtenOff: number;
  readonly source: string | null;
  readonly landedOn: IsoDate | null;
  readonly cookedOn: IsoDate | null;
  readonly packedOn: IsoDate | null;
  readonly bestBefore: IsoDate | null;
  readonly saleStopOn: IsoDate | null;
  readonly weightRaw: number | null;
  readonly weightCleaned: number | null;
  readonly weightCooked: number | null;
  readonly halfReachedAt: Timestamp | null;
  readonly halfApprovedAt: Timestamp | null;
  readonly fullReachedAt: Timestamp | null;
  readonly fullApprovedAt: Timestamp | null;
  readonly pausedReason: string | null;
  /**
   * The state this batch was paused from, or null when it is not paused.
   * D23: resuming returns a batch to the state it was paused from, so the
   * batch remembers it rather than the Owner choosing at resume time. Server
   * written, and protected for the same reason `state` is.
   */
  readonly pausedFrom: BatchState | null;
  readonly costs: BatchCosts;
  /** Kept current by a trigger. Never written by a client. */
  readonly pnl: BatchPnl;
}

/** `batches/{ref}/lines/{id}`: what the pot actually used. */
export interface BatchLine extends BaseDoc {
  readonly ingredientId: string;
  readonly qtyActual: number;
  readonly costActual: Paise;
}

/** `batches/{ref}/updates/{id}`: a kitchen photo update, owner approved (D5). */
export interface BatchUpdate extends BaseDoc {
  readonly photoPath: string | null;
  readonly kitchenLine: string;
  readonly messageText: string;
  readonly approvedBy: ActorId | null;
  readonly sentAt: Timestamp | null;
}

/** `batches/{ref}/writeOffs/{id}`: a jar that will never be sold. */
export interface WriteOff extends BaseDoc {
  readonly qty: number;
  readonly reason: string;
  readonly by: ActorId;
}
