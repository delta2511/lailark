/**
 * Documents and numbering, against the emulators: the real callables over
 * real HTTP, real transactions, a real `counters/{series}` document and a
 * real PDF in a real bucket.
 *
 * The one that matters most is two sellers at the same moment: the numbers
 * they get are `0001` and `0002`, never the same one twice, and never a hole.
 * Everything else here is a line of brief 13 checked where it is enforced,
 * which is the server.
 *
 * The 1 April reset is a fake-clock test and lives in
 * `src/money/numbering.test.ts`, because the emulator's clock is the
 * machine's and cannot be moved.
 */

import { PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE, toDocumentId } from "@lailark/shared";
import { beforeAll, describe, expect, it } from "vitest";

import {
  batchDoc,
  callFunction,
  clearFirestore,
  db,
  mustTransition,
  setPaidCount,
  waitFor,
  waitForState,
} from "./emulator";

const PRODUCT = "prawns-pickle";
const ASHA = "+919000001111";
const RAVI = "+919000002222";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

async function seedProduct() {
  await db().collection("products").doc(PRODUCT).set({
    name: "Prawns and dates",
    type: "hero",
    veg: false,
    hsn: "16052900",
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

async function seedCustomer(phone: string, name: string) {
  await db()
    .collection("customers")
    .doc(phone)
    .set({
      name,
      email: null,
      country: "IN",
      consents: {
        updates: { given: false, at: null, by: null },
        marketing: { given: false, at: null, by: null },
      },
      shareCode: null,
      stats: { orders: 0, jars: 0, lastOrderAt: null },
      createdAt: new Date(),
      createdBy: "seed",
      updatedAt: new Date(),
      updatedBy: "seed",
    });
}

async function inStockBatch(jarCount = 22): Promise<string> {
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
  const ref: string = created.ref;
  await mustTransition("owner", { ref, to: "open", data: {} });
  await setPaidCount(ref, 10);
  await waitForState(ref, "halfReached");
  await mustTransition("owner", { ref, to: "sourcing", data: {} });
  await mustTransition("kitchen", {
    ref,
    to: "cooking",
    data: { landedOn: "2026-09-01", source: "Beypore", weightRaw: 12_000, costRaw: 480_000 },
  });
  await mustTransition("kitchen", {
    ref,
    to: "bottled",
    data: { weightCleaned: 9_000, weightCooked: 7_000, jarCount, packedOn: "2026-09-04" },
  });
  await waitForState(ref, "inStock", "bottled", "soldOut");
  await db().collection("batches").doc(ref).update({ paidCount: 0, heldJars: {} });
  return ref;
}

function saleData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerPhone: ASHA,
    customerName: "Asha",
    confirmNewCustomer: false,
    line: { kind: "product", productSlug: PRODUCT, batchRef: null, qty: 1 },
    discountPaise: 0,
    discountReason: "",
    fulfilment: "handedOver",
    paymentMethod: "cash",
    consents: { updates: true, marketing: false },
    expectedTotalPaise: PRICE_IN_STOCK_PAISE,
    ...overrides,
  };
}

async function sell(who: "owner" | "kitchen", overrides: Record<string, unknown> = {}) {
  const out = await callFunction("createCounterSale", who, saleData(overrides));
  if (!out.result) throw new Error(`sale failed: ${JSON.stringify(out.error)}`);
  return out.result;
}

async function documentDoc(number: string) {
  const snap = await db().collection("documents").doc(toDocumentId(number)).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

async function counterNext(series: string): Promise<number | null> {
  const snap = await db().collection("counters").doc(series).get();
  const next = snap.get("next");
  return typeof next === "number" ? next : null;
}

/** The financial year this test run falls in, so it reads its own numbers. */
function fyLabel(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() + 1 >= 4 ? y : y - 1;
  const two = (value: number) => String(value % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
}

const FY = fyLabel();

/* -------------------------------------------------------------------------- */

describe("a counter sale is given a bill at save", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
  });

  it("issues LK/<fy>/0001 and writes the document in the same commit", async () => {
    await inStockBatch();
    const sale = await sell("kitchen");

    expect(sale.billNumber).toBe(`LK/${FY}/0001`);

    const order = (await db().collection("orders").doc(sale.orderId).get()).data();
    expect(order?.billNumber).toBe(`LK/${FY}/0001`);

    const doc = await documentDoc(sale.billNumber);
    expect(doc).not.toBeNull();
    expect(doc?.kind).toBe("bill");
    expect(doc?.orderId).toBe(sale.orderId);
    expect(doc?.total).toBe(PRICE_IN_STOCK_PAISE);
    expect(await counterNext(`LK-${FY}`)).toBe(2);
  });

  it("writes the GST fields at zero and carries the HSN (D26)", async () => {
    const doc = await documentDoc(`LK/${FY}/0001`);
    expect(doc?.cgst).toBe(0);
    expect(doc?.sgst).toBe(0);
    expect(doc?.igst).toBe(0);
    expect(doc?.taxable).toBe(PRICE_IN_STOCK_PAISE);
    expect(doc?.gstEnabled).toBe(false);
    const lines = doc?.lines as Array<Record<string, unknown>>;
    expect(lines[0].hsn).toBe("16052900");
    expect(lines[0].batchNo).toBe("001");
  });

  it("freezes the seller block and the customer onto it (13.2)", async () => {
    const doc = await documentDoc(`LK/${FY}/0001`);
    const seller = doc?.seller as Record<string, unknown>;
    expect(seller.name).toBe("Lailark Kitchen");
    expect(seller.fssai).toBe("FSSAI Lic. No. 21323244000035");
    expect(seller.gstin).toBeNull();
    expect((doc?.customer as Record<string, unknown>).phone).toBe(ASHA);
    expect(doc?.deliveryText).toBe("Handed over at Kunnamangalam");
    expect(doc?.placeOfSupply).toBe("KL");
    expect(doc?.channel).toBe("counter");
  });

  it("gives an unpaid payment link no number at all", async () => {
    const sale = await sell("owner", {
      customerPhone: ASHA,
      paymentMethod: "paymentLink",
    });
    expect(sale.billNumber).toBeNull();
    // And the series has not moved, so no number is spent on a jar that may
    // come back.
    expect(await counterNext(`LK-${FY}`)).toBe(2);
  });
});

