/**
 * `firestore.rules`, one test per row of brief section 17.12 that a rule can
 * express, plus the four things the rules exist to make impossible: a public
 * read, a client money write, a client order write, and the Kitchen touching
 * a count on a batch.
 *
 * Rows of 17.12 that are *not* here are the ones rules cannot see: the
 * discount cap lives in a Settings document, approving a broadcast is a state
 * change inside a callable, a state transition is the `transitionBatch`
 * callable. Those are tested in `functions/` when they are built. What is
 * here is every row that comes down to "may this role read or write this
 * document or this field".
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import type { RulesTestContext, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { KITCHEN_RECIPE_EDIT_SWITCH } from "@lailark/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  callers,
  type Callers,
  everyRole,
  KITCHEN_UID,
  makeTestEnvironment,
  NO_ROLE_UID,
  OWNER_UID,
  VIEWER_UID,
} from "./env.js";
import { BATCH_DOC, BATCH_NO, CUSTOMER_PHONE, DOCUMENT_ID, ORDER_ID, seedFirestore, UPDATE_ID } from "./seed.js";

let env: RulesTestEnvironment;
let who: Callers;

const now = Timestamp.fromDate(new Date("2026-09-16T00:00:00Z"));
const base = { createdAt: now, updatedAt: now, createdBy: OWNER_UID };

const read = (ctx: RulesTestContext, path: string) => getDoc(doc(ctx.firestore(), path));
const write = (ctx: RulesTestContext, path: string, data: object) =>
  setDoc(doc(ctx.firestore(), path), data);
const patch = (ctx: RulesTestContext, path: string, data: object) =>
  updateDoc(doc(ctx.firestore(), path), data);
const remove = (ctx: RulesTestContext, path: string) => deleteDoc(doc(ctx.firestore(), path));

beforeAll(async () => {
  env = await makeTestEnvironment();
  who = callers(env);
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFirestore(env);
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("the public internet", () => {
  const closed = [
    `batches/${BATCH_NO}`,
    `orders/${ORDER_ID}`,
    `customers/${CUSTOMER_PHONE}`,
    `users/${OWNER_UID}`,
    `documents/${DOCUMENT_ID}`,
    "config/other",
    "notify/n1",
    "settings/discountCap",
    "products/prawns-and-dates",
    "audit/aud-1",
  ];

  for (const path of closed) {
    it(`cannot read ${path}`, async () => {
      await assertFails(read(who.unauth, path));
    });
  }

  it("cannot write anything, including a collection nobody named", async () => {
    await assertFails(write(who.unauth, "whatever/x", { a: 1 }));
    await assertFails(write(who.unauth, `batches/${BATCH_NO}/lines/new`, { a: 1 }));
  });
});

describe("notify, the only public write", () => {
  const valid = { contact: "+917736110087", source: "index", createdAt: serverTimestamp() };

  it("takes a create from anybody, with exactly the three fields", async () => {
    await assertSucceeds(write(who.unauth, "notify/new-1", valid));
  });

  it("refuses an extra field", async () => {
    await assertFails(write(who.unauth, "notify/new-2", { ...valid, utm: "instagram" }));
  });

  it("refuses a contact shorter than six characters", async () => {
    await assertFails(write(who.unauth, "notify/new-3", { ...valid, contact: "12345" }));
  });

  it("refuses a source that is not one of the two pages", async () => {
    await assertFails(write(who.unauth, "notify/new-4", { ...valid, source: "x" }));
  });

  it("refuses a client-supplied createdAt that is not a timestamp", async () => {
    await assertFails(write(who.unauth, "notify/new-5", { ...valid, createdAt: "today" }));
  });

  it("is never readable by the public, and never editable or deletable", async () => {
    await assertFails(read(who.unauth, "notify/n1"));
    await assertFails(patch(who.owner, "notify/n1", { source: "index" }));
    await assertFails(remove(who.owner, "notify/n1"));
  });

  it("is readable by all three admin roles: somebody has to message the list", async () => {
    await assertSucceeds(read(who.owner, "notify/n1"));
    await assertSucceeds(read(who.kitchen, "notify/n1"));
    await assertSucceeds(read(who.viewer, "notify/n1"));
  });
});

describe("config/site, the only public read", () => {
  it("is readable by the public", async () => {
    const snap = await assertSucceeds(read(who.unauth, "config/site"));
    expect(snap.data()).toEqual({ notifyCtaVisible: true });
  });

  it("is not writable, not even by the Owner: it is a console switch", async () => {
    await assertFails(patch(who.owner, "config/site", { notifyCtaVisible: false }));
  });

  it("does not open the rest of config", async () => {
    await assertFails(read(who.unauth, "config/other"));
    await assertFails(read(who.owner, "config/other"));
  });
});

/* ── 17.12: "See everything except Money" ────────────────────────────────── */

