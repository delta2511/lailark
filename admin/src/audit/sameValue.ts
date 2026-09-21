/**
 * Deep-enough equality for the field values this app ever audits: numbers,
 * strings, booleans, nulls, and plain arrays/objects of those (a batch's
 * `costs`, a product's `customLines`). Never a Firestore sentinel or a
 * Timestamp, because neither is ever a value a person typed into a box.
 *
 * Its own file, with no Firebase import, so it can be unit tested with no
 * emulator (`write.test.ts`) the same way `photos.ts`'s pure helpers are:
 * `write.ts` (the audited-write wrapper) is the only importer that needs the
 * SDK, and pulling that in here would drag `admin/src/firebase.ts`'s
 * module-load side effects into a plain `vitest run`.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const key of keys) {
    if (!sameValue(ao[key], bo[key])) return false;
  }
  return true;
}
