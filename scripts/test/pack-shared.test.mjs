// Tests for scripts/pack-shared.mjs's pack/restore round trip. Runs the real script
// against this repo's actual functions/package.json (there is only one to test
// against), and restores it in a `finally` no matter what. No network beyond `npm
// pack`, which packs shared/ locally.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = resolve(ROOT, "scripts", "pack-shared.mjs");
const PKG_PATH = resolve(ROOT, "functions", "package.json");
const VENDOR_DIR = resolve(ROOT, "functions", "vendor");

function pack() {
  return spawnSync("node", [SCRIPT], { cwd: ROOT, encoding: "utf8" });
}

function restore() {
  return spawnSync("node", [SCRIPT, "--restore"], { cwd: ROOT, encoding: "utf8" });
}

test("pack strips devDependencies and rewrites the @lailark/shared spec; restore puts both back byte for byte", () => {
  const before = readFileSync(PKG_PATH);
  const beforePkg = JSON.parse(before.toString("utf8"));
  assert.ok(beforePkg.devDependencies, "fixture assumption: functions/package.json has devDependencies before packing");
  assert.equal(beforePkg.dependencies["@lailark/shared"], "0.0.0");

  try {
    const packResult = pack();
    assert.equal(packResult.status, 0, `pack failed:\n${packResult.stdout}\n${packResult.stderr}`);

    const packedPkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
    assert.equal(packedPkg.devDependencies, undefined, "devDependencies must be gone after packing");
    assert.match(
      packedPkg.dependencies["@lailark/shared"],
      /^file:vendor\/.*\.tgz$/,
      "@lailark/shared must point at the vendored tarball after packing",
    );
    assert.ok(existsSync(VENDOR_DIR), "functions/vendor/ must exist after packing");

    const restoreResult = restore();
    assert.equal(restoreResult.status, 0, `restore failed:\n${restoreResult.stdout}\n${restoreResult.stderr}`);

    const after = readFileSync(PKG_PATH);
    assert.deepEqual(
      [...after],
      [...before],
      "functions/package.json must be byte-for-byte identical to its pre-pack state after restore",
    );
    assert.ok(!existsSync(VENDOR_DIR), "functions/vendor/ must be removed after restore");
  } finally {
    // Belt and braces: whatever happened above, make sure the working tree ends up
    // restored, not packed, so this test never leaves functions/package.json dirty
    // for the next test file or for git status.
    restore();
  }
});

test("packing twice, then restoring once, still ends up byte for byte identical", () => {
  const before = readFileSync(PKG_PATH);

  try {
    const first = pack();
    assert.equal(first.status, 0, `first pack failed:\n${first.stdout}\n${first.stderr}`);
    const second = pack();
    assert.equal(second.status, 0, `second pack failed:\n${second.stdout}\n${second.stderr}`);

    const packedTwice = JSON.parse(readFileSync(PKG_PATH, "utf8"));
    assert.equal(packedTwice.devDependencies, undefined, "devDependencies must still be gone after a second pack");
    assert.match(packedTwice.dependencies["@lailark/shared"], /^file:vendor\/.*\.tgz$/);

    const restoreResult = restore();
    assert.equal(restoreResult.status, 0, `restore failed:\n${restoreResult.stdout}\n${restoreResult.stderr}`);

    const after = readFileSync(PKG_PATH);
    assert.deepEqual(
      [...after],
      [...before],
      "double-pack then single restore must still reproduce the original bytes exactly",
    );
    assert.ok(!existsSync(VENDOR_DIR));
  } finally {
    restore();
  }
});

test("restoring an already-restored tree is a no-op", () => {
  const before = readFileSync(PKG_PATH);
  assert.ok(!existsSync(VENDOR_DIR), "fixture assumption: starts restored, no functions/vendor/");

  const result = restore();
  assert.equal(result.status, 0, `restore failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /already restored/);

  const after = readFileSync(PKG_PATH);
  assert.deepEqual([...after], [...before]);
  assert.ok(!existsSync(VENDOR_DIR));
});