describe("see everything except Money", () => {
  const everyday = [
    `batches/${BATCH_NO}`,
    `batches/${BATCH_NO}/lines/l1`,
    `batches/${BATCH_NO}/updates/${UPDATE_ID}`,
    `batches/${BATCH_NO}/writeOffs/w1`,
    `orders/${ORDER_ID}`,
    `orders/${ORDER_ID}/events/e1`,
    `customers/${CUSTOMER_PHONE}`,
    `customers/${CUSTOMER_PHONE}/addresses/a1`,
    "products/prawns-and-dates",
    "ingredients/i1",
    "recipes/rec-1",
    "shipments/sh-1",
    "shipments/sh-1/events/e1",
    "concerns/con-1",
    "approvals/app-1",
    `conversations/${CUSTOMER_PHONE}`,
    `conversations/${CUSTOMER_PHONE}/messages/m1`,
    "settings/discountCap",
    "settings/pincodes",
    "policyVersions/p1",
    "audit/aud-1",
  ];

  for (const path of everyday) {
    it(`is read by all three roles: ${path}`, async () => {
      await assertSucceeds(read(who.owner, path));
      await assertSucceeds(read(who.kitchen, path));
      await assertSucceeds(read(who.viewer, path));
    });
  }
});

/* ── 17.12: "See Money" ──────────────────────────────────────────────────── */

describe("see Money", () => {
  const money = [
    `documents/${DOCUMENT_ID}`,
    "refunds/ref-1",
    "settlements/setl-1",
    "dayCloses/2026-09-16",
  ];

  for (const path of money) {
    it(`Owner and Viewer read ${path}, Kitchen does not`, async () => {
      await assertSucceeds(read(who.owner, path));
      await assertSucceeds(read(who.viewer, path));
      await assertFails(read(who.kitchen, path));
      await assertFails(read(who.noRole, path));
      await assertFails(read(who.unauth, path));
    });
  }

  it("keeps counters and webhookEvents off every client, read included", async () => {
    for (const path of ["counters/bill-26-27", "webhookEvents/razorpay-evt-1"]) {
      for (const [, ctx] of everyRole(who)) {
        await assertFails(read(ctx, path));
      }
    }
  });

  it("takes no client write to any money collection, the Owner included", async () => {
    const paths = [
      [`documents/${DOCUMENT_ID}`, "documents/new-1"],
      ["counters/bill-26-27", "counters/new-1"],
      ["refunds/ref-1", "refunds/new-1"],
      ["settlements/setl-1", "settlements/new-1"],
      ["webhookEvents/razorpay-evt-1", "webhookEvents/new-1"],
      ["dayCloses/2026-09-16", "dayCloses/2026-09-17"],
    ];
    for (const [existing, fresh] of paths) {
      for (const [, ctx] of everyRole(who)) {
        await assertFails(write(ctx, fresh, { ...base }));
        await assertFails(patch(ctx, existing, { tampered: true }));
        await assertFails(remove(ctx, existing));
      }
    }
  });
});

/* ── orders: no client write at all ──────────────────────────────────────── */

describe("orders", () => {
  it("are read by all three roles", async () => {
    await assertSucceeds(read(who.owner, `orders/${ORDER_ID}`));
    await assertSucceeds(read(who.kitchen, `orders/${ORDER_ID}`));
    await assertSucceeds(read(who.viewer, `orders/${ORDER_ID}`));
  });

  it("take no create, update or delete from any client, the Owner included", async () => {
    for (const [, ctx] of everyRole(who)) {
      await assertFails(write(ctx, "orders/new-1", { ...base, total: 59900 }));
      await assertFails(patch(ctx, `orders/${ORDER_ID}`, { kitchenNote: "hello" }));
      await assertFails(patch(ctx, `orders/${ORDER_ID}`, { payment: { status: "captured" } }));
      await assertFails(remove(ctx, `orders/${ORDER_ID}`));
    }
  });

  it("take no client write on the event timeline either", async () => {
    for (const [, ctx] of everyRole(who)) {
      await assertFails(write(ctx, `orders/${ORDER_ID}/events/new-1`, { ...base }));
    }
  });
});

