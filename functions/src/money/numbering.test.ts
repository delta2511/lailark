/**
 * The number allocator, on a fake Firestore and a fake clock.
 *
 * Two claims are checked here, because both are claims about time rather
 * than about contention (the real two-caller race is in
 * `functions/test/documents.test.ts`, against the emulator):
 *
 *  1. the first document of a financial year finds no counter and starts at
 *     1, without anything having to run on 1 April;
 *  2. **the series resets on 1 April, in Asia/Kolkata.** The clock is moved
 *     across the boundary and the next number is `LK/27-28/0001`, while the
 *     26-27 counter is left exactly where it was, so a bill dated in March
 *     still takes the next 26-27 number.
 *
 * The 1 April crossing is driven by `nowMillis` through `readIssue`, which is
 * the real path a callable takes, so what is faked is the clock and nothing
 * else.
 */

import { DEFAULT_DOCUMENT_PREFIXES } from "@lailark/shared";
import { describe, expect, it } from "vitest";

import { DEFAULT_SELLER } from "./copy";
import { type DocumentContext, isRenderable, issueDocument, readIssue } from "./issue";
import type { DocumentSource } from "./plan";

/* -------------------------------------------------------------------------- */
/* A Firestore small enough to hold in the head                               */
/* -------------------------------------------------------------------------- */

interface FakeRef {
  readonly path: string;
  readonly id: string;
}

class FakeStore {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly created: string[] = [];

  db = {
    collection: (name: string) => ({
      doc: (id?: string): FakeRef => {
        const key = id ?? `auto-${this.docs.size}-${Math.random()}`;
        return { path: `${name}/${key}`, id: key };
      },
    }),
  };

