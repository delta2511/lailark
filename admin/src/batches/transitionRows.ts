/**
 * A trimmed, presentation-only copy of brief section 8.2's transition table
 * (with decision D21c on top of it): just enough to decide what the one big
 * state button asks for, and who gets to see it.
 *
 * The one true table is `functions/src/batches/transitions.ts`'s
 * `BATCH_TRANSITION_TABLE`, which validates every request and is what
 * actually writes. This file never writes anything itself; every submit here
 * still goes through the real table on the server (`callTransitionBatch`), so
 * a row that drifted out of step with the server fails safe: the button is
 * either missing (nothing offered) or the server refuses the request with its
 * own plain line (`callableErrorMessage`), never a wrong write.
 *
 * ASSUMED (M2.4): duplicating this trimmed table here rather than moving the
 * whole state machine into `@lailark/shared` so both sides read one table.
 * That would be a larger refactor of M2.3's work than this task's scope, and
 * the fail-safe behaviour above is the reason it is an acceptable risk for
 * now rather than something to fix in the same breath.
 */
import { BATCH_STATES_PAUSABLE, type BatchState, type Role } from "@lailark/shared";

import { BATCHES } from "../copy";

/**
 * `price` is money a customer is charged and is capped at the ₹649 MRP;
 * `rupees` is money the kitchen spends (the raw material's cost), which has no
 * ceiling but is never negative. They are two kinds, not one, because the one
 * rule that separates them is printed on the jar.
 */
export type FieldKind = "text" | "textarea" | "date" | "price" | "rupees" | "whole" | "positive";

export interface TransitionField {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly required: boolean;
}

export interface TransitionRow {
  readonly from: BatchState;
  readonly to: BatchState;
  readonly callers: readonly Role[];
  readonly buttonLabel: string;
  readonly fields: readonly TransitionField[];
}

/** The forward-moving rows only. Pause and resume are handled separately below. */
export const BATCH_TRANSITION_ROWS: readonly TransitionRow[] = [
  {
    from: "draft",
    to: "open",
    callers: ["owner"],
    buttonLabel: BATCHES.openBatch,
    fields: [
      { key: "plannedJars", label: BATCHES.plannedJars, kind: "whole", required: false },
      { key: "priceOpen", label: BATCHES.priceOpen, kind: "price", required: false },
      { key: "priceInStock", label: BATCHES.priceInStock, kind: "price", required: false },
      { key: "limitPerPerson", label: BATCHES.limitPerPerson, kind: "whole", required: false },
    ],
  },
  {
    from: "halfReached",
    to: "sourcing",
    callers: ["owner"],
    buttonLabel: BATCHES.sayYesSourcing,
    fields: [{ key: "messageText", label: BATCHES.messageText, kind: "textarea", required: false }],
  },
  {
    from: "sourcing",
    to: "cooking",
    callers: ["kitchen", "owner"],
    buttonLabel: BATCHES.startCooking,
    fields: [
      { key: "landedOn", label: BATCHES.landedOn, kind: "date", required: true },
      { key: "source", label: BATCHES.source, kind: "text", required: true },
      { key: "weightRaw", label: BATCHES.weightRaw, kind: "positive", required: true },
      { key: "costRaw", label: BATCHES.costRaw, kind: "rupees", required: true },
    ],
  },
  {
    from: "cooking",
    to: "bottled",
    callers: ["kitchen", "owner"],
    buttonLabel: BATCHES.bottleBatch,
    fields: [
      { key: "weightCleaned", label: BATCHES.weightCleaned, kind: "positive", required: true },
      { key: "weightCooked", label: BATCHES.weightCooked, kind: "positive", required: true },
      { key: "jarCount", label: BATCHES.jarCount, kind: "whole", required: true },
      { key: "packedOn", label: BATCHES.packedOn, kind: "date", required: true },
    ],
  },
];

/** The one forward row this role may act on from this state, or null. */
export function findTransitionRow(state: string | undefined, role: Role): TransitionRow | null {
  return (
    BATCH_TRANSITION_ROWS.find((row) => row.from === state && row.callers.includes(role)) ?? null
  );
}

/** Brief 8.2, decision D23: pausable from Open, Half reached, Sourcing, Cooking, In stock and Sold out. */
export function isPausable(state: string | undefined): boolean {
  return (BATCH_STATES_PAUSABLE as readonly string[]).includes(state ?? "");
}

/**
 * What the screen says when there is no button for this role: either the
 * step is automatic (nobody presses anything) or it belongs to the other
 * role. Falls back to a plain "nothing to do" line for a state or role this
 * table does not name.
 */
export function waitingLine(state: string | undefined, role: Role): string {
  if (state === "draft" && role !== "owner") return BATCHES.waitingDraftNotOwner;
  if (state === "open") return BATCHES.waitingOpen;
  if (state === "halfReached" && role !== "owner") return BATCHES.waitingHalfReached;
  if (state === "sourcing" && role === "owner") return BATCHES.waitingSourcingKitchenOnly;
  if (state === "cooking" && role === "owner") return BATCHES.waitingCookingKitchenOnly;
  if (state === "bottled") return BATCHES.waitingBottled;
  if (state === "inStock") return BATCHES.waitingInStock;
  if (state === "soldOut") return BATCHES.waitingSoldOut;
  if (state === "archived") return BATCHES.waitingArchived;
  return BATCHES.waitingNoAction;
}
