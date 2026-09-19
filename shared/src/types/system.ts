/** `users`, `policyVersions`, `settings`, `audit`. Brief section 18.1. */

import type { Paise } from "../money.js";
import type {
  Courier,
  DocumentKind,
  PolicyKind,
  Role,
  ShippingRule,
} from "../states.js";
import type { ActorId, BaseDoc, PhoneE164, Timestamp } from "./base.js";

/** `users/{uid}`. The role is also a custom claim, which is what rules check. */
export interface User extends BaseDoc {
  readonly name: string;
  readonly phone: PhoneE164;
  readonly role: Role;
  readonly active: boolean;
}

/** `policyVersions/{id}`. An order records which version it agreed to. */
export interface PolicyVersion extends BaseDoc {
  readonly kind: PolicyKind;
  readonly text: string;
  readonly publishedAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* settings/{name}                                                            */
/* -------------------------------------------------------------------------- */

/** `settings/gst`. Off at launch, ready from day one. */
export interface GstSettings {
  readonly enabled: boolean;
  readonly gstin: string | null;
  readonly homeState: string;
  readonly rateBasisPoints: number;
}

/** `settings/shipping`. Brief section 4.2, decision D12. */
export interface ShippingSettings {
  readonly rule: ShippingRule;
  readonly flatFee: Paise;
  readonly freeFromJars: number;
}

/** `settings/dispatch`. Decision D11: 6 pm cut-off, Sundays off. */
export interface DispatchSettings {
  /** Hour of day in Asia/Kolkata, 0-23. */
  readonly cutOffHour: number;
  /** ISO weekday numbers that are not working days. Sunday is 7. */
  readonly nonWorkingWeekdays: readonly number[];
  /** `"YYYY-MM-DD"` holidays. */
  readonly holidays: readonly string[];
}

/** `settings/holds`. Brief section 9.3: 15 minutes on the web. */
export interface HoldsSettings {
  readonly webHoldMinutes: number;
  readonly paymentLinkHoldMinutes: number;
}

/** `settings/shelfLife`. The inputs to `saleStopOn`. Brief section 6.2. */
export interface ShelfLifeSettings {
  readonly shelfLifeMonths: number;
  readonly shelfLifeDays: number;
  readonly minRemainingFraction: number;
  readonly minRemainingDays: number;
  readonly transitDays: number;
  readonly warnDays: number;
}

/** `settings/courier`. */
export interface CourierSettings {
  readonly preferred: Courier;
  readonly fallback: Courier;
}

/** `settings/prefixes`. Brief section 17.11: the bill prefixes. */
export interface PrefixSettings {
  readonly document: Readonly<Record<DocumentKind, string>>;
}

/** `settings/discountCap`. Decision D17: ships empty until the Owner sets it. */
export interface DiscountCapSettings {
  /** Null means the kitchen may not discount at all. */
  readonly kitchenCap: Paise | null;
  readonly reasonRequired: boolean;
}

/** `settings/pincodes`. Brief section 18.1: the serviceable list, refreshed weekly. */
export interface PincodesSettings {
  readonly serviceable: readonly string[];
  readonly refreshedAt: Timestamp;
  readonly source: "shiprocket" | "manual";
  readonly count: number;
}

/**
 * `settings/permissions`. Question Q4: ingredients and recipes are the Owner's
 * to edit, and the Kitchen reads all of them. `kitchenCanEditRecipes` is the
 * Owner's switch that lets the Kitchen create and edit both as well. Off by
 * default, and a missing document or field means off. Only a literal `true`
 * turns it on: see `kitchenCanEditRecipes()` in `rules.ts`, which mirrors the
 * check in `firestore.rules`.
 */
export interface PermissionsSettings {
  readonly kitchenCanEditRecipes: boolean;
}

/**
 * `settings/messages`. Decision D24, answering Q11: Claude drafts the three
 * customer messages and the Owner can edit them. This document is the edit.
 *
 * Each field is a template whose `{product}`, `{ingredient}` and `{price}` are
 * substituted from the batch, so a message never types a price or a count.
 * A missing document, a missing field or an empty string all mean "the Owner
 * has not written one", and `DEFAULT_CUSTOMER_MESSAGES` in `messages.ts` is
 * used instead. Settings are Owner-write and read by all three roles.
 *
 * Editing these changes the **draft** the Owner is offered. It never sends
 * anything: every message still becomes an `approvals` document with `sentAt`
 * null and waits for his yes (D5).
 */
export interface MessagesSettings {
  /** Draft -> Open, to the people who asked to be told. */
  readonly batchOpen: string;
  /** Open -> Half reached, brief 7.2 step 7. */
  readonly halfReached: string;
  /** Bottled -> In stock, to the notify-me list. */
  readonly backInStock: string;
}

/** `settings/{name}`, keyed by name. */
export interface SettingsByName {
  readonly gst: GstSettings;
  readonly shipping: ShippingSettings;
  readonly dispatch: DispatchSettings;
  readonly holds: HoldsSettings;
  readonly shelfLife: ShelfLifeSettings;
  readonly courier: CourierSettings;
  readonly prefixes: PrefixSettings;
  readonly discountCap: DiscountCapSettings;
  readonly pincodes: PincodesSettings;
  readonly permissions: PermissionsSettings;
  readonly messages: MessagesSettings;
}

/** One settings document, whichever name it carries. */
export type Settings<K extends keyof SettingsByName = keyof SettingsByName> =
  SettingsByName[K] & BaseDoc;

/** `audit/{id}`. Undo reads from here. */
export interface AuditEntry extends BaseDoc {
  /** The document path that changed. */
  readonly object: string;
  readonly action: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly by: ActorId;
  readonly at: Timestamp;
}
