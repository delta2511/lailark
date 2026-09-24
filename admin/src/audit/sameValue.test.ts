/**
 * `sameValue`, the concurrency check {@link undoAuditEntry} (write.ts) runs
 * before it restores anything: "is the document's current value for this
 * field still what this write left behind." No emulator needed for this
 * part, the same way `phone.test.ts` and `session.test.ts` test pure
 * functions without one; the Firestore-backed half of the file (the race
 * itself, the back-door guard, undoing an undo) is exercised end to end in
 * `admin/tests/timeline.spec.ts` against the real emulator.
 */
import { describe, expect, it } from "vitest";

import { sameValue } from "./sameValue";

describe("sameValue", () => {
  it("treats identical primitives as the same", () => {
    expect(sameValue(64900, 64900)).toBe(true);
    expect(sameValue("Beypore", "Beypore")).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(true, true)).toBe(true);
  });

  it("treats different primitives as different", () => {
    expect(sameValue(64900, 62000)).toBe(false);
    expect(sameValue("Beypore", "Chaliyam")).toBe(false);
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue(0, "0")).toBe(false);
  });

  it("compares a batch's costs map by value, not by reference", () => {
    const a = { jarsLids: 45000, boxInserts: 0, labelling: 0, gasPower: 0 };
    const b = { jarsLids: 45000, boxInserts: 0, labelling: 0, gasPower: 0 };
    expect(sameValue(a, b)).toBe(true);
    expect(sameValue(a, { ...b, jarsLids: 46000 })).toBe(false);
  });

  it("catches a field present on one side and missing on the other", () => {
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it("compares a product's customLines array by value and by order", () => {
    const before = [{ description: "Extra spoon", amountPaise: 5000 }];
    const sameOrder = [{ description: "Extra spoon", amountPaise: 5000 }];
    const changedAmount = [{ description: "Extra spoon", amountPaise: 7500 }];
    const reordered = [
      { description: "Extra jar", amountPaise: 1000 },
      { description: "Extra spoon", amountPaise: 5000 },
    ];
    expect(sameValue(before, sameOrder)).toBe(true);
    expect(sameValue(before, changedAmount)).toBe(false);
    expect(sameValue(before, reordered)).toBe(false);
  });
});
