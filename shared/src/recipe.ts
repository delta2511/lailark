/**
 * The recipe engine: ingredient order, percentages, the allergen line,
 * nutrition per 100 g, and the printed-label drift check.
 *
 * The spec is `docs/strategy/label-ingredient-percentage-basis-fssai.md`.
 * Everything here is pure arithmetic and string building: no Firebase, no
 * clock, no locale. The admin recomputes a label block on every keystroke,
 * the functions will use the same numbers for the print file, and the tests
 * reproduce the worked example table in section 4 of that doc row by row.
 *
 * Three things the clause does not settle, settled here:
 *
 * - **The denominator.** Basis A is every ingoing weight over the ingoing
 *   total. Basis B takes the evaporated portion out of both the numerator
 *   and the denominator, under the first proviso to 5(2)(f). Basis C is
 *   ingoing over finished weight, the method the printed batch 001 label
 *   used. B is the recommended basis and the default (doc section 4).
 * - **The ordering.** 5(2)(b) orders by composition "at the time of its
 *   manufacture", and the doc's "Ordering ambiguity" note says a literal
 *   reading puts Vinegar first while the sensible reading puts it fourth.
 *   The engine orders by whatever the chosen basis measures, so the label's
 *   order and its percentages can never disagree with each other: under A
 *   and C vinegar leads, under B it sits fourth. Flagged to the consultant
 *   in the doc; nothing here decides it for good.
 * - **The rounding.** The doc prints one decimal in the table and a whole
 *   number in "Declared figures on basis B: Prawns 35%, Dates 23%", and
 *   never says which is the rule. The engine keeps full precision, rounds
 *   half up to one decimal for the table, and to a whole number for the
 *   label.
 */

import type { NutritionPer100g } from "./types/catalogue.js";

/* -------------------------------------------------------------------------- */
/* The basis switch                                                           */
/* -------------------------------------------------------------------------- */

/** The three positions of the percentage basis switch, doc section 4. */
export const PERCENTAGE_BASES = ["A", "B", "C"] as const;

export type PercentageBasis = (typeof PERCENTAGE_BASES)[number];

/** Doc section 4: "Build the switch with three positions and default to B." */
export const DEFAULT_PERCENTAGE_BASIS: PercentageBasis = "B";

export function isPercentageBasis(value: unknown): value is PercentageBasis {
  return typeof value === "string" && (PERCENTAGE_BASES as readonly string[]).includes(value);
}

/** What each position of the switch means, in the doc's own words. */
export const PERCENTAGE_BASIS_NOTES: Readonly<Record<PercentageBasis, string>> = {
  A: "Ingoing weight over the ingoing total. Legally clean, commercially unfair, and less informative.",
  B: "Ingoing weight over the ingoing total minus evaporated water. The recommended basis.",
  C: "Ingoing weight over finished weight. The method used on the printed batch 001 label.",
};

/** The short label for the switch on screen. */
export const PERCENTAGE_BASIS_LABELS: Readonly<Record<PercentageBasis, string>> = {
  A: "A: of ingoing total",
  B: "B: of ingoing minus evaporated",
  C: "C: per 100 g finished",
};

/**
 * Doc section 5, quoting the second proviso to 5(2)(e): "where a compound
 * ingredient constitutes less than 5 per cent of the food, the ingredients,
 * other than food additives that serve the technological function in the food
 * products, need not be declared". Compounded asafoetida at 5 g in a 6 kg
 * batch is under it, so its bracketed list is voluntary.
 */
export const COMPOUND_DECLARATION_THRESHOLD_PERCENT = 5;

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything the engine weighs, it weighs in grams. A volume needs a density,
 * which the ingredient carries: the doc's worked example takes "Oil at 0.92
 * kg/L; vinegar at 1.00 kg/L", and those are the two litres-in-the-recipe
 * cases batch 001 actually has.
 */
const GRAMS_PER_UNIT: Readonly<Record<string, number>> = { g: 1, kg: 1000 };
const MILLILITRES_PER_UNIT: Readonly<Record<string, number>> = { ml: 1, l: 1000 };