/* ── batches: the field lists ────────────────────────────────────────────── */

describe("a batch, from the Kitchen", () => {
  const path = `batches/${BATCH_NO}`;

  it("takes a weight", async () => {
    await assertSucceeds(patch(who.kitchen, path, { weightRaw: 12.4 }));
  });

  it("takes weights and costs together", async () => {
    await assertSucceeds(
      patch(who.kitchen, path, {
        weightRaw: 12.4,
        weightCleaned: 9.1,
        weightCooked: 7.6,
        costs: { jarsLids: 120000, boxInserts: 0, labelling: 0, gasPower: 0 },
        updatedAt: serverTimestamp(),
        updatedBy: KITCHEN_UID,
      }),
    );
  });

  it("takes the sourcing note and the three dates", async () => {
    await assertSucceeds(
      patch(who.kitchen, path, {
        source: "Beypore market",
        landedOn: "2026-09-01",
        cookedOn: "2026-09-02",
        packedOn: "2026-09-04",
      }),
    );
  });

  it("cannot touch paidCount", async () => {
    await assertFails(patch(who.kitchen, path, { paidCount: 99 }));
  });

  it("cannot touch state", async () => {
    await assertFails(patch(who.kitchen, path, { state: "bottled" }));
  });

  it("cannot smuggle a protected field in beside a legal one", async () => {
    await assertFails(patch(who.kitchen, path, { weightRaw: 12.4, heldJars: { "ord-9": { qty: 1 } } }));
    await assertFails(patch(who.kitchen, path, { weightRaw: 12.4, bottledJars: 22 }));
  });

  it("cannot set a price or the planned jars", async () => {
    await assertFails(patch(who.kitchen, path, { priceOpen: 1 }));
    await assertFails(patch(who.kitchen, path, { plannedJars: 40 }));
  });

  it("cannot create a batch: opening one is the Owner's", async () => {
    await assertFails(write(who.kitchen, "batches/002", { ...base, productSlug: "x" }));
  });

  it("cannot delete a batch", async () => {
    await assertFails(remove(who.kitchen, path));
  });
});

describe("a batch, from the Owner", () => {
  const path = `batches/${BATCH_NO}`;

  it("is created without the counts and the computed fields", async () => {
    await assertSucceeds(
      write(who.owner, "batches/002", {
        ...base,
        productSlug: "prawns-and-dates",
        recipeId: "rec-1",
        plannedJars: 22,
        priceOpen: 59900,
        priceInStock: 64900,
      }),
    );
  });

  it("is not created with a count or a state already on it", async () => {
    const body = { ...base, productSlug: "x", plannedJars: 22 };
    await assertFails(write(who.owner, "batches/003", { ...body, paidCount: 0 }));
    await assertFails(write(who.owner, "batches/004", { ...body, state: "draft" }));
    await assertFails(write(who.owner, "batches/005", { ...body, bookableJars: 19 }));
    await assertFails(write(who.owner, "batches/006", { ...body, heldJars: {} }));
  });

  it("takes a price change", async () => {
    await assertSucceeds(patch(who.owner, path, { priceOpen: 59900, priceInStock: 64900 }));
  });

  it("takes the kitchen fields too: the Owner does the kitchen's job on a bad day", async () => {
    await assertSucceeds(patch(who.owner, path, { weightRaw: 12.4, source: "Beypore" }));
  });

  it("refuses paidCount, state and heldJars, because a count is a transaction", async () => {
    await assertFails(patch(who.owner, path, { paidCount: 99 }));
    await assertFails(patch(who.owner, path, { state: "bottled" }));
    await assertFails(patch(who.owner, path, { heldJars: { "ord-9": { qty: 1 } } }));
    await assertFails(patch(who.owner, path, { bookableJars: 22 }));
    await assertFails(patch(who.owner, path, { pnl: { revenue: 1 } }));
    await assertFails(patch(who.owner, path, { bestBefore: "2030-01-01" }));
  });

  it("cannot delete a batch: numbers are never reused", async () => {
    await assertFails(remove(who.owner, path));
  });

  it("cannot write a batch that already carries a protected field, even unchanged", async () => {
    // A blind `setDoc` of the whole document counts as changing nothing, so it
    // is allowed. A `setDoc` that moves one count is not.
    await assertSucceeds(write(who.owner, path, BATCH_DOC));
    await assertFails(write(who.owner, path, { ...BATCH_DOC, paidCount: 4 }));
  });
});

