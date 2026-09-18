/**
 * `storage.rules`. Nothing in the bucket is public, bills are Money, photos
 * are staff, and an upload is an image under 8 MB or it is refused.
 *
 * Reads are tested with `getMetadata`, and every object a read test touches is
 * seeded first with the rules switched off. That matters: a *permitted* read
 * of an object that does not exist fails with `storage/object-not-found`,
 * which `assertSucceeds` would report as a failure, and a denied read of a
 * missing object fails with `storage/unauthorized` before the emulator ever
 * looks for the bytes. Seeding keeps the two apart, so a passing test means
 * what it says.
 */

import { getMetadata, ref, uploadBytes } from "firebase/storage";
import type { RulesTestContext, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { callers, type Callers, everyRole, makeTestEnvironment } from "./env.js";

let env: RulesTestEnvironment;
let who: Callers;

const BILL = "documents/LK-26-27-0001.pdf";
const LABEL = "shipments/sh-1/label.pdf";
const EXPORT = "exports/2026-09.csv";
const PHOTO = "batches/001/updates/seeded.jpg";
const PRODUCT_IMAGE = "products/prawns-and-dates/hero.jpg";

const jpeg = () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]), type: "image/jpeg" });

const readAt = (ctx: RulesTestContext, path: string) => getMetadata(ref(ctx.storage(), path));

const put = (ctx: RulesTestContext, path: string, bytes: Uint8Array, contentType: string) =>
  uploadBytes(ref(ctx.storage(), path), bytes, { contentType });

const putJpeg = (ctx: RulesTestContext, path: string) => {
  const { bytes, type } = jpeg();
  return put(ctx, path, bytes, type);
};

beforeAll(async () => {
  env = await makeTestEnvironment();
  who = callers(env);
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (admin) => {
    const bucket = admin.storage();
    const { bytes, type } = jpeg();
    await uploadBytes(ref(bucket, BILL), new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
    await uploadBytes(ref(bucket, LABEL), new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
    await uploadBytes(ref(bucket, EXPORT), new Uint8Array([1, 2, 3]), { contentType: "text/csv" });
    await uploadBytes(ref(bucket, PHOTO), bytes, { contentType: type });
    await uploadBytes(ref(bucket, PRODUCT_IMAGE), bytes, { contentType: type });
  });
});

describe("the public internet", () => {
  it("reads nothing in the bucket, not even a jar photo", async () => {
    for (const path of [PHOTO, PRODUCT_IMAGE, BILL, LABEL, EXPORT]) {
      await assertFails(readAt(who.unauth, path));
    }
  });

  it("uploads nothing", async () => {
    await assertFails(putJpeg(who.unauth, "batches/001/updates/hacked.jpg"));
    await assertFails(putJpeg(who.unauth, "anywhere/else.jpg"));
  });

  it("is what a signed-in caller with no role claim gets too", async () => {
    await assertFails(readAt(who.noRole, PHOTO));
    await assertFails(putJpeg(who.noRole, "batches/001/updates/x.jpg"));
  });
});

describe("batch photos", () => {
  it("are uploaded by the Kitchen", async () => {
    await assertSucceeds(putJpeg(who.kitchen, "batches/001/updates/x.jpg"));
  });

  it("are uploaded by the Owner", async () => {
    await assertSucceeds(putJpeg(who.owner, "batches/001/updates/y.jpg"));
  });

  it("are read by all three roles", async () => {
    await assertSucceeds(readAt(who.owner, PHOTO));
    await assertSucceeds(readAt(who.kitchen, PHOTO));
    await assertSucceeds(readAt(who.viewer, PHOTO));
  });

  it("are not uploaded by the Viewer, who is read-only everywhere", async () => {
    await assertFails(putJpeg(who.viewer, "batches/001/updates/z.jpg"));
  });

  it("must be an image: a text file is refused", async () => {
    await assertFails(
      put(who.kitchen, "batches/001/updates/notes.txt", new Uint8Array([104, 105]), "text/plain"),
    );
  });

  it("must be under 8 MB: a 9 MB upload is refused", async () => {
    const nineMegabytes = new Uint8Array(9 * 1024 * 1024);
    await assertFails(put(who.kitchen, "batches/001/updates/huge.jpg", nineMegabytes, "image/jpeg"));
  });
});

describe("bills and receipts", () => {
  it("are read by the Owner and the Viewer, the two who see Money", async () => {
    await assertSucceeds(readAt(who.owner, BILL));
    await assertSucceeds(readAt(who.viewer, BILL));
  });

  it("are not read by the Kitchen", async () => {
    await assertFails(readAt(who.kitchen, BILL));
  });

  it("are written by the server and nobody else", async () => {
    for (const [, ctx] of everyRole(who)) {
      await assertFails(put(ctx, "documents/x.pdf", new Uint8Array([1]), "application/pdf"));
      await assertFails(putJpeg(ctx, "documents/x.jpg"));
    }
  });
});

describe("courier labels", () => {
  it("are read by whoever is packing, and not by the Viewer", async () => {
    await assertSucceeds(readAt(who.owner, LABEL));
    await assertSucceeds(readAt(who.kitchen, LABEL));
    await assertFails(readAt(who.viewer, LABEL));
  });

  it("come from Shiprocket through a function, never from a client", async () => {
    for (const [, ctx] of everyRole(who)) {
      await assertFails(put(ctx, "shipments/sh-1/label.pdf", new Uint8Array([1]), "application/pdf"));
    }
  });
});

describe("exports", () => {
  it("are read by the Owner and the Viewer, and written by the server", async () => {
    await assertSucceeds(readAt(who.owner, EXPORT));
    await assertSucceeds(readAt(who.viewer, EXPORT));
    await assertFails(readAt(who.kitchen, EXPORT));
    await assertFails(put(who.owner, "exports/x.csv", new Uint8Array([1]), "text/csv"));
  });
});

describe("catalogue images", () => {
  it("are the Owner's to upload", async () => {
    await assertSucceeds(putJpeg(who.owner, "products/prawns-and-dates/second.jpg"));
    await assertFails(putJpeg(who.kitchen, "products/prawns-and-dates/second.jpg"));
    await assertSucceeds(readAt(who.kitchen, PRODUCT_IMAGE));
  });
});

describe("any other path", () => {
  it("is denied to everybody, in both directions", async () => {
    for (const [, ctx] of everyRole(who)) {
      await assertFails(readAt(ctx, "somewhere/else.jpg"));
      await assertFails(putJpeg(ctx, "somewhere/else.jpg"));
    }
  });
});
