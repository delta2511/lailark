import { describe, expect, it } from "vitest";
import {
  isKitchenBatchField,
  isProtectedBatchField,
  KITCHEN_BATCH_FIELDS,
  PROTECTED_BATCH_FIELDS,
  writableBatchFields,
} from "./rules.js";

const ALL_BATCH_FIELDS = [
  "createdAt",
  "updatedAt",
  "createdBy",
  "productSlug",
  "recipeId",
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