describe("batch subcollections", () => {
  it("let both staff roles record ingredient actuals, and only the Owner remove one", async () => {
    await assertSucceeds(write(who.kitchen, `batches/${BATCH_NO}/lines/new-1`, { ...base, qtyActual: 2 }));
    await assertSucceeds(patch(who.kitchen, `batches/${BATCH_NO}/lines/l1`, { qtyActual: 3 }));
    await assertFails(remove(who.kitchen, `batches/${BATCH_NO}/lines/l1`));
    await assertSucceeds(remove(who.owner, `batches/${BATCH_NO}/lines/l1`));
    await assertFails(write(who.viewer, `batches/${BATCH_NO}/lines/new-2`, { ...base }));
  });

  it("let the Kitchen post a photo update but not approve it", async () => {
    await assertSucceeds(
      write(who.kitchen, `batches/${BATCH_NO}/updates/new-1`, {
        ...base,
        createdBy: KITCHEN_UID,
        photoPath: "batches/001/updates/new-1.jpg",
        kitchenLine: "In the pot.",
        approvedBy: null,
        sentAt: null,
      }),
    );
    await assertFails(
      write(who.kitchen, `batches/${BATCH_NO}/updates/new-2`, {
        ...base,
        createdBy: KITCHEN_UID,
        kitchenLine: "In the pot.",
        approvedBy: KITCHEN_UID,
      }),
    );
    await assertSucceeds(patch(who.owner, `batches/${BATCH_NO}/updates/${UPDATE_ID}`, { approvedBy: OWNER_UID }));
    await assertFails(patch(who.kitchen, `batches/${BATCH_NO}/updates/${UPDATE_ID}`, { approvedBy: KITCHEN_UID }));
  });

  it("let the Kitchen fix their own unapproved update, and nobody else's, and not an approved one", async () => {
    await assertSucceeds(
      patch(who.kitchen, `batches/${BATCH_NO}/updates/${UPDATE_ID}`, { kitchenLine: "Prawns are in, cleaned." }),
    );
    await assertFails(
      patch(who.kitchen, `batches/${BATCH_NO}/updates/approved-1`, { kitchenLine: "changed my mind" }),
    );
    await assertFails(
      patch(who.kitchen, `batches/${BATCH_NO}/updates/${UPDATE_ID}`, { messageText: "the whole message" }),
    );
  });

  it("let both staff roles write off a jar, and nobody edit it away", async () => {
    await assertSucceeds(
      write(who.kitchen, `batches/${BATCH_NO}/writeOffs/new-1`, { ...base, qty: 1, reason: "cracked" }),
    );
    await assertFails(patch(who.owner, `batches/${BATCH_NO}/writeOffs/w1`, { qty: 0 }));
    await assertFails(remove(who.owner, `batches/${BATCH_NO}/writeOffs/w1`));
  });
});

/* ── catalogue, customers, shipping, agent, system ───────────────────────── */

describe("the catalogue", () => {
  it("is the Owner's to change", async () => {
    await assertSucceeds(patch(who.owner, "products/prawns-and-dates", { priceInStock: 64900 }));
    await assertSucceeds(patch(who.owner, "ingredients/i1", { unitCost: 100 }));
    await assertSucceeds(patch(who.owner, "recipes/rec-1", { version: 2 }));
  });

  it("keeps products, and so prices, away from the Kitchen", async () => {
    await assertFails(patch(who.kitchen, "products/prawns-and-dates", { priceInStock: 1 }));
  });
});

/*
 * Question Q4, answered by Shefin: ingredients and recipes are the Owner's to
 * edit, the Kitchen reads all of them, and the Owner has a switch,
 * `settings/permissions.kitchenCanEditRecipes`, that lets the Kitchen create
 * and edit them too. Only a literal `true` turns it on. Every case below runs
 * in all four states of that switch, and each test sets the state it needs
 * itself and puts it back afterwards, so file order does not matter.
 */
