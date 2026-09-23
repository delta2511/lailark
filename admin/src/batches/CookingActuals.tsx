/**
 * Per-ingredient actuals, brief section 17.4's Cooking row: "each
 * ingredient's actual weight and cost (prefilled from the recipe), drift
 * warning for label review."
 *
 * One row per recipe line, in `batches/{ref}/lines/{id}`, keyed by its own
 * ingredient (`lineIds.ts`), which is also the id the Sourcing -> Cooking
 * transition writes the main ingredient's raw weight and cost under
 * (`functions/src/batches/transitions.ts`), so a row here and the one the
 * server already wrote are the same document. Before M2.13 every line
 * flagged `isMain` was keyed under the literal id `"main"`, which made the
 * two main lines of a batch 001 shaped recipe one document; `lineIds.ts`
 * says what replaced it and what happens to the documents that id left
 * behind.
 *
 * "Prefilled from the recipe": the weight box opens on the recipe's own
 * quantity in grams, so an untouched box shows no drift. ASSUMED (M2.4):
 * the cost box opens empty rather than guessed from the ingredient's price
 * list, because turning a per-unit cost into a per-gram default crosses into
 * price-list territory this task does not otherwise build.
 *
 * M2.14 (superseding A79): a commit here offers the same 8 second undo as
 * every other in-place field (`UndoToast`, `saveBatchLine`'s doc comment in
 * `data.ts` for the race analysis). One toast for the whole section, not one
 * per row, the same shape `BatchDetail` uses for its own fields: the section
 * is one screen's worth of typing, and only one box is ever being edited at
 * a time.
 */
import {
  formatINR,
  indexIngredients,
  ingredientActualDrift,
  toGrams,
  type IngredientIndex,
  type Role,
} from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { BATCHES } from "../copy";
import { isCostPaise, parseRupeesToPaise } from "../products/productMoney";
import type { IngredientDoc, RecipeDoc } from "../products/data";
import { UndoToast, type UndoToastState } from "../ui/UndoToast";
import { resolveActuals, type OrphanLine } from "./lineIds";
import {
  isPermissionDenied,
  saveBatchLine,
  undoBatchLineWrite,
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
  readonly role: Role;
}