/** The units a recipe line may be written in. */
export const RECIPE_UNITS = ["g", "kg", "ml", "l"] as const;

export type RecipeUnit = (typeof RECIPE_UNITS)[number];

function normaliseUnit(unit: string): string {
  return String(unit).trim().toLowerCase();
}

/**
 * `qty` in `unit` as grams. A volume unit needs `densityGPerMl`; without one
 * there is no honest answer, so this throws rather than guessing 1.0 and
 * quietly declaring gingelly oil 8% heavier than it is.
 */
export function toGrams(qty: number, unit: string, densityGPerMl?: number | null): number {
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0) {
    throw new RangeError(`quantity must be a number from 0, got ${String(qty)}`);
  }
  const key = normaliseUnit(unit);
  const asMass = GRAMS_PER_UNIT[key];
  if (asMass !== undefined) return qty * asMass;

  const asVolume = MILLILITRES_PER_UNIT[key];
  if (asVolume !== undefined) {
    if (typeof densityGPerMl !== "number" || !Number.isFinite(densityGPerMl) || densityGPerMl <= 0) {
      throw new RangeError(`a quantity in ${key} needs the ingredient's density in g/ml`);
    }
    return qty * asVolume * densityGPerMl;
  }

  throw new RangeError(`unknown recipe unit ${JSON.stringify(unit)}`);
}

/* -------------------------------------------------------------------------- */
/* Rounding                                                                   */
/* -------------------------------------------------------------------------- */

/** Half up, at `decimals` places, with the float wobble taken out first. */
export function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON * Math.abs(value)) * factor) / factor;
}

/** The table in doc section 4 prints one decimal. */
export const TABLE_DECIMALS = 1;

/** "Declared figures on basis B: Prawns 35%, Dates 23%": a whole number. */
export function declaredPercent(value: number): number {
  return Math.round(value + Number.EPSILON * Math.abs(value));
}

/** `35` as `"35%"`, the way the printed label writes it. */
export function formatLabelPercent(value: number): string {
  return `${declaredPercent(value)}%`;
}

/* -------------------------------------------------------------------------- */
/* What the engine needs to be given                                          */
/* -------------------------------------------------------------------------- */

/**
 * The part of an `ingredients/{id}` document the label needs. A structural
 * subset of {@link import("./types/catalogue.js").Ingredient}, so a document
 * read straight out of Firestore fits with no adapter, and a test fixture
 * does not have to invent `createdAt`.
 */
export interface IngredientForLabel {
  /** The name as printed on the label. Never paraphrased. */
  readonly labelName: string;
  readonly allergenTags?: readonly string[];
  readonly nutritionPer100g?: NutritionPer100g;
  /** Needed only when a line of the recipe is written in ml or l. */
  readonly densityGPerMl?: number | null;
}

/** The part of a recipe line the label needs. */
export interface RecipeLineForLabel {
  readonly ingredientId: string;
  readonly qty: number;
  readonly unit: string;
  /**
   * Emphasised on the label, or essential to characterise the food, so
   * 5(2)(g) owes it a percentage. Prawns and Dates on batch 001; nothing
   * else, because the proviso exempts spices, condiments and masalas.
   */
  readonly isMain?: boolean;
  /** Water or vinegar that boils off. 5(2)(f), first proviso. */
  readonly evaporates?: boolean;
  /**
   * How much of an evaporating line is still there at the end, in grams
   * whatever `unit` the line is written in. Batch 001 takes "2 L in, ~400 g
   * stays" from doc section 4, so the vinegar line is qty 2, unit l,
   * residueG 400. Ignored unless `evaporates` is true; missing means all of
   * it went.
   */
  readonly residueG?: number;
  /**
   * A compound ingredient's own parts, 5(2)(e). Each entry is either the id
   * of another ingredient document or, when it is not one, the part's name
   * exactly as the label prints it. In descending order of proportion, which
   * only the supplier knows.
   */
  readonly compoundOf?: readonly string[];
}

