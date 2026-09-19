import { describe, expect, it } from "vitest";

import {
  COMPOUND_DECLARATION_THRESHOLD_PERCENT,
  DEFAULT_CLAIMS_TEXT,
  DEFAULT_PERCENTAGE_BASIS,
  DEFAULT_STORAGE_TEXT,
  PRINTED_LABEL_BATCH_001,
  allergenLine,
  buildLabelBlock,
  compareLabelText,
  compoundDeclarationRequired,
  computeRecipePercentages,
  indexIngredients,
  labelIngredientsLine,
  nutritionPer100g,
  parseIngredientsLine,
  roundToDecimals,
  toGrams,
  verifyAgainstPrintedLabel,
  type IngredientForLabel,
  type IngredientIndex,
  type PercentageBasis,
  type RecipeForLabel,
} from "./recipe.js";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The worked example in `label-ingredient-percentage-basis-fssai.md` section
 * 4, as the doc writes it: fifteen rows, spice weights the doc calls
 * illustrative placeholders, oil at 0.92 kg/L and vinegar at 1.00 kg/L, and
 * "Vinegar (2 L in, ~400 g stays)".
 */
const DOC_INGREDIENTS: Readonly<Record<string, IngredientForLabel>> = {
  prawns: { labelName: "Prawns, cleaned raw" },
  vinegar: { labelName: "Vinegar", densityGPerMl: 1.0 },
  dates: { labelName: "Dates" },
  oil: { labelName: "Gingelly oil", densityGPerMl: 0.92 },
  garlic: { labelName: "Garlic" },
  greenChilli: { labelName: "Green chilli" },
  salt: { labelName: "Salt" },
  ginger: { labelName: "Ginger" },
  chilliPowders: { labelName: "Chilli powders (Kashmiri + hot)" },
  sugar: { labelName: "Sugar" },
  mustard: { labelName: "Mustard" },
  curryLeaves: { labelName: "Curry leaves" },
  turmeric: { labelName: "Turmeric" },
  fenugreek: { labelName: "Fenugreek" },
  asafoetida: { labelName: "Compounded asafoetida" },
};

const DOC_RECIPE: RecipeForLabel = {
  finishedWeightG: 4400,
  lines: [
    { ingredientId: "prawns", qty: 1550, unit: "g", isMain: true },
    { ingredientId: "vinegar", qty: 2, unit: "l", evaporates: true, residueG: 400 },
    { ingredientId: "dates", qty: 1000, unit: "g", isMain: true },
    { ingredientId: "oil", qty: 1, unit: "l" },
    { ingredientId: "garlic", qty: 150, unit: "g" },
    { ingredientId: "greenChilli", qty: 100, unit: "g" },
    { ingredientId: "salt", qty: 90, unit: "g" },
    { ingredientId: "ginger", qty: 80, unit: "g" },
    { ingredientId: "chilliPowders", qty: 60, unit: "g" },
    { ingredientId: "sugar", qty: 40, unit: "g" },
    { ingredientId: "mustard", qty: 15, unit: "g" },
    { ingredientId: "curryLeaves", qty: 10, unit: "g" },
    { ingredientId: "turmeric", qty: 8, unit: "g" },
    { ingredientId: "fenugreek", qty: 5, unit: "g" },
    { ingredientId: "asafoetida", qty: 5, unit: "g", compoundOf: ["Gum Arabic", "Wheat Flour", "Asafoetida"] },
  ],
};

/**
 * The table exactly as the doc prints it. `[ingoing g, column A, column B,
 * column C]`.
 */
const DOC_TABLE: readonly (readonly [string, number, number, number, number])[] = [
  ["prawns", 1550, 25.7, 35.0, 35.2],
  ["vinegar", 2000, 33.2, 9.0, 45.5],
  ["dates", 1000, 16.6, 22.6, 22.7],
  ["oil", 920, 15.2, 20.8, 20.9],
  ["garlic", 150, 2.5, 3.4, 3.4],
  ["greenChilli", 100, 1.7, 2.3, 2.3],
  ["salt", 90, 1.5, 2.0, 2.0],
  ["ginger", 80, 1.3, 1.8, 1.8],
  ["chilliPowders", 60, 1.0, 1.4, 1.4],
  ["sugar", 40, 0.7, 0.9, 0.9],
  ["mustard", 15, 0.2, 0.3, 0.3],
  ["curryLeaves", 10, 0.2, 0.2, 0.2],
  ["turmeric", 8, 0.1, 0.2, 0.2],
  ["fenugreek", 5, 0.1, 0.1, 0.1],
  ["asafoetida", 5, 0.1, 0.1, 0.1],
];

