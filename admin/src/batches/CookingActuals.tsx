/**
 * Per-ingredient actuals, brief section 17.4's Cooking row: "each
 * ingredient's actual weight and cost (prefilled from the recipe), drift
 * warning for label review."
 *
 * One row per recipe line, in `batches/{ref}/lines/{id}`. The main
 * ingredient's line keeps the id the Sourcing -> Cooking transition already
 * gave it (`"main"`, `functions/src/batches/transitions.ts`); every other
 * line is keyed by its own ingredient id, so a row here and the one the
 * server already wrote for the main ingredient are the same document.
 *
 * "Prefilled from the recipe": the weight box opens on the recipe's own
 * quantity in grams, so an untouched box shows no drift. ASSUMED (M2.4):
 * the cost box opens empty rather than guessed from the ingredient's price
 * list, because turning a per-unit cost into a per-gram default crosses into
 * price-list territory this task does not otherwise build.
 */
import {
  formatINR,
  indexIngredients,
  ingredientActualDrift,
  toGrams,
  type IngredientIndex,
} from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { BATCHES } from "../copy";
import { isCostPaise, parseRupeesToPaise } from "../products/productMoney";
import type { IngredientDoc, RecipeDoc } from "../products/data";
import {
  isPermissionDenied,
  saveBatchLine,
  useBatchLines,
  type BatchLineDoc,
  type BatchLineField,
} from "./data";

interface Props {
  readonly batchRef: string;
  readonly recipe: RecipeDoc | null;
  readonly ingredients: readonly IngredientDoc[];
  readonly canEdit: boolean;
  readonly uid: string;
}

function lineIdFor(ingredientId: string, isMain: boolean): string {
  return isMain ? "main" : ingredientId;
}

export function CookingActuals({ batchRef, recipe, ingredients, canEdit, uid }: Props): JSX.Element | null {
  const lines = useBatchLines(batchRef);

  if (recipe === null || recipe.lines.length === 0) return null;

  const index: IngredientIndex = indexIngredients(ingredients.map((i) => ({ ...i, id: i.id })));
  const byId = new Map(lines.items.map((l) => [l.id, l]));

  return (
    <div class="drift-section">
      <p class="field-label">{BATCHES.actualsHeading}</p>
      <p class="field-help">{BATCHES.actualsHelp}</p>
      <ul class="line-list" data-testid="actuals-list">
        {recipe.lines.map((line) => {
          const isMain = line.isMain === true;
          const id = lineIdFor(line.ingredientId, isMain);
          const ingredient = index[line.ingredientId];
          let recipeG = 0;
          try {
            recipeG = toGrams(line.qty, line.unit, ingredient?.densityGPerMl);
          } catch {
            recipeG = 0;
          }
          const existing = byId.get(id) ?? null;
          return (
            <ActualRow
              // Remounts once the actual arrives (or changes elsewhere), the
              // same way every other edit-in-place field in this admin keys
              // on its committed value (`ProductDetail`'s price and jar-size
              // inputs): `useState`'s initial value only runs once, so
              // without this the box would keep showing the recipe's own
              // fallback forever after the real actual loads in.
              key={`${line.ingredientId}-${existing?.qtyActual ?? "u"}-${existing?.costActual ?? "u"}`}
              batchRef={batchRef}
              lineId={id}
              ingredientId={line.ingredientId}
              label={ingredient?.labelName ?? line.ingredientId}
              recipeQty={line.qty}
              recipeUnit={line.unit}
              recipeG={recipeG}
              densityGPerMl={ingredient?.densityGPerMl ?? null}
              existing={existing}
              canEdit={canEdit}
              uid={uid}
            />
          );
        })}
      </ul>
    </div>
  );
}

