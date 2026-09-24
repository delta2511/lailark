import { describe, expect, it } from "vitest";

import { batchLineIds, mainBatchLines } from "./batchLines.js";

const PRAWNS = "prawns";
const DATES = "dates";
const VINEGAR = "vinegar";

/** Batch 001's shape: two main lines and one that is not. */
const twoMain = [
  { ingredientId: PRAWNS, isMain: true },
  { ingredientId: DATES, isMain: true },
  { ingredientId: VINEGAR, isMain: false },
];

describe("batchLineIds", () => {
  it("keys every line by its own ingredient", () => {
    expect(batchLineIds(twoMain)).toEqual([PRAWNS, DATES, VINEGAR]);
  });

  it("suffixes a repeated ingredient rather than colliding with itself", () => {
    const salty = [{ ingredientId: "salt" }, { ingredientId: "salt" }, { ingredientId: "salt" }];
    expect(batchLineIds(salty)).toEqual(["salt", "salt~2", "salt~3"]);
  });

  it("does not hand a repeat an id another ingredient genuinely owns", () => {
    const lines = [{ ingredientId: "salt" }, { ingredientId: "salt~2" }, { ingredientId: "salt" }];
    expect(batchLineIds(lines)).toEqual(["salt", "salt~2", "salt~3"]);
  });

  it("is the same answer whatever `isMain` says", () => {
    expect(batchLineIds([{ ingredientId: PRAWNS, isMain: true }])).toEqual(
      batchLineIds([{ ingredientId: PRAWNS, isMain: false }]),
    );
  });
});

describe("mainBatchLines", () => {
  it("names both of batch 001's main ingredients, in the recipe's order", () => {
    expect(mainBatchLines(twoMain)).toEqual([
      { ingredientId: PRAWNS, lineId: PRAWNS },
      { ingredientId: DATES, lineId: DATES },
    ]);
  });

  it("names the one main line of a one main recipe", () => {
    const lines = [
      { ingredientId: PRAWNS, isMain: true },
      { ingredientId: VINEGAR, isMain: false },
    ];
    expect(mainBatchLines(lines)).toEqual([{ ingredientId: PRAWNS, lineId: PRAWNS }]);
  });

  it("is empty for a recipe that names no main ingredient (Q16)", () => {
    expect(mainBatchLines([{ ingredientId: VINEGAR, isMain: false }])).toEqual([]);
  });

  /**
   * The suffix counts the whole recipe, not the main lines alone: a main
   * line's id must not depend on which lines the caller happened to keep, or
   * the server would write one id and the actuals screen would read another.
   */
  it("gives a main line the same id the whole recipe's numbering gives it", () => {
    const lines = [
      { ingredientId: "salt", isMain: false },
      { ingredientId: "salt", isMain: true },
    ];
    expect(batchLineIds(lines)).toEqual(["salt", "salt~2"]);
    expect(mainBatchLines(lines)).toEqual([{ ingredientId: "salt", lineId: "salt~2" }]);
  });
});