export function CookingActuals({ batchRef, recipe, ingredients, canEdit, uid, role }: Props): JSX.Element | null {
  const lines = useBatchLines(batchRef);

  // M2.14: the toast's `before` is the `audit/{id}` entry the write just
  // created, the same shape `BatchDetail`'s own toast uses.
  const [toast, setToast] = useState<UndoToastState<string> | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  /**
   * The undo race and the back-door guard both live in `undoBatchLineWrite`
   * (`./data.ts`): it refuses if the field changed again since this write
   * (the other person's figure stands, nothing here silently overwrites
   * it), and it refuses if `role` may not write the field (never reached in
   * practice, since only a staff role can reach this screen's boxes at all,
   * but checked anyway rather than assumed).
   */
  async function handleUndo(auditId: string): Promise<void> {
    setToast(null);
    const outcome = await undoBatchLineWrite(auditId, uid, role);
    if (!outcome.ok) {
      setUndoError(
        outcome.reason === "raced"
          ? BATCHES.undoRaced
          : outcome.reason === "forbidden"
            ? BATCHES.undoForbidden
            : BATCHES.undoGone,
      );
      return;
    }
    setToast({ message: BATCHES.undone, before: outcome.auditId });
  }

  if (recipe === null || recipe.lines.length === 0) return null;

  const index: IngredientIndex = indexIngredients(ingredients.map((i) => ({ ...i, id: i.id })));

  /**
   * **Nothing is resolved, shown or typed until the lines have loaded.**
   * `useBatchLines` opens on `{items: [], loading: true}`, and a row
   * resolved against that empty list binds to its own ingredient id rather
   * than to the `lines/main` document it should have adopted. A commit
   * inside that window would write a second document for the same
   * ingredient and strand the legacy one: invisible on the screen,
   * uneditable, and counted a second time by anything that sums the
   * subcollection. The window is short and real (M2.13 round 1 measured it),
   * so the boxes simply do not exist until the answer is known.
   */
  if (lines.loading) {
    return (
      <div class="drift-section">
        <p class="field-label">{BATCHES.actualsHeading}</p>
        <p class="field-help" data-testid="actuals-loading">
          {BATCHES.actualsLoading}
        </p>
      </div>
    );
  }

  if (lines.denied) {
    return (
      <div class="drift-section">
        <p class="field-label">{BATCHES.actualsHeading}</p>
        <p class="notice-line" data-testid="actuals-denied">
          {BATCHES.actualsDenied}
        </p>
      </div>
    );
  }

  const byId = new Map(lines.items.map((l) => [l.id, l]));
  const { rows: resolved, orphans } = resolveActuals(recipe.lines, lines.items);

  return (
    <div class="drift-section">
      <UndoToast toast={toast} onUndo={(id) => void handleUndo(id)} onExpire={() => setToast(null)} />
      {undoError ? (
        <p class="error" data-testid="actuals-undo-error">
          {undoError}
        </p>
      ) : null}
      <p class="field-label">{BATCHES.actualsHeading}</p>
      <p class="field-help">{BATCHES.actualsHelp}</p>
      <ul class="line-list" data-testid="actuals-list">
        {recipe.lines.map((line, position) => {
          const row = resolved[position];
          const id = row?.docId ?? line.ingredientId;
          const rowKey = row?.rowKey ?? line.ingredientId;
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
              key={`${id}-${existing?.qtyActual ?? "u"}-${existing?.costActual ?? "u"}`}
              batchRef={batchRef}
              lineId={id}
              rowKey={rowKey}
              ingredientId={line.ingredientId}
              label={ingredient?.labelName ?? line.ingredientId}
              recipeQty={line.qty}
              recipeEstimated={line.estimated === true}
              recipeUnit={line.unit}
              recipeG={recipeG}
              densityGPerMl={ingredient?.densityGPerMl ?? null}
              existing={existing}
              canEdit={canEdit}
              uid={uid}
              onSaved={(auditId, message) => {
                setUndoError(null);
                setToast({ message, before: auditId });
              }}
            />
          );
        })}
      </ul>
      <OrphanLines orphans={orphans} index={index} />
    </div>
  );
}

/**
 * Money recorded against a line no row in this recipe claims: the ingredient
 * was swapped on the recipe, or the recipe changed under a batch that had
 * already been cooked, or `planStartCooking` wrote its placeholder line for
 * a recipe with no main ingredient at all.
 *
 * It is shown, named and left exactly where it is. Reassigning it to another
 * ingredient would be a guess about money, and hiding it would leave a
 * figure in the batch's costs that nobody on this screen can see. The way
 * out is on the recipe: put the ingredient back on it and the row picks the
 * same document up again, with its figures intact.
 */
function OrphanLines({
  orphans,
  index,
}: {
  readonly orphans: readonly OrphanLine<BatchLineDoc>[];
  readonly index: IngredientIndex;
}): JSX.Element | null {
  if (orphans.length === 0) return null;
  return (
    <div class="drift-section" data-testid="orphan-lines">
      <p class="field-label">{BATCHES.orphansHeading}</p>
      <ul class="line-list">
        {orphans.map((orphan) => {
          const name =
            orphan.ingredientId === null
              ? BATCHES.orphanNoIngredient
              : (index[orphan.ingredientId]?.labelName ?? orphan.ingredientId);
          const figures = BATCHES.orphanFigures(
            orphan.doc.qtyActual != null ? `${orphan.doc.qtyActual} g` : "",
            orphan.doc.costActual != null ? formatINR(orphan.doc.costActual) : "",
          );
          return (
            <li key={orphan.doc.id} class="line-row" data-testid={`orphan-line-${orphan.doc.id}`}>
              <span class="field-value number">{BATCHES.orphanLine(name, figures)}</span>
            </li>
          );
        })}
      </ul>
      <p class="field-help">{BATCHES.orphanHelp}</p>
    </div>
  );
}

