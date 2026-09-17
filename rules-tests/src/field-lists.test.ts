/**
 * The two batch field lists exist twice: once in `firestore.rules`, where they
 * are enforced, and once in `shared/src/rules.ts`, where the admin reads them
 * to decide which inputs to grey out. Two copies of a list is a bug waiting
 * to happen, so this test parses the rules file and asserts the sets match.
 *
 * Parsing the text rather than generating the rules from the TypeScript was
 * the choice: `firestore.rules` stays a plain, readable, hand-written file
 * that anyone can open in the Firebase console and compare line for line with
 * what is deployed, and a build step that writes a security rules file is a
 * thing that can silently produce the wrong file. A regex over two literal
 * arrays is cheap, and if the shape of the file changes enough to break the
 * regex, this test fails rather than passing vacuously.
 */

import { readFileSync } from "node:fs";

import { KITCHEN_BATCH_FIELDS, KITCHEN_RECIPE_EDIT_SWITCH, PROTECTED_BATCH_FIELDS } from "@lailark/shared";
import { describe, expect, it } from "vitest";

import { FIRESTORE_RULES_PATH } from "./env.js";

const rulesText = readFileSync(FIRESTORE_RULES_PATH, "utf8");

/** Pulls the single-quoted strings out of `function name() { return [ ... ]; }`. */
function listFromRules(functionName: string): string[] {
  const body = new RegExp(`function\\s+${functionName}\\s*\\(\\)\\s*\\{[^}]*?return\\s*\\[([^\\]]*)\\]`).exec(
    rulesText,
  );
  if (!body) throw new Error(`no function ${functionName}() returning a list in firestore.rules`);
  return [...body[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("the batch field lists in firestore.rules", () => {
  it("are found at all: the regex still matches the file", () => {
    expect(listFromRules("protectedBatchFields").length).toBeGreaterThan(0);
    expect(listFromRules("kitchenBatchFields").length).toBeGreaterThan(0);
  });

  it("match PROTECTED_BATCH_FIELDS in @lailark/shared", () => {
    expect(listFromRules("protectedBatchFields").sort()).toEqual([...PROTECTED_BATCH_FIELDS].sort());
  });

  it("match KITCHEN_BATCH_FIELDS in @lailark/shared", () => {
    expect(listFromRules("kitchenBatchFields").sort()).toEqual([...KITCHEN_BATCH_FIELDS].sort());
  });

  it("hold no duplicates", () => {
    for (const name of ["protectedBatchFields", "kitchenBatchFields"]) {
      const list = listFromRules(name);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("do not overlap: no field is both protected and a kitchen field", () => {
    const kitchen = new Set(listFromRules("kitchenBatchFields"));
    expect(listFromRules("protectedBatchFields").filter((f) => kitchen.has(f))).toEqual([]);
  });
});

describe("the rules file itself", () => {
  it("still denies everything it does not name", () => {
    expect(rulesText).toContain("match /{document=**} {");
    expect(rulesText).toMatch(/match \/\{document=\*\*\} \{\s*\n\s*allow read, write: if false;/);
  });

  it("names every money collection as server-only", () => {
    for (const name of ["documents", "counters", "refunds", "settlements", "webhookEvents", "dayCloses"]) {
      expect(rulesText).toContain(`match /${name}/`);
    }
  });
});

describe("the Kitchen recipe edit switch in firestore.rules (Q4)", () => {
  it("reads the document and field KITCHEN_RECIPE_EDIT_SWITCH names, defaulting to off", () => {
    const { collection, doc, field } = KITCHEN_RECIPE_EDIT_SWITCH;
    const body = /function\s+kitchenCanEditRecipes\s*\(\)\s*\{([^}]*)\}/.exec(rulesText);
    if (!body) throw new Error("no function kitchenCanEditRecipes() in firestore.rules");
    const path = `/databases/$(database)/documents/${collection}/${doc}`;
    expect(body[1]).toContain(`exists(${path})`);
    expect(body[1]).toContain(`get(${path}).data.get('${field}', false) == true`);
    expect(KITCHEN_RECIPE_EDIT_SWITCH.default).toBe(false);
  });
});
