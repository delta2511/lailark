/**
 * One `ingredients/{id}` document: read only for anyone who may not edit it,
 * a form for anyone who may (D22).
 *
 * The read-only view renders no input, select or textarea at all. That is the
 * shape of D22 on screen: "Kitchen and Viewer read every ingredient and
 * recipe with all their details", and an input Sumayya can type into and not
 * save is worse than no input.
 */
import {
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  RECIPE_UNITS,
  formatINR,
  type NutritionPer100g,
} from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { PRODUCTS } from "../copy";
import type { IngredientDoc, IngredientInput } from "./data";

interface Props {
  readonly ingredient: IngredientDoc | null;
  readonly canEdit: boolean;
  readonly onSave: (input: IngredientInput) => Promise<void>;
  readonly onClose: () => void;
  readonly error: string | null;
}

function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Rupees typed in the box, paise in the document (CLAUDE.md section 3). */
function toPaise(text: string): number {
  return Math.round((numberOrNull(text) ?? 0) * 100);
}

export function IngredientDetail({ ingredient, canEdit, onSave, onClose, error }: Props): JSX.Element {
  const [labelName, setLabelName] = useState(ingredient?.labelName ?? "");
  const [allergens, setAllergens] = useState((ingredient?.allergenTags ?? []).join("\n"));
  const [unit, setUnit] = useState(ingredient?.unit ?? "g");
  const [unitCost, setUnitCost] = useState(
    ingredient?.unitCost === undefined ? "" : String(ingredient.unitCost / 100),
  );
  const [source, setSource] = useState(ingredient?.source ?? "");
  const [density, setDensity] = useState(
    ingredient?.densityGPerMl === undefined || ingredient.densityGPerMl === null
      ? ""
      : String(ingredient.densityGPerMl),
  );
  const [nutrition, setNutrition] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const key of NUTRIENT_KEYS) {
      const value = ingredient?.nutritionPer100g?.[key];
      start[key] = value === undefined ? "" : String(value);
    }
    return start;
  });
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!canEdit) {
    const tags = ingredient?.allergenTags ?? [];
    return (
      <div class="detail" data-testid="ingredient-detail">
        <p class="notice-line" data-testid="read-only-note">
          {PRODUCTS.readOnly}
        </p>
        <Field label={PRODUCTS.labelName} value={ingredient?.labelName ?? ""} testId="view-labelName" />
        <Field label={PRODUCTS.allergenTags} value={tags.join(", ")} testId="view-allergenTags" />
        <Field label={PRODUCTS.unit} value={ingredient?.unit ?? ""} testId="view-unit" />
        <Field
          label={PRODUCTS.unitCost}
          value={ingredient?.unitCost === undefined ? "" : formatINR(ingredient.unitCost)}
          testId="view-unitCost"
          numeric
        />
        <Field label={PRODUCTS.source} value={ingredient?.source ?? ""} testId="view-source" />
        <Field
          label={PRODUCTS.density}
          value={ingredient?.densityGPerMl == null ? "" : String(ingredient.densityGPerMl)}
          testId="view-density"
          numeric
        />
        <p class="field-label">{PRODUCTS.nutrition}</p>
        <ul class="percent-list" data-testid="view-nutrition">
          {NUTRIENT_KEYS.filter((key) => ingredient?.nutritionPer100g?.[key] !== undefined).map(
            (key) => (
              <li key={key}>
                <span class="percent-name">{NUTRIENT_LABELS[key]}</span>
                <span class="percent-value">
                  {ingredient?.nutritionPer100g?.[key]} {NUTRIENT_UNITS[key]}
                </span>
              </li>
            ),
          )}
        </ul>
        <div class="hairline" />
        <button class="quiet" type="button" onClick={onClose}>
          {PRODUCTS.backToProducts}
        </button>
      </div>
    );
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (labelName.trim() === "") {
      setLocalError(PRODUCTS.nameRequired);
      return;
    }
    setLocalError(null);
    setBusy(true);

    const values: NutritionPer100g = {};
    const writable = values as Record<string, number>;
    for (const key of NUTRIENT_KEYS) {
      const value = numberOrNull(nutrition[key] ?? "");
      if (value !== null) writable[key] = value;
    }

    const input: IngredientInput = {
      labelName: labelName.trim(),
      allergenTags: allergens
        .split("\n")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
      nutritionPer100g: values,
      unitCost: toPaise(unitCost),
      unit: unit.trim(),
      source: source.trim() === "" ? null : source.trim(),
      densityGPerMl: numberOrNull(density),
    };

    try {
      await onSave(input);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="detail" data-testid="ingredient-form" onSubmit={(event) => void submit(event)}>
      <label for="labelName">{PRODUCTS.labelName}</label>
      <input
        id="labelName"
        name="labelName"
        type="text"
        value={labelName}
        onInput={(event) => setLabelName((event.target as HTMLInputElement).value)}
      />
      <p class="field-help">{PRODUCTS.labelNameHelp}</p>

      <label for="allergenTags">{PRODUCTS.allergenTags}</label>
      <textarea
        id="allergenTags"
        name="allergenTags"
        rows={3}
        value={allergens}
        onInput={(event) => setAllergens((event.target as HTMLTextAreaElement).value)}
      />
      <p class="field-help">{PRODUCTS.allergenTagsHelp}</p>

      <label for="unit">{PRODUCTS.unit}</label>
      <select
        id="unit"
        name="unit"
        value={unit}
        onChange={(event) => setUnit((event.target as HTMLSelectElement).value)}
      >
        {RECIPE_UNITS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <label for="unitCost">{PRODUCTS.unitCost}</label>
      <input
        id="unitCost"
        name="unitCost"
        type="text"
        inputMode="decimal"
        value={unitCost}
        onInput={(event) => setUnitCost((event.target as HTMLInputElement).value)}
      />
      <p class="field-help">{PRODUCTS.unitCostHelp}</p>

      <label for="source">{PRODUCTS.source}</label>
      <input
        id="source"
        name="source"
        type="text"
        value={source}
        onInput={(event) => setSource((event.target as HTMLInputElement).value)}
      />

      <label for="density">{PRODUCTS.density}</label>
      <input
        id="density"
        name="density"
        type="text"
        inputMode="decimal"
        value={density}
        onInput={(event) => setDensity((event.target as HTMLInputElement).value)}
      />
      <p class="field-help">{PRODUCTS.densityHelp}</p>

      <p class="field-label">{PRODUCTS.nutrition}</p>
      <p class="field-help">{PRODUCTS.nutritionHelp}</p>
      {NUTRIENT_KEYS.map((key) => (
        <div key={key}>
          <label for={key}>{`${NUTRIENT_LABELS[key]} (${NUTRIENT_UNITS[key]})`}</label>
          <input
            id={key}
            name={key}
            type="text"
            inputMode="decimal"
            value={nutrition[key] ?? ""}
            onInput={(event) =>
              setNutrition({ ...nutrition, [key]: (event.target as HTMLInputElement).value })
            }
          />
        </div>
      ))}

      {localError ?? error ? (
        <p class="error" data-testid="save-error">
          {localError ?? error}
        </p>
      ) : null}

      <div class="hairline" />
      <button type="submit" disabled={busy} data-testid="save-ingredient">
        {busy ? PRODUCTS.saving : PRODUCTS.save}
      </button>
      <div class="hairline" />
      <button class="quiet" type="button" onClick={onClose}>
        {PRODUCTS.cancel}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  testId,
  numeric,
}: {
  label: string;
  value: string;
  testId: string;
  numeric?: boolean;
}): JSX.Element {
  return (
    <div class="settings-field">
      <p class="field-label">{label}</p>
      <p class={numeric ? "field-value number" : "field-value"} data-testid={testId}>
        {value}
      </p>
    </div>
  );
}