  tx = {
    get: async (ref: FakeRef) => {
      const data = this.docs.get(ref.path);
      return {
        exists: data !== undefined,
        id: ref.id,
        data: () => data,
        get: (field: string) => data?.[field],
      };
    },
    create: (ref: FakeRef, body: Record<string, unknown>) => {
      if (this.docs.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
      this.docs.set(ref.path, body);
      this.created.push(ref.path);
    },
    set: (ref: FakeRef, body: Record<string, unknown>) => {
      this.docs.set(ref.path, { ...(this.docs.get(ref.path) ?? {}), ...body });
    },
  };
}

const CONTEXT: DocumentContext = {
  prefixes: DEFAULT_DOCUMENT_PREFIXES,
  seller: DEFAULT_SELLER,
  gst: { enabled: false, gstin: null, homeState: "KL" },
};

function source(orderId: string): DocumentSource {
  return {
    orderId,
    channel: "counter",
    customerName: "Asha",
    customerPhone: "+919000001111",
    customerEmail: null,
    deliveryLines: [],
    placeOfSupply: "KL",
    lines: [
      {
        description: "Prawns and dates",
        hsn: "16052900",
        qty: 1,
        unitPrice: 64_900,
        batchNo: "001",
        jarNumbers: [],
      },
    ],
    shippingFee: 0,
    discount: 0,
    discountReason: null,
    paymentMethod: "cash",
    paymentStatus: "captured",
    paymentReference: null,
  };
}

/** One whole issue, the way a callable does it: read, then write. */
async function issueBill(store: FakeStore, nowMillis: number, orderId: string): Promise<string> {
  const serial = await readIssue(
    store.tx as never,
    store.db as never,
    "bill",
    nowMillis,
    CONTEXT,
  );
  issueDocument(
    store.tx as never,
    store.db as never,
    serial,
    { source: source(orderId), context: CONTEXT, nowMillis },
    "uid-owner",
  );
  return serial.number;
}

/** Asia/Kolkata is UTC+5:30, so the epoch millis are worked back from that. */
function ist(y: number, m: number, d: number, hour = 12, minute = 0): number {
  return Date.UTC(y, m - 1, d, hour, minute) - 330 * 60_000;
}

/* -------------------------------------------------------------------------- */

describe("the first number of a series", () => {
  it("starts at 0001 with no counter document at all", async () => {
    const store = new FakeStore();
    expect(await issueBill(store, ist(2026, 9, 23), "o-000001")).toBe("LK/26-27/0001");
    expect(store.docs.get("counters/LK-26-27")?.next).toBe(2);
    // The document and one audit entry, created in the same commit.
    expect(store.created[0]).toBe("documents/LK-26-27-0001");
    expect(store.created.filter((path) => path.startsWith("audit/"))).toHaveLength(1);
  });

  it("makes the document id the number itself, so it cannot be issued twice", async () => {
    const store = new FakeStore();
    await issueBill(store, ist(2026, 9, 23), "o-000001");
    expect(store.docs.has("documents/LK-26-27-0001")).toBe(true);
    expect(store.docs.get("documents/LK-26-27-0001")?.number).toBe("LK/26-27/0001");
  });

  it("counts on, one at a time", async () => {
    const store = new FakeStore();
    const numbers: string[] = [];
    for (let i = 1; i <= 9; i += 1) {
      numbers.push(await issueBill(store, ist(2026, 12, 1), `o-00000${i}`));
    }
    expect(numbers).toEqual([
      "LK/26-27/0001",
      "LK/26-27/0002",
      "LK/26-27/0003",
      "LK/26-27/0004",
      "LK/26-27/0005",
      "LK/26-27/0006",
      "LK/26-27/0007",
      "LK/26-27/0008",
      "LK/26-27/0009",
    ]);
  });
});

describe("the series resets on 1 April", () => {
  it("carries on through 31 March and starts again on 1 April", async () => {
    const store = new FakeStore();
    for (let i = 1; i <= 9; i += 1) {
      await issueBill(store, ist(2026, 12, 1), `o-00000${i}`);
    }
    expect(store.docs.get("counters/LK-26-27")?.next).toBe(10);

    // Still the old year at the last moment of 31 March, Kolkata time.
    expect(await issueBill(store, ist(2027, 3, 31, 23, 59), "o-0000aa")).toBe("LK/26-27/0010");

    // Half past midnight on 1 April is 19:00 on 31 March in UTC, so this is
    // also the test that the financial year is worked out in Asia/Kolkata and
    // not in the region the function happens to be running in.
    expect(await issueBill(store, ist(2027, 4, 1, 0, 30), "o-0000bb")).toBe("LK/27-28/0001");

    // The old counter is untouched, so a late March bill still gets 0012.
    expect(store.docs.get("counters/LK-26-27")?.next).toBe(11);
    expect(store.docs.get("counters/LK-27-28")?.next).toBe(2);

    expect(await issueBill(store, ist(2027, 3, 30), "o-0000cc")).toBe("LK/26-27/0011");
    expect(store.docs.get("counters/LK-27-28")?.next).toBe(2);
  });

  it("keeps the two series in separate documents", async () => {
    const store = new FakeStore();
    await issueBill(store, ist(2026, 6, 1), "o-0000dd");
    await issueBill(store, ist(2027, 6, 1), "o-0000ee");
    expect([...store.docs.keys()].filter((key) => key.startsWith("counters/")).sort()).toEqual([
      "counters/LK-26-27",
      "counters/LK-27-28",
    ]);
  });
});

describe("what may be drawn at all", () => {
  it("accepts a document that was really issued", async () => {
    const store = new FakeStore();
    await issueBill(store, ist(2026, 12, 1), "o-0000kk");
    expect(isRenderable(store.docs.get("documents/LK-26-27-0001"))).toBe(true);
  });

  it("refuses a row that got as far as having an id", () => {
    // What a blind `set(..., { merge: true })` on a void used to leave
    // behind: no kind, no number, no total, and a trigger that crashed on it.
    expect(isRenderable({ voided: { reason: "x" }, pdfPath: null })).toBe(false);
    expect(isRenderable({})).toBe(false);
    expect(isRenderable(null)).toBe(false);
    expect(isRenderable({ kind: "bill", number: "", total: 0, lines: [] })).toBe(false);
    expect(isRenderable({ kind: "invoice", number: "LK/26-27/0001", total: 0, lines: [] })).toBe(false);
  });
});

describe("the counter", () => {
  it("grows past 9999 rather than restarting or repadding (A26)", async () => {
    const store = new FakeStore();
    store.docs.set("counters/LK-26-27", { next: 9999 });
    expect(await issueBill(store, ist(2026, 12, 1), "o-0000ff")).toBe("LK/26-27/9999");
    expect(await issueBill(store, ist(2026, 12, 1), "o-0000gg")).toBe("LK/26-27/10000");
  });

  it("treats a missing or broken next as 1 rather than as zero", async () => {
    const store = new FakeStore();
    store.docs.set("counters/LK-26-27", { next: "nonsense" });
    expect(await issueBill(store, ist(2026, 12, 1), "o-0000hh")).toBe("LK/26-27/0001");
  });

  it("refuses to write the same number twice, even if the counter fell behind", async () => {
    const store = new FakeStore();
    await issueBill(store, ist(2026, 12, 1), "o-0000ii");
    store.docs.set("counters/LK-26-27", { next: 1 });
    await expect(issueBill(store, ist(2026, 12, 1), "o-0000jj")).rejects.toThrow(/already exists/);
  });
});
