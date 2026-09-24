import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { batchDescription, batchTitle, formatIngredients } from "../lib/batch.js";
import BatchContent from "../app/batch/[nnn]/BatchContent.js";

/**
 * M3.4: proves the `/batch/[nnn]` template is generic by rendering a second
 * batch from a fixture defined right here, not a file under
 * site/content/batches/ — batch 002 does not exist yet, and a real
 * /batch/002 URL must never ship with invented facts. This fixture's
 * ingredients carry percentages (D28: record pages show them from batch 002
 * on), so this is also the one place that proves the percent branch of
 * formatIngredients ever renders.
 */
const fixtureBatch = {
  number: "002",
  name: "Squid and dates",
  facts: [
    "Squid from Beypore, landed 2 January 2027.",
    "Cooked 3 January 2027.",
    "Bottled 5 January 2027.",
    "13 jars, 200 g each.",
  ],
  story: [
    "The squid came in smaller this time, so the batch is smaller too.",
    "Sumayya cut every piece by hand.",
  ],
  yourJar: "The jar number is written by hand on the label.",
  ingredients: [
    { name: "Squid", percent: 59 },
    { name: "dates", percent: 22 },
    { name: "vinegar" },
    { name: "gingelly (sesame) oil" },
    { name: "garlic" },
  ],
  allergens: "Contains mollusc (squid) and sesame.",
  claims: "No added preservatives. Prepared by traditional method.",
  storage: "A cool, dry place away from sunlight.",
  bestBefore: "Best before six months from packing, so until 5 July 2027.",
  photos: [],
};

describe("formatIngredients (D28: percent renders only when supplied)", () => {
  it("renders no percentages for batch 001's shape", () => {
    const line = formatIngredients([{ name: "Prawns" }, { name: "dates" }, { name: "vinegar" }]);
    assert.equal(line, "Prawns, dates, vinegar.");
  });

  it("renders a percent per ingredient when the JSON supplies one, mixed with plain ones", () => {
    const line = formatIngredients(fixtureBatch.ingredients);
    assert.equal(line, "Squid (59%), dates (22%), vinegar, gingelly (sesame) oil, garlic.");
  });
});

describe("batchTitle / batchDescription", () => {
  it("builds the <title> and description from any batch's own facts, not 001's", () => {
    assert.equal(batchTitle(fixtureBatch), "Batch 002. Squid and dates. Lailark");
    assert.equal(
      batchDescription(fixtureBatch),
      "Squid from Beypore, landed 2 January 2027. Cooked 3 January 2027. Bottled 5 January 2027. 13 jars, 200 g each."
    );
  });
});

describe("BatchContent renders any batch, proving the template is not tied to 001", () => {
  it("renders the fixture batch's own facts, story, ingredients (with percentages) and closing button", () => {
    const html = renderToStaticMarkup(BatchContent({ batch: fixtureBatch }));

    assert.match(html, /Batch 002/);
    assert.match(html, /Squid and dates/);
    for (const fact of fixtureBatch.facts) {
      assert.ok(html.includes(fact), `expected rendered HTML to contain fact: ${fact}`);
    }
    for (const paragraph of fixtureBatch.story) {
      assert.ok(html.includes(paragraph), `expected rendered HTML to contain story paragraph: ${paragraph}`);
    }
    // The percentages: the whole point of this fixture.
    assert.match(html, /Squid \(59%\)/);
    assert.match(html, /dates \(22%\)/);
    assert.ok(!html.includes("<img"), "empty photos array must render nothing (D50)");

    // D48: still just the one action, to the home page, on any batch.
    assert.match(html, /See what we make/);
    assert.match(html, /href="\/"/);
    assert.ok(!html.includes("wa.me"), "no WhatsApp link on the record page");
    assert.ok(!html.includes("₹"), "no price on the record page (D47)");
  });

  it("renders batch 001's own shape with no ingredient percentages and its photo", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { join } = await import("node:path");
    const contentPath = join(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "content",
      "batches",
      "001.json"
    );
    const batch001 = JSON.parse(await readFile(contentPath, "utf8"));
    const html = renderToStaticMarkup(BatchContent({ batch: batch001 }));

    assert.match(html, /Prawns, dates, vinegar/);
    assert.ok(!/Prawns\s*\(\d/.test(html), "batch 001 must show no ingredient percentages (D28)");
    assert.match(html, /jar-001\.jpg/);
    assert.ok(!html.includes("Sumayya writes one of these"), "no caption on the jar photo (D50)");
  });
});