describe("ingredients and recipes, and the Owner's Kitchen switch (Q4)", () => {
  const SWITCH_PATH = `${KITCHEN_RECIPE_EDIT_SWITCH.collection}/${KITCHEN_RECIPE_EDIT_SWITCH.doc}`;

  /** `undefined` means the switch document does not exist. */
  const SWITCH_STATES: ReadonlyArray<readonly [label: string, value: unknown, on: boolean]> = [
    ["missing", undefined, false],
    ["false", false, false],
    ['the string "true"', "true", false],
    ["true", true, true],
  ];

  const CATALOGUE = [
    ["ingredients", "ingredients/i1", { unitCost: 1 }],
    ["recipes", "recipes/rec-1", { version: 2 }],
  ] as const;

  async function setSwitch(value: unknown): Promise<void> {
    await env.withSecurityRulesDisabled(async (admin) => {
      const ref = doc(admin.firestore(), SWITCH_PATH);
      if (value === undefined) await deleteDoc(ref);
      else await setDoc(ref, { ...base, [KITCHEN_RECIPE_EDIT_SWITCH.field]: value });
    });
  }

  afterEach(async () => {
    await setSwitch(undefined);
  });

  const list = (ctx: RulesTestContext, name: string) => getDocs(collection(ctx.firestore(), name));

  for (const [label, value, on] of SWITCH_STATES) {
    describe(`with the switch ${label}`, () => {
      beforeEach(async () => {
        await setSwitch(value);
      });

      it("the Kitchen gets and lists every ingredient and recipe", async () => {
        for (const [name, path] of CATALOGUE) {
          await assertSucceeds(read(who.kitchen, path));
          await assertSucceeds(list(who.kitchen, name));
        }
      });

      it("the Viewer reads them and writes nothing", async () => {
        for (const [name, path, change] of CATALOGUE) {
          await assertSucceeds(read(who.viewer, path));
          await assertSucceeds(list(who.viewer, name));
          await assertFails(patch(who.viewer, path, change));
          await assertFails(write(who.viewer, `${name}/viewer-new`, { ...base, labelName: "no" }));
        }
      });

      it(`the Kitchen ${on ? "may" : "may not"} create and update them`, async () => {
        const expectation = on ? assertSucceeds : assertFails;
        for (const [name, path, change] of CATALOGUE) {
          await expectation(patch(who.kitchen, path, change));
          await expectation(write(who.kitchen, `${name}/kitchen-new`, { ...base, createdBy: KITCHEN_UID }));
        }
      });

      it("the Kitchen never deletes them", async () => {
        for (const [, path] of CATALOGUE) {
          await assertFails(remove(who.kitchen, path));
        }
      });

      it("the Owner creates, updates and deletes them", async () => {
        for (const [name, path, change] of CATALOGUE) {
          await assertSucceeds(write(who.owner, `${name}/owner-new`, { ...base }));
          await assertSucceeds(patch(who.owner, path, change));
          await assertSucceeds(remove(who.owner, path));
        }
      });

      it("a caller with no role, or nobody at all, neither reads nor writes them", async () => {
        for (const ctx of [who.noRole, who.unauth]) {
          for (const [name, path, change] of CATALOGUE) {
            await assertFails(read(ctx, path));
            await assertFails(list(ctx, name));
            await assertFails(patch(ctx, path, change));
            await assertFails(write(ctx, `${name}/stranger-new`, { ...base }));
            await assertFails(remove(ctx, path));
          }
        }
      });
    });
  }

  describe("the switch itself", () => {
    const flipOn = { ...base, [KITCHEN_RECIPE_EDIT_SWITCH.field]: true };

    it("cannot be created by the Kitchen or the Viewer", async () => {
      await setSwitch(undefined);
      await assertFails(write(who.kitchen, SWITCH_PATH, flipOn));
      await assertFails(write(who.viewer, SWITCH_PATH, flipOn));
    });

    it("cannot be flipped by the Kitchen or the Viewer, by set or by update", async () => {
      await setSwitch(false);
      for (const ctx of [who.kitchen, who.viewer]) {
        await assertFails(write(ctx, SWITCH_PATH, flipOn));
        await assertFails(patch(ctx, SWITCH_PATH, { [KITCHEN_RECIPE_EDIT_SWITCH.field]: true }));
        await assertFails(remove(ctx, SWITCH_PATH));
      }
      await assertFails(patch(who.kitchen, "ingredients/i1", { unitCost: 1 }));
    });

    it("is read by the Kitchen, so the admin can tell it what it may edit", async () => {
      await setSwitch(false);
      await assertSucceeds(read(who.kitchen, SWITCH_PATH));
    });

    it("is created and flipped by the Owner, and the Kitchen may then edit", async () => {
      await setSwitch(undefined);
      await assertSucceeds(write(who.owner, SWITCH_PATH, { ...base, [KITCHEN_RECIPE_EDIT_SWITCH.field]: false }));
      await assertFails(patch(who.kitchen, "recipes/rec-1", { version: 2 }));
      await assertSucceeds(patch(who.owner, SWITCH_PATH, { [KITCHEN_RECIPE_EDIT_SWITCH.field]: true }));
      await assertSucceeds(patch(who.kitchen, "recipes/rec-1", { version: 2 }));
    });

    it("is not public", async () => {
      await setSwitch(true);
      await assertFails(read(who.unauth, SWITCH_PATH));
      await assertFails(read(who.noRole, SWITCH_PATH));
      await assertFails(write(who.noRole, SWITCH_PATH, { ...base, [KITCHEN_RECIPE_EDIT_SWITCH.field]: false }));
    });
  });
});

