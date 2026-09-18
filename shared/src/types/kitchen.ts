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
 * `batches/{nnn}`. The document id is the batch number, zero padded to three
 * digits: `"001"`. Global, sequential, never reused.
 */
export interface Batch extends BaseDoc {
  readonly productSlug: string;
  readonly recipeId: string;
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
  readonly costs: BatchCosts;
  /** Kept current by a trigger. Never written by a client. */
  readonly pnl: BatchPnl;
}

/** `batches/{nnn}/lines/{id}`: what the pot actually used. */
export interface BatchLine extends BaseDoc {
  readonly ingredientId: string;
  readonly qtyActual: number;
  readonly costActual: Paise;
}

/** `batches/{nnn}/updates/{id}`: a kitchen photo update, owner approved (D5). */
export interface BatchUpdate extends BaseDoc {
  readonly photoPath: string | null;
  readonly kitchenLine: string;
  readonly messageText: string;
  readonly approvedBy: ActorId | null;
  readonly sentAt: Timestamp | null;
}

/** `batches/{nnn}/writeOffs/{id}`: a jar that will never be sold. */
export interface WriteOff extends BaseDoc {
  readonly qty: number;
  readonly reason: string;
  readonly by: ActorId;
}
