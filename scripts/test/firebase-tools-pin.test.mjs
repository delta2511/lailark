// The firebase-tools version is pinned once, in .firebase-tools-version, because two
// places install it: CI and scripts/cloud-setup.sh. When they drift, a cloud session's
// emulator run and CI's stop being the same run, which is exactly the kind of
// difference that costs an afternoon. These tests fail on drift. No network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const read = (...parts) => readFileSync(resolve(ROOT, ...parts), "utf8");

const pin = read(".firebase-tools-version").trim();

test("the pin is a plain semver version on one line", () => {
  assert.match(pin, /^\d+\.\d+\.\d+$/);
});

test("CI installs the pinned version and nothing hard-coded", () => {
  const ci = read(".github", "workflows", "ci.yml");
  assert.match(ci, /npm install -g "firebase-tools@\$\(cat \.firebase-tools-version\)"/);
  const hardCoded = ci.match(/firebase-tools@\d+\.\d+\.\d+/g);
  assert.equal(hardCoded, null, `ci.yml hard-codes a version: ${hardCoded}`);
});

test("the emulator JAR cache key moves with the pin", () => {
  const ci = read(".github", "workflows", "ci.yml");
  assert.match(ci, /key: firebase-emulators-\$\{\{ hashFiles\('\.firebase-tools-version'\) \}\}/);
});

test("cloud-setup.sh reads the pin rather than naming a version", () => {
  const setup = read("scripts", "cloud-setup.sh");
  assert.match(setup, /< \.firebase-tools-version/);
  assert.match(setup, /npm install -g "firebase-tools@\$PIN"/);
  const hardCoded = setup.match(/firebase-tools@\d+\.\d+\.\d+/g);
  assert.equal(hardCoded, null, `cloud-setup.sh hard-codes a version: ${hardCoded}`);
});
