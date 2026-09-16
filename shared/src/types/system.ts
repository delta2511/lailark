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