/** The part of a `recipes/{id}` document the label needs. */
export interface RecipeForLabel {
  readonly percentageBasis?: string;
  /**
   * What the batch weighs once it is in the jars: 22 jars of 200 g is 4,400 g
   * for batch 001. Basis C and the nutrition panel both divide by it.
   */
  readonly finishedWeightG?: number;
  readonly storageText?: string;
  readonly claimsText?: string;
  readonly lines: readonly RecipeLineForLabel[];
}

/** Ingredients keyed by document id. */
export type IngredientIndex = Readonly<Record<string, IngredientForLabel>>;

/** `[{id, ...}]` to `{id: {...}}`, for a screen holding a list. */
export function indexIngredients<T extends IngredientForLabel>(
  list: readonly (T & { readonly id: string })[],
): Readonly<Record<string, T>> {
  const index: Record<string, T> = {};
  for (const item of list) index[item.id] = item;
  return index;
}

export interface RecipeComputationOptions {
  readonly basis?: PercentageBasis;
  /** Overrides `recipe.finishedWeightG`, for a batch that weighed out differently. */
  readonly finishedWeightG?: number;
}

/* -------------------------------------------------------------------------- */
/* The computation                                                            */
/* -------------------------------------------------------------------------- */

/** One line of a recipe, weighed and placed. */
export interface ComputedIngredient {
  readonly ingredientId: string;
  /** The ingredient's own `labelName`, or the id when the document is gone. */
  readonly labelName: string;
  /** Ingoing weight at the time of manufacture, in grams. */
  readonly ingoingG: number;
  /** What is left of it once the boil is over. Equal to `ingoingG` unless it evaporates. */
  readonly remainingG: number;
  /** The column's number: a percentage on A and B, g per 100 g finished on C. */
  readonly value: number;
  /** `value` at one decimal, the way doc section 4 prints the table. */
  readonly tableValue: number;
  /** `value` as a whole number, the way the label prints it. */
  readonly declaredValue: number;
  /** Where it sits on the label, from 0. */
  readonly order: number;
  readonly isMain: boolean;
  readonly evaporates: boolean;
  readonly compoundOf?: readonly string[];
  /** Its share of the food, used for the 5% compound threshold. */
  readonly shareOfFoodPercent: number;
}

export interface RecipeComputation {
  readonly basis: PercentageBasis;
  /** Every ingoing weight added up, doc section 4's 6,033 g. */
  readonly ingoingTotalG: number;
  /** What the chosen basis divides by. 4,433 g on basis B. */
  readonly denominatorG: number;
  readonly finishedWeightG: number | null;
  /** In label order, descending by whatever the basis measures. */
  readonly items: readonly ComputedIngredient[];
  /** Line ingredient ids with no ingredient document in the index. */
  readonly missingIngredientIds: readonly string[];
}

function basisOf(recipe: RecipeForLabel, options: RecipeComputationOptions | undefined): PercentageBasis {
  const asked = options?.basis ?? recipe.percentageBasis;
  return isPercentageBasis(asked) ? asked : DEFAULT_PERCENTAGE_BASIS;
}

/**
 * Weighs every line, picks the denominator the basis asks for, and sorts the
 * lines into the order the label prints them.
 *
 * Basis B is the one that differs line by line: the evaporated portion leaves
 * the numerator as well as the denominator, which is what turns 2 L of
 * vinegar into the 400 g that is still in the jar, 9.0% rather than 33.2%.
 */
