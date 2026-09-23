/**
 * One `recipes/{id}` document: its lines, the percentage basis switch, and
 * the label block the recipe engine builds from both, recomputed on every
 * keystroke and on every flip of the switch.
 *
 * Brief section 14.3: "Recipe drives ingredient order, percentages,
 * allergens, nutrition and storage. Percentage basis: see the label basis
 * doc. One switch in the recipe engine." That switch is this screen's.
 *
 * Read only for anyone who may not edit (D22): the lines and the whole label
 * block still read, and no input, select or textarea is rendered.
 */
import {
  DEFAULT_CLAIMS_TEXT,
  DEFAULT_PERCENTAGE_BASIS,
  DEFAULT_STORAGE_TEXT,
  RECIPE_UNITS,
  buildLabelBlock,
  indexIngredients,
  isPercentageBasis,
  type PercentageBasis,
  type RecipeLine,
} from "@lailark/shared";
import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";

import { PRODUCTS } from "../copy";
import type { IngredientDoc, RecipeDoc, RecipeInput } from "./data";
import { BasisSwitch, LabelBlockView } from "./LabelBlockView";

interface Props {
  readonly recipe: RecipeDoc | null;
  readonly ingredients: readonly IngredientDoc[];
  readonly canEdit: boolean;
  readonly onSave: (input: RecipeInput) => Promise<void>;
  readonly onClose: () => void;
  readonly error: string | null;
}

interface LineDraft {
  ingredientId: string;
  qty: string;
  unit: string;
  isMain: boolean;
  evaporates: boolean;
  residueG: string;
  compoundOf: string;
}

function toDraft(line: RecipeLine): LineDraft {
  return {
    ingredientId: line.ingredientId,
    qty: String(line.qty ?? ""),
    unit: line.unit ?? "g",
    isMain: line.isMain === true,
    evaporates: line.evaporates === true,
    residueG: line.residueG === undefined ? "" : String(line.residueG),
    compoundOf: (line.compoundOf ?? []).join(", "),
  };
}

function toLine(draft: LineDraft): RecipeLine {
  const parts = draft.compoundOf
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const qty = Number(draft.qty);
  return {
    ingredientId: draft.ingredientId,
    qty: Number.isFinite(qty) ? qty : 0,
    unit: draft.unit,
    isMain: draft.isMain,
    evaporates: draft.evaporates,
    ...(draft.evaporates ? { residueG: Number(draft.residueG) || 0 } : {}),
    ...(parts.length > 0 ? { compoundOf: parts } : {}),
  };
}

/** The first ingredient this recipe puts on two lines, or null (M2.13). */
function firstRepeatedIngredient(lines: readonly LineDraft[]): string | null {
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.ingredientId === "") continue;
    if (seen.has(line.ingredientId)) return line.ingredientId;
    seen.add(line.ingredientId);
  }
  return null;
}

function numberOr(text: string, fallback: number): number {
  const value = Number(text.trim());
  return Number.isFinite(value) && text.trim() !== "" ? value : fallback;
}