describe("customers", () => {
  it("are edited by both staff roles: a name typed wrong, an address before packing", async () => {
    await assertSucceeds(patch(who.kitchen, `customers/${CUSTOMER_PHONE}`, { name: "Shefin M" }));
    await assertSucceeds(patch(who.owner, `customers/${CUSTOMER_PHONE}/addresses/a1`, { pincode: "673572" }));
    await assertSucceeds(
      write(who.kitchen, `customers/${CUSTOMER_PHONE}/addresses/new-1`, { ...base, pincode: "673571" }),
    );
  });

  it("are never deleted from a client: deletion is a function", async () => {
    await assertFails(remove(who.owner, `customers/${CUSTOMER_PHONE}`));
    await assertFails(remove(who.owner, `customers/${CUSTOMER_PHONE}/addresses/a1`));
  });

  it("are read-only for the Viewer", async () => {
    await assertFails(patch(who.viewer, `customers/${CUSTOMER_PHONE}`, { name: "no" }));
  });
});

describe("shipments", () => {
  it("take a packing cost from either staff role", async () => {
    await assertSucceeds(patch(who.kitchen, "shipments/sh-1", { packingCost: 4000 }));
    await assertSucceeds(patch(who.owner, "shipments/sh-1", { courierCost: 9000 }));
    await assertSucceeds(write(who.kitchen, "shipments/new-1", { ...base, orderId: ORDER_ID }));
  });

  it("keep the courier's own event trail off the client", async () => {
    await assertFails(write(who.owner, "shipments/sh-1/events/new-1", { ...base, status: "picked" }));
  });
});

describe("concerns and approvals", () => {
  it("are answered by the Owner alone", async () => {
    await assertSucceeds(patch(who.owner, "concerns/con-1", { answer: "refund" }));
    await assertSucceeds(patch(who.owner, "approvals/app-1", { status: "approved" }));
    await assertFails(patch(who.kitchen, "concerns/con-1", { answer: "refund" }));
    await assertFails(patch(who.kitchen, "approvals/app-1", { status: "approved" }));
    await assertFails(patch(who.viewer, "approvals/app-1", { status: "approved" }));
  });

  it("are raised by functions, not by a client", async () => {
    await assertFails(write(who.owner, "approvals/new-1", { ...base, kind: "broadcast" }));
    await assertFails(remove(who.owner, "concerns/con-1"));
  });
});

describe("conversations", () => {
  it("take no client write: every message goes through the WhatsApp function", async () => {
    await assertFails(patch(who.owner, `conversations/${CUSTOMER_PHONE}`, { summary: "x" }));
    await assertFails(
      write(who.owner, `conversations/${CUSTOMER_PHONE}/messages/new-1`, { ...base, body: "hi" }),
    );
  });
});

describe("settings", () => {
  it("are read by the Kitchen, because the counter needs the discount cap", async () => {
    await assertSucceeds(read(who.kitchen, "settings/discountCap"));
    await assertSucceeds(read(who.kitchen, "settings/pincodes"));
  });

  it("are changed by the Owner alone", async () => {
    await assertSucceeds(patch(who.owner, "settings/discountCap", { amount: 5000 }));
    await assertFails(patch(who.kitchen, "settings/discountCap", { amount: 500000 }));
    await assertFails(patch(who.viewer, "settings/discountCap", { amount: 500000 }));
  });
});

