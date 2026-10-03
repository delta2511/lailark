/**
 * M5.7: the policy version an order records is the version that was live.
 *
 * Against the emulator, because the claim is about what `createCheckout`
 * writes and about five documents in `policyVersions` existing when it does.
 * A real web checkout goes through the real callable, with no sign-in, exactly
 * as the site calls it.
 *
 * What this pins:
 *
 *  - the five pages are published, by id, with the text the site renders;
 *  - the order names that set, so its terms can be read back years later;
 *  - re-running the publish leaves `publishedAt` alone, because a version's
 *    date is the day it appeared and not the day somebody redeployed;
 *  - editing a page's words gives a different version, which is the only
 *    reason a fingerprint was used instead of a number somebody bumps.
 */

import {
  POLICY_KINDS,
  POLICY_PAGES,
  POLICY_SET_VERSION,
  PRICE_IN_STOCK_PAISE,
  PRICE_OPEN_PAISE,
  policyPageText,
  policySetVersion,
  policyVersionDocId,
} from "@lailark/shared";
import { beforeEach, describe, expect, it } from "vitest";

import {
  livePolicyVersion,
  POLICY_VERSIONS,
  resetPolicyPublishCache,
} from "../src/policies/publish";
import { callFunction, clearFirestore, db, mustTransition, waitForState } from "./emulator";

const PRODUCT = "prawns-and-dates";

async function seedProduct(): Promise<void> {
  await db().collection("products").doc(PRODUCT).set({
    name: "Prawns and dates",
    type: "hero",
    veg: false,
    hsn: "16",
    priceInStock: PRICE_IN_STOCK_PAISE,
    priceOpen: PRICE_OPEN_PAISE,
    jarGrams: 200,
    shippingRule: "free",
    seasonStart: null,
    seasonEnd: null,
    active: true,
    customLines: [],
  });
}

async function openBatch(): Promise<string> {
  const created = await mustTransition("owner", {
    to: "draft",
    data: {
      productSlug: PRODUCT,
      recipeId: `${PRODUCT}-v1`,
      plannedJars: 22,
      priceOpen: PRICE_OPEN_PAISE,
      priceInStock: PRICE_IN_STOCK_PAISE,
    },
  });
  await mustTransition("owner", { ref: created.ref, to: "open", data: {} });
  await waitForState(created.ref, "open");
  return created.ref;
}

async function versionDoc(kind: (typeof POLICY_KINDS)[number], setVersion = POLICY_SET_VERSION) {
  const snap = await db()
    .collection(POLICY_VERSIONS)
    .doc(policyVersionDocId(setVersion, kind))
    .get();
  return snap;
}

describe("publishing the five pages", () => {
  beforeEach(async () => {
    await clearFirestore();
    resetPolicyPublishCache();
  });

  it("writes one document per page, with the text the site renders", async () => {
    expect(await livePolicyVersion(db())).toBe(POLICY_SET_VERSION);

    for (const page of POLICY_PAGES) {
      const snap = await versionDoc(page.kind);
      expect(snap.exists, `${page.path} was not published`).toBe(true);
      expect(snap.get("kind")).toBe(page.kind);
      expect(snap.get("path")).toBe(page.path);
      expect(snap.get("setVersion")).toBe(POLICY_SET_VERSION);
      expect(snap.get("text")).toBe(policyPageText(page));
      expect(snap.get("publishedAt")).toBeTruthy();
    }
  });

  it("is idempotent, and does not move publishedAt on a second run", async () => {
    await livePolicyVersion(db());
    const first = (await versionDoc("terms")).get("publishedAt");

    resetPolicyPublishCache();
    await livePolicyVersion(db());
    const second = (await versionDoc("terms")).get("publishedAt");

    expect(second).toEqual(first);
  });

  it("publishes once per instance, so a warm instance does no reads for it", async () => {
    await livePolicyVersion(db());
    // Deleting a document and asking again proves the cache: the answer comes
    // back without the document being restored, because nothing looked.
    await db().collection(POLICY_VERSIONS).doc(policyVersionDocId(POLICY_SET_VERSION, "terms")).delete();
    expect(await livePolicyVersion(db())).toBe(POLICY_SET_VERSION);
    expect((await versionDoc("terms")).exists).toBe(false);

    // And a cold instance puts it back.
    resetPolicyPublishCache();
    await livePolicyVersion(db());
    expect((await versionDoc("terms")).exists).toBe(true);
  });

  it("gives a different version when a page's words change", async () => {
    const edited = POLICY_PAGES.map((page) =>
      page.kind === "privacy"
        ? { ...page, blocks: [...page.blocks, { type: "paragraph" as const, text: "One more line." }] }
        : page,
    );
    expect(policySetVersion(edited)).not.toBe(POLICY_SET_VERSION);
    // The old set is untouched by that: an order pointing at it still reads.
    await livePolicyVersion(db());
    expect((await versionDoc("privacy")).get("text")).toBe(policyPageText(POLICY_PAGES[3]));
  });
});