/**
 * Batch 001 as the recipe document records it: the doc's weights, but the
 * chilli powders as the two ingredients the printed label names, and the
 * lines in the order the printed label prints them. Line order is what the
 * allergen line reads; the percentage basis is what the ingredient line
 * reads.
 */
const BATCH_001_INGREDIENTS: Readonly<Record<string, IngredientForLabel>> = {
  prawns: {
    labelName: "Prawns",
    allergenTags: ["Crustacean (Prawns)"],
    nutritionPer100g: { energyKcal: 99, proteinG: 24, fatG: 0.3, sodiumMg: 111 },
  },
  dates: {
    labelName: "Dates",
    nutritionPer100g: { energyKcal: 282, proteinG: 2.5, fatG: 0.4, sodiumMg: 2 },
  },
  vinegar: {
    labelName: "Vinegar",
    densityGPerMl: 1.0,
    nutritionPer100g: { energyKcal: 18, proteinG: 0, fatG: 0, sodiumMg: 5 },
  },
  gingellyOil: {
    labelName: "Gingelly (Sesame) Oil",
    allergenTags: ["Sesame"],
    densityGPerMl: 0.92,
    nutritionPer100g: { energyKcal: 884, proteinG: 0, fatG: 100, sodiumMg: 0 },
  },
  garlic: { labelName: "Garlic", nutritionPer100g: { energyKcal: 149, proteinG: 6.4, fatG: 0.5, sodiumMg: 17 } },
  greenChilli: { labelName: "Green Chilli", nutritionPer100g: { energyKcal: 40, proteinG: 1.9, fatG: 0.2, sodiumMg: 7 } },
  ginger: { labelName: "Ginger", nutritionPer100g: { energyKcal: 80, proteinG: 1.8, fatG: 0.8, sodiumMg: 13 } },
  salt: { labelName: "Salt", nutritionPer100g: { energyKcal: 0, proteinG: 0, fatG: 0, sodiumMg: 38758 } },
  kashmiriChilli: {
    labelName: "Kashmiri Chilli Powder",
    nutritionPer100g: { energyKcal: 282, proteinG: 12, fatG: 14, sodiumMg: 30 },
  },
  redChilli: {
    labelName: "Red Chilli Powder",
    nutritionPer100g: { energyKcal: 282, proteinG: 12, fatG: 14, sodiumMg: 30 },
  },
  sugar: { labelName: "Sugar", nutritionPer100g: { energyKcal: 387, proteinG: 0, fatG: 0, sodiumMg: 1 } },
  asafoetida: {
    labelName: "Compounded Asafoetida",
    allergenTags: ["Wheat (Gluten)"],
    nutritionPer100g: { energyKcal: 297, proteinG: 4, fatG: 1.1, sodiumMg: 50 },
  },
  mustard: {
    labelName: "Mustard",
    allergenTags: ["Mustard"],
    nutritionPer100g: { energyKcal: 508, proteinG: 26, fatG: 36, sodiumMg: 13 },
  },
  curryLeaves: { labelName: "Curry Leaves", nutritionPer100g: { energyKcal: 108, proteinG: 6, fatG: 1, sodiumMg: 15 } },
  fenugreek: { labelName: "Fenugreek", nutritionPer100g: { energyKcal: 323, proteinG: 23, fatG: 6.4, sodiumMg: 67 } },
  turmeric: { labelName: "Turmeric", nutritionPer100g: { energyKcal: 312, proteinG: 9.7, fatG: 3.3, sodiumMg: 27 } },
};

