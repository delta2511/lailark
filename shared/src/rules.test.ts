import { describe, expect, it } from "vitest";
import {
  isKitchenBatchField,
  isProtectedBatchField,
  KITCHEN_BATCH_FIELDS,
  KITCHEN_RECIPE_EDIT_SWITCH,
  kitchenCanEditRecipes,
  PROTECTED_BATCH_FIELDS,
  writableBatchFields,
} from "./rules.js";
import { SETTINGS_NAMES } from "./states.js";
import type { PermissionsSettings } from "./types/system.js";

const ALL_BATCH_FIELDS = [
  "createdAt",
  "updatedAt",
  "createdBy",
  "batchNo",
  "productSlug",
  "productName",
  "recipeId",
  "mainIngredientName",
  "state",
  "plannedJars",
  "bookableJars",
  "perPersonLimit",
  "priceOpen",
  "priceInStock",
  "paidCount",
  "heldJars",
  "bottledJars",
  "writtenOff",
  "source",
  "landedOn",
  "cookedOn",
  "packedOn",
  "bestBefore",
  "saleStopOn",
  "weightRaw",
  "weightCleaned",
  "weightCooked",
  "halfReachedAt",
  "halfApprovedAt",
  "fullReachedAt",
  "fullApprovedAt",
  "pausedReason",
  "pausedFrom",
  "costs",
  "pnl",
];

describe("the batch field lists", () => {
  it("do not overlap: no field is both protected and a kitchen field", () => {
    const both = PROTECTED_BATCH_FIELDS.filter((f) =>
      (KITCHEN_BATCH_FIELDS as readonly string[]).includes(f),
    );
    expect(both).toEqual([]);
  });

  it("hold no duplicates and are sorted, so the rules file can be compared to them", () => {
    for (const list of [PROTECTED_BATCH_FIELDS, KITCHEN_BATCH_FIELDS]) {
      expect(new Set(list).size).toBe(list.length);
      expect([...list]).toEqual([...list].sort());
    }
  });

  it("name only real batch fields (plus updatedBy, which the write wrapper stamps)", () => {
    const known = new Set([...ALL_BATCH_FIELDS, "updatedBy"]);
    for (const f of [...PROTECTED_BATCH_FIELDS, ...KITCHEN_BATCH_FIELDS]) {
      expect(known.has(f)).toBe(true);
    }
  });

  it("cover every count and every server-computed field", () => {
    for (const f of ["paidCount", "heldJars", "bottledJars", "writtenOff", "pnl", "state"]) {
      expect(isProtectedBatchField(f)).toBe(true);
    }
    expect(isProtectedBatchField("priceOpen")).toBe(false);
  });

  it("let the kitchen at weights, dates and costs and nothing else", () => {
    for (const f of ["weightRaw", "weightCleaned", "weightCooked", "costs", "landedOn"]) {
      expect(isKitchenBatchField(f)).toBe(true);
    }
    for (const f of ["priceOpen", "plannedJars", "recipeId", "state"]) {
      expect(isKitchenBatchField(f)).toBe(false);
    }
  });

  it("tell each screen what it may offer", () => {
    const owner = writableBatchFields("owner", ALL_BATCH_FIELDS);
    expect(owner).toContain("priceOpen");
    expect(owner).not.toContain("paidCount");
    expect(owner).not.toContain("state");

    const kitchen = writableBatchFields("kitchen", ALL_BATCH_FIELDS);
    expect(kitchen.sort()).toEqual(["cookedOn", "costs", "landedOn", "packedOn", "source", "updatedAt", "weightCleaned", "weightCooked", "weightRaw"]);

    expect(writableBatchFields("viewer", ALL_BATCH_FIELDS)).toEqual([]);
    expect(writableBatchFields("", ALL_BATCH_FIELDS)).toEqual([]);
  });
});

describe("the Kitchen's recipe edit switch (Q4)", () => {
  it("lives on settings/permissions and is off by default", () => {
    expect(KITCHEN_RECIPE_EDIT_SWITCH).toEqual({
      collection: "settings",
      doc: "permissions",
      field: "kitchenCanEditRecipes",
      default: false,
    });
    expect(SETTINGS_NAMES).toContain(KITCHEN_RECIPE_EDIT_SWITCH.doc);
  });

  it("is off when the document does not exist", () => {
    expect(kitchenCanEditRecipes(undefined)).toBe(false);
  });

  it("is off when the field is missing", () => {
    expect(kitchenCanEditRecipes({})).toBe(false);
  });

  it("is off when the field is false", () => {
    expect(kitchenCanEditRecipes({ kitchenCanEditRecipes: false })).toBe(false);
  });

  it("is off for anything truthy that is not a literal true, like the rule", () => {
    const loose = (value: unknown) =>
      kitchenCanEditRecipes({ kitchenCanEditRecipes: value } as unknown as Partial<PermissionsSettings>);
    expect(loose("true")).toBe(false);
    expect(loose(1)).toBe(false);
    expect(loose(null)).toBe(false);
  });

  it("is on only for true", () => {
    expect(kitchenCanEditRecipes({ kitchenCanEditRecipes: true })).toBe(true);
  });
});
