/**
 * The generated label block, recomputed from the recipe engine on every
 * render: the ingredient line, the allergen line, the claims, the storage
 * text and nutrition per 100 g.
 *
 * Nothing here writes copy. Every customer-facing string on this panel comes
 * out of `@lailark/shared`, which builds it from the recipe and the printed
 * label (CLAUDE.md section 3: claims and ingredient lines copy the label
 * character for character).
 */
import {
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  NUTRIENT_UNITS,
  PERCENTAGE_BASES,
  PERCENTAGE_BASIS_LABELS,
  PERCENTAGE_BASIS_NOTES,
  roundToDecimals,
  verifyAgainstPrintedLabel,
  type LabelBlock,
  type PercentageBasis,
} from "@lailark/shared";
import type { JSX } from "preact";

import { PRODUCTS } from "../copy";

interface BasisSwitchProps {
  readonly basis: PercentageBasis;
  readonly onChange: (basis: PercentageBasis) => void;
  /** C divides by the finished weight, so it is off until there is one. */
  readonly finishedWeightG: number;
}

/**
 * Three buttons, not a select: the switch is a view control on a read-only
 * screen as much as on an editable one, and a select would read as an edit
 * input to anyone checking what the Kitchen can touch.
 */
export function BasisSwitch({ basis, onChange, finishedWeightG }: BasisSwitchProps): JSX.Element {
  return (
    <div class="basis-switch" data-testid="basis-switch">
      <p class="field-label">{PRODUCTS.basis}</p>
      <div class="basis-buttons">
        {PERCENTAGE_BASES.map((option) => (
          <button
            key={option}
            type="button"
            class={`chip${option === basis ? " chip-on" : ""}`}
            data-testid={`basis-${option}`}
            aria-pressed={option === basis}
            disabled={option === "C" && !(finishedWeightG > 0)}
            onClick={() => onChange(option)}
          >
            {PERCENTAGE_BASIS_LABELS[option]}
          </button>
        ))}
      </div>
      <p class="field-help" data-testid="basis-note">
        {PERCENTAGE_BASIS_NOTES[basis]}
      </p>
    </div>
  );
}

function formatNutrient(value: number, key: (typeof NUTRIENT_KEYS)[number]): string {
  const decimals = NUTRIENT_UNITS[key] === "g" ? 1 : 0;
  return `${roundToDecimals(value, decimals)} ${NUTRIENT_UNITS[key]}`;
}

interface LabelBlockViewProps {
  readonly block: LabelBlock;
  readonly ingredientNames: Readonly<Record<string, string>>;
}

export function LabelBlockView({ block, ingredientNames }: LabelBlockViewProps): JSX.Element {
  const drift = verifyAgainstPrintedLabel(block);
  const missing = block.computation.missingIngredientIds;

  return (
    <section class="label-block" data-testid="label-block">
      <h2 class="section-heading">{PRODUCTS.labelBlock}</h2>

      {missing.length > 0 ? (
        <p class="notice-line" data-testid="label-missing-ingredient">
          {PRODUCTS.labelMissingIngredient(missing.join(", "))}
        </p>
      ) : null}

      <div class="label-field">
        <p class="field-label">{PRODUCTS.labelIngredients}</p>
        <p class="label-text" data-testid="label-ingredients-line">
          {block.ingredientsLine}
        </p>
      </div>

      <ul class="percent-list" data-testid="percent-list">
        {block.computation.items.map((item) => (
          <li key={item.ingredientId} data-testid={`percent-${item.ingredientId}`}>
            <span class="percent-name">{item.labelName}</span>
            <span class="percent-value">{roundToDecimals(item.value, 1)}</span>
          </li>
        ))}
      </ul>

      <div class="label-field">
        <p class="field-label">{PRODUCTS.labelAllergens}</p>
        <p class="label-text" data-testid="label-allergen-line">
          {block.allergenLine}
        </p>
      </div>

      <div class="label-field">
        <p class="field-label">{PRODUCTS.labelClaims}</p>
        <p class="label-text claim-text" data-testid="label-claims">
          {block.claimsText}
        </p>
      </div>

      <div class="label-field">
        <p class="field-label">{PRODUCTS.labelStorage}</p>
        <p class="label-text" data-testid="label-storage">
          {block.storageText}
        </p>
      </div>

      <div class="label-field">
        <p class="field-label">{PRODUCTS.labelNutrition}</p>
        {block.nutrition === null ? (
          <p class="field-help" data-testid="label-nutrition-none">
            {PRODUCTS.labelNutritionNone}
          </p>
        ) : (
          <ul class="percent-list" data-testid="label-nutrition">
            {NUTRIENT_KEYS.filter((key) => block.nutrition?.per100g[key] !== undefined).map((key) => (
              <li key={key} data-testid={`nutrient-${key}`}>
                <span class="percent-name">{NUTRIENT_LABELS[key]}</span>
                <span class="percent-value">
                  {formatNutrient(block.nutrition?.per100g[key] ?? 0, key)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {block.nutrition && block.nutrition.missing.length > 0 ? (
          <p class="field-help" data-testid="label-nutrition-missing">
            {PRODUCTS.labelNutritionMissing(
              block.nutrition.missing
                .map(
                  (gap) =>
                    `${gap.nutrient} (${gap.ingredientIds
                      .map((id) => ingredientNames[id] ?? id)
                      .join(", ")})`,
                )
                .join("; "),
            )}
          </p>
        ) : null}
      </div>

      <div class="label-field">
        <p class="field-label">{PRODUCTS.driftHeading}</p>
        <p class="field-help" data-testid="label-drift-count">
          {drift.length === 0 ? PRODUCTS.driftNone : PRODUCTS.driftCount(drift.length)}
        </p>
        {drift.length > 0 ? (
          <ul class="drift-list" data-testid="label-drift-list">
            {drift.map((difference) => (
              <li key={`${difference.field}-${difference.kind}-${difference.subject ?? ""}`}>
                {difference.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