describe("the version on an order", () => {
  let batchRef = "";

  beforeEach(async () => {
    // Wiped between tests because D15 allows one open batch per product: a
    // second `openBatch` on a dirty database is refused, not a bug here.
    await clearFirestore();
    await seedProduct();
    batchRef = await openBatch();
    // Published from this process as well, on purpose, and after a reset so
    // the wipe above is really undone.
    //
    // The emulator runs the callable in its own process, which publishes once
    // per instance and by this point in a full suite run has already done so
    // for a database that has since been cleared. That is an artefact of a test
    // run wiping Firestore under a warm instance, not something a customer can
    // cause: nothing in production deletes a published version, and the rules
    // refuse every client write to the collection. What the function itself
    // guarantees, that a cold instance publishes before it writes an order, is
    // pinned in-process above.
    resetPolicyPublishCache();
    await livePolicyVersion(db());
  });

  it("is the live set, and every page of it is readable by its id", async () => {
    const out = await callFunction("createCheckout", null, {
      productSlug: PRODUCT,
      qty: 1,
      customerName: "Asha",
      customerPhone: "+919000000501",
      address: { lines: ["12 Mill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
      consents: { updates: true, marketing: false },
      expectedTotalPaise: PRICE_OPEN_PAISE,
      clientRef: `cr-${Math.random().toString(36).slice(2)}`,
    });
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();

    const order = await db().collection("orders").doc(String(out.result.orderId)).get();
    const recorded = order.get("policyVersion") as string;

    expect(recorded).toBe(POLICY_SET_VERSION);
    expect(recorded).not.toBe("");

    // The whole point: from the order alone, the five pages it was sold under.
    for (const kind of POLICY_KINDS) {
      const snap = await db()
        .collection(POLICY_VERSIONS)
        .doc(policyVersionDocId(recorded, kind))
        .get();
      expect(snap.exists, `${kind} of ${recorded} is missing`).toBe(true);
      expect(snap.get("text")).toBe(policyPageText(POLICY_PAGES.find((p) => p.kind === kind)!));
    }

    expect(batchRef).not.toBe("");
  });

  it("is never the empty string it was before M5.7", async () => {
    const out = await callFunction("createCheckout", null, {
      productSlug: PRODUCT,
      qty: 1,
      customerName: "Binu",
      customerPhone: "+919000000502",
      address: { lines: ["3 Hill Road"], city: "Kozhikode", state: "KL", pincode: "673571" },
      consents: { updates: true, marketing: false },
      expectedTotalPaise: PRICE_OPEN_PAISE,
      clientRef: `cr-${Math.random().toString(36).slice(2)}`,
    });
    expect(out.result, JSON.stringify(out.error)).toBeTruthy();

    const order = await db().collection("orders").doc(String(out.result.orderId)).get();
    expect(order.get("policyVersion")).toMatch(/^p-[0-9a-f]{16}$/);
    // A counter sale still records "" and that is deliberate (sale.ts): nobody
    // at the door was shown a page. This is the web channel.
    expect(order.get("channel")).toBe("web");
  });
});