export function computeRecipePercentages(
  recipe: RecipeForLabel,
  ingredients: IngredientIndex,
  options?: RecipeComputationOptions,
): RecipeComputation {
  const basis = basisOf(recipe, options);
  const finishedWeightG = options?.finishedWeightG ?? recipe.finishedWeightG ?? null;

  if (basis === "C" && (finishedWeightG === null || !(finishedWeightG > 0))) {
    throw new RangeError("basis C divides by the finished weight, so the recipe needs one");
  }

  const missingIngredientIds: string[] = [];

  const weighed = recipe.lines.map((line, index) => {
    const ingredient = ingredients[line.ingredientId];
    if (!ingredient) missingIngredientIds.push(line.ingredientId);

    const ingoingG = toGrams(line.qty, line.unit, ingredient?.densityGPerMl);
    const evaporates = line.evaporates === true;
    const remainingG = evaporates
      ? Math.min(ingoingG, Math.max(0, line.residueG ?? 0))
      : ingoingG;

    return { line, index, ingredient, ingoingG, remainingG, evaporates };
  });

  const ingoingTotalG = weighed.reduce((sum, w) => sum + w.ingoingG, 0);
  const remainingTotalG = weighed.reduce((sum, w) => sum + w.remainingG, 0);

  const denominatorG =
    basis === "A" ? ingoingTotalG : basis === "B" ? remainingTotalG : (finishedWeightG ?? 0);

  // A and C both measure the ingoing weight, so both order by it; only B
  // measures what is left, which is what moves vinegar from first to fourth.
  // Doc section 4, "Ordering ambiguity".
  const measured = weighed.map((w) => ({
    ...w,
    measuredG: basis === "B" ? w.remainingG : w.ingoingG,
  }));

  const ordered = [...measured].sort((a, b) =>
    b.measuredG === a.measuredG ? a.index - b.index : b.measuredG - a.measuredG,
  );

  const items: ComputedIngredient[] = ordered.map((w, order) => {
    const value = denominatorG > 0 ? (w.measuredG / denominatorG) * 100 : 0;
    const shareOfFoodPercent =
      remainingTotalG > 0 ? (w.remainingG / remainingTotalG) * 100 : 0;
    const computed: ComputedIngredient = {
      ingredientId: w.line.ingredientId,
      labelName: w.ingredient?.labelName ?? w.line.ingredientId,
      ingoingG: w.ingoingG,
      remainingG: w.remainingG,
      value,
      tableValue: roundToDecimals(value, TABLE_DECIMALS),
      declaredValue: declaredPercent(value),
      order,
      isMain: w.line.isMain === true,
      evaporates: w.evaporates,
      shareOfFoodPercent,
      ...(w.line.compoundOf ? { compoundOf: w.line.compoundOf } : {}),
    };
    return computed;
  });

  return { basis, ingoingTotalG, denominatorG, finishedWeightG, items, missingIngredientIds };
}

/* -------------------------------------------------------------------------- */
/* The printed ingredient line                                                */
/* -------------------------------------------------------------------------- */

/**
 * True when 5(2)(e)'s bracketed list is owed rather than voluntary: a
 * compound ingredient at or above 5% of the food. Doc section 5 puts
 * compounded asafoetida well under it, so batch 001's bracket is a choice,
 * and the choice on the printed jar was to declare it.
 */
export function compoundDeclarationRequired(item: ComputedIngredient): boolean {
  return (
    item.compoundOf !== undefined &&
    item.compoundOf.length > 0 &&
    item.shareOfFoodPercent >= COMPOUND_DECLARATION_THRESHOLD_PERCENT
  );
}

function compoundNames(
  compoundOf: readonly string[],
  ingredients: IngredientIndex,
): readonly string[] {
  return compoundOf.map((part) => ingredients[part]?.labelName ?? part);
}

/**
 * One ingredient as the label prints it: the name, its bracketed parts if it
 * is a declared compound, and a percentage only where 5(2)(g) asks for one.
 */
export function labelIngredientText(
  item: ComputedIngredient,
  ingredients: IngredientIndex,
): string {
  const parts =
    item.compoundOf && item.compoundOf.length > 0
      ? ` (${compoundNames(item.compoundOf, ingredients).join(", ")})`
      : "";
  const percent = item.isMain ? ` (${formatLabelPercent(item.value)})` : "";
  return `${item.labelName}${parts}${percent}`;
}

