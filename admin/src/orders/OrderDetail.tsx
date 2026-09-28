/**
 * One order, brief §17.5: "customer and delivery contact, channel, lines
 * with batch and jar numbers, payment and method, documents, shipment
 * (courier, number, cost, packing cost), tracking, kitchen note, Concerns,
 * timeline."
 *
 * M3.9 drew this read only; M4.1 added the packing panel and M4.5 the refund
 * panel. Concerns are still a later milestone (M4.4) and sit here as an honest
 * empty state, so that task has somewhere to land rather than inventing its own
 * section.
 */
import {
  formatINR,
  indiaPostTrackingUrl,
  ORDER_GROUP_LABELS,
  orderGroupForState,
  type Paise,
  type Role,
} from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { ORDERS, PAYMENT_LABEL } from "../copy";
import { Timeline } from "../timeline/Timeline";
import { billMessageFor } from "./billMessage";
import { useDocumentsForOrder, useMessageOverrides, useShipment, type OrderDoc } from "./data";
import { PackingSection } from "./PackingSection";
import { RefundSection } from "./RefundSection";
import { shipMessageFor } from "./shipMessage";

interface Props {
  readonly order: OrderDoc;
  readonly role: Role;
  readonly siteOrigin: string;
}

function Field({ label, value, testId, numeric }: { readonly label: string; readonly value: string; readonly testId: string; readonly numeric?: boolean }): JSX.Element {
  return (
    <div class="settings-field">
      <p class="field-label">{label}</p>
      <p class={numeric ? "field-value number" : "field-value"} data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export function OrderDetail({ order, role, siteOrigin }: Props): JSX.Element {
  const documents = useDocumentsForOrder(order.id);
  const shipment = useShipment(order.id);
  const overrides = useMessageOverrides();
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [shipPopupBlocked, setShipPopupBlocked] = useState(false);
  const canPack = role === "owner" || role === "kitchen";

  /**
   * Opened in a new tab, same reasoning as the bill link on Sell
   * (`TodaysSales.tsx`): `noopener` is not passed in the features string,
   * because `window.open` returns null with it even when the tab opened
   * fine, which would make every successful tap look blocked. The opener is
   * cut afterwards instead, the same protection with an accurate result.
   */
  function openWhatsApp(waLink: string): void {
    setPopupBlocked(false);
    const opened = window.open(waLink, "_blank");
    if (opened === null) setPopupBlocked(true);
    else opened.opener = null;
  }

  function openShipWhatsApp(waLink: string): void {
    setShipPopupBlocked(false);
    const opened = window.open(waLink, "_blank");
    if (opened === null) setShipPopupBlocked(true);
    else opened.opener = null;
  }

  const group = order.state ? orderGroupForState(order.state) : null;
  const groupLabel = group ? ORDER_GROUP_LABELS[group] : (order.state ?? "");
  const paidWhileHeld = group === "awaitingPayment" && order.payment?.status === "captured";

  const bill = billMessageFor(order, siteOrigin, overrides);
  const shipMessage = shipMessageFor(order, shipment.shipment, overrides);
  const trackingLink = indiaPostTrackingUrl(shipment.shipment?.awb ?? null);

  return (
    <div class="detail" data-testid="order-detail">
      <div class="batch-detail-header">
        <p class="state-chip" data-testid="order-detail-group">
          {groupLabel}
        </p>
        <h2 class="section-heading" data-testid="order-detail-number">
          {order.number ?? order.id}
        </h2>
        {paidWhileHeld ? (
          <p class="approval-badge" data-testid="order-detail-paid-badge">
            {ORDERS.paidWhileHeld} {typeof order.payment?.amount === "number" ? formatINR(order.payment.amount as Paise) : ""}
          </p>
        ) : null}
      </div>

      {/* ---- Customer and delivery, brief §17.5 ---- */}
      <p class="section-heading">{ORDERS.customerHeading}</p>
      <div class="fill-numbers">
        <Field label={ORDERS.customerHeading} value={order.deliveryContact?.name ?? ""} testId="order-customer-name" />
        <Field label="Phone" value={order.customerPhone ?? ""} testId="order-customer-phone" />
      </div>

      <p class="section-heading">{ORDERS.deliveryHeading}</p>
      {order.deliveryContact ? (
        <div class="fill-numbers" data-testid="order-delivery-contact">
          <Field label="Address" value={order.deliveryContact.lines.join(", ")} testId="order-delivery-lines" />
          <Field label="Town or city" value={order.deliveryContact.city} testId="order-delivery-city" />
          <Field label="State" value={order.deliveryContact.state} testId="order-delivery-state" />
          <Field label="Pincode" value={order.deliveryContact.pincode} testId="order-delivery-pincode" />
        </div>
      ) : (
        <p class="field-value" data-testid="order-no-delivery">
          {ORDERS.noDeliveryContact}
        </p>
      )}

      {/* ---- Channel ---- */}
      <p class="section-heading">{ORDERS.channelHeading}</p>
      <p class="field-value" data-testid="order-channel">
        {order.channel ? (ORDERS.channelLabel[order.channel] ?? order.channel) : ""}
      </p>

      {/* ---- Lines, with batch and jar numbers ---- */}
      <p class="section-heading">{ORDERS.linesHeading}</p>
      <ul data-testid="order-lines">
        {(order.lines ?? []).map((line, index) => (
          <li key={index} class="line-row" data-testid={`order-line-${index}`}>
            <div class="fill-numbers">
              <Field
                label="Product"
                value={line.customDescription ?? line.productSlug ?? ""}
                testId={`order-line-${index}-product`}
              />
              <Field label="Batch" value={line.batchRef ?? ""} testId={`order-line-${index}-batch`} />
              <Field label="Qty" value={String(line.qty ?? 0)} testId={`order-line-${index}-qty`} numeric />
              <Field
                label="Price each"
                value={typeof line.unitPrice === "number" ? formatINR(line.unitPrice as Paise) : ""}
                testId={`order-line-${index}-price`}
                numeric
              />
            </div>
            <p class="field-label">{ORDERS.jarNumbersLabel}</p>
            <p class="field-value" data-testid={`order-line-${index}-jars`}>
              {line.jarNumbers && line.jarNumbers.length > 0 ? line.jarNumbers.join(", ") : ORDERS.jarNumbersNone}
            </p>
          </li>
        ))}
      </ul>

      {/* ---- Payment, brief §17.5. Shown from the order document itself, so
               it renders the same for every role: `orders/{id}` is
               `isAdmin()`-readable, unlike `documents` below. A201: this is
               precisely where a held-but-captured order proves it was paid. ---- */}
      <p class="section-heading">{ORDERS.paymentHeading}</p>
      <div class="fill-numbers">
        <Field
          label={ORDERS.paymentAmount}
          value={typeof order.payment?.amount === "number" ? formatINR(order.payment.amount as Paise) : ""}
          testId="order-payment-amount"
          numeric
        />
        <Field
          label={ORDERS.paymentMethod}
          value={order.payment?.method ? (PAYMENT_LABEL[order.payment.method] ?? order.payment.method) : ""}
          testId="order-payment-method"
        />
        <Field
          label={ORDERS.paymentStatus}
          value={order.payment?.status ? (ORDERS.paymentStatusLabel[order.payment.status] ?? order.payment.status) : ""}
          testId="order-payment-status"
        />
        <Field
          label={ORDERS.paymentReference}
          value={order.payment?.upiRef ?? order.payment?.razorpayIds?.paymentId ?? order.payment?.razorpayIds?.paymentLinkId ?? ""}
          testId="order-payment-reference"
        />
        {typeof order.payment?.refundedAmount === "number" && order.payment.refundedAmount > 0 ? (
          <Field
            label={ORDERS.paymentRefunded}
            value={formatINR(order.payment.refundedAmount as Paise)}
            testId="order-payment-refunded"
            numeric
          />
        ) : null}
      </div>

      {/* ---- Documents: seesMoney()-gated (Owner, Viewer), never Kitchen ---- */}
      <p class="section-heading">{ORDERS.documentsHeading}</p>
      {role === "kitchen" ? (
        <p class="field-value" data-testid="order-documents-denied">
          {ORDERS.readDenied}
        </p>
      ) : documents.loading ? (
        <p class="field-value" data-testid="order-documents-loading">
          {ORDERS.loading}
        </p>
      ) : documents.denied ? (
        <p class="field-value" data-testid="order-documents-denied">
          {ORDERS.readDenied}
        </p>
      ) : documents.items.length === 0 ? (
        <p class="field-value" data-testid="order-documents-none">
          {ORDERS.documentsNone}
        </p>
      ) : (
        <ul data-testid="order-documents-list">
          {documents.items.map((document) => (
            <li key={document.id} class="line-row" data-testid={`order-document-${document.id}`}>
              {document.number ?? document.id} ({document.kind})
              {typeof document.total === "number" ? ` · ${formatINR(document.total as Paise)}` : ""}
              {document.voided ? ` · void` : ""}
            </li>
          ))}
        </ul>
      )}

      {/* ---- Shipment, brief §17.5, M4.1 ---- */}
      <p class="section-heading">{ORDERS.shipmentHeading}</p>
      {shipment.shipment ? (
        <div class="fill-numbers" data-testid="order-shipment">
          <Field
            label={ORDERS.shipmentCourier}
            value={
              shipment.shipment.courier
                ? (ORDERS.courierLabel[shipment.shipment.courier] ?? shipment.shipment.courier)
                : ""
            }
            testId="order-shipment-courier"
          />
          <Field
            label={ORDERS.shipmentAwb}
            value={shipment.shipment.awb ?? ""}
            testId="order-shipment-awb"
          />
          <Field
            label={ORDERS.shipmentPackingCost}
            value={typeof shipment.shipment.packingCost === "number" ? formatINR(shipment.shipment.packingCost as Paise) : ""}
            testId="order-shipment-packing-cost"
            numeric
          />
          <Field
            label={ORDERS.shipmentCourierCost}
            value={typeof shipment.shipment.courierCost === "number" ? formatINR(shipment.shipment.courierCost as Paise) : ""}
            testId="order-shipment-courier-cost"
            numeric
          />
          <Field
            label={ORDERS.shipmentStatus}
            value={
              shipment.shipment.status
                ? (ORDERS.shipmentStatusLabel[shipment.shipment.status] ?? shipment.shipment.status)
                : ""
            }
            testId="order-shipment-status"
          />
        </div>
      ) : (
        <p class="field-value" data-testid="order-shipment-none">
          {ORDERS.shipmentNone}
        </p>
      )}

      {/* ---- Tracking, brief §17.5, M4.1 ---- */}
      <p class="section-heading">{ORDERS.trackingHeading}</p>
      {trackingLink ? (
        <a class="field-value" data-testid="order-tracking-link" href={trackingLink} target="_blank" rel="noreferrer">
          {ORDERS.trackingLinkLabel}
        </a>
      ) : (
        <p class="field-value" data-testid="order-tracking-none">
          {ORDERS.trackingNone}
        </p>
      )}

      {/* ---- Pack, ship, deliver: M4.1, brief §11.1 and §11.3. Owner and
               Kitchen both may act (§17.12's role matrix row for this task);
               a Viewer only ever sees the sections above. ---- */}
      {canPack ? (
        <PackingSection order={order} />
      ) : null}

      {/* ---- Send the dispatch message, D32: drafted, never sent
               automatically ---- */}
      {shipMessage.hasTracking ? (
        <>
          <p class="section-heading">{ORDERS.sendShipMessageHeading}</p>
          <p class="field-label">{ORDERS.sendShipMessagePreview}</p>
          <p class="field-value bill-preview" data-testid="order-ship-message-preview">
            {shipMessage.text}
          </p>
          {shipMessage.waLink ? (
            <>
              <button
                type="button"
                data-testid="order-ship-message-send"
                onClick={() => openShipWhatsApp(shipMessage.waLink as string)}
              >
                {ORDERS.sendShipMessageButton}
              </button>
              {shipPopupBlocked ? (
                <p class="error" data-testid="order-ship-message-popup-blocked">
                  {ORDERS.sendBillPopupBlocked}
                </p>
              ) : null}
            </>
          ) : (
            <p class="field-value" data-testid="order-ship-message-no-phone">
              {ORDERS.sendShipMessageNoPhone}
            </p>
          )}
        </>
      ) : null}

      {/* ---- Kitchen note ---- */}
      <p class="section-heading">{ORDERS.kitchenNoteHeading}</p>
      <p class="field-value" data-testid="order-kitchen-note">
        {order.kitchenNote && order.kitchenNote.trim() !== "" ? order.kitchenNote : ORDERS.kitchenNoteNone}
      </p>

      {/* ---- Record a refund: M4.5, brief §12.3 and D31. **Owner only**,
               because money moves; `recordRefund` refuses anybody else at the
               server too, which is where it counts. ---- */}
      {role === "owner" ? <RefundSection order={order} /> : null}

      {/* ---- Concerns: M4.4 lands here ---- */}
      <p class="section-heading">{ORDERS.concernsHeading}</p>
      <p class="field-value" data-testid="order-concerns-none">
        {ORDERS.concernsNone}
      </p>

      {/* ---- Send the bill, D32: drafted, never sent automatically ---- */}
      <p class="section-heading">{ORDERS.sendBillHeading}</p>
      {!bill.hasToken ? (
        <p class="field-value" data-testid="order-bill-no-token">
          {ORDERS.sendBillNoToken}
        </p>
      ) : (
        <>
          <p class="field-label">{ORDERS.sendBillPreview}</p>
          <p class="field-value bill-preview" data-testid="order-bill-preview">
            {bill.text}
          </p>
          {bill.waLink ? (
            <>
              <button
                type="button"
                data-testid="order-bill-send"
                onClick={() => openWhatsApp(bill.waLink as string)}
              >
                {ORDERS.sendBillButton}
              </button>
              {popupBlocked ? (
                <p class="error" data-testid="order-bill-popup-blocked">
                  {ORDERS.sendBillPopupBlocked}
                </p>
              ) : null}
            </>
          ) : (
            <p class="field-value" data-testid="order-bill-no-phone">
              {ORDERS.sendBillNoPhone}
            </p>
          )}
        </>
      )}

      {/* ---- Timeline, D39: `audit` is the only history ---- */}
      <p class="section-heading">{ORDERS.timelineHeading}</p>
      <Timeline objectPath={`orders/${order.id}`} />
    </div>
  );
}
