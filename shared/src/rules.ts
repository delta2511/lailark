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

import type { SettingsName } from "./states.js";
import type { Batch } from "./types/kitchen.js";
import type { PermissionsSettings } from "./types/system.js";

/** Any key of the batch document, including the three every document has. */
type BatchField = keyof Batch;

/**
 * Fields on `batches/{ref}` that no client may write, ever, in any role.
 *
 * Two kinds of field are on this list:
 *
 * - **Transaction owned.** `paidCount`, `heldJars`, `bottledJars` and
 *   `writtenOff` are the jar count. They change only inside a Firestore
 *   transaction on this document, run by a function that checks
 *   `paid + live holds + requested <= bookable` first (CLAUDE.md section 3).
 *   A client write here would oversell a batch.
 * - **Server computed.** `bookableJars` and `perPersonLimit` are arithmetic on
 *   `plannedJars` (D44 leaves `perPersonLimit` exactly that, and puts the
 *   Owner's own cap in `perPersonLimitOverride` beside it, which is his to
 *   write and so is deliberately **not** on this list); `bestBefore` and
 *   `saleStopOn` are arithmetic on `packedOn`;
 *   `pnl` is kept current by a trigger; `state`, `pausedFrom` and the four
 *   `...At` stamps are the lifecycle, moved only by the `transitionBatch`
 *   callable (M2.3) so the transition table in brief section 8.2 is the only
 *   way through; and `batchNo` is the printed number, which decision D21c
 *   allocates from `counters/batch` at Cooking -> Bottled and nowhere else. A
 *   client that could write `batchNo` could print two jars with one number.
 *
 * The Owner has every right in the product and still cannot write these. That
 * is deliberate: the restriction is not about trust, it is about there being
 * exactly one code path that can make a count wrong.
 */
export const PROTECTED_BATCH_FIELDS = [
  "batchNo",
  "bestBefore",
  "bookableJars",
  "bottledJars",
  "fullApprovedAt",
  "fullReachedAt",
  "halfApprovedAt",
  "halfReachedAt",
  "heldJars",
  "paidCount",
  "pausedFrom",
  "perPersonLimit",
  "pnl",
  "saleStopOn",
  "state",
  "writtenOff",
] as const satisfies readonly BatchField[];

export type ProtectedBatchField = (typeof PROTECTED_BATCH_FIELDS)[number];

/**
 * The only fields on `batches/{ref}` the Kitchen role may change.
 *
 * Brief section 17.12 gives Kitchen "Move a batch through Sourcing, Cooking,
 * Bottled" and "Weights, costs, photos, updates". The move is a callable, not
 * a field write, so what is left for the rules is the sourcing note, the three
 * dates, the three weights and the packaging costs. Prices, planned jars, the
 * recipe and the product are the Owner's, `perPersonLimitOverride` (D44)
 * included.
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

/* -------------------------------------------------------------------------- */
/* Ingredients and recipes, question Q4                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where the Owner's "Kitchen may edit ingredients and recipes" switch lives.
 *
 * Q4, answered by Shefin: Owner only for now, with a switch to let the Kitchen
 * edit later; the Kitchen reads every ingredient and recipe either way. One
 * switch covers both collections because a recipe and its ingredients are
 * edited together. Like the discount cap (D17) it is a setting the Owner
 * flips, not code. `firestore.rules` reads the same document and field, and
 * treats anything but a literal `true` (including no document) as off.
 *
 * Deleting an ingredient or recipe stays the Owner's whatever the switch
 * says, because a batch's history points at them.
 */
export const KITCHEN_RECIPE_EDIT_SWITCH = {
  collection: "settings",
  doc: "permissions",
  field: "kitchenCanEditRecipes",
  default: false,
} as const satisfies {
  collection: "settings";
  doc: SettingsName;
  field: keyof PermissionsSettings;
  default: boolean;
};

/**
 * Whether the Kitchen may create and edit ingredients and recipes, given the
 * `settings/permissions` document as read (or `undefined` if it does not
 * exist). True only for a literal `true`, exactly like the rule, so the admin
 * never offers an input the rules would refuse.
 */
export function kitchenCanEditRecipes(
  permissions: Partial<PermissionsSettings> | undefined,
): boolean {
  return permissions?.kitchenCanEditRecipes === true;
}
