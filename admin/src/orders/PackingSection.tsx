/**
 * Pack, book India Post, deliver: brief §11.1 and §11.3, M4.1. Owner and
 * Kitchen both may do every one of these (brief §17.12's role matrix row for
 * this task), so `OrderDetail.tsx` renders this for both and neither role
 * sees a narrower version of it.
 *
 * Three states, three small forms, the same shape `StateButton.tsx` already
 * uses for a batch: a busy flag, an error read from the callable
 * (`callableMessage`), and nothing optimistic. The live order and shipment
 * listeners repaint the screen once the callable's transaction lands.
 */
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { callableMessage } from "../callableError";
import { ORDERS } from "../copy";
import { callDeliverOrder, callPackOrder, callShipOrder } from "./shipmentActions";
import type { OrderDoc } from "./data";

interface Props {
  readonly order: OrderDoc;
}

/** Parses a rupee string typed into a cost box into paise, or null when empty. */
function parsePaise(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const rupees = Number(trimmed);
  if (!Number.isFinite(rupees) || rupees < 0) return null;
  return Math.round(rupees * 100);
}

function PackForm({ order }: { readonly order: OrderDoc }): JSX.Element {
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A refusal (or a submit already sent) belongs to the state it was raised
  // in. Once the live order listener moves the order to a new state, this
  // panel is about to be replaced by a different one entirely; nothing from
  // the old state should still be showing while that happens. Modelled on
  // `StateButton.tsx`, whose forms get this for free by remounting under a
  // new `key`: `PackingSection` swaps component types on every transition
  // too, except where the same component (`DeliverButton`) serves two
  // adjacent states, so this effect is the explicit version of the same rule.
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setError(null);
    setSent(false);
  }, [order.state]);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError(null);
    const parsed = cost.trim() === "" ? null : parsePaise(cost);
    if (cost.trim() !== "" && parsed === null) {
      setError(ORDERS.packRefused);
      return;
    }
    setBusy(true);
    try {
      await callPackOrder(order.id, parsed ?? undefined);
      // Success: this order is about to move on. Block a second submit
      // against the same (now stale) state until the listener catches up
      // and either remounts this panel as something else or clears `sent`
      // above.
      setSent(true);
    } catch (caught) {
      setError(callableMessage(caught, ORDERS.packRefused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="state-form" data-testid="order-pack-form" onSubmit={(event) => void submit(event)}>
      <p class="section-heading">{ORDERS.packHeading}</p>
      <label for="pack-cost" class="field-label">
        {ORDERS.packCostLabel}
      </label>
      <input
        id="pack-cost"
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        data-testid="order-pack-cost"
        placeholder="₹"
        value={cost}
        onInput={(event) => setCost((event.target as HTMLInputElement).value)}
      />
      {error ? (
        <p class="error" data-testid="order-pack-error">
          {error}
        </p>
      ) : null}
      <button type="submit" data-testid="order-pack-submit" disabled={busy || sent}>
        {ORDERS.packButton}
      </button>
    </form>
  );
}

function ShipForm({ order }: { readonly order: OrderDoc }): JSX.Element {
  const [consignment, setConsignment] = useState("");
  const [courierCost, setCourierCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // See the same field on `PackForm` above: a refusal, or a submit already
  // sent, belongs to the state it happened in and must not survive into a
  // repainted screen.
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setError(null);
    setSent(false);
  }, [order.state]);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError(null);
    const cost = courierCost.trim() === "" ? null : parsePaise(courierCost);
    if (courierCost.trim() !== "" && cost === null) {
      setError(ORDERS.shipRefused);
      return;
    }
    setBusy(true);
    try {
      await callShipOrder(order.id, consignment, cost ?? undefined);
      setSent(true);
    } catch (caught) {
      setError(callableMessage(caught, ORDERS.shipRefused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="state-form" data-testid="order-ship-form" onSubmit={(event) => void submit(event)}>
      <p class="section-heading">{ORDERS.shipHeading}</p>
      <label for="ship-consignment" class="field-label">
        {ORDERS.shipConsignmentLabel}
      </label>
      <input
        id="ship-consignment"
        type="text"
        data-testid="order-ship-consignment"
        placeholder={ORDERS.shipConsignmentPlaceholder}
        value={consignment}
        onInput={(event) => setConsignment((event.target as HTMLInputElement).value)}
      />
      <label for="ship-courier-cost" class="field-label">
        {ORDERS.shipCourierCostLabel}
      </label>
      <input
        id="ship-courier-cost"
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        data-testid="order-ship-courier-cost"
        placeholder="₹"
        value={courierCost}
        onInput={(event) => setCourierCost((event.target as HTMLInputElement).value)}
      />
      {error ? (
        <p class="error" data-testid="order-ship-error">
          {error}
        </p>
      ) : null}
      <button type="submit" data-testid="order-ship-submit" disabled={busy || sent}>
        {ORDERS.shipButton}
      </button>
    </form>
  );
}

function DeliverButton({ order, byHand }: { readonly order: OrderDoc; readonly byHand: boolean }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same reasoning as `PackForm` and `ShipForm`. This one matters even more
  // for `DeliverButton`, because it is the one component `PackingSection`
  // reuses across two adjacent states (`packed` by hand, and `shipped`), so a
  // stale error here would not even get cleared by a remount the way the
  // others are: nothing else changes type underneath it until the order
  // reaches `delivered`, when this panel disappears entirely.
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setError(null);
    setSent(false);
  }, [order.state]);

  async function deliver(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await callDeliverOrder(order.id);
      setSent(true);
    } catch (caught) {
      setError(callableMessage(caught, ORDERS.deliverRefused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="state-form" data-testid="order-deliver-form">
      {error ? (
        <p class="error" data-testid="order-deliver-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="order-deliver-submit"
        disabled={busy || sent}
        onClick={() => void deliver()}
      >
        {byHand ? ORDERS.deliverByHandButton : ORDERS.deliverButton}
      </button>
    </div>
  );
}

/**
 * The one action this order can take right now, if any: pack (`toPack`),
 * book India Post (`packed`, ships by courier), or mark delivered
 * (`shipped`, or `packed` with a fulfilment that never sees a courier at
 * all: brief §11.1's "delivered by hand"). A `role` prop is deliberately not
 * taken: every action here is Owner **and** Kitchen (§17.12), so the caller
 * decides once whether to render this section at all.
 */
export function PackingSection({ order }: Props): JSX.Element | null {
  if (order.state === "toPack") return <PackForm order={order} />;
  if (order.state === "packed") {
    if (order.fulfilment === "ship") return <ShipForm order={order} />;
    return <DeliverButton order={order} byHand />;
  }
  if (order.state === "shipped") return <DeliverButton order={order} byHand={false} />;
  return null;
}