describe("two sellers at the same moment", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    await seedCustomer(RAVI, "Ravi");
  });

  it("never issues one number twice, and leaves no hole", async () => {
    await inStockBatch();

    const [a, b, c] = await Promise.all([
      sell("owner", { customerPhone: ASHA }),
      sell("kitchen", { customerPhone: RAVI }),
      sell("owner", { customerPhone: ASHA }),
    ]);

    const numbers = [a.billNumber, b.billNumber, c.billNumber].sort();
    expect(numbers).toEqual([`LK/${FY}/0001`, `LK/${FY}/0002`, `LK/${FY}/0003`]);
    expect(new Set(numbers).size).toBe(3);
    expect(await counterNext(`LK-${FY}`)).toBe(4);

    const found = await db().collection("documents").get();
    expect(found.size).toBe(3);
  });
});

describe("the bill a person can open, D35", () => {
  let orderId = "";
  let billNumber = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    await inStockBatch();
    const sale = await sell("kitchen");
    orderId = sale.orderId;
    billNumber = sale.billNumber;
  });

  it("the trigger draws the page without anybody asking", async () => {
    const path = await waitFor(
      "the bill's PDF",
      async () => (await documentDoc(billNumber))?.pdfPath ?? null,
      (value) => typeof value === "string",
    );
    expect(path).toBe(`documents/${FY}/LK-${FY}-0001.pdf`);
  });

  it("hands the Kitchen a link to that one bill, and the link is a PDF", async () => {
    const out = await callFunction("billForOrder", "kitchen", { orderId });
    expect(out.error).toBeUndefined();
    expect(out.result.documentNumber).toBe(billNumber);
    expect(out.result.voided).toBe(false);
    // Against the emulator there is nothing to sign with, so the link is an
    // ordinary download URL and says so. Production signs.
    expect(out.result.signed).toBe(false);
    expect(out.result.expiresAtMillis).toBeGreaterThan(Date.now());

    const fetched = await fetch(out.result.url);
    expect(fetched.status).toBe(200);
    const bytes = Buffer.from(await fetched.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });

  it("lets the Owner and the Viewer open it too", async () => {
    for (const who of ["owner", "viewer"] as const) {
      const out = await callFunction("billForOrder", who, { orderId });
      expect(out.result?.documentNumber).toBe(billNumber);
    }
  });

  it("refuses a caller with no role, and one with no sign-in", async () => {
    const noRole = await callFunction("billForOrder", "noRole", { orderId });
    expect(noRole.error?.status).toBe("PERMISSION_DENIED");
    const nobody = await callFunction("billForOrder", null, { orderId });
    expect(nobody.error?.status).toBe("UNAUTHENTICATED");
  });

  it("says plainly when a sale has no bill yet", async () => {
    const unpaid = await sell("owner", { paymentMethod: "paymentLink" });
    const out = await callFunction("billForOrder", "kitchen", { orderId: unpaid.orderId });
    expect(out.error?.status).toBe("FAILED_PRECONDITION");
    expect(out.error?.message).toBe("There is no bill for this sale yet.");
  });

  it("refuses a reference that is not one", async () => {
    const out = await callFunction("billForOrder", "owner", { orderId: "nonsense" });
    expect(out.error?.status).toBe("INVALID_ARGUMENT");
  });
});

