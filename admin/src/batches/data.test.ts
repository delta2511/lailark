/**
 * `canRoleWriteBatchField`: the same two field lists `firestore.rules`
 * enforces (`shared/src/rules.ts`), used to gate the M2.6 Undo button so it
 * never offers to restore a field the write would be refused for.
 *
 * This is the "no back door" guard from the M2.6 report: an undo must not
 * reach a field its actor was never allowed to write, the Owner included for
 * the protected fields (counts, state, the printed number) a function alone
 * may move. The end-to-end race and undo-of-undo behaviour is covered by
 * `admin/tests/timeline.spec.ts` against the real emulator; this is the pure
 * predicate the Undo button's visibility and `undoBatchWrite`'s refusal both
 * read.
 */
import { describe, expect, it } from "vitest";

import { canRoleWriteBatchField } from "./data";

describe("canRoleWriteBatchField", () => {
  it("gives the Owner every kitchen field", () => {
    for (const field of ["source", "landedOn", "weightRaw", "cookedOn", "weightCleaned", "weightCooked", "costs"]) {
      expect(canRoleWriteBatchField("owner", field)).toBe(true);
    }
  });

  it("refuses the Owner a protected field: a count, the state, the printed number", () => {
    for (const field of ["state", "paidCount", "bookableJars", "heldJars", "batchNo", "pnl", "bottledJars"]) {
      expect(canRoleWriteBatchField("owner", field)).toBe(false);
    }
  });

  it("gives the Kitchen the kitchen fields and nothing else", () => {
    expect(canRoleWriteBatchField("kitchen", "source")).toBe(true);
    expect(canRoleWriteBatchField("kitchen", "weightRaw")).toBe(true);
    expect(canRoleWriteBatchField("kitchen", "costs")).toBe(true);
  });

  it("refuses the Kitchen a price, the planned jars, or anything protected", () => {
    for (const field of ["priceOpen", "priceInStock", "plannedJars", "state", "paidCount", "batchNo"]) {
      expect(canRoleWriteBatchField("kitchen", field)).toBe(false);
    }
  });

  it("gives the Viewer nothing: read-only, everywhere, always", () => {
    expect(canRoleWriteBatchField("viewer", "source")).toBe(false);
    expect(canRoleWriteBatchField("viewer", "weightRaw")).toBe(false);
  });
});