export function RecipeDetail({
  recipe,
  ingredients,
  canEdit,
  onSave,
  onClose,
  error,
}: Props): JSX.Element {
  const [productSlug, setProductSlug] = useState(recipe?.productSlug ?? "");
  const [version, setVersion] = useState(String(recipe?.version ?? 1));
  const [expectedYieldJars, setExpectedYieldJars] = useState(String(recipe?.expectedYieldJars ?? ""));
  const [finishedWeightG, setFinishedWeightG] = useState(String(recipe?.finishedWeightG ?? ""));
  const [storageText, setStorageText] = useState(recipe?.storageText ?? DEFAULT_STORAGE_TEXT);
  const [claimsText, setClaimsText] = useState(recipe?.claimsText ?? DEFAULT_CLAIMS_TEXT);
  const [lines, setLines] = useState<LineDraft[]>(() => (recipe?.lines ?? []).map(toDraft));
  const [basis, setBasis] = useState<PercentageBasis>(
    isPercentageBasis(recipe?.percentageBasis) ? recipe.percentageBasis : DEFAULT_PERCENTAGE_BASIS,
  );
  const [busy, setBusy] = useState(false);
  /**
   * M2.13. Two lines of one ingredient cannot have separate actuals: their
   * weights and costs live in `batches/{ref}/lines`, keyed by ingredient,
   * and a positional tiebreak swaps them the moment the lines are reordered.
   * Rather than key a batch's money on a line's position, the recipe simply
   * does not allow the shape: the dropdown leaves out ingredients already on
   * another line, and a save is refused if one slips through.
   */
  const [lineError, setLineError] = useState<string | null>(null);

  const index = useMemo(() => indexIngredients(ingredients.map((i) => ({ ...i, id: i.id }))), [ingredients]);
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const ingredient of ingredients) out[ingredient.id] = ingredient.labelName;
    return out;
  }, [ingredients]);

  const finishedWeight = numberOr(finishedWeightG, 0);

  // The block is the current state, saved or not, so the basis switch and
  // every typed gram show in the label straight away.
  const block = useMemo(() => {
    try {
      return buildLabelBlock(
        {
          percentageBasis: basis,
          finishedWeightG: finishedWeight > 0 ? finishedWeight : undefined,
          storageText,
          claimsText,
          lines: lines.map(toLine),
        },
        index,
        { basis: basis === "C" && !(finishedWeight > 0) ? DEFAULT_PERCENTAGE_BASIS : basis },
      );
    } catch {
      return null;
    }
  }, [basis, finishedWeight, storageText, claimsText, lines, index]);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const repeated = firstRepeatedIngredient(lines);
    if (repeated !== null) {
      setLineError(PRODUCTS.lineIngredientRepeated(names[repeated] ?? repeated));
      return;
    }
    setLineError(null);
    setBusy(true);
    try {
      await onSave({
        productSlug: productSlug.trim(),
        version: numberOr(version, 1),
        percentageBasis: basis,
        expectedYieldJars: numberOr(expectedYieldJars, 0),
        finishedWeightG: finishedWeight,
        storageText,
        claimsText,
        lines: lines.map(toLine),
      });
    } finally {
      setBusy(false);
    }
  }

  const labelPanel =
    block === null ? null : (
      <>
        <BasisSwitch basis={basis} onChange={setBasis} finishedWeightG={finishedWeight} />
        <LabelBlockView block={block} ingredientNames={names} />
      </>
    );

  if (!canEdit) {
    return (
      <div class="detail" data-testid="recipe-detail">
        <p class="notice-line" data-testid="read-only-note">
          {PRODUCTS.readOnly}
        </p>
        <div class="settings-field">
          <p class="field-label">{PRODUCTS.productSlug}</p>
          <p class="field-value" data-testid="view-productSlug">
            {recipe?.productSlug ?? ""}
          </p>
        </div>
        <div class="settings-field">
          <p class="field-label">{PRODUCTS.finishedWeightG}</p>
          <p class="field-value number" data-testid="view-finishedWeightG">
            {recipe?.finishedWeightG ?? ""}
          </p>
        </div>
        <p class="field-label">{PRODUCTS.lines}</p>
        <ul class="percent-list" data-testid="view-lines">
          {lines.map((line, position) => (
            <li key={`${line.ingredientId}-${position}`} data-testid={`view-line-${line.ingredientId}`}>
              <span class="percent-name">{names[line.ingredientId] ?? line.ingredientId}</span>
              <span class="percent-value">{`${line.qty} ${line.unit}`}</span>
            </li>
          ))}
        </ul>
        {labelPanel}
        <div class="hairline" />
        <button class="quiet" type="button" onClick={onClose}>
          {PRODUCTS.backToProducts}
        </button>
      </div>
    );
  }

  return (
    <form class="detail" data-testid="recipe-form" onSubmit={(event) => void submit(event)}>
      <label for="productSlug">{PRODUCTS.productSlug}</label>
      <input
        id="productSlug"
        name="productSlug"
        type="text"
        value={productSlug}
        onInput={(event) => setProductSlug((event.target as HTMLInputElement).value)}
      />

      <label for="version">{PRODUCTS.version}</label>
      <input
        id="version"
        name="version"
        type="text"
        inputMode="numeric"
        value={version}
        onInput={(event) => setVersion((event.target as HTMLInputElement).value)}
      />

      <label for="expectedYieldJars">{PRODUCTS.expectedYieldJars}</label>
      <input
        id="expectedYieldJars"
        name="expectedYieldJars"
        type="text"
        inputMode="numeric"
        value={expectedYieldJars}
        onInput={(event) => setExpectedYieldJars((event.target as HTMLInputElement).value)}
      />

      <label for="finishedWeightG">{PRODUCTS.finishedWeightG}</label>
      <input
        id="finishedWeightG"
        name="finishedWeightG"
        type="text"
        inputMode="numeric"
        value={finishedWeightG}
        onInput={(event) => setFinishedWeightG((event.target as HTMLInputElement).value)}
      />
      <p class="field-help">{PRODUCTS.finishedWeightHelp}</p>

      <label for="claimsText">{PRODUCTS.claimsText}</label>
      <textarea
        id="claimsText"
        name="claimsText"
        rows={2}
        value={claimsText}
        onInput={(event) => setClaimsText((event.target as HTMLTextAreaElement).value)}
      />

      <label for="storageText">{PRODUCTS.storageText}</label>
      <textarea
        id="storageText"
        name="storageText"
        rows={3}
        value={storageText}
        onInput={(event) => setStorageText((event.target as HTMLTextAreaElement).value)}
      />

      <p class="field-label">{PRODUCTS.lines}</p>
      <ul class="line-list">
        {lines.map((line, position) => (
          <li key={position} class="line-row" data-testid={`line-${position}`}>
            <label for={`line-${position}-ingredient`}>{PRODUCTS.lineIngredient}</label>
            <select
              id={`line-${position}-ingredient`}
              value={line.ingredientId}
              onChange={(event) =>
                setLines(
                  lines.map((l, i) =>
                    i === position
                      ? { ...l, ingredientId: (event.target as HTMLSelectElement).value }
                      : l,
                  ),
                )
              }
            >
              <option value="">{PRODUCTS.lineIngredient}</option>
              {ingredients
                // Already on another line: choosing it here would give two
                // lines one ingredient, which the batch's actuals cannot
                // tell apart (M2.13). The line's own current value stays,
                // so an existing recipe still shows what it says.
                .filter(
                  (ingredient) =>
                    ingredient.id === line.ingredientId ||
                    !lines.some((l, i) => i !== position && l.ingredientId === ingredient.id),
                )
                .map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>
                    {ingredient.labelName}
                  </option>
                ))}
            </select>

            <label for={`line-${position}-qty`}>{PRODUCTS.lineQty}</label>
            <input
              id={`line-${position}-qty`}
              type="text"
              inputMode="decimal"
              value={line.qty}
              onInput={(event) =>
                setLines(
                  lines.map((l, i) =>
                    i === position ? { ...l, qty: (event.target as HTMLInputElement).value } : l,
                  ),
                )
              }
            />

            <label for={`line-${position}-unit`}>{PRODUCTS.lineUnit}</label>
            <select
              id={`line-${position}-unit`}
              value={line.unit}
              onChange={(event) =>
                setLines(
                  lines.map((l, i) =>
                    i === position ? { ...l, unit: (event.target as HTMLSelectElement).value } : l,
                  ),
                )
              }
            >
              {RECIPE_UNITS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <label class="check-row" for={`line-${position}-main`}>
              <input
                id={`line-${position}-main`}
                type="checkbox"
                checked={line.isMain}
                onChange={(event) =>
                  setLines(
                    lines.map((l, i) =>
                      i === position
                        ? { ...l, isMain: (event.target as HTMLInputElement).checked }
                        : l,
                    ),
                  )
                }
              />
              {PRODUCTS.lineIsMain}
            </label>

            <label class="check-row" for={`line-${position}-evaporates`}>
              <input
                id={`line-${position}-evaporates`}
                type="checkbox"
                checked={line.evaporates}
                onChange={(event) =>
                  setLines(
                    lines.map((l, i) =>
                      i === position
                        ? { ...l, evaporates: (event.target as HTMLInputElement).checked }
                        : l,
                    ),
                  )
                }
              />
              {PRODUCTS.lineEvaporates}
            </label>

            {line.evaporates ? (
              <>
                <label for={`line-${position}-residue`}>{PRODUCTS.lineResidue}</label>
                <input
                  id={`line-${position}-residue`}
                  type="text"
                  inputMode="decimal"
                  value={line.residueG}
                  onInput={(event) =>
                    setLines(
                      lines.map((l, i) =>
                        i === position
                          ? { ...l, residueG: (event.target as HTMLInputElement).value }
                          : l,
                      ),
                    )
                  }
                />
              </>
            ) : null}

            <label for={`line-${position}-compound`}>{PRODUCTS.lineCompoundOf}</label>
            <input
              id={`line-${position}-compound`}
              type="text"
              value={line.compoundOf}
              onInput={(event) =>
                setLines(
                  lines.map((l, i) =>
                    i === position
                      ? { ...l, compoundOf: (event.target as HTMLInputElement).value }
                      : l,
                  ),
                )
              }
            />

            <button
              class="quiet"
              type="button"
              data-testid={`remove-line-${position}`}
              onClick={() => setLines(lines.filter((_, i) => i !== position))}
            >
              {PRODUCTS.removeLine}
            </button>
          </li>
        ))}
      </ul>

      <button
        class="quiet"
        type="button"
        data-testid="add-line"
        onClick={() =>
          setLines([
            ...lines,
            {
              // The first ingredient this recipe is not already using: a new
              // line that defaulted to one already on another line would be
              // the duplicate the dropdown refuses to let anyone pick (M2.13).
              ingredientId:
                ingredients.find((i) => !lines.some((l) => l.ingredientId === i.id))?.id ?? "",
              qty: "",
              unit: "g",
              isMain: false,
              evaporates: false,
              residueG: "",
              compoundOf: "",
            },
          ])
        }
      >
        {PRODUCTS.addLine}
      </button>

      {lineError ? (
        <p class="error" data-testid="line-error">
          {lineError}
        </p>
      ) : null}

      {error ? (
        <p class="error" data-testid="save-error">
          {error}
        </p>
      ) : null}

      <div class="hairline" />
      <button type="submit" disabled={busy} data-testid="save-recipe">
        {busy ? PRODUCTS.saving : PRODUCTS.save}
      </button>
      <div class="hairline" />
      <button class="quiet" type="button" onClick={onClose}>
        {PRODUCTS.cancel}
      </button>

      {labelPanel}
    </form>
  );
}