/** The whole printed ingredient list, one string, ending in a full stop. */
export function labelIngredientsLine(
  computation: RecipeComputation,
  ingredients: IngredientIndex,
): string {
  const text = computation.items
    .map((item) => labelIngredientText(item, ingredients))
    .join(", ");
  return text === "" ? "" : `${text}.`;
}

/* -------------------------------------------------------------------------- */
/* The allergen line                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Regulation 5(14): a separate "Contains" declaration, with no 5% threshold,
 * so an allergen inside a sub-5% compound still shows (doc section 5,
 * "The allergen is not optional").
 *
 * The order is first appearance down the recipe's own lines, not the label's
 * computed order. No clause orders allergens by weight, and tying them to the
 * percentage basis would make the allergen line move every time the switch is
 * flipped, which is the last line on a label that should ever move.
 */
export function allergenTagsFor(
  recipe: RecipeForLabel,
  ingredients: IngredientIndex,
): readonly string[] {
  const seen: string[] = [];
  for (const line of recipe.lines) {
    for (const tag of ingredients[line.ingredientId]?.allergenTags ?? []) {
      if (!seen.includes(tag)) seen.push(tag);
    }
  }
  return seen;
}

/** "Contains: Crustacean (Prawns), Sesame, Wheat (Gluten) and Mustard." */
export function allergenLine(recipe: RecipeForLabel, ingredients: IngredientIndex): string {
  const tags = allergenTagsFor(recipe, ingredients);
  if (tags.length === 0) return "";
  const listed =
    tags.length === 1
      ? tags[0]
      : `${tags.slice(0, -1).join(", ")} and ${tags[tags.length - 1]}`;
  return `Contains: ${listed}.`;
}

/* -------------------------------------------------------------------------- */
/* Nutrition                                                                  */
/* -------------------------------------------------------------------------- */

/** The nutrients the panel carries, in the order the printed label lists them. */
export const NUTRIENT_KEYS = [
  "energyKcal",
  "proteinG",
  "carbohydrateG",
  "sugarsG",
  "fatG",
  "saturatedFatG",
  "transFatG",
  "sodiumMg",
  "saltG",
] as const satisfies readonly (keyof NutritionPer100g)[];

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export const NUTRIENT_LABELS: Readonly<Record<NutrientKey, string>> = {
  energyKcal: "Energy",
  proteinG: "Protein",
  carbohydrateG: "Carbohydrate",
  sugarsG: "Total sugars",
  fatG: "Total fat",
  saturatedFatG: "Saturated fat",
  transFatG: "Trans fat",
  sodiumMg: "Sodium",
  saltG: "Salt",
};

export const NUTRIENT_UNITS: Readonly<Record<NutrientKey, string>> = {
  energyKcal: "kcal",
  proteinG: "g",
  carbohydrateG: "g",
  sugarsG: "g",
  fatG: "g",
  saturatedFatG: "g",
  transFatG: "g",
  sodiumMg: "mg",
  saltG: "g",
};

/** A nutrient nobody can compute, and the ingredients that are why. */
export interface MissingNutrition {
  readonly nutrient: NutrientKey;
  readonly ingredientIds: readonly string[];
}

export interface NutritionResult {
  readonly finishedWeightG: number;
  /** Only the nutrients every contributing ingredient carries a figure for. */
  readonly per100g: Readonly<Partial<Record<NutrientKey, number>>>;
  /** Everything else, named, so a gap is reported rather than quietly wrong. */
  readonly missing: readonly MissingNutrition[];
}

/**
 * Ingoing nutrients summed across the lines, divided by the finished weight
 * (brief section 14.3, and the doc's basis for the panel).
 *
 * A pickle loses water, so the nutrients that go in are the nutrients that
 * come out, concentrated into a smaller jar. Dividing the sum by the finished
 * weight rather than the ingoing weight is what puts that concentration in
 * the panel.
 *
 * An ingredient with no figure for a nutrient does not count as zero: a zero
 * would be a wrong number on a printed label. The nutrient is left out of
 * `per100g` and the ingredient is named in `missing`.
 */