const BATCH_001_RECIPE: RecipeForLabel = {
  percentageBasis: "B",
  finishedWeightG: 4400,
  lines: [
    { ingredientId: "prawns", qty: 1550, unit: "g", isMain: true },
    { ingredientId: "dates", qty: 1000, unit: "g", isMain: true },
    { ingredientId: "vinegar", qty: 2, unit: "l", evaporates: true, residueG: 400 },
    { ingredientId: "gingellyOil", qty: 1, unit: "l" },
    { ingredientId: "garlic", qty: 150, unit: "g" },
    { ingredientId: "greenChilli", qty: 100, unit: "g" },
    { ingredientId: "ginger", qty: 80, unit: "g" },
    { ingredientId: "salt", qty: 90, unit: "g" },
    { ingredientId: "kashmiriChilli", qty: 30, unit: "g" },
    { ingredientId: "redChilli", qty: 30, unit: "g" },
    { ingredientId: "sugar", qty: 40, unit: "g" },
    {
      ingredientId: "asafoetida",
      qty: 5,
      unit: "g",
      compoundOf: ["Gum Arabic", "Wheat Flour", "Asafoetida"],
    },
    { ingredientId: "mustard", qty: 15, unit: "g" },
    { ingredientId: "curryLeaves", qty: 10, unit: "g" },
    { ingredientId: "fenugreek", qty: 5, unit: "g" },
    { ingredientId: "turmeric", qty: 8, unit: "g" },
  ],
};

