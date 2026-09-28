/**
 * Recording a refund on an order, brief §12.3, M4.5. **Owner only**: money
 * moves, so `OrderDetail.tsx` renders this for nobody else and
 * `recordRefund`/`markOrderRefusal` refuse anybody else at the server too. A
 * screen with no button on it proves nothing.
 *
 * ## D31: recorded, not started
 *
 * Nothing on this panel calls the Razorpay API and nothing checks the payment's
 * age. The refund has already happened, in the Razorpay dashboard, by UPI, or
 * in cash; this writes it into the books. M4.5b adds the API refund and the
 * 6-month guard.
 *
 * ## Why hold-to-confirm
 *
 * Brief §17.1: the app has no "are you sure" dialogs "except for actions that
 * leave the system... those use hold-to-confirm". A recorded refund issues a
 * permanent, never-reused document number and can put a jar back on sale, so
 * it is one of those. `ui/HoldToConfirm.tsx` is the pattern, shared with
 * anything later that leaves the system.
 *
 * Shape follows `PackingSection.tsx`, which is the panel next door: a busy
 * flag, the server's own sentence read through `callableMessage`, a `sent`
 * flag so one hold cannot be spent twice, and nothing optimistic. The live
 * order and `refunds` listeners repaint the screen once the transaction lands.
 */
import { formatINR, type Paise, type RefundMethod, REFUND_METHODS } from "@lailark/shared";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { callableMessage } from "../callableError";
import { ORDERS } from "../copy";
import { HoldToConfirm } from "../ui/HoldToConfirm";
import { useRefundsForOrder, type OrderDoc } from "./data";
import { gatewayFeePaise, refundAmountPaise } from "./refundMoney";
import { callMarkOrderRefusal, callRecordRefund } from "./refundActions";

interface Props {
  readonly order: OrderDoc;
}

function rupeeBox(id: string, testId: string, value: string, set: (next: string) => void): JSX.Element {
  return (
    <input
      id={id}
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      data-testid={testId}
      placeholder="₹"
      value={value}
      onInput={(event) => set((event.target as HTMLInputElement).value)}
    />
  );
}

function Money({ label, paise, testId }: { readonly label: string; readonly paise: number; readonly testId: string }): JSX.Element {
  return (
    <div class="settings-field">
      <p class="field-label">{label}</p>
      <p class="field-value number" data-testid={testId}>
        {formatINR(paise as Paise)}
      </p>
    </div>
  );
}

