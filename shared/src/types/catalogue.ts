/** `products`, `ingredients`, `recipes`. Brief section 18.1. */

import type { Paise } from "../money.js";
import type { ProductType, ShippingRule } from "../states.js";
import type { BaseDoc, IsoDate } from "./base.js";

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
  /** Extra label lines, copied character for character from the print file. */
  readonly customLines: readonly string[];
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
  /** A compound ingredient declares its own parts, as asafoetida does. */
  readonly compoundOf?: readonly string[];
}

/** `recipes/{id}`. */
export interface Recipe extends BaseDoc {
  readonly productSlug: string;
  readonly version: number;
  /** Which label percentage basis this recipe declares. */
  readonly percentageBasis: string;
  readonly expectedYieldJars: number;
  readonly yieldRatios: Readonly<Record<string, number>>;
  readonly storageText: string;
  readonly claimsText: string;
  readonly lines: readonly RecipeLine[];
  readonly retiredOn?: IsoDate;
}