function valuesByIngredient(basis: PercentageBasis): Record<string, number> {
  const computation = computeRecipePercentages(DOC_RECIPE, DOC_INGREDIENTS, { basis });
  const out: Record<string, number> = {};
  for (const item of computation.items) out[item.ingredientId] = item.tableValue;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Section 4 of the label basis doc: the worked example                       */
/* -------------------------------------------------------------------------- */

describe("label basis doc section 4, the worked example", () => {
  it("weighs every line the way the doc does, oil at 0.92 kg/L and vinegar at 1.00 kg/L", () => {
    const computation = computeRecipePercentages(DOC_RECIPE, DOC_INGREDIENTS, { basis: "A" });
    const grams: Record<string, number> = {};
    for (const item of computation.items) grams[item.ingredientId] = item.ingoingG;

    for (const [id, ingoing] of DOC_TABLE) {
      expect(grams[id], `${id} ingoing g`).toBeCloseTo(ingoing, 6);
    }
    expect(computation.ingoingTotalG).toBe(6033);
  });

  it("column A: every ingoing weight over the ingoing total of 6,033 g", () => {
    const values = valuesByIngredient("A");
    for (const [id, , columnA] of DOC_TABLE) {
      expect(values[id], `${id} column A`).toBe(columnA);
    }
  });

  it("column B, the recommended basis: the adjusted total is 4,433 g", () => {
    const computation = computeRecipePercentages(DOC_RECIPE, DOC_INGREDIENTS, { basis: "B" });
    expect(computation.denominatorG).toBe(4433);

    const values = valuesByIngredient("B");
    for (const [id, , , columnB] of DOC_TABLE) {
      expect(values[id], `${id} column B`).toBe(columnB);
    }
  });

  it("column C: ingoing over the finished weight of 4,400 g, in g per 100 g", () => {
    const computation = computeRecipePercentages(DOC_RECIPE, DOC_INGREDIENTS, { basis: "C" });
    expect(computation.denominatorG).toBe(4400);

    const values = valuesByIngredient("C");
    for (const [id, , , , columnC] of DOC_TABLE) {
      expect(values[id], `${id} column C`).toBe(columnC);
    }
  });

  it("A and B total 100.00% and C totals 137.1 g per 100 g", () => {
    const totalOf = (basis: PercentageBasis): number =>
      roundToDecimals(
        computeRecipePercentages(DOC_RECIPE, DOC_INGREDIENTS, { basis }).items.reduce(
          (sum, item) => sum + item.value,
          0,
        ),
        1,
      );

    expect(totalOf("A")).toBe(100);
    expect(totalOf("B")).toBe(100);
    // "Sums to 137 g per 100 g, which proves it cannot be expressed as a set
    // of percentages." Doc section 4.
    expect(totalOf("C")).toBe(137.1);
  });

  it("basis B is the default when nothing asks for one", () => {
    expect(DEFAULT_PERCENTAGE_BASIS).toBe("B");
    const computation = computeRecipePercentages({ lines: DOC_RECIPE.lines }, DOC_INGREDIENTS);
    expect(computation.basis).toBe("B");
    expect(computation.denominatorG).toBe(4433);
  });
});

/* -------------------------------------------------------------------------- */
/* The done-when                                                              */
/* -------------------------------------------------------------------------- */

describe("batch 001 on basis B", () => {
  it("declares Prawns 35% and Dates 23%", () => {
    const computation = computeRecipePercentages(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, {
      basis: "B",
    });
    const prawns = computation.items.find((item) => item.ingredientId === "prawns");
    const dates = computation.items.find((item) => item.ingredientId === "dates");

    expect(prawns?.declaredValue).toBe(35);
    expect(dates?.declaredValue).toBe(23);
    expect(computation.ingoingTotalG).toBe(6033);
    expect(computation.denominatorG).toBe(4433);
  });

  it("prints those two figures, and no others, on the ingredient line", () => {
    const block = buildLabelBlock(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, { basis: "B" });
    expect(block.ingredientsLine).toBe(
      "Prawns (35%), Dates (23%), Gingelly (Sesame) Oil, Vinegar, Garlic, Green Chilli, Salt, " +
        "Ginger, Sugar, Kashmiri Chilli Powder, Red Chilli Powder, Mustard, Curry Leaves, " +
        "Turmeric, Compounded Asafoetida (Gum Arabic, Wheat Flour, Asafoetida), Fenugreek.",
    );
    const percentages = parseIngredientsLine(block.ingredientsLine).filter((i) => i.percent !== null);
    expect(percentages.map((i) => `${i.name} ${i.percent}`)).toEqual(["Prawns 35%", "Dates 23%"]);
  });

  it("copies the printed allergen line, claims and storage character for character", () => {
    const block = buildLabelBlock(BATCH_001_RECIPE, BATCH_001_INGREDIENTS);
    expect(block.allergenLine).toBe(PRINTED_LABEL_BATCH_001.allergenLine);
    expect(block.claimsText).toBe(PRINTED_LABEL_BATCH_001.claimsText);
    expect(block.storageText).toBe(PRINTED_LABEL_BATCH_001.storageText);
    expect(DEFAULT_CLAIMS_TEXT).toBe("No added preservatives. Prepared by traditional method.");
    expect(DEFAULT_STORAGE_TEXT).toBe(
      "Cool, dry place away from sunlight; refrigerate after opening; clean dry spoon; keep prawns covered in oil.",
    );
  });

  it("takes the claims and storage the recipe records when it has its own", () => {
    const block = buildLabelBlock(
      { ...BATCH_001_RECIPE, claimsText: "No added preservatives.", storageText: "Keep cool." },
      BATCH_001_INGREDIENTS,
    );
    expect(block.claimsText).toBe("No added preservatives.");
    expect(block.storageText).toBe("Keep cool.");
  });

  it("moves the percentages when the switch moves", () => {
    const percentOf = (basis: PercentageBasis, id: string): number | undefined =>
      computeRecipePercentages(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, { basis }).items.find(
        (item) => item.ingredientId === id,
      )?.declaredValue;

    expect(percentOf("A", "prawns")).toBe(26);
    expect(percentOf("B", "prawns")).toBe(35);
    expect(percentOf("C", "prawns")).toBe(35);
    expect(percentOf("A", "dates")).toBe(17);
    expect(percentOf("B", "dates")).toBe(23);
    expect(percentOf("C", "dates")).toBe(23);
  });
});

/* -------------------------------------------------------------------------- */
/* Ordering, 5(2)(b) and the doc's ordering ambiguity                          */
/* -------------------------------------------------------------------------- */

describe("ordering, 5(2)(b)", () => {
  const namesOn = (basis: PercentageBasis): string[] =>
    computeRecipePercentages(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, { basis }).items.map(
      (item) => item.ingredientId,
    );

  it("orders descending by whatever the chosen basis measures", () => {
    for (const basis of ["A", "B", "C"] as const) {
      const computation = computeRecipePercentages(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, {
        basis,
      });
      const values = computation.items.map((item) => item.value);
      expect([...values].sort((a, b) => b - a), `basis ${basis} is descending`).toEqual(values);
    }
  });

  /**
   * Doc section 4, "Ordering ambiguity": "5(2)(b) orders ingredients by
   * composition at the time of its manufacture. A literal reading puts
   * Vinegar first. The sensible reading (evaporated water leaves the
   * calculation) puts it fourth. Flag to the consultant."
   *
   * The engine takes neither side once and for all. It orders by the basis
   * that is switched on, so the literal reading (A, and C, which both measure
   * the full ingoing 2 L) puts vinegar second after the prawns, and the
   * sensible reading (B, which measures the 400 g that stays) puts it fourth,
   * exactly as the doc describes. Vinegar is "first" in the doc's sense of
   * first by weight among the things that move; the prawns at 1,550 g are
   * still ahead of the 2,000 g of vinegar only under B.
   */
  it("puts vinegar ahead of the prawns on the literal reading and fourth on the sensible one", () => {
    expect(namesOn("A")[0]).toBe("vinegar");
    expect(namesOn("C")[0]).toBe("vinegar");
    expect(namesOn("B")[3]).toBe("vinegar");
    expect(namesOn("B")[0]).toBe("prawns");
  });

  it("breaks a tie by the order the recipe records its lines", () => {
    // Kashmiri and red chilli powder are both 30 g, asafoetida and fenugreek
    // both 5 g. The recipe lists kashmiri before red and asafoetida before
    // fenugreek, and so does the label.
    const order = namesOn("B");
    expect(order.indexOf("kashmiriChilli")).toBeLessThan(order.indexOf("redChilli"));
    expect(order.indexOf("asafoetida")).toBeLessThan(order.indexOf("fenugreek"));
  });

  it("does not move the allergen line when the switch moves", () => {
    for (const basis of ["A", "B", "C"] as const) {
      const block = buildLabelBlock(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, { basis });
      expect(block.allergenLine, `basis ${basis}`).toBe(PRINTED_LABEL_BATCH_001.allergenLine);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Section 5 of the label basis doc: compounded asafoetida                     */
/* -------------------------------------------------------------------------- */

describe("label basis doc section 5, compounded asafoetida", () => {
  const block = buildLabelBlock(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, { basis: "B" });
  const computation = computeRecipePercentages(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, {
    basis: "B",
  });
  const asafoetida = computation.items.find((item) => item.ingredientId === "asafoetida");

  it("sits under the 5% threshold, so its bracketed list is voluntary", () => {
    expect(COMPOUND_DECLARATION_THRESHOLD_PERCENT).toBe(5);
    expect(asafoetida).toBeDefined();
    expect(asafoetida?.shareOfFoodPercent).toBeLessThan(5);
    expect(compoundDeclarationRequired(asafoetida!)).toBe(false);
  });

  it("prints the parts in brackets anyway, in the order the supplier gave, as the jar does", () => {
    expect(block.ingredientsLine).toContain(
      "Compounded Asafoetida (Gum Arabic, Wheat Flour, Asafoetida)",
    );
  });

  it("declares the wheat allergen even though the compound is under 5%", () => {
    // "The allergen is not optional. Regulation 5(14) requires a separate
    // Contains declaration with no 5% threshold." Doc section 5.
    expect(block.allergenLine).toContain("Wheat (Gluten)");
    expect(block.allergenLine).toContain("Crustacean (Prawns)");
  });

  it("owes the bracketed list once the compound reaches 5% of the food", () => {
    const heavier = computeRecipePercentages(
      {
        ...BATCH_001_RECIPE,
        lines: BATCH_001_RECIPE.lines.map((line) =>
          line.ingredientId === "asafoetida" ? { ...line, qty: 500 } : line,
        ),
      },
      BATCH_001_INGREDIENTS,
      { basis: "B" },
    );
    const bigger = heavier.items.find((item) => item.ingredientId === "asafoetida");
    expect(bigger?.shareOfFoodPercent).toBeGreaterThanOrEqual(5);
    expect(compoundDeclarationRequired(bigger!)).toBe(true);
  });

  it("expands a compound part that is itself an ingredient document", () => {
    const ingredients: IngredientIndex = {
      ...BATCH_001_INGREDIENTS,
      wheatFlour: { labelName: "Wheat Flour" },
    };
    const line = labelIngredientsLine(
      computeRecipePercentages(
        {
          lines: [
            { ingredientId: "prawns", qty: 100, unit: "g" },
            { ingredientId: "asafoetida", qty: 5, unit: "g", compoundOf: ["wheatFlour", "Asafoetida"] },
          ],
        },
        ingredients,
      ),
      ingredients,
    );
    expect(line).toBe("Prawns, Compounded Asafoetida (Wheat Flour, Asafoetida).");
  });
});

/* -------------------------------------------------------------------------- */
/* Nutrition                                                                  */
/* -------------------------------------------------------------------------- */

describe("nutrition per 100 g, ingoing nutrients over finished weight", () => {
  it("works out by hand on a two line recipe", () => {
    // 1,000 g of dates at 280 kcal/100 g is 2,800 kcal. 1,000 g of prawns at
    // 100 kcal/100 g is 1,000 kcal. 3,800 kcal in, 1,600 g out, so
    // 3,800 / 1,600 * 100 = 237.5 kcal per 100 g. Protein: 25 g + 250 g is
    // 275 g in, 275 / 1,600 * 100 = 17.1875 g per 100 g.
    const ingredients: IngredientIndex = {
      dates: { labelName: "Dates", nutritionPer100g: { energyKcal: 280, proteinG: 2.5 } },
      prawns: { labelName: "Prawns", nutritionPer100g: { energyKcal: 100, proteinG: 25 } },
    };
    const result = nutritionPer100g(
      {
        lines: [
          { ingredientId: "dates", qty: 1000, unit: "g" },
          { ingredientId: "prawns", qty: 1, unit: "kg" },
        ],
      },
      ingredients,
      1600,
    );

    expect(result.finishedWeightG).toBe(1600);
    expect(result.per100g.energyKcal).toBeCloseTo(237.5, 9);
    expect(result.per100g.proteinG).toBeCloseTo(17.1875, 9);
    expect(result.missing).toEqual([]);
  });

  it("concentrates rather than dilutes: a batch that loses water gains per 100 g", () => {
    const ingredients: IngredientIndex = {
      prawns: { labelName: "Prawns", nutritionPer100g: { energyKcal: 100 } },
    };
    const recipe: RecipeForLabel = { lines: [{ ingredientId: "prawns", qty: 1000, unit: "g" }] };
    expect(nutritionPer100g(recipe, ingredients, 1000).per100g.energyKcal).toBeCloseTo(100, 9);
    expect(nutritionPer100g(recipe, ingredients, 500).per100g.energyKcal).toBeCloseTo(200, 9);
  });

  it("names the ingredient with no figure instead of counting it as zero", () => {
    const ingredients: IngredientIndex = {
      dates: { labelName: "Dates", nutritionPer100g: { energyKcal: 280, proteinG: 2.5 } },
      salt: { labelName: "Salt", nutritionPer100g: { energyKcal: 0 } },
    };
    const result = nutritionPer100g(
      {
        lines: [
          { ingredientId: "dates", qty: 1000, unit: "g" },
          { ingredientId: "salt", qty: 90, unit: "g" },
        ],
      },
      ingredients,
      1000,
    );

    expect(result.per100g.energyKcal).toBeCloseTo(280, 9);
    expect(result.per100g.proteinG).toBeUndefined();
    expect(result.missing).toEqual([{ nutrient: "proteinG", ingredientIds: ["salt"] }]);
  });

  it("names an ingredient whose document is missing altogether", () => {
    const result = nutritionPer100g(
      {
        lines: [
          { ingredientId: "dates", qty: 1000, unit: "g" },
          { ingredientId: "gone", qty: 10, unit: "g" },
        ],
      },
      { dates: { labelName: "Dates", nutritionPer100g: { energyKcal: 280 } } },
      1000,
    );
    expect(result.per100g.energyKcal).toBeUndefined();
    expect(result.missing).toEqual([{ nutrient: "energyKcal", ingredientIds: ["gone"] }]);
  });

  it("refuses a finished weight of zero rather than dividing by it", () => {
    expect(() => nutritionPer100g(DOC_RECIPE, DOC_INGREDIENTS, 0)).toThrow(RangeError);
  });

  it("puts a figure on every nutrient batch 001's ingredients carry", () => {
    const block = buildLabelBlock(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, { basis: "B" });
    expect(block.nutrition).not.toBeNull();
    expect(block.nutrition?.missing).toEqual([]);
    expect(Object.keys(block.nutrition?.per100g ?? {}).sort()).toEqual([
      "energyKcal",
      "fatG",
      "proteinG",
      "sodiumMg",
    ]);
  });

  it("leaves the panel out when no finished weight is recorded", () => {
    const noWeight: RecipeForLabel = {
      percentageBasis: BATCH_001_RECIPE.percentageBasis,
      lines: BATCH_001_RECIPE.lines,
    };
    const block = buildLabelBlock(noWeight, BATCH_001_INGREDIENTS, { basis: "B" });
    expect(block.nutrition).toBeNull();
    expect(block.ingredientsLine).toContain("Prawns (35%)");
  });
});

/* -------------------------------------------------------------------------- */
/* The drift check                                                            */
/* -------------------------------------------------------------------------- */

describe("the printed label drift check", () => {
  const printed = PRINTED_LABEL_BATCH_001;

  it("passes on identical input", () => {
    expect(compareLabelText(printed, { ...printed })).toEqual([]);
  });

  it("fails a changed word, naming the line and both versions", () => {
    const differences = compareLabelText(printed, {
      ...printed,
      claimsText: "No preservatives. Prepared by traditional method.",
    });
    expect(differences).toHaveLength(1);
    expect(differences[0].field).toBe("claimsText");
    expect(differences[0].kind).toBe("wording");
    expect(differences[0].message).toContain("The claims text differs");
    expect(differences[0].message).toContain("No added preservatives.");
  });

  it("fails a changed word inside the ingredient line, naming the ingredient", () => {
    const differences = compareLabelText(printed, {
      ...printed,
      ingredientsLine: printed.ingredientsLine.replace("Gingelly (Sesame) Oil", "Sesame Oil"),
    });
    const messages = differences.map((d) => d.message);
    expect(messages).toContain("Gingelly (Sesame) Oil is on the printed label and not on the generated line.");
    expect(messages).toContain("Sesame Oil is on the generated line and not on the printed label.");
  });

  it("fails a changed percentage, naming the ingredient and both figures", () => {
    const differences = compareLabelText(printed, {
      ...printed,
      ingredientsLine: printed.ingredientsLine.replace("Prawns (59%)", "Prawns (35%)"),
    });
    expect(differences).toHaveLength(1);
    expect(differences[0].kind).toBe("percentage");
    expect(differences[0].subject).toBe("Prawns");
    expect(differences[0].message).toBe(
      "Prawns: the printed label says 59%, the generated line says 35%.",
    );
  });

  it("fails a changed order, naming the ingredient and both positions", () => {
    const differences = compareLabelText(printed, {
      ...printed,
      ingredientsLine: printed.ingredientsLine.replace(
        "Vinegar, Gingelly (Sesame) Oil",
        "Gingelly (Sesame) Oil, Vinegar",
      ),
    });
    expect(differences.every((d) => d.kind === "order")).toBe(true);
    const messages = differences.map((d) => d.message);
    expect(messages).toContain("Gingelly (Sesame) Oil is 4 on the printed label and 3 on the generated line.");
    expect(messages).toContain("Vinegar is 3 on the printed label and 4 on the generated line.");
  });

  it("fails a changed allergen line and a changed storage line", () => {
    const differences = compareLabelText(printed, {
      ...printed,
      allergenLine: "Contains: Crustacean (Prawns), Sesame and Mustard.",
      storageText: "Store in a cool, dry place away from sunlight.",
    });
    expect(differences.map((d) => d.field).sort()).toEqual(["allergenLine", "storageText"]);
    expect(differences.every((d) => d.message.includes("differs from the printed label"))).toBe(true);
  });

  /**
   * The printed batch 001 label was computed on basis C from the market
   * weight of the prawns, which is exactly what the label basis doc was
   * written to change. So the generated block is expected to differ, and what
   * this test pins is the known list: two percentages and twelve positions.
   * A new difference, or a changed allergen, claims or storage line, is drift
   * and fails here.
   */
  it("lists exactly the known batch 001 differences and nothing else", () => {
    const block = buildLabelBlock(BATCH_001_RECIPE, BATCH_001_INGREDIENTS, { basis: "B" });
    const differences = verifyAgainstPrintedLabel(block);

    expect(differences.filter((d) => d.field !== "ingredientsLine")).toEqual([]);
    expect(differences.filter((d) => d.kind === "percentage").map((d) => d.message)).toEqual([
      "Prawns: the printed label says 59%, the generated line says 35%.",
      "Dates: the printed label says 22%, the generated line says 23%.",
    ]);
    expect(differences.filter((d) => d.kind === "order").map((d) => d.subject)).toEqual([
      "Gingelly (Sesame) Oil",
      "Vinegar",
      "Salt",
      "Ginger",
      "Sugar",
      "Kashmiri Chilli Powder",
      "Red Chilli Powder",
      "Mustard",
      "Curry Leaves",
      "Turmeric",
      "Compounded Asafoetida (Gum Arabic, Wheat Flour, Asafoetida)",
      "Fenugreek",
    ]);
    expect(differences.filter((d) => d.kind === "missing" || d.kind === "extra")).toEqual([]);
    expect(differences).toHaveLength(14);
  });
});

/* -------------------------------------------------------------------------- */
/* The pieces                                                                 */
/* -------------------------------------------------------------------------- */

describe("the pieces", () => {
  it("converts g, kg, ml and l, and refuses a volume with no density", () => {
    expect(toGrams(1550, "g")).toBe(1550);
    expect(toGrams(1.55, "kg")).toBeCloseTo(1550, 9);
    expect(toGrams(2, "l", 1)).toBe(2000);
    expect(toGrams(1, "L", 0.92)).toBeCloseTo(920, 9);
    expect(toGrams(500, "ml", 0.92)).toBeCloseTo(460, 9);
    expect(() => toGrams(1, "l")).toThrow(/density/);
    expect(() => toGrams(1, "tbsp")).toThrow(/unknown recipe unit/);
    expect(() => toGrams(-1, "g")).toThrow(RangeError);
  });

  it("rounds half up", () => {
    expect(roundToDecimals(0.25, 1)).toBe(0.3);
    expect(roundToDecimals(22.5581, 1)).toBe(22.6);
    expect(roundToDecimals(15.2494, 1)).toBe(15.2);
    expect(roundToDecimals(0.2486, 1)).toBe(0.2);
  });

  it("splits an ingredient line on the commas outside the brackets", () => {
    const items = parseIngredientsLine(PRINTED_LABEL_BATCH_001.ingredientsLine);
    expect(items).toHaveLength(16);
    expect(items[0]).toMatchObject({ name: "Prawns", percent: "59%", position: 0 });
    expect(items[11].name).toBe("Compounded Asafoetida (Gum Arabic, Wheat Flour, Asafoetida)");
    expect(items[15]).toMatchObject({ name: "Turmeric", percent: null });
    expect(parseIngredientsLine("")).toEqual([]);
  });

  it("writes an allergen line of one, two and three tags", () => {
    const line = (tags: string[][]): string =>
      allergenLine(
        { lines: tags.map((_, i) => ({ ingredientId: `i${i}`, qty: 1, unit: "g" })) },
        Object.fromEntries(tags.map((t, i) => [`i${i}`, { labelName: `I${i}`, allergenTags: t }])),
      );
    expect(line([])).toBe("");
    expect(line([[]])).toBe("");
    expect(line([["Sesame"]])).toBe("Contains: Sesame.");
    expect(line([["Sesame"], ["Mustard"]])).toBe("Contains: Sesame and Mustard.");
    expect(line([["Sesame"], ["Mustard"], ["Soy"]])).toBe("Contains: Sesame, Mustard and Soy.");
    // A tag on two ingredients is named once.
    expect(line([["Sesame"], ["Sesame"], ["Mustard"]])).toBe("Contains: Sesame and Mustard.");
  });

  it("names a line whose ingredient document is gone rather than dropping it", () => {
    const computation = computeRecipePercentages(
      { lines: [{ ingredientId: "gone", qty: 100, unit: "g" }] },
      {},
    );
    expect(computation.missingIngredientIds).toEqual(["gone"]);
    expect(computation.items[0].labelName).toBe("gone");
  });

  it("refuses basis C when no finished weight is recorded", () => {
    expect(() =>
      computeRecipePercentages({ lines: DOC_RECIPE.lines }, DOC_INGREDIENTS, { basis: "C" }),
    ).toThrow(/finished weight/);
  });

  it("indexes a list of ingredients by id", () => {
    const index = indexIngredients([{ id: "salt", labelName: "Salt" }]);
    expect(index.salt.labelName).toBe("Salt");
  });
});