export function nutritionPer100g(
  recipe: RecipeForLabel,
  ingredients: IngredientIndex,
  finishedWeightG: number,
): NutritionResult {
  if (!(finishedWeightG > 0)) {
    throw new RangeError(`finished weight must be more than 0 g, got ${String(finishedWeightG)}`);
  }

  const weighed = recipe.lines.map((line) => {
    const ingredient = ingredients[line.ingredientId];
    return {
      ingredientId: line.ingredientId,
      grams: toGrams(line.qty, line.unit, ingredient?.densityGPerMl),
      nutrition: ingredient?.nutritionPer100g,
    };
  });

  const per100g: Partial<Record<NutrientKey, number>> = {};
  const missing: MissingNutrition[] = [];

  for (const nutrient of NUTRIENT_KEYS) {
    const declaredSomewhere = weighed.some((w) => typeof w.nutrition?.[nutrient] === "number");
    if (!declaredSomewhere) continue;

    const gaps = weighed
      .filter((w) => w.grams > 0 && typeof w.nutrition?.[nutrient] !== "number")
      .map((w) => w.ingredientId);

    if (gaps.length > 0) {
      missing.push({ nutrient, ingredientIds: gaps });
      continue;
    }

    // Per 100 g of the ingredient, so grams/100 of it goes in.
    const ingoing = weighed.reduce(
      (sum, w) => sum + ((w.nutrition?.[nutrient] ?? 0) * w.grams) / 100,
      0,
    );
    per100g[nutrient] = (ingoing / finishedWeightG) * 100;
  }

  return { finishedWeightG, per100g, missing };
}

/* -------------------------------------------------------------------------- */
/* The printed batch 001 label                                                */
/* -------------------------------------------------------------------------- */

/**
 * Batch 001 as it is printed on 22 jars, transcribed in
 * `docs/strategy/lailark-site-v0-handoff.md` section 2, which that doc calls
 * the source of truth for anything appearing on both the jar and the site.
 * CLAUDE.md section 3: claims and ingredient lines copy the label character
 * for character, never paraphrased. Nothing here is regenerated; it is the
 * fixed thing a generated block is measured against.
 */
export const PRINTED_LABEL_BATCH_001 = {
  ingredientsLine:
    "Prawns (59%), Dates (22%), Vinegar, Gingelly (Sesame) Oil, Garlic, Green Chilli, Ginger, Salt, Kashmiri Chilli Powder, Red Chilli Powder, Sugar, Compounded Asafoetida (Gum Arabic, Wheat Flour, Asafoetida), Mustard, Curry Leaves, Fenugreek, Turmeric.",
  allergenLine: "Contains: Crustacean (Prawns), Sesame, Wheat (Gluten) and Mustard.",
  claimsText: "No added preservatives. Prepared by traditional method.",
  storageText:
    "Cool, dry place away from sunlight; refrigerate after opening; clean dry spoon; keep prawns covered in oil.",
} as const;

/** The claims text a recipe starts with, until someone types another. */
export const DEFAULT_CLAIMS_TEXT: string = PRINTED_LABEL_BATCH_001.claimsText;

/** The storage text a recipe starts with, until someone types another. */
export const DEFAULT_STORAGE_TEXT: string = PRINTED_LABEL_BATCH_001.storageText;

/* -------------------------------------------------------------------------- */
/* The label block                                                            */
/* -------------------------------------------------------------------------- */

export interface LabelBlock {
  readonly basis: PercentageBasis;
  readonly computation: RecipeComputation;
  readonly ingredientsLine: string;
  readonly allergenLine: string;
  readonly claimsText: string;
  readonly storageText: string;
  readonly nutrition: NutritionResult | null;
}

/**
 * Everything the label prints, from the recipe and its ingredients. The
 * nutrition panel is null when no finished weight is recorded, because there
 * is nothing to divide by; the rest of the block still builds.
 */
