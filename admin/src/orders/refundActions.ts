/**
 * The two callables M4.5 adds: `recordRefund` and `markOrderRefusal`
 * (`functions/src/money/recordRefund.ts`).
 *
 * `refunds`, `documents` and every money field on an order take no client
 * write in any role (`firestore.rules`, CLAUDE.md §3), so this file is the one
 * door the refund panel goes through, the same shape `shipmentActions.ts`
 * already is for packing.
 *
 * D31: neither of these starts a refund through the Razorpay API. The refund
 * has already happened, in the dashboard, by UPI or in cash, and this records
 * it.
 */
import type { RefundMethod } from "@lailark/shared";
import { httpsCallable } from "firebase/functions";

import { functions } from "../firebase";

export interface RecordRefundInput {
  readonly orderId: string;
  readonly method: RefundMethod;
  /** Integers in paise. Never rupees, never a float (CLAUDE.md §3). */
  readonly amountPaise: number;
  readonly razorpayRefundId?: string;
  readonly reference?: string;
  readonly note?: string;
  readonly gatewayFeeUnreturnedPaise?: number;
  readonly refusalReason?: string;
}

export interface RecordRefundResult {
  readonly orderId: string;
  readonly refundId: string;
  readonly method: RefundMethod;
  readonly amount: number;
  readonly refundedTotal: number;
  readonly fullyRefunded: boolean;
  readonly orderState: string;
  readonly paymentStatus: string;
  readonly jarsReturned: number;
  readonly jarsHeldBackBecause: string | null;
  readonly documentKind: string;
  readonly documentNumber: string;
  readonly refusalReason: string | null;
}

export async function callRecordRefund(input: RecordRefundInput): Promise<RecordRefundResult> {
  const call = httpsCallable<Record<string, unknown>, RecordRefundResult>(functions, "recordRefund");
  const result = await call({ ...input });
  return result.data;
}

export interface MarkRefusalResult {
  readonly orderId: string;
  readonly refusalReason: string | null;
  readonly allowanceSpent: boolean;
}

/**
 * D65: the refusal mark may be added or changed after the refund. `null` takes
 * it off, which hands the customer's per-person allowance back.
 */
export async function callMarkOrderRefusal(
  orderId: string,
  reason: string | null,
): Promise<MarkRefusalResult> {
  const call = httpsCallable<Record<string, unknown>, MarkRefusalResult>(
    functions,
    "markOrderRefusal",
  );
  const result = await call({ orderId, reason });
  return result.data;
}
