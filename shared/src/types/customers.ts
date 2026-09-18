/** `customers` and its addresses. Brief section 18.1. */

import type { ActorId, BaseDoc, PhoneE164, Timestamp } from "./base.js";

export interface Consent {
  readonly given: boolean;
  readonly at: Timestamp | null;
  readonly by: ActorId | null;
}

export interface CustomerConsents {
  readonly updates: Consent;
  readonly marketing: Consent;
}

export interface CustomerStats {
  readonly orders: number;
  readonly jars: number;
  readonly lastOrderAt: Timestamp | null;
}

/**
 * `customers/{phoneE164}`. The document id is the number, which makes "one
 * customer per number" true by construction.
 */
export interface Customer extends BaseDoc {
  readonly name: string;
  readonly email: string | null;
  readonly country: string;
  readonly consents: CustomerConsents;
  readonly shareCode: string | null;
  readonly stats: CustomerStats;
}

/** `customers/{phone}/addresses/{id}`. */
export interface Address extends BaseDoc {
  readonly name: string;
  readonly phone: PhoneE164;
  readonly lines: readonly string[];
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
  /** A stable hash of the address, so a repeat is recognised. */
  readonly hash: string;
}
