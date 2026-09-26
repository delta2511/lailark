/**
 * Packing and India Post, brief §11.1 and §11.3, M4.1. No Firebase in this
 * file: the three callables (`packOrder`, `shipOrder`, `deliverOrder`) do the
 * Firestore work, this module decides what that work is, the same split
 * `orders/sale.ts` and `batches/transitions.ts` already use.
 *
 * The states this file moves an order through are `toPack -> packed ->
 * shipped -> delivered` (the courier path), or `packed -> delivered` directly
 * for a hand delivery (brief §11.1's "Delivered by hand", the fallback that
 * needs no courier at all). Every move here is one callable, so two Kitchen
 * phones packing at once cannot both hand out the same jar number, and an
 * order cannot skip a state no one told it to skip.
 */

import {
  formatINR,
  type OrderState,
  type Paise,
} from "@lailark/shared";

export type ErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "failed-precondition"
  | "not-found"
  | "aborted";

export type Failure = { readonly ok: false; readonly code: ErrorCode; readonly message: string };
function fail(code: ErrorCode, message: string): Failure {
  return { ok: false, code, message };
}
function invalid(message: string): Failure {
  return fail("invalid-argument", message);
}

/**
 * The ceiling a packing or courier cost may not cross, the same discipline
 * `MAX_LINE_COST_PAISE` (`shared/src/batchLines.ts`) uses for an ingredient
 * line: a number this large in a paise field is a rupee figure typed into the
 * wrong box, not a real packing job. Brief §11.3 step 4's own examples ("two
 * jars, extra padding, a bigger box") are all well under a hundred rupees;
 * this leaves a wide margin above that rather than guessing at the exact
 * ceiling a real box could hit.
 *
 * ASSUMED (M4.1, CLAUDE.md §5 "assume freely": a limit inside the decided
 * shape, not a customer-facing price).
 */
export const MAX_SHIPPING_COST_PAISE: Paise = 2_000_00;

/**
 * The packing cost used when `settings/courier.defaultPackingCost` has not
 * been set yet. The Settings screen that writes it is fast-follow (M4.1's own
 * scope note), so this is what a fresh install packs its first order with.
 *
 * ASSUMED (M4.1, CLAUDE.md §5: "default values that are marked as settings in
 * the brief" are Claude's to pick). Forty rupees for a padded box and tape,
 * which is the brief's own example of what this field is for.
 */
export const DEFAULT_PACKING_COST_PAISE: Paise = 40_00;

/** A shipping cost, validated, with a named ceiling. Null input means "use the default". */
export function checkShippingCost(value: unknown, label: string): { readonly ok: true; readonly value: Paise } | Failure {
  if (value === null || value === undefined) return { ok: true, value: 0 };
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return invalid(`${label} is an integer number of paise.`);
  }
  if (value < 0) return invalid(`${label} cannot be negative.`);
  if (value > MAX_SHIPPING_COST_PAISE) {
    return invalid(`${label} is more than ${formatINR(MAX_SHIPPING_COST_PAISE)}. Check the receipt.`);
  }
  return { ok: true, value };
}

/* -------------------------------------------------------------------------- */
/* Packing, brief §11.3                                                       */
/* -------------------------------------------------------------------------- */

/** One order line the way this planner needs it. */
export interface PackableLine {
  readonly batchRef: string | null;
  readonly qty: number;
}

/** One batch this order draws jars from, as `jarsAssigned`/`bottledJars` read it. */
export interface PackingBatchView {
  readonly ref: string;
  readonly jarsAssigned: number;
  readonly bottledJars: number;
}

export interface PackOrderRequest {
  readonly orderId: string;
  readonly state: OrderState;
  readonly lines: readonly PackableLine[];
  /**
   * Already resolved by the caller: the request's own figure, or the
   * settings default, or {@link DEFAULT_PACKING_COST_PAISE}, whichever
   * applies. This module only validates it, since it has no settings to
   * read.
   */
  readonly packingCostPaise: number;
}

export interface PackOrderPlan {
  /** Jar numbers for each line, in the order `lines` was given. */
  readonly jarNumbersByLine: readonly (readonly number[])[];
  /** `batchRef -> new jarsAssigned`, one entry per batch this order touches. */
  readonly jarsAssignedByBatch: ReadonlyMap<string, number>;
  readonly packingCostPaise: Paise;
}

/**
 * Plans a pack: assigns jar numbers to every line that names a batch, in
 * ascending order within each batch, starting after the highest number that
 * batch has already handed out.
 *
 * **"In payment order" (brief §11.3 step 3).** The Kitchen packs the To pack
 * list top to bottom, and that list is sorted oldest-paid-first (the same
 * screen, §11.3 step 1). Jar numbers are handed out in the order orders are
 * packed, which is the order they were paid in as long as the Kitchen packs
 * down the list the screen already puts them in. This function does not
 * itself re-check payment time: doing so would need every other order in the
 * batch inside this transaction, for a guarantee the UI already gives by
 * ordering the list, and the property this transaction *does* guarantee
 * unconditionally is the one CLAUDE.md asks for: two callers packing at once
 * can never be handed the same number, because both read `jarsAssigned` from
 * the same document inside the same transaction and the second is retried.
 *
 * ASSUMED (M4.1, needs Shefin): the brief's "in payment order" is read as "in
 * packing order, and packing follows the payment-ordered list" rather than as
 * a second, server-enforced check against every sibling order's `paidAt`.
 */