function ActualRow({
  batchRef,
  lineId,
  ingredientId,
  label,
  recipeQty,
  recipeUnit,
  recipeG,
  densityGPerMl,
  existing,
  canEdit,
  uid,
}: {
  readonly batchRef: string;
  readonly lineId: string;
  readonly ingredientId: string;
  readonly label: string;
  readonly recipeQty: number;
  readonly recipeUnit: string;
  readonly recipeG: number;
  readonly densityGPerMl: number | null;
  readonly existing: BatchLineDoc | null;
  readonly canEdit: boolean;
  readonly uid: string;
}): JSX.Element {
  const openingQty =
    existing?.qtyActual !== undefined ? String(existing.qtyActual) : recipeG > 0 ? String(Math.round(recipeG)) : "";
  const openingCost = existing?.costActual !== undefined ? String(existing.costActual / 100) : "";

  const [qtyText, setQtyText] = useState(openingQty);
  const [costText, setCostText] = useState(openingCost);
  // The last text this row actually committed (or opened on): what an empty
  // box falls back to, so clearing one is a no-op the person can see undone.
  const [keptQty, setKeptQty] = useState(openingQty);
  const [keptCost, setKeptCost] = useState(openingCost);
  const [error, setError] = useState<string | null>(null);

  const qtyNum = Number(qtyText);
  const drift =
    Number.isFinite(qtyNum) && qtyNum >= 0
      ? (() => {
          try {
            return ingredientActualDrift(recipeQty, recipeUnit, qtyNum, densityGPerMl);
          } catch {
            return null;
          }
        })()
      : null;

  /**
   * One box, one field. Neither box ever reads the other's value, so a
   * commit can only ever change the field the person is standing in: the
   * write is a `merge` and carries nothing else with it.
   */
  async function commit(field: BatchLineField, value: number): Promise<void> {
    setError(null);
    try {
      await saveBatchLine(batchRef, lineId, ingredientId, field, value, uid, existing === null);
    } catch (caught) {
      setError(isPermissionDenied(caught) ? BATCHES.saveRefused : BATCHES.saveFailed);
    }
  }

  /**
   * ASSUMED (M2.4): an empty or whitespace-only box is "not given", never a
   * zero. It leaves the stored value exactly as it was and puts the stored
   * value back in the box, because a person retyping a weight or interrupted
   * mid-edit has no reason to expect that clearing a box is how you say "this
   * weight is gone". `StateButton.parseField` already reads an empty box the
   * same way. A deliberate 0 typed into the box is a real number and saves.
   */
  function commitQty(text: string): void {
    const raw = text.trim();
    if (raw === "") {
      setQtyText(keptQty);
      setError(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setError(BATCHES.weightInvalid);
      return;
    }
    setQtyText(raw);
    setKeptQty(raw);
    void commit("qtyActual", n);
  }

  function commitCost(text: string): void {
    const raw = text.trim();
    if (raw === "") {
      setCostText(keptCost);
      setError(null);
      return;
    }
    // A cost is money: a whole number of paise, zero or more. Never negative,
    // never a fraction of a paisa (CLAUDE.md section 3).
    const paise = parseRupeesToPaise(raw);
    if (!isCostPaise(paise)) {
      setError(BATCHES.costInvalid);
      return;
    }
    setCostText(raw);
    setKeptCost(raw);
    void commit("costActual", paise as number);
  }

  return (
    <li class="line-row" data-testid={`actual-row-${lineId}`}>
      <span class="percent-name">{label}</span>
      <p class="field-help" data-testid={`recipe-qty-${lineId}`}>
        {BATCHES.recipeQty}: {Math.round(recipeG)} g
      </p>

      {canEdit ? (
        <>
          <label for={`actual-weight-${lineId}`}>{BATCHES.actualWeight}</label>
          <input
            id={`actual-weight-${lineId}`}
            type="text"
            inputMode="decimal"
            value={qtyText}
            data-testid={`actual-weight-${lineId}`}
            onInput={(event) => setQtyText((event.target as HTMLInputElement).value)}
            onChange={(event) => commitQty((event.target as HTMLInputElement).value)}
          />

          <label for={`actual-cost-${lineId}`}>{BATCHES.actualCost}</label>
          <input
            id={`actual-cost-${lineId}`}
            type="text"
            inputMode="decimal"
            value={costText}
            data-testid={`actual-cost-${lineId}`}
            onInput={(event) => setCostText((event.target as HTMLInputElement).value)}
            onChange={(event) => commitCost((event.target as HTMLInputElement).value)}
          />
        </>
      ) : (
        <>
          <span class="field-value number" data-testid={`view-actual-weight-${lineId}`}>
            {existing?.qtyActual !== undefined ? `${existing.qtyActual} g` : ""}
          </span>
          <span class="field-value number" data-testid={`view-actual-cost-${lineId}`}>
            {existing?.costActual !== undefined ? formatINR(existing.costActual) : ""}
          </span>
        </>
      )}

      {error ? (
        <p class="error" data-testid={`actual-error-${lineId}`}>
          {error}
        </p>
      ) : null}

      {drift?.isDrifting ? (
        <p class="notice-line" data-testid={`drift-warning-${lineId}`}>
          {BATCHES.driftWarning(drift.percent)}
        </p>
      ) : null}
    </li>
  );
}
