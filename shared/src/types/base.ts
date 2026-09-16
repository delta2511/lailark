/**
 * The shape every Firestore document in this system shares, and the timestamp
 * type the package uses.
 */

import type { TimestampLike } from "../dates.js";

/**
 * A Firestore timestamp, structurally.
 *
 * `shared/` deliberately has no `firebase` or `firebase-admin` dependency: it
 * is imported by the static site, by the admin bundle and by the functions,
 * and only one of those three has the SDK. Both the admin SDK `Timestamp` and
 * the web SDK `Timestamp` expose `seconds` and `nanoseconds`, so a real
 * Timestamp is assignable to this interface with no cast and no adapter.
 */
export type Timestamp = TimestampLike;

/** A calendar date stored as `"YYYY-MM-DD"`. See `dates.ts` for why. */
export type IsoDate = string;

/** A phone number in E.164, `"+917736110087"`. Used as a document id. */
export type PhoneE164 = string;

/** A Firebase Auth uid, or `"system"` for a write a trigger made. */
export type ActorId = string;

/** Brief section 18: every document has these three. */
export interface BaseDoc {
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly createdBy: ActorId;
}

/** A document that carries its own Firestore id in the body. */
export interface WithId {
  readonly id: string;
}