export function planPackOrder(
  batches: ReadonlyMap<string, PackingBatchView>,
  request: PackOrderRequest,
): { readonly ok: true; readonly value: PackOrderPlan } | Failure {
  if (request.state !== "toPack") {
    return fail("failed-precondition", "This order is not in To pack.");
  }

  const costCheck = checkShippingCost(request.packingCostPaise, "Packing cost");
  if (!costCheck.ok) return costCheck;
  const packingCostPaise = costCheck.value;

  const neededByBatch = new Map<string, number>();
  for (const line of request.lines) {
    if (line.batchRef === null) continue;
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      return invalid("Every line's quantity must be a positive whole number.");
    }
    neededByBatch.set(line.batchRef, (neededByBatch.get(line.batchRef) ?? 0) + line.qty);
  }

  const startByBatch = new Map<string, number>();
  const jarsAssignedByBatch = new Map<string, number>();
  for (const [batchRef, qty] of neededByBatch) {
    const batch = batches.get(batchRef);
    if (batch === undefined) {
      return fail("not-found", `Batch ${batchRef} could not be read.`);
    }
    const start = batch.jarsAssigned + 1;
    const next = batch.jarsAssigned + qty;
    if (next > batch.bottledJars) {
      return fail(
        "failed-precondition",
        `Packing this order would hand out jar ${next} of a batch that only bottled ${batch.bottledJars}.`,
      );
    }
    startByBatch.set(batchRef, start);
    jarsAssignedByBatch.set(batchRef, next);
  }

  const cursor = new Map(startByBatch);
  const jarNumbersByLine = request.lines.map((line) => {
    if (line.batchRef === null || line.qty <= 0) return [] as readonly number[];
    const from = cursor.get(line.batchRef) as number;
    const numbers = Array.from({ length: line.qty }, (_, i) => from + i);
    cursor.set(line.batchRef, from + line.qty);
    return numbers;
  });

  return {
    ok: true,
    value: { jarNumbersByLine, jarsAssignedByBatch, packingCostPaise },
  };
}

/* -------------------------------------------------------------------------- */
/* Ship, brief §11.1                                                          */
/* -------------------------------------------------------------------------- */

export interface ShipOrderRequest {
  readonly state: OrderState;
  readonly fulfilment: string;
  readonly consignmentNumber: string;
  readonly courierCostPaise: number | null;
}

export interface ShipOrderPlan {
  readonly awb: string;
  readonly courierCostPaise: Paise;
}

/**
 * Plans "enter the India Post consignment number", brief §11.3 step 6: only
 * from `packed`, and only for an order that actually ships by courier. A
 * hand delivery or a counter collection never sees this screen at all.
 */
export function planShipOrder(
  request: ShipOrderRequest,
  isValidConsignment: (value: unknown) => boolean,
): { readonly ok: true; readonly value: ShipOrderPlan } | Failure {
  if (request.state !== "packed") {
    if (request.state === "shipped") {
      return fail("failed-precondition", "This order has already been marked shipped.");
    }
    if (request.state === "delivered") {
      return fail("failed-precondition", "This order has already been delivered.");
    }
    return fail("failed-precondition", "This order has not been packed yet.");
  }
  if (request.fulfilment !== "ship") {
    return fail("failed-precondition", "This order does not ship by courier.");
  }
  const awb = request.consignmentNumber.trim().toUpperCase();
  if (!isValidConsignment(awb)) {
    return invalid(
      'An India Post consignment number is 13 characters: two letters, nine digits, two letters, for example "EE123456789IN".',
    );
  }
  const costCheck = checkShippingCost(request.courierCostPaise, "Courier cost");
  if (!costCheck.ok) return costCheck;
  return { ok: true, value: { awb, courierCostPaise: costCheck.value } };
}

/* -------------------------------------------------------------------------- */
/* Delivered, brief §11.1 and §11.3 step 6                                    */
/* -------------------------------------------------------------------------- */

export interface DeliverOrderRequest {
  readonly state: OrderState;
  readonly fulfilment: string;
}

/**
 * Plans "delivered": from `shipped` (the courier finished), or from `packed`
 * when the fulfilment is not `ship` (§11.1's "delivered by hand", the order
 * never went near a courier at all).
 */
export function planDeliverOrder(request: DeliverOrderRequest): { readonly ok: true } | Failure {
  if (request.state === "shipped") return { ok: true };
  if (request.state === "packed" && request.fulfilment !== "ship") return { ok: true };
  if (request.state === "delivered") {
    return fail("failed-precondition", "This order has already been delivered.");
  }
  return fail(
    "failed-precondition",
    request.fulfilment === "ship"
      ? "This order has not been shipped yet."
      : "This order has not been packed yet.",
  );
}