export function buildLabelBlock(
  recipe: RecipeForLabel,
  ingredients: IngredientIndex,
  options?: RecipeComputationOptions,
): LabelBlock {
  const computation = computeRecipePercentages(recipe, ingredients, options);
  const finishedWeightG = computation.finishedWeightG;

  return {
    basis: computation.basis,
    computation,
    ingredientsLine: labelIngredientsLine(computation, ingredients),
    allergenLine: allergenLine(recipe, ingredients),
    claimsText: recipe.claimsText ?? DEFAULT_CLAIMS_TEXT,
    storageText: recipe.storageText ?? DEFAULT_STORAGE_TEXT,
    nutrition:
      finishedWeightG !== null && finishedWeightG > 0
        ? nutritionPer100g(recipe, ingredients, finishedWeightG)
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* The drift check                                                            */
/* -------------------------------------------------------------------------- */

/** The four label strings a generated block is compared against. */
export interface PrintedLabelText {
  readonly ingredientsLine: string;
  readonly allergenLine: string;
  readonly claimsText: string;
  readonly storageText: string;
}

export type LabelDifferenceKind = "wording" | "percentage" | "order" | "missing" | "extra";

export interface LabelDifference {
  readonly field: keyof PrintedLabelText;
  readonly kind: LabelDifferenceKind;
  /** The ingredient the difference is about, where it is about one. */
  readonly subject?: string;
  readonly printed: string;
  readonly generated: string;
  /** One plain line naming what differs. */
  readonly message: string;
}

interface ParsedItem {
  readonly text: string;
  readonly name: string;
  readonly percent: string | null;
  readonly position: number;
}

/**
 * Splits a printed ingredient list into its items on the commas that are not
 * inside a compound's brackets, so "Compounded Asafoetida (Gum Arabic, Wheat
 * Flour, Asafoetida)" stays one item.
 */
export function parseIngredientsLine(line: string): readonly ParsedItem[] {
  const trimmed = line.trim().replace(/\.\s*$/, "");
  if (trimmed === "") return [];

  const chunks: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of trimmed) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      chunks.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  chunks.push(current);

  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "")
    .map((text, position) => {
      const match = /\s*\(\s*([\d.]+\s*%)\s*\)\s*$/.exec(text);
      const percent = match ? match[1].replace(/\s+/g, "") : null;
      const name = match ? text.slice(0, match.index).trim() : text;
      return { text, name, percent, position };
    });
}

function plain(field: keyof PrintedLabelText, name: string, printed: string, generated: string): LabelDifference[] {
  if (printed === generated) return [];
  return [
    {
      field,
      kind: "wording",
      printed,
      generated,
      message: `${name} differs from the printed label. Printed: "${printed}". Generated: "${generated}".`,
    },
  ];
}

function compareIngredientLines(printedLine: string, generatedLine: string): LabelDifference[] {
  const printed = parseIngredientsLine(printedLine);
  const generated = parseIngredientsLine(generatedLine);
  const differences: LabelDifference[] = [];

  for (const item of printed) {
    if (!generated.some((g) => g.name === item.name)) {
      differences.push({
        field: "ingredientsLine",
        kind: "missing",
        subject: item.name,
        printed: item.text,
        generated: "",
        message: `${item.name} is on the printed label and not on the generated line.`,
      });
    }
  }

  for (const item of generated) {
    const match = printed.find((p) => p.name === item.name);
    if (!match) {
      differences.push({
        field: "ingredientsLine",
        kind: "extra",
        subject: item.name,
        printed: "",
        generated: item.text,
        message: `${item.name} is on the generated line and not on the printed label.`,
      });
      continue;
    }
    if (match.percent !== item.percent) {
      differences.push({
        field: "ingredientsLine",
        kind: "percentage",
        subject: item.name,
        printed: match.percent ?? "no percentage",
        generated: item.percent ?? "no percentage",
        message: `${item.name}: the printed label says ${match.percent ?? "no percentage"}, the generated line says ${item.percent ?? "no percentage"}.`,
      });
    }
    if (match.position !== item.position) {
      differences.push({
        field: "ingredientsLine",
        kind: "order",
        subject: item.name,
        printed: String(match.position + 1),
        generated: String(item.position + 1),
        message: `${item.name} is ${match.position + 1} on the printed label and ${item.position + 1} on the generated line.`,
      });
    }
  }

  return differences;
}

