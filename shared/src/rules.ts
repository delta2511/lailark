/**
 * The field lists the security rules enforce, as values the apps can read.
 *
 * `firestore.rules` is not importable from TypeScript, and a rule that says
 * "the kitchen may change these eight fields" is only half a feature: the
 * admin has to grey out the other twenty-odd inputs, or Sumayya taps Save and
 * gets a permission error with nothing to fix. So the same two lists live
 * here and in `firestore.rules`, and `rules-tests/` parses the rules file and
 * asserts the two sets match, character for character. Change one, the test
 * fails until you change the other.
 *
 * Brief section 18.2: "rules allow the kitchen to change only kitchen fields
 * on a batch (weights, dates, costs, updates), checked by comparing which
 * keys changed."
 */

import type { Batch } from "./types/kitchen.js";

/** Any key of the batch document, including the three every document has. */
type BatchField = keyof Batch;

/**
 * Fields on `batches/{nnn}` that no client may write, ever, in any role.
 *
 * Two kinds of field are on this list:
 *
 * - **Transaction owned.** `paidCount`, `heldJars`, `bottledJars` and
 *   `writtenOff` are the jar count. They change only inside a Firestore
 *   transaction on this document, run by a function that checks
 *   `paid + live holds + requested <= bookable` first (CLAUDE.md section 3).
 *   A client write here would oversell a batch.
 * - **Server computed.** `bookableJars` and `perPersonLimit` are arithmetic on
 *   `plannedJars`; `bestBefore` and `saleStopOn` are arithmetic on `packedOn`;
 *   `pnl` is kept current by a trigger; `state` and the four `...At` stamps
 *   are the lifecycle, moved only by the `transitionBatch` callable (M2.3) so
 *   the transition table in brief section 8.2 is the only way through.
 *
 * The Owner has every right in the product and still cannot write these. That
 * is deliberate: the restriction is not about trust, it is about there being
 * exactly one code path that can make a count wrong.
 */
export const PROTECTED_BATCH_FIELDS = [
  "bestBefore",
  "bookableJars",
  "bottledJars",
  "fullApprovedAt",
  "fullReachedAt",
  "halfApprovedAt",
  "halfReachedAt",
  "heldJars",
  "paidCount",
  "perPersonLimit",
  "pnl",
  "saleStopOn",
  "state",
  "writtenOff",
] as const satisfies readonly BatchField[];

export type ProtectedBatchField = (typeof PROTECTED_BATCH_FIELDS)[number];

/**
 * The only fields on `batches/{nnn}` the Kitchen role may change.
 *
 * Brief section 17.12 gives Kitchen "Move a batch through Sourcing, Cooking,
 * Bottled" and "Weights, costs, photos, updates". The move is a callable, not
 * a field write, so what is left for the rules is the sourcing note, the three
 * dates, the three weights and the packaging costs. Prices, planned jars, the
 * recipe and the product are the Owner's.
 *
 * `updatedAt` and `updatedBy` are on the list because the admin's write
 * wrapper stamps them on every save (M2.6). Without them every kitchen save
 * would be denied for touching a field outside the list.
 */
export const KITCHEN_BATCH_FIELDS = [
  "cookedOn",
  "costs",
  "landedOn",
  "packedOn",
  "source",
  "updatedAt",
  "updatedBy",
  "weightCleaned",
  "weightCooked",
  "weightRaw",
] as const;

export type KitchenBatchField = (typeof KITCHEN_BATCH_FIELDS)[number];

/** True if `field` is one the rules will refuse from any client. */
export function isProtectedBatchField(field: string): field is ProtectedBatchField {
  return (PROTECTED_BATCH_FIELDS as readonly string[]).includes(field);
}

/** True if `field` is one the Kitchen role may change on a batch. */
export function isKitchenBatchField(field: string): field is KitchenBatchField {
  return (KITCHEN_BATCH_FIELDS as readonly string[]).includes(field);
}

/**
 * The fields the given role may write on a batch, given the whole set of
 * fields a screen offers. The admin uses this to disable inputs rather than
 * let a save fail: `owner` gets everything except the protected list,
 * `kitchen` gets the kitchen list, `viewer` gets nothing.
 */
export function writableBatchFields(role: string, fields: readonly string[]): string[] {
  if (role === "owner") return fields.filter((f) => !isProtectedBatchField(f));
  if (role === "kitchen") return fields.filter((f) => isKitchenBatchField(f));
  return [];
}
