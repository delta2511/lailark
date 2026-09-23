/**
 * M2.13. The bug Shefin found testing Milestone 2: batch 001's recipe flags
 * prawns and dates both `isMain`, the actuals screen keyed every main line
 * under the literal id `"main"`, and the two rows became one document. A
 * cost typed against prawns moved to dates; the row typed first looked as
 * though it had never saved. These are the cases that scheme has to get
 * right.
 */
import { describe, expect, it } from "vitest";

import { LEGACY_MAIN_ID, resolveActuals, resolveLineIds } from "./lineIds";

const PRAWNS = "prawns";
const DATES = "dates";
const VINEGAR = "vinegar";

const twoMain = [
  { ingredientId: PRAWNS, isMain: true },
  { ingredientId: DATES, isMain: true },
  { ingredientId: VINEGAR, isMain: false },
];

describe("resolveLineIds", () => {
  it("gives two main lines two ids: the bug, stated as a test", () => {
    expect(resolveLineIds(twoMain, [])).toEqual([PRAWNS, DATES, VINEGAR]);
    expect(new Set(resolveLineIds(twoMain, [])).size).toBe(3);
  });

  it("keys a line by its ingredient whatever `isMain` says", () => {
    const on = resolveLineIds([{ ingredientId: PRAWNS, isMain: true }], []);
    const off = resolveLineIds([{ ingredientId: PRAWNS, isMain: false }], []);
    // Flipping the flag on a recipe must not orphan an actual already typed.
    expect(on).toEqual(off);
  });

  it("is the same answer on every render and every reload", () => {
    expect(resolveLineIds(twoMain, [])).toEqual(resolveLineIds(twoMain, []));
    // And it does not depend on where a line sits in the list.
    expect(resolveLineIds([...twoMain].reverse(), [])).toEqual([VINEGAR, DATES, PRAWNS]);
  });

  it("suffixes a repeated ingredient rather than colliding with itself", () => {
    const salty = [{ ingredientId: "salt" }, { ingredientId: "salt" }, { ingredientId: "salt" }];
    expect(resolveLineIds(salty, [])).toEqual(["salt", "salt~2", "salt~3"]);
  });

  it("does not hand a repeat an id another ingredient genuinely owns", () => {
    // Ingredient ids are not all opaque: batch 001's are hand-written slugs,
    // so an ingredient really called `salt~2` can exist. Two rows on one
    // document is the bug this whole scheme exists to remove, so the suffix
    // steps over every id in play rather than assuming `~2` is free.
    const lines = [{ ingredientId: "salt" }, { ingredientId: "salt~2" }, { ingredientId: "salt" }];
    const ids = resolveLineIds(lines, []);
    expect(ids).toEqual(["salt", "salt~2", "salt~3"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("a pre-M2.13 `lines/main` document", () => {
    it("is adopted by the line whose ingredient it names", () => {
      const existing = [{ id: LEGACY_MAIN_ID, ingredientId: DATES }];
      expect(resolveLineIds(twoMain, existing)).toEqual([PRAWNS, LEGACY_MAIN_ID, VINEGAR]);
    });

    it("is adopted by the first main line when it names no ingredient", () => {
      expect(resolveLineIds(twoMain, [{ id: LEGACY_MAIN_ID }])).toEqual([
        LEGACY_MAIN_ID,
        DATES,
        VINEGAR,
      ]);
    });

    it("is left alone once that line has a document of its own", () => {
      const existing = [
        { id: LEGACY_MAIN_ID, ingredientId: PRAWNS },
        { id: PRAWNS, ingredientId: PRAWNS },
      ];
      expect(resolveLineIds(twoMain, existing)).toEqual([PRAWNS, DATES, VINEGAR]);
    });

    it("is claimed by no row when it names an ingredient this recipe no longer has", () => {
      const existing = [{ id: LEGACY_MAIN_ID, ingredientId: "beef" }];
      expect(resolveLineIds(twoMain, existing)).toEqual([PRAWNS, DATES, VINEGAR]);
    });

    it("never takes an id an ingredient genuinely owns", () => {
      const lines = [{ ingredientId: "main", isMain: true }, { ingredientId: DATES, isMain: true }];
      expect(resolveLineIds(lines, [{ id: LEGACY_MAIN_ID, ingredientId: DATES }])).toEqual([
        "main",
        DATES,
      ]);
    });

    it("gives at most one line the legacy document, so no two rows share one", () => {
      const ids = resolveLineIds(twoMain, [{ id: LEGACY_MAIN_ID, ingredientId: PRAWNS }]);
      expect(ids.filter((id) => id === LEGACY_MAIN_ID)).toHaveLength(1);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

describe("resolveActuals", () => {
  it("names a row by its ingredient even when it is bound to the legacy document", () => {
    const { rows, orphans } = resolveActuals(twoMain, [{ id: LEGACY_MAIN_ID, ingredientId: PRAWNS }]);
    expect(rows[0]).toEqual({ docId: LEGACY_MAIN_ID, rowKey: PRAWNS });
    expect(rows[1]).toEqual({ docId: DATES, rowKey: DATES });
    expect(orphans).toEqual([]);
  });

  /**
   * Round 1 of M2.13 left money stranded in two ways: a legacy document
   * naming an ingredient the recipe no longer lists, and a legacy document
   * superseded by one under the row's own id. Neither row reads them, so
   * neither is editable, and a sum over the subcollection counts them. They
   * are reported instead, and the screen says so.
   */
  describe("a document no row claims", () => {
    it("is reported when the recipe's main ingredient was swapped", () => {
      const swapped = [
        { ingredientId: "squid", isMain: true },
        { ingredientId: DATES, isMain: true },
      ];
      const stranded = { id: LEGACY_MAIN_ID, ingredientId: PRAWNS, costActual: 80_000 };
      const { rows, orphans } = resolveActuals(swapped, [stranded]);
      expect(rows.map((r) => r.docId)).toEqual(["squid", DATES]);
      expect(orphans).toEqual([{ doc: stranded, ingredientId: PRAWNS }]);
    });

    it("is reported when its row already has a document of its own", () => {
      const legacy = { id: LEGACY_MAIN_ID, ingredientId: PRAWNS, costActual: 80_000 };
      const own = { id: PRAWNS, ingredientId: PRAWNS, costActual: 55_000 };
      const { rows, orphans } = resolveActuals(twoMain, [legacy, own]);
      expect(rows[0]?.docId).toBe(PRAWNS);
      expect(orphans).toEqual([{ doc: legacy, ingredientId: PRAWNS }]);
    });

    it("reports the placeholder line a recipe with no main ingredient leaves behind", () => {
      // `planStartCooking` writes `lines/main` with `ingredientId: "main"`
      // when the recipe names no main ingredient. No row can claim it, so it
      // is named as carrying no ingredient rather than left unseen.
      const noMain = [{ ingredientId: VINEGAR, isMain: false }];
      const placeholder = { id: LEGACY_MAIN_ID, ingredientId: LEGACY_MAIN_ID, qtyActual: 12_000 };
      const { rows, orphans } = resolveActuals(noMain, [placeholder]);
      expect(rows.map((r) => r.docId)).toEqual([VINEGAR]);
      expect(orphans).toEqual([{ doc: placeholder, ingredientId: null }]);
    });

    it("reports nothing when every document is claimed", () => {
      const existing = [
        { id: PRAWNS, ingredientId: PRAWNS },
        { id: DATES, ingredientId: DATES },
      ];
      expect(resolveActuals(twoMain, existing).orphans).toEqual([]);
    });
  });
});
