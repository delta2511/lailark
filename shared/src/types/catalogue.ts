/** `products`, `ingredients`, `recipes`. Brief section 18.1. */

import type { Paise } from "../money.js";
import type { ProductType, ShippingRule } from "../states.js";
import type { BaseDoc, IsoDate } from "./base.js";

/**
 * Something the kitchen may sell at the counter outside the jar catalogue,
 * with its own set amount: brief section 17.8, "Custom lines the kitchen may
 * sell at the counter, with their set amount." `description` is what shows
 * on the sale line; `amountPaise` is the fixed price, integers in paise
 * (CLAUDE.md section 3), never a per-unit rate.
 */
export interface CustomLine {
  readonly description: string;
  readonly amountPaise: Paise;
}

/** `products/{slug}`. The document id is the slug. */
export interface Product extends BaseDoc {
  readonly name: string;
  readonly type: ProductType;
  readonly veg: boolean;
  /** HSN code, carried from day one even though GST is off at launch. */
  readonly hsn: string;
  readonly priceInStock: Paise;
  readonly priceOpen: Paise;
  readonly jarGrams: number;
  readonly shippingRule: ShippingRule;
  /** `"MM-DD"`, or null for a product with no season. */
  readonly seasonStart: string | null;
  readonly seasonEnd: string | null;
  readonly active: boolean;
  /** Things the kitchen may sell at the counter under this product's name. */
  readonly customLines: readonly CustomLine[];
}

export interface NutritionPer100g {
  readonly energyKcal?: number;
  readonly proteinG?: number;
  readonly carbohydrateG?: number;
  readonly sugarsG?: number;
  readonly fatG?: number;
  readonly saturatedFatG?: number;
  readonly transFatG?: number;
  readonly sodiumMg?: number;
  readonly saltG?: number;
}

/** `ingredients/{id}`. */
export interface Ingredient extends BaseDoc {
  /** The name as printed on the label. Never paraphrased. */
  readonly labelName: string;
  readonly allergenTags: readonly string[];
  readonly nutritionPer100g: NutritionPer100g;
  readonly unitCost: Paise;
  readonly unit: string;
  readonly source: string | null;
  /**
   * Grams per millilitre, for an ingredient a recipe measures by volume. The
   * label basis doc's worked example takes "Oil at 0.92 kg/L; vinegar at 1.00
   * kg/L", and the recipe engine refuses a line in ml or l without one rather
   * than guessing 1.0.
   */
  readonly densityGPerMl?: number | null;
}

/** One line of a recipe. */
export interface RecipeLine {
  readonly ingredientId: string;
  readonly qty: number;
  readonly unit: string;
  /** The ingredient the percentage basis is anchored on. */
  readonly isMain: boolean;
  /** Water or vinegar that cooks off, so it is out of the label percentage. */
  readonly evaporates: boolean;
  /**
   * How much of an evaporating line is still in the jar, in grams whatever
   * `unit` this line is written in. Batch 001's vinegar is "2 L in, ~400 g
   * stays" (label basis doc section 4), so qty 2, unit l, residueG 400.
   * Ignored unless `evaporates` is true.
   */
  readonly residueG?: number;
  /** A compound ingredient declares its own parts, as asafoetida does. */
  readonly compoundOf?: readonly string[];
  /**
   * True while this quantity is a working figure rather than something that
   * was weighed. The label basis doc's spice weights are placeholders, and
   * batch 001's recipe was seeded from them; a percentage computed from an
   * estimate is an estimate, and the screen that shows the quantity says so.
   *
   * Absent means measured, so nothing already recorded is retroactively
   * called a guess.
   */
  readonly estimated?: boolean;
}

/** `recipes/{id}`. */
export interface Recipe extends BaseDoc {
  readonly productSlug: string;
  readonly version: number;
  /** Which label percentage basis this recipe declares. */
  readonly percentageBasis: string;
  readonly expectedYieldJars: number;
  readonly yieldRatios: Readonly<Record<string, number>>;
  /**
   * What the batch weighs once it is in the jars: 22 jars of 200 g is 4,400 g
   * for batch 001. Percentage basis C and the nutrition panel both divide by
   * it.
   */
  readonly finishedWeightG?: number;
  readonly storageText: string;
  readonly claimsText: string;
  readonly lines: readonly RecipeLine[];
  readonly retiredOn?: IsoDate;
}