/**
 * Every way a generated label block differs from a printed one, each named.
 * An empty array means the two are the same, character for character.
 *
 * This is the guard CLAUDE.md section 3 asks for. Batch 001's printed label
 * was computed on basis C from the market weight of the prawns, so a block
 * generated on basis B is *expected* to differ from it: the point is that the
 * differences are a known, listed set, and any new one shows up here rather
 * than on a jar.
 */
export function compareLabelText(
  printed: PrintedLabelText,
  generated: PrintedLabelText,
): readonly LabelDifference[] {
  return [
    ...compareIngredientLines(printed.ingredientsLine, generated.ingredientsLine),
    ...plain("allergenLine", "The allergen line", printed.allergenLine, generated.allergenLine),
    ...plain("claimsText", "The claims text", printed.claimsText, generated.claimsText),
    ...plain("storageText", "The storage text", printed.storageText, generated.storageText),
  ];
}

/** The same check, taking a whole generated block. */
export function verifyAgainstPrintedLabel(
  block: LabelBlock,
  printed: PrintedLabelText = PRINTED_LABEL_BATCH_001,
): readonly LabelDifference[] {
  return compareLabelText(printed, {
    ingredientsLine: block.ingredientsLine,
    allergenLine: block.allergenLine,
    claimsText: block.claimsText,
    storageText: block.storageText,
  });
}

/* -------------------------------------------------------------------------- */
/* Cooking actuals against the recipe, brief section 17.4                     */
/* -------------------------------------------------------------------------- */

/**
 * How far Kitchen's actual weight for an ingredient may differ from the
 * recipe's own quantity before the batch screen raises a drift warning for
 * label review.
 *
 * ASSUMED (M2.4): the brief asks for "a drift warning for label review" but
 * names no threshold. 15% is chosen as a sensible middle ground: normal
 * cooking variance (a bit more or less of something landed that day) should
 * not nag on every batch, while a pot that is genuinely different from what
 * the recipe says (half the dates, say) is caught before the label is
 * printed. A named constant so Shefin can move it at the milestone break
 * without hunting for a magic number.
 */
export const INGREDIENT_ACTUAL_DRIFT_THRESHOLD_PERCENT = 15;

export interface IngredientActualDrift {
  /** The recipe's own quantity for this line, in grams. */
  readonly recipeG: number;
  /** What Kitchen actually weighed out, in grams. */
  readonly actualG: number;
  /** `actualG - recipeG`. Positive when more went in than the recipe calls for. */
  readonly diffG: number;
  /** `abs(diffG) / recipeG * 100`, or 100 when the recipe line is 0 g and something went in anyway. */
  readonly percent: number;
  readonly isDrifting: boolean;
}

/**
 * Compares what Kitchen actually weighed out for one ingredient against what
 * the recipe calls for, both reduced to grams so a line written in litres or
 * kilos compares honestly against a scale reading in grams.
 */
export function ingredientActualDrift(
  recipeQty: number,
  recipeUnit: string,
  actualG: number,
  densityGPerMl?: number | null,
  thresholdPercent: number = INGREDIENT_ACTUAL_DRIFT_THRESHOLD_PERCENT,
): IngredientActualDrift {
  const recipeG = toGrams(recipeQty, recipeUnit, densityGPerMl);
  if (!Number.isFinite(actualG) || actualG < 0) {
    throw new RangeError(`actual weight must be a number from 0, got ${String(actualG)}`);
  }
  const diffG = actualG - recipeG;
  const percent = recipeG > 0 ? (Math.abs(diffG) / recipeG) * 100 : actualG > 0 ? 100 : 0;
  return { recipeG, actualG, diffG, percent, isDrifting: percent > thresholdPercent };
}
