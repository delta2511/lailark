/**
 * Publishing the five policy pages, and naming the version an order agreed to.
 *
 * M5.7, decision D66. Brief §18.1 gives the collection its shape,
 * `policyVersions/{id}` with `kind`, `text` and `publishedAt`, and says an
 * order records which version it agreed to.
 *
 * ## Where a version comes from
 *
 * Not from a number somebody remembers to bump. `POLICY_SET_VERSION` in
 * `@lailark/shared` is derived from the five pages' own words, so the id
 * changes the moment a sentence changes and cannot be left behind by an edit.
 * That is the whole reason it is a fingerprint: a hand-kept version is stale
 * exactly when it matters, after a page has been rewritten and before anybody
 * noticed, and then an order points at text it was never sold under.
 *
 * ## Why this writes, rather than reads
 *
 * An order's `policyVersion` has to name a document that exists, or the record
 * is a dangling reference. The site's pages and this code come out of the same
 * build, so the function always knows the live version; what it cannot know is
 * whether anybody ran `publish-policies.mjs` after the deploy. So it publishes
 * them itself, once per instance, before the first checkout it serves. The
 * script stays, because a fresh project should have the pages in place before
 * the first customer arrives rather than a moment after, but nothing depends on
 * somebody having run it.
 *
 * Idempotent and safe to race: two instances that both find a document missing
 * write the same id with the same text, so the loser of the race overwrites the
 * winner with an identical page and a `publishedAt` a few milliseconds later.
 * Nothing reads `publishedAt` for anything but the record, and the text, the id
 * and the `setVersion` an order points at are the same either way. An old set is
 * never touched, which is the point of keeping them.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  POLICY_PAGES,
  POLICY_SET_VERSION,
  policyPageText,
  policyVersionDocId,
} from "@lailark/shared";

export const POLICY_VERSIONS = "policyVersions";

/**
 * The version every order placed by this build records. A constant, because
 * the pages are in the build: no read, and nothing to go wrong in a
 * transaction.
 */
export const LIVE_POLICY_VERSION = POLICY_SET_VERSION;

/**
 * Set once the five documents for {@link LIVE_POLICY_VERSION} are known to be
 * in Firestore, so an instance does five gets at most once in its life.
 */
let published: Promise<void> | null = null;

async function publish(db: Firestore): Promise<void> {
  const batch = db.batch();
  let toWrite = 0;
  for (const page of POLICY_PAGES) {
    const ref = db.collection(POLICY_VERSIONS).doc(policyVersionDocId(LIVE_POLICY_VERSION, page.kind));
    const snap = await ref.get();
    if (snap.exists) continue;
    batch.set(ref, {
      kind: page.kind,
      text: policyPageText(page),
      path: page.path,
      setVersion: LIVE_POLICY_VERSION,
      publishedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: "system",
    });
    toWrite += 1;
  }
  if (toWrite > 0) await batch.commit();
}

/**
 * Makes sure the live version's five documents exist, then answers with the
 * version an order should record. Cached per instance; a failure is not
 * cached, so the next call tries again.
 */
export async function livePolicyVersion(db: Firestore): Promise<string> {
  if (published === null) {
    published = publish(db).catch((error: unknown) => {
      published = null;
      throw error;
    });
  }
  await published;
  return LIVE_POLICY_VERSION;
}

/** Test seam: forgets that this instance has published. */
export function resetPolicyPublishCache(): void {
  published = null;
}