describe("a sale voided the same day, brief 13.3", () => {
  let orderId = "";
  let billNumber = "";
  let batchRef = "";

  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
    batchRef = await inStockBatch();
    const sale = await sell("kitchen");
    orderId = sale.orderId;
    billNumber = sale.billNumber;
    await waitFor(
      "the bill's first PDF",
      async () => (await documentDoc(billNumber))?.pdfPath ?? null,
      (value) => typeof value === "string",
    );
  });

  it("keeps the number, and marks the document void", async () => {
    const out = await callFunction("voidCounterSale", "kitchen", {
      orderId,
      reason: "entered on the wrong customer",
    });
    expect(out.error).toBeUndefined();
    expect(out.result.billNumber).toBe(billNumber);

    const doc = await documentDoc(billNumber);
    expect(doc).not.toBeNull();
    expect((doc?.voided as Record<string, unknown>).reason).toBe("entered on the wrong customer");
    expect(doc?.cancelledBy).toBeTruthy();
  });

  it("does not wind the counter back, so the next bill is 0002", async () => {
    expect(await counterNext(`LK-${FY}`)).toBe(2);
    const next = await sell("owner");
    expect(next.billNumber).toBe(`LK/${FY}/0002`);
  });

  it("puts the jar back on the batch all the same", async () => {
    const batch = await batchDoc(batchRef);
    // One sale voided, one fresh sale above: the net is one jar gone.
    expect(batch.paidCount).toBe(1);
  });

  it("draws the page again, with the void mark on it", async () => {
    const path = await waitFor(
      "the voided bill's PDF",
      async () => (await documentDoc(billNumber))?.pdfPath ?? null,
      (value) => typeof value === "string",
    );
    const out = await callFunction("billForOrder", "owner", { orderId });
    expect(out.result.voided).toBe(true);
    const fetched = await fetch(out.result.url);
    expect(fetched.status).toBe(200);
    expect(path).toBe(`documents/${FY}/LK-${FY}-0001.pdf`);
  });
});

/* -------------------------------------------------------------------------- */
/* When the bill an order names cannot be marked                              */
/* -------------------------------------------------------------------------- */

