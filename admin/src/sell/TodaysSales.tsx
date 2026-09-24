/**
 * Brief section 17.3: the Sell screen is "the New sale screen (7A.1), plus
 * the list of today's counter sales and drafts waiting for signal". This is
 * the first half of that; the offline drafts are M2.10.
 *
 * **Today is the business day, not the calendar date.** A Lailark day runs
 * 05:00 to 05:00 (`BUSINESS_DAY_START_HOUR_IST` in `@lailark/shared`), so a
 * jar sold at 23:50 and a mistake noticed at 00:10 are the same evening. It
 * matters here more than anywhere: brief 7A.6 lets a sale be voided "same
 * day, before the bill is sent", so this list is exactly the list of sales
 * that can still be taken back, and it would be a strange screen that
 * offered a Void button that the server refuses twenty minutes after
 * midnight.
 *
 * The void itself goes through `voidCounterSale`, which puts the jar back on
 * the batch, moves the order to `voided` and writes both to the trail, all
 * in one transaction. Nothing here writes anything.
 *
 * **The Bill button (M2.9, D35).** The smallest thing that satisfies "a
 * counter sale produces a bill PDF viewable from the order screen": one tap
 * on the row, which asks `billForOrder` for a short-lived link and opens it.
 * The full Orders screen, where every document for an order is listed, is
 * M3.9. Nothing here reads `documents` or Storage, and nothing could: both
 * keep `seesMoney()`, so the Kitchen's only way to a bill is the callable.
 */
import { formatINR } from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { PAYMENT_LABEL, SELL } from "../copy";
import { formatIndianMobile } from "../phone";
import {
  callBillForOrder,
  callVoidCounterSale,
  saleErrorMessage,
  useTodaysCounterSales,
  type OrderDoc,
} from "./data";

/** What the line on this order was, in as few words as the order carries. */
function describe(order: OrderDoc): string {
  const line = order.lines?.[0];
  if (!line) return order.number ?? order.id;
  const what = line.customDescription ?? line.productSlug ?? "";
  const qty = line.qty ?? 1;
  return qty > 1 ? `${qty} × ${what}` : what;
}

/** The bill has gone once M2.9 and M5 stamp it; before that it never has. */
function billHasGone(order: OrderDoc): boolean {
  return (order as { billSentAt?: unknown }).billSentAt != null;
}

interface RowProps {
  readonly order: OrderDoc;
}

function SaleRow({ order }: RowProps): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [billing, setBilling] = useState(false);

  const voided = order.state === "voided";
  const canVoid = !voided && !billHasGone(order);
  const billNumber = (order as { billNumber?: string | null }).billNumber ?? null;

  async function openBill(): Promise<void> {
    setBilling(true);
    setError(null);
    try {
      const link = await callBillForOrder(order.id);
      // Opened in a new tab rather than navigated to: the seller is in the
      // middle of a counter session and must not lose the Sell screen. A
      // phone that blocks the pop-up is told what to do about it, because
      // "nothing happened" is the worst possible answer at a counter.
      //
      // `noopener` is **not** passed in the features string: with it,
      // `window.open` returns null even when the tab opened perfectly well,
      // so every successful tap would claim to have been blocked. The
      // opener is cut afterwards instead, which is the same protection.
      const opened = window.open(link.url, "_blank");
      if (opened === null) setError(SELL.billBlocked);
      else opened.opener = null;
    } catch (err) {
      setError(saleErrorMessage(err, SELL.billFailed));
    } finally {
      setBilling(false);
    }
  }

  async function voidIt(): Promise<void> {
    if (reason.trim() === "") {
      setError(SELL.voidReasonRequired);
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const result = await callVoidCounterSale(order.id, reason.trim());
      setDone(SELL.voidDone(result.jarsReturned));
      setAsking(false);
    } catch (err) {
      setError(saleErrorMessage(err, SELL.voidFailed));
    } finally {
      setWorking(false);
    }
  }

  return (
    <li class="sale-row" data-testid={`sale-row-${order.id}`}>
      <div class="sale-row-top">
        <span class="sale-row-what">{describe(order)}</span>
        <span class="field-value number" data-testid={`sale-row-total-${order.id}`}>
          {formatINR(order.total ?? 0)}
        </span>
      </div>
      <div class="sale-row-bottom">
        <span class="field-help">
          {order.customerPhone ? formatIndianMobile(order.customerPhone) : ""}
          {order.payment?.method ? `, ${PAYMENT_LABEL[order.payment.method] ?? order.payment.method}` : ""}
        </span>
        {voided ? (
          <span class="state-chip" data-testid={`sale-voided-${order.id}`}>
            {SELL.saleVoided}
          </span>
        ) : null}
      </div>

      {done !== null ? (
        <p class="notice-line" data-testid={`void-done-${order.id}`}>
          {done}
        </p>
      ) : null}

      {billNumber !== null ? (
        <div class="sale-row-bill">
          <span class="field-value number" data-testid={`bill-number-${order.id}`}>
            {billNumber}
          </span>
          <button
            type="button"
            class="quiet"
            data-testid={`bill-${order.id}`}
            disabled={billing}
            onClick={() => void openBill()}
          >
            {billing ? SELL.billOpening : SELL.billLabel}
          </button>
          {voided ? <span class="field-help">{SELL.billVoided}</span> : null}
        </div>
      ) : (
        <p class="field-help" data-testid={`bill-none-${order.id}`}>
          {SELL.billNone}
        </p>
      )}

      {!voided && !canVoid ? <p class="field-help">{SELL.voidNotAvailable}</p> : null}

      {canVoid && !asking ? (
        <button
          type="button"
          class="quiet"
          data-testid={`void-${order.id}`}
          onClick={() => {
            setAsking(true);
            setError(null);
          }}
        >
          {SELL.voidLabel}
        </button>
      ) : null}

      {asking ? (
        <div class="void-form" data-testid={`void-form-${order.id}`}>
          <label for={`void-reason-${order.id}`}>{SELL.voidReason}</label>
          <input
            id={`void-reason-${order.id}`}
            name={`void-reason-${order.id}`}
            type="text"
            data-testid={`void-reason-${order.id}`}
            value={reason}
            onInput={(event) => setReason((event.target as HTMLInputElement).value)}
          />
          <button type="button" data-testid={`void-confirm-${order.id}`} disabled={working} onClick={() => void voidIt()}>
            {working ? SELL.voidWorking : SELL.voidConfirm}
          </button>
          <button type="button" class="quiet" onClick={() => setAsking(false)}>
            {SELL.voidCancel}
          </button>
        </div>
      ) : null}

      {error !== null ? (
        <p class="error" data-testid={`void-error-${order.id}`}>
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function TodaysSales(): JSX.Element {
  const sales = useTodaysCounterSales();

  return (
    <section class="todays-sales" data-testid="todays-sales">
      <h2 class="section-heading">{SELL.todayHeading}</h2>
      {sales.loading ? <p data-testid="todays-sales-loading">{SELL.todayLoading}</p> : null}
      {sales.denied ? <p data-testid="todays-sales-denied">{SELL.todayDenied}</p> : null}
      {!sales.loading && !sales.denied && sales.items.length === 0 ? (
        <p data-testid="todays-sales-empty">{SELL.todayEmpty}</p>
      ) : null}
      <ul class="sale-list">
        {sales.items.map((order) => (
          <SaleRow key={order.id} order={order} />
        ))}
      </ul>
    </section>
  );
}
