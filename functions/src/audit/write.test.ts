/**
 * `buildAuditFields`, the pure half of the function-side audit wrapper: given
 * a patch and the document as it read before the write, which fields
 * actually changed, and what was each one's before/after. The
 * `Transaction`-backed half (`writeAudit`, and its wiring into
 * `transitionBatch`/`approveBatchFull`) is exercised end to end by
 * `admin/tests/timeline.spec.ts` against the real emulator, the same way
 * `transitions.test.ts` leaves the Firestore plumbing to the emulator suite
 * and keeps this file to the parts with no Firebase in them.
 */
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { buildAuditFields } from "./write";

function snapOf(data: Record<string, unknown>): DocumentSnapshot {
  return { get: (field: string) => data[field] } as unknown as DocumentSnapshot;
}

describe("buildAuditFields", () => {
  it("reads before from the snapshot and after from the patch, for each changed field", () => {
    const before = snapOf({ state: "open", weightRaw: null, paidCount: 3 });
    const result = buildAuditFields({ state: "sourcing", weightRaw: 12.4 }, before);

    expect(result.fields).toEqual(["state", "weightRaw"]);
    expect(result.before).toEqual({ state: "open", weightRaw: null });
    expect(result.after).toEqual({ state: "sourcing", weightRaw: 12.4 });
    // Untouched fields never appear, so the entry cannot be mistaken for a
    // record of the whole document.
    expect(result.before).not.toHaveProperty("paidCount");
  });

  it("treats a missing beforeSnap (a create) as nothing there before", () => {
    const result = buildAuditFields({ state: "draft", productSlug: "prawns" }, null);
    expect(result.before).toEqual({ state: null, productSlug: null });
    expect(result.after).toEqual({ state: "draft", productSlug: "prawns" });
  });

  it("drops FieldValue sentinels from fields, before and after", () => {
    const before = snapOf({ updatedAt: "whatever" });
    const result = buildAuditFields(
      { state: "cooking", updatedAt: FieldValue.serverTimestamp() },
      before,
    );
    expect(result.fields).toEqual(["state"]);
    expect(result.before).not.toHaveProperty("updatedAt");
    expect(result.after).not.toHaveProperty("updatedAt");
  });

  it("reads a field the snapshot does not have as null, not undefined", () => {
    const before = snapOf({});
    const result = buildAuditFields({ pausedFrom: "open" }, before);
    expect(result.before).toEqual({ pausedFrom: null });
  });

  it("is empty when the patch is empty or carries only sentinels", () => {
    expect(buildAuditFields({}, snapOf({})).fields).toEqual([]);
    expect(buildAuditFields({ updatedAt: FieldValue.serverTimestamp() }, snapOf({})).fields).toEqual([]);
  });
});
