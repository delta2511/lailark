import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  addressLines,
  formatDate,
  formatMillis,
  jarWords,
  orderApiUrl,
  readOrderPayload,
  tokenFromPath,
} from "../lib/order.js";

const TOKEN = "0123456789abcdef0123456789abcdef";

test("the token is read off the path, and only a real one", () => {
  assert.equal(tokenFromPath(`/o/${TOKEN}`), TOKEN);
  assert.equal(tokenFromPath(`/o/${TOKEN}/`), TOKEN);
  assert.equal(tokenFromPath("/o/short"), null);
  assert.equal(tokenFromPath(`/o/${TOKEN.toUpperCase()}`), null);
  assert.equal(tokenFromPath(`/O/${TOKEN}`), null);
  assert.equal(tokenFromPath(`/o/${TOKEN}/extra`), null);
  assert.equal(tokenFromPath("/"), null);
  assert.equal(tokenFromPath(null), null);
});

test("the endpoint is built only for a real token", () => {
  assert.equal(orderApiUrl(TOKEN), `/api/order/${TOKEN}`);
  assert.equal(orderApiUrl("../counts"), null);
});

test("a payload with no order in it is refused outright", () => {
  assert.equal(readOrderPayload(null), null);
  assert.equal(readOrderPayload({}), null);
  assert.equal(readOrderPayload({ order: { number: "" } }), null);
});

test("a whole order reads through, with every figure kept in paise", () => {
  const out = readOrderPayload({
    order: {
      number: "o-7f3a2c",
      placedOnMillis: Date.UTC(2026, 8, 4, 6, 0),
      lines: [
        {
          description: "Prawns and dates",
          qty: 2,
          unitPricePaise: 59_900,
          batchNo: "003",
          jarNumbers: [9, 10],
        },
      ],
      shippingFeePaise: 0,
      totalPaise: 119_800,
      delivery: {
        name: "Asha",
        lines: ["12 Mill Road", ""],
        city: "Kozhikode",
        state: "KL",
        pincode: "673571",
      },
    },
    documents: [
      { kind: "receipt", number: "LK/26-27/0004", issuedOn: "2026-09-04", totalPaise: 119_800, url: "https://example.test/x.pdf" },
    ],
  });
  assert.equal(out.number, "o-7f3a2c");
  assert.equal(out.totalPaise, 119_800);
  assert.equal(out.lines.length, 1);
  assert.deepEqual(out.lines[0].jarNumbers, [9, 10]);
  assert.equal(out.lines[0].batchNo, "003");
  assert.equal(out.documents.length, 1);
  assert.equal(out.documents[0].number, "LK/26-27/0004");
  assert.deepEqual(addressLines(out.delivery), [
    "Asha",
    "12 Mill Road",
    "Kozhikode, KL, 673571",
  ]);
});

test("a figure that is not a whole number of paise becomes null, never a zero", () => {
  const out = readOrderPayload({
    order: {
      number: "o-1",
      lines: [{ description: "x", qty: 1, unitPricePaise: "649", jarNumbers: null }],
      totalPaise: 64_900.5,
      shippingFeePaise: undefined,
    },
  });
  assert.equal(out.totalPaise, null);
  assert.equal(out.shippingFeePaise, null);
  assert.equal(out.lines[0].unitPricePaise, null);
  assert.deepEqual(out.lines[0].jarNumbers, []);
});

test("a line with no jars in it is dropped rather than drawn as nothing", () => {
  const out = readOrderPayload({
    order: { number: "o-1", lines: [{ description: "x", qty: 0 }, { description: "y", qty: 1 }] },
  });
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].description, "y");
});

test("jars and dates are spelled the way the rest of the site spells them", () => {
  assert.equal(jarWords(1), "1 jar");
  assert.equal(jarWords(3), "3 jars");
  assert.equal(formatDate("2026-09-04"), "4 Sep 2026");
  assert.equal(formatDate("nope"), null);
  assert.equal(formatMillis(Date.UTC(2026, 8, 4, 6, 0)), "4 Sep 2026");
  assert.equal(formatMillis(null), null);
});