function ActualRow({
  batchRef,
  lineId,
  rowKey,
  ingredientId,
  label,
  recipeQty,
  recipeEstimated,
  recipeUnit,
  recipeG,
  densityGPerMl,
  existing,
  canEdit,
  uid,
  onSaved,
}: {
  readonly batchRef: string;
  readonly lineId: string;
  readonly rowKey: string;
  readonly ingredientId: string;
  readonly label: string;
  readonly recipeQty: number;
  readonly recipeEstimated: boolean;
  readonly recipeUnit: string;
  readonly recipeG: number;
  readonly densityGPerMl: number | null;
  readonly existing: BatchLineDoc | null;
  readonly canEdit: boolean;
  readonly uid: string;
  /** M2.14: called with the write's `audit/{id}` and the toast's message. */
  readonly onSaved: (auditId: string, message: string) => void;
}): JSX.Element {
  // M2.14: `!= null` catches both, not just `undefined`. Undoing this row's
  // very first edit (a `create`, since the line document did not exist
  // before it) restores a field to `null`, not to an absent key: the write
  // is a `merge`, which sets what `before` says rather than deleting the
  // key, so the field genuinely holds `null` afterwards, same as before the
  // edit. A box that only checked `!== undefined` read that back as "0" or
  // "0 g", a real, wrong number where the undo meant "nothing typed yet".
  const openingQty =
    existing?.qtyActual != null ? String(existing.qtyActual) : recipeG > 0 ? String(Math.round(recipeG)) : "";
  const openingCost = existing?.costActual != null ? String(existing.costActual / 100) : "";

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
      const beforeValue = existing?.[field] ?? null;
      const { auditId } = await saveBatchLine(
        batchRef,
        lineId,
        ingredientId,
        field,
        value,
        beforeValue,
        uid,
        existing === null,
      );
      const fieldLabel = field === "qtyActual" ? BATCHES.actualWeight : BATCHES.actualCost;
      const display = field === "qtyActual" ? `${value} g` : formatINR(value);
      onSaved(auditId, BATCHES.actualFieldChanged(label, fieldLabel, display));
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
    <li class="line-row" data-testid={`actual-row-${rowKey}`}>
      <span class="percent-name">{label}</span>
      <p class="field-help" data-testid={`recipe-qty-${rowKey}`}>
        {BATCHES.recipeQty}: {Math.round(recipeG)} g
        {recipeEstimated ? ` (${BATCHES.recipeQtyEstimated})` : ""}
      </p>

      {canEdit ? (
        <>
          <label for={`actual-weight-${rowKey}`}>{BATCHES.actualWeight}</label>
          <input
            id={`actual-weight-${rowKey}`}
            type="text"
            inputMode="decimal"
            value={qtyText}
            data-testid={`actual-weight-${rowKey}`}
            onInput={(event) => setQtyText((event.target as HTMLInputElement).value)}
            onChange={(event) => commitQty((event.target as HTMLInputElement).value)}
          />

          <label for={`actual-cost-${rowKey}`}>{BATCHES.actualCost}</label>
          <input
            id={`actual-cost-${rowKey}`}
            type="text"
            inputMode="decimal"
            value={costText}
            data-testid={`actual-cost-${rowKey}`}
            onInput={(event) => setCostText((event.target as HTMLInputElement).value)}
            onChange={(event) => commitCost((event.target as HTMLInputElement).value)}
          />
        </>
      ) : (
        <>
          <span class="field-value number" data-testid={`view-actual-weight-${rowKey}`}>
            {existing?.qtyActual != null ? `${existing.qtyActual} g` : ""}
          </span>
          <span class="field-value number" data-testid={`view-actual-cost-${rowKey}`}>
            {existing?.costActual != null ? formatINR(existing.costActual) : ""}
          </span>
        </>
      )}

      {error ? (
        <p class="error" data-testid={`actual-error-${rowKey}`}>
          {error}
        </p>
      ) : null}

      {drift?.isDrifting ? (
        <p class="notice-line" data-testid={`drift-warning-${rowKey}`}>
          {BATCHES.driftWarning(drift.percent)}
        </p>
      ) : null}
    </li>
  );
}