describe("a void whose bill cannot be found", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
  });

  /**
   * Both halves of this used to be silent. A well-formed number with nothing
   * behind it **created** a ghost document, which wedged the series for good
   * and crashed the render trigger; an unreadable number was skipped with a
   * comment saying the trail would show it, and the trail showed nothing.
   */
  async function voidWithBillNumber(billNumber: string) {
    const batchRef = await inStockBatch();
    const sale = await sell("kitchen", { paymentMethod: "paymentLink" });
    // A payment link has no bill of its own (D36), so this is the clean way
    // to put a number on an order with nothing behind it.
    await db().collection("orders").doc(sale.orderId).update({ billNumber });
    const out = await callFunction("voidCounterSale", "kitchen", {
      orderId: sale.orderId,
      reason: "entered on the wrong customer",
    });
    return { out, orderId: sale.orderId, batchRef };
  }

  it("voids the sale, returns the jar, and raises a concern instead of writing a ghost", async () => {
    const ghost = `LK/${FY}/0009`;
    const { out, orderId, batchRef } = await voidWithBillNumber(ghost);

    expect(out.error).toBeUndefined();
    expect(out.result.state).toBe("voided");
    expect(out.result.billNumber).toBe(ghost);
    expect(out.result.billMarkedVoid).toBe(false);
    expect(out.result.jarsReturned).toBe(1);

    // The jar really went back.
    expect((await batchDoc(batchRef)).heldJars).toEqual({});

    // Nothing was created at that id. This is the one that mattered: a row
    // there would make every later sale's `tx.create` fail for good.
    expect(await documentDoc(ghost)).toBeNull();

    // And the skip is visible, to the Owner and in the trail.
    const concern = (await db().collection("concerns").doc(`bill-not-voided-${orderId}`).get()).data();
    expect(concern?.type).toBe("technicalFailure");
    expect(concern?.urgent).toBe(true);
    expect(concern?.orderId).toBe(orderId);
    expect(String(concern?.summary)).toContain(ghost);
    // Nothing is drafted or sent to a customer.
    expect(concern?.draftMessage).toBeNull();
    expect(concern?.sentAt).toBeNull();

    const trail = await db()
      .collection("audit")
      .where("object", "==", `concerns/bill-not-voided-${orderId}`)
      .get();
    expect(trail.size).toBe(1);
    expect(trail.docs[0].get("action")).toBe("billNotVoided");
  });

  it("leaves the series usable: the next sale takes the next number", async () => {
    await inStockBatch();
    const next = await sell("owner");
    expect(next.billNumber).toMatch(new RegExp(`^LK/${FY}/\\d{4}$`));
    const doc = await documentDoc(next.billNumber);
    expect(doc?.kind).toBe("bill");
  });

  it("does the same for a bill number that cannot be read at all", async () => {
    const { out, orderId } = await voidWithBillNumber("not a bill number");

    expect(out.error).toBeUndefined();
    expect(out.result.billMarkedVoid).toBe(false);
    expect(out.result.jarsReturned).toBe(1);

    const concern = (await db().collection("concerns").doc(`bill-not-voided-${orderId}`).get()).data();
    expect(concern?.type).toBe("technicalFailure");
    expect(String(concern?.summary)).toContain("cannot be read");
  });
});

describe("GST switched on before the tax exists", () => {
  beforeAll(async () => {
    await clearFirestore();
    await seedProduct();
    await seedCustomer(ASHA, "Asha");
  });

  it("refuses the sale with a sentence, not a bare INTERNAL (A96)", async () => {
    await inStockBatch();
    await db().collection("settings").doc("gst").set({ enabled: true, homeState: "KL" }, { merge: true });

    const out = await callFunction("createCounterSale", "kitchen", saleData());
    expect(out.error?.status).toBe("FAILED_PRECONDITION");
    expect(out.error?.message).toBe(
      "GST is switched on in Settings, but bills cannot work out the tax yet, so nothing can be sold. Ask Shefin to switch GST back off.",
    );

    await db().collection("settings").doc("gst").set({ enabled: false, homeState: "KL" }, { merge: true });
  });
});