describe("users", () => {
  it("are read by the Owner, all of them: that is the users screen", async () => {
    await assertSucceeds(read(who.owner, `users/${OWNER_UID}`));
    await assertSucceeds(read(who.owner, `users/${KITCHEN_UID}`));
    await assertSucceeds(read(who.owner, `users/${VIEWER_UID}`));
  });

  it("are read by everyone else for themselves only", async () => {
    await assertSucceeds(read(who.kitchen, `users/${KITCHEN_UID}`));
    await assertFails(read(who.kitchen, `users/${OWNER_UID}`));
    await assertSucceeds(read(who.viewer, `users/${VIEWER_UID}`));
    await assertFails(read(who.viewer, `users/${KITCHEN_UID}`));
  });

  it("take no client write: a role is a custom claim set by setRole", async () => {
    for (const [, ctx] of everyRole(who)) {
      await assertFails(patch(ctx, `users/${OWNER_UID}`, { role: "owner" }));
      await assertFails(write(ctx, "users/new-1", { role: "owner", name: "me" }));
    }
  });
});

describe("a signed-in caller with no role claim", () => {
  it("reads their own users document and nothing else", async () => {
    await assertSucceeds(read(who.noRole, `users/${NO_ROLE_UID}`));
    for (const path of [
      `batches/${BATCH_NO}`,
      `orders/${ORDER_ID}`,
      `customers/${CUSTOMER_PHONE}`,
      `documents/${DOCUMENT_ID}`,
      "settings/discountCap",
      "notify/n1",
      "audit/aud-1",
      `users/${OWNER_UID}`,
    ]) {
      await assertFails(read(who.noRole, path));
    }
  });

  it("still gets config/site, which is public to the whole internet anyway", async () => {
    await assertSucceeds(read(who.noRole, "config/site"));
  });

  it("writes nothing", async () => {
    await assertFails(patch(who.noRole, `batches/${BATCH_NO}`, { weightRaw: 1 }));
    await assertFails(write(who.noRole, "audit/new-1", { ...base }));
  });
});

describe("the Viewer", () => {
  it("writes nothing, anywhere", async () => {
    await assertFails(patch(who.viewer, `batches/${BATCH_NO}`, { weightRaw: 1 }));
    await assertFails(patch(who.viewer, "products/prawns-and-dates", { name: "no" }));
    await assertFails(patch(who.viewer, `customers/${CUSTOMER_PHONE}`, { name: "no" }));
    await assertFails(patch(who.viewer, "shipments/sh-1", { packingCost: 1 }));
    await assertFails(
      write(who.viewer, "audit/new-1", { by: VIEWER_UID, at: serverTimestamp(), action: "read" }),
    );
  });
});

describe("the audit log", () => {
  it("takes an entry from either staff role, stamped by the caller and the server clock", async () => {
    await assertSucceeds(
      write(who.kitchen, "audit/new-1", {
        object: `batches/${BATCH_NO}`,
        action: "update",
        before: { weightRaw: null },
        after: { weightRaw: 12.4 },
        by: KITCHEN_UID,
        at: serverTimestamp(),
      }),
    );
  });

  it("refuses an entry pinned on somebody else", async () => {
    await assertFails(
      write(who.kitchen, "audit/new-2", {
        object: "x",
        action: "update",
        by: OWNER_UID,
        at: serverTimestamp(),
      }),
    );
  });

  it("refuses a backdated entry", async () => {
    await assertFails(
      write(who.kitchen, "audit/new-3", { object: "x", action: "update", by: KITCHEN_UID, at: now }),
    );
  });

  it("is append-only", async () => {
    await assertFails(patch(who.owner, "audit/aud-1", { action: "create" }));
    await assertFails(remove(who.owner, "audit/aud-1"));
  });
});

describe("policy versions", () => {
  it("are published by the Owner and read by everybody on the admin list", async () => {
    await assertSucceeds(write(who.owner, "policyVersions/new-1", { ...base, kind: "terms", text: "x" }));
    await assertFails(write(who.kitchen, "policyVersions/new-2", { ...base, kind: "terms", text: "x" }));
    await assertSucceeds(read(who.viewer, "policyVersions/p1"));
  });
});