export function RefundSection({ order }: Props): JSX.Element {
  const refunds = useRefundsForOrder(order.id);

  const paid = typeof order.payment?.amount === "number" ? order.payment.amount : 0;
  const returned = typeof order.payment?.refundedAmount === "number" ? order.payment.refundedAmount : 0;
  const left = Math.max(paid - returned, 0);
  const block = order.refund ?? null;
  const fullyRefunded = block?.fullyRefunded === true;
  const pending = block?.gatewayPending ?? null;
  // Brief §12.3's gateway fee only exists on a payment the gateway handled.
  const paidOnline =
    order.payment?.method === "razorpay" ||
    order.payment?.method === "paymentLink" ||
    order.payment?.method === "razorpayQr";

  const [method, setMethod] = useState<RefundMethod>("razorpay");
  const [amount, setAmount] = useState("");
  const [razorpayRefundId, setRazorpayRefundId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [fee, setFee] = useState("");
  const [refusalReason, setRefusalReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Same rule as `PackingSection`: a refusal, or a hold already spent, belongs
  // to the order as it was. Once the live listener reports new money, nothing
  // from the old attempt should still be on screen.
  useEffect(() => {
    setError(null);
    setSent(false);
  }, [order.state, returned]);

  async function record(): Promise<void> {
    setError(null);
    setDone(null);
    const paise = refundAmountPaise(amount);
    if (paise === null) {
      setError(ORDERS.refundBadAmount);
      return;
    }
    const feePaise = paidOnline && fee.trim() !== "" ? gatewayFeePaise(fee) : null;
    if (paidOnline && fee.trim() !== "" && feePaise === null) {
      setError(ORDERS.refundBadFee);
      return;
    }
    setBusy(true);
    try {
      const result = await callRecordRefund({
        orderId: order.id,
        method,
        amountPaise: paise,
        ...(method === "razorpay" ? { razorpayRefundId: razorpayRefundId.trim() } : {}),
        ...(method === "upi" ? { reference: reference.trim() } : {}),
        ...(note.trim() === "" ? {} : { note: note.trim() }),
        ...(feePaise === null ? {} : { gatewayFeeUnreturnedPaise: feePaise }),
        ...(refusalReason.trim() === "" ? {} : { refusalReason: refusalReason.trim() }),
      });
      setSent(true);
      setDone(
        result.jarsReturned > 0
          ? ORDERS.refundDoneJarsBack
          : `${ORDERS.refundDoneNoJars}${
              result.jarsHeldBackBecause
                ? ` ${ORDERS.refundHeldBackBecause[result.jarsHeldBackBecause] ?? ""}`
                : ""
            }`.trim(),
      );
      setAmount("");
      setNote("");
      setRefusalReason("");
    } catch (caught) {
      setError(callableMessage(caught, ORDERS.refundRefused));
    } finally {
      setBusy(false);
    }
  }

  function usePendingDetails(): void {
    if (pending === null) return;
    setMethod("razorpay");
    setRazorpayRefundId(pending.razorpayRefundId ?? "");
    if (typeof pending.amount === "number") setAmount((pending.amount / 100).toFixed(2));
  }

  return (
    <div data-testid="order-refund-section">
      <p class="section-heading">{ORDERS.refundHeading}</p>

      {/* The gateway got there first: M3.6's `refund.processed` matched this
          order and left it as something to record (brief §12.3, "the refund
          webhook matches it to the order by itself"). Nothing was written to
          the ledger by that webhook, so this line is a to-do, not a receipt. */}
      {pending !== null ? (
        <div class="notice" data-testid="order-refund-pending">
          <p>
            {ORDERS.refundGatewayPendingHeading}
            {typeof pending.amount === "number" ? `: ${formatINR(pending.amount as Paise)}` : ""}
          </p>
          <p class="field-label" data-testid="order-refund-pending-id">
            {pending.razorpayRefundId}
          </p>
          <button type="button" class="quiet" data-testid="order-refund-use-pending" onClick={usePendingDetails}>
            {ORDERS.refundGatewayPendingPrefill}
          </button>
        </div>
      ) : null}

      <div class="fill-numbers">
        <Money label={ORDERS.refundPaidLabel} paise={paid} testId="order-refund-paid" />
        <Money label={ORDERS.refundReturnedLabel} paise={returned} testId="order-refund-returned" />
        <Money label={ORDERS.refundLeftLabel} paise={left} testId="order-refund-left" />
      </div>

      {paid <= 0 ? (
        <p class="field-value" data-testid="order-refund-nothing-paid">
          {ORDERS.refundNothingPaid}
        </p>
      ) : fullyRefunded ? (
        <p class="field-value" data-testid="order-refund-nothing-left">
          {ORDERS.refundNothingLeft}
        </p>
      ) : (
        <div class="state-form" data-testid="order-refund-form">
          <p class="field-value">{ORDERS.refundIntro}</p>

          <label for="refund-method" class="field-label">
            {ORDERS.refundMethodLabel}
          </label>
          <select
            id="refund-method"
            data-testid="order-refund-method"
            value={method}
            onChange={(event) => setMethod((event.target as HTMLSelectElement).value as RefundMethod)}
          >
            {REFUND_METHODS.map((m) => (
              <option key={m} value={m}>
                {ORDERS.refundMethodOption[m] ?? m}
              </option>
            ))}
          </select>

          <label for="refund-amount" class="field-label">
            {ORDERS.refundAmountLabel}
          </label>
          {rupeeBox("refund-amount", "order-refund-amount", amount, setAmount)}

          {method === "razorpay" ? (
            <>
              <label for="refund-rzp-id" class="field-label">
                {ORDERS.refundRazorpayIdLabel}
              </label>
              <input
                id="refund-rzp-id"
                type="text"
                data-testid="order-refund-razorpay-id"
                placeholder={ORDERS.refundRazorpayIdPlaceholder}
                value={razorpayRefundId}
                onInput={(event) => setRazorpayRefundId((event.target as HTMLInputElement).value)}
              />
            </>
          ) : null}

          {method === "upi" ? (
            <>
              <label for="refund-reference" class="field-label">
                {ORDERS.refundReferenceLabel}
              </label>
              <input
                id="refund-reference"
                type="text"
                data-testid="order-refund-reference"
                value={reference}
                onInput={(event) => setReference((event.target as HTMLInputElement).value)}
              />
            </>
          ) : null}

          <label for="refund-note" class="field-label">
            {ORDERS.refundNoteLabel}
          </label>
          <input
            id="refund-note"
            type="text"
            data-testid="order-refund-note"
            placeholder={ORDERS.refundNotePlaceholder}
            value={note}
            onInput={(event) => setNote((event.target as HTMLInputElement).value)}
          />

          {paidOnline ? (
            <>
              <label for="refund-fee" class="field-label">
                {ORDERS.refundGatewayFeeLabel}
              </label>
              {rupeeBox("refund-fee", "order-refund-fee", fee, setFee)}
              <p class="field-label">{ORDERS.refundGatewayFeeHint}</p>
            </>
          ) : null}

          {/* D65: the refusal mark may be set with the refund, and added or
              changed afterwards (the panel below). */}
          <label for="refund-refusal" class="field-label">
            {ORDERS.refundRefusalLabel}
          </label>
          <input
            id="refund-refusal"
            type="text"
            data-testid="order-refund-refusal-reason"
            placeholder={ORDERS.refundRefusalPlaceholder}
            value={refusalReason}
            onInput={(event) => setRefusalReason((event.target as HTMLInputElement).value)}
          />
          <p class="field-label">{ORDERS.refundRefusalHint}</p>

          {error ? (
            <p class="error" data-testid="order-refund-error">
              {error}
            </p>
          ) : null}

          <HoldToConfirm
            label={ORDERS.refundButton}
            hint={ORDERS.refundButtonHint}
            testId="order-refund-submit"
            disabled={busy || sent}
            onConfirm={() => void record()}
          />
        </div>
      )}

      {done ? (
        <p class="field-value" data-testid="order-refund-done">
          {done}
        </p>
      ) : null}

      {/* What has been recorded, brief §17.5's "documents" and the timeline
          between them. The document numbers are the permanent record; this is
          the readable list beside them. */}
      <p class="section-heading">{ORDERS.refundHistoryHeading}</p>
      {refunds.items.length === 0 ? (
        <p class="field-value" data-testid="order-refunds-none">
          {ORDERS.refundHistoryNone}
        </p>
      ) : (
        <ul data-testid="order-refunds-list">
          {refunds.items.map((refund) => (
            <li key={refund.id} class="line-row" data-testid={`order-refund-${refund.id}`}>
              {typeof refund.amount === "number" ? formatINR(refund.amount as Paise) : ""}
              {refund.method ? ` · ${ORDERS.refundMethodOption[refund.method] ?? refund.method}` : ""}
              {refund.documentNumber ? ` · ${refund.documentNumber}` : ""}
              {typeof refund.jarsReturned === "number" && refund.jarsReturned > 0
                ? ` · ${refund.jarsReturned} back on sale`
                : ""}
            </li>
          ))}
        </ul>
      )}

      <RefusalMark order={order} />
    </div>
  );
}

/**
 * D65's second half: the mark may be added or changed **after** the refund, so
 * an order refunded first and understood later can still be marked, and a mark
 * made in error can come off again. Taking it off hands the customer's
 * per-person allowance for the batch back; leaving it on keeps it spent. The
 * jar is on sale either way.
 *
 * Not held-to-confirm: no money moves and no document is issued, and the write
 * is reversible by the same button.
 */
function RefusalMark({ order }: { readonly order: OrderDoc }): JSX.Element | null {
  const block = order.refund ?? null;
  const recorded = typeof block?.totalPaise === "number" && block.totalPaise > 0;
  const marked = block?.refusal ?? null;
  const [reason, setReason] = useState(marked?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason(marked?.reason ?? "");
    setError(null);
  }, [marked?.reason]);

  if (!recorded) return null;

  async function save(next: string | null): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await callMarkOrderRefusal(order.id, next);
    } catch (caught) {
      setError(callableMessage(caught, ORDERS.refusalRefused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="state-form" data-testid="order-refusal-form">
      <p class="section-heading">{ORDERS.refusalHeading}</p>
      <p class="field-value" data-testid="order-refusal-state">
        {marked ? ORDERS.refusalSet : ORDERS.refusalNone}
      </p>
      <input
        id="refusal-reason"
        type="text"
        data-testid="order-refusal-reason"
        placeholder={ORDERS.refundRefusalPlaceholder}
        value={reason}
        onInput={(event) => setReason((event.target as HTMLInputElement).value)}
      />
      {error ? (
        <p class="error" data-testid="order-refusal-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="order-refusal-save"
        disabled={busy || reason.trim() === ""}
        onClick={() => void save(reason.trim())}
      >
        {ORDERS.refusalSaveButton}
      </button>
      {marked ? (
        <button
          type="button"
          class="quiet"
          data-testid="order-refusal-clear"
          disabled={busy}
          onClick={() => void save(null)}
        >
          {ORDERS.refusalClearButton}
        </button>
      ) : null}
    </div>
  );
}