test("the test server's rewrites are the ones Hosting actually has", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const config = JSON.parse(readFileSync(join(root, "firebase.json"), "utf8"));
  const customer = config.hosting.find((h) => h.target === "customer");
  const rule = customer.rewrites.find((r) => r.source === "/o/**");
  assert.ok(rule, "firebase.json must rewrite /o/** for the private order page");
  assert.equal(rule.destination, "/o.html");

  const server = readFileSync(join(root, "site", "scripts", "serve-out.mjs"), "utf8");
  assert.ok(
    server.includes('prefix: "/o/", file: "o.html"'),
    "serve-out.mjs must mirror the /o/** rewrite",
  );

  // A private page must never be cached anywhere, and must never be indexed.
  //
  // The glob has to cover the bare `/o` as well as `/o/<token>`: `/o/**` does
  // not match `/o`, so the page itself, `/o.html` and Next's `/o.txt` used to
  // fall through to the site-wide `no-cache` with no `X-Robots-Tag` at all,
  // which left the one indexable spelling of a private page indexable (M3.8
  // round 2). Brace expansion covers all four spellings in one source: `/o`,
  // `/o.html`, `/o.txt` and `/o/<anything>`. Checked against the hosting
  // emulator, not only asserted here.
  const headers = customer.headers.find((h) => h.source.startsWith("/o"));
  assert.ok(headers, "/o must carry its own headers");
  assert.equal(headers.source, "/o{,.html,.txt,/**}");
  assert.equal(
    headers.headers.find((h) => h.key === "Cache-Control")?.value,
    "no-store",
  );
  assert.equal(
    headers.headers.find((h) => h.key === "X-Robots-Tag")?.value,
    "noindex, nofollow",
  );
});

test("the order page's copy carries no leftover markers and no em dash", async () => {
  // D63 approved every string as drafted, so nothing here is still waiting
  // on an answer.
  const { ORDER_PAGE_COPY, documentKindWords } = await import("../lib/orderCopy.js");
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "orderCopy.js"),
    "utf8",
  );
  assert.ok(!source.includes("TODO("), "no TODO markers are left in the order page's copy");
  assert.ok(source.includes("D63"), "the copy cites the decision that approved it");

  const everything = JSON.stringify(ORDER_PAGE_COPY);
  assert.ok(!everything.includes("\u2014"), "no em dash in anything a customer reads");
  // D63: the order's state is deliberately not on this page.
  assert.ok(!everything.toLowerCase().includes("paidwaiting"));

  // A kind this page has no word for never prints the internal id.
  assert.equal(documentKindWords("receipt"), "Receipt");
  assert.equal(documentKindWords("refundNote"), "Refund note");
  assert.equal(documentKindWords("somethingNew"), "Document");
  assert.equal(documentKindWords("toString"), "Document");
  assert.equal(documentKindWords(undefined), "Document");
});

test("a document link is only ever drawn when it is https", async () => {
  const { safeDocumentUrl } = await import("../lib/order.js");
  assert.equal(safeDocumentUrl("https://example.test/x.pdf"), "https://example.test/x.pdf");
  assert.equal(safeDocumentUrl("http://example.test/x.pdf"), null);
  assert.equal(safeDocumentUrl("javascript:alert(1)"), null);
  assert.equal(safeDocumentUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(safeDocumentUrl("/o/whatever"), null);
  assert.equal(safeDocumentUrl(""), null);
  assert.equal(safeDocumentUrl(null), null);

  const out = readOrderPayload({
    order: { number: "o-1", lines: [{ description: "x", qty: 1 }] },
    documents: [
      { kind: "receipt", number: "A", url: "javascript:alert(1)" },
      { kind: "receipt", number: "B", url: "https://example.test/b.pdf" },
    ],
  });
  assert.equal(out.documents.find((d) => d.number === "A").url, null);
  assert.equal(out.documents.find((d) => d.number === "B").url, "https://example.test/b.pdf");
});

test("the endpoint's internal vocabulary is not read, even when it is sent", () => {
  // `/api/order/<token>` stopped sending state, channel, paymentStatus and
  // paymentMethod (M3.8 round 2, D63). The page never reads them either, so
  // an older deploy of the function cannot put one on the page.
  const out = readOrderPayload({
    order: {
      number: "o-1",
      state: "paidWaiting",
      channel: "web",
      paymentStatus: "captured",
      paymentMethod: "razorpay",
      lines: [{ description: "Prawns and dates", qty: 1, unitPricePaise: 59_900 }],
      totalPaise: 59_900,
    },
  });
  assert.equal(out.state, undefined);
  assert.equal(out.channel, undefined);
  assert.equal(out.paymentStatus, undefined);
  assert.equal(out.paymentMethod, undefined);
  assert.equal(out.lines[0].description, "Prawns and dates");
});
