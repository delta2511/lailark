/** `conversations`, `concerns`, `approvals`, `notify`. Brief section 18.1. */

import type { Paise } from "../money.js";
import type {
  ApprovalKind,
  ApprovalStatus,
  ConcernType,
  MessageDirection,
} from "../states.js";
import type { ActorId, BaseDoc, PhoneE164, Timestamp } from "./base.js";

/** `conversations/{phoneE164}`. */
export interface Conversation extends BaseDoc {
  readonly lastMessageAt: Timestamp | null;
  /** The WhatsApp 24 hour service window. */
  readonly windowExpiresAt: Timestamp | null;
  readonly summary: string | null;
  readonly memory: Readonly<Record<string, unknown>>;
}

/** `conversations/{phone}/messages/{id}`. */
export interface Message extends BaseDoc {
  readonly direction: MessageDirection;
  readonly templateName: string | null;
  readonly body: string;
  readonly mediaPath: string | null;
  readonly metaMessageId: string | null;
  readonly status: string;
  readonly category: string | null;
  readonly at: Timestamp;
}

export interface ConcernMoney {
  readonly amount: Paise;
  readonly direction: "refund" | "charge" | "none";
}

/** `concerns/{id}`: everything that waits for the Owner. */
export interface Concern extends BaseDoc {
  readonly type: ConcernType;
  readonly customerPhone: PhoneE164 | null;
  readonly orderId: string | null;
  /**
   * The batch's internal reference, `"b-7f3a2c"`, or null. D21c: never the
   * printed number, so a concern raised on an open batch still points at the
   * same document after bottling stamps that batch's `batchNo`.
   */
  readonly batchRef: string | null;
  readonly summary: string;
  readonly proposal: string | null;
  readonly draftMessage: string | null;
  readonly answer: string | null;
  readonly outcome: string | null;
  readonly money: ConcernMoney | null;
  readonly raisedAt: Timestamp;
  readonly dueAt: Timestamp | null;
  readonly answeredAt: Timestamp | null;
  readonly sentAt: Timestamp | null;
  readonly urgent: boolean;
}

/** `approvals/{id}`: nothing goes to a customer without one. */
export interface Approval extends BaseDoc {
  readonly kind: ApprovalKind;
  /**
   * The batch's internal reference, `"b-7f3a2c"`, or null. D21c: an approval
   * is raised long before the batch has a printed number, and is never
   * re-pointed when it gets one.
   */
  readonly batchRef: string | null;
  readonly draft: string;
  readonly status: ApprovalStatus;
  readonly answeredBy: ActorId | null;
  readonly at: Timestamp | null;
  /**
   * The production clock this approval starts: five days at half reached,
   * three days once the batch is full (brief 7.3 and 8.2). Null for an
   * approval with no clock, such as a broadcast offer.
   */
  readonly dueAt: Timestamp | null;
  /**
   * The approval whose clock replaced this one's, or null. Brief §8.2: "3-day
   * production clock replaces the 5-day" once the batch is full, so the half
   * approval's `dueAt` is cleared and this says by what. Never more than one
   * clock is live on a batch at a time.
   */
  readonly dueAtSupersededBy: string | null;
  /**
   * When the approved message actually went out. An approved approval with no
   * `sentAt` is the "recorded as sent-pending" of M2.5: the Owner has said
   * yes, and sending itself arrives in M5.
   */
  readonly sentAt: Timestamp | null;
}

/** `notify/{id}`: the notify-me list. */
export interface NotifyEntry extends BaseDoc {
  readonly phone: PhoneE164;
  readonly productSlug: string | null;
  readonly country: string | null;
  readonly source: string;
  readonly consentAt: Timestamp | null;
  readonly unsubscribedAt: Timestamp | null;
}
