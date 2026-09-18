#!/usr/bin/env node
// Packages @lailark/shared as a tarball inside functions/vendor/ and points
// functions/package.json's "@lailark/shared" dependency at it with a file: spec.
//
// Why: functions/ is deployed by uploading a zip of functions/ alone (see
// firebase.json functions.predeploy/postdeploy) and Cloud Build runs `npm install`
// (or `npm ci`, if a lockfile is present) *inside that directory*. @lailark/shared
// is a private workspace package with no npm registry entry, so a plain
// "@lailark/shared": "0.0.0" dependency cannot be installed outside this repo's
// workspace. Packing it into a tarball and depending on that tarball via a file:
// path makes functions/ self-contained: `npm install` (or `npm ci`) inside a copy
// of functions/ alone — no sibling shared/, no workspace root — resolves it.
//
//   node scripts/pack-shared.mjs            build shared/, pack it into functions/vendor/,
//                                            rewrite functions/package.json to depend on the tarball
//   node scripts/pack-shared.mjs --restore  undo: put "0.0.0" back, delete functions/vendor/
//
// Both directions are idempotent: packing when already packed just re-packs (removing
// any stale tarball first); restoring when already restored is a no-op.
//
// Deliberately NOT written to run `npm install` at the root after packing or
// restoring: node_modules/@lailark/shared is a symlink created once by the root
// `npm install` (workspaces), and rewriting functions/package.json's dependency
// *string* does not touch node_modules, so the symlink — and therefore the
// emulator, `npm test`, `npm run build` and CI — keeps working through the pack/
// restore cycle without needing a reinstall.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit } from "node:process";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const FUNCTIONS_DIR = resolve(ROOT, "functions");
const VENDOR_DIR = resolve(FUNCTIONS_DIR, "vendor");
const PKG_PATH = resolve(FUNCTIONS_DIR, "package.json");
const WORKSPACE_SPEC = "0.0.0";

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) {
    console.error(`failed: ${cmd} ${args.join(" ")}`);
    exit(r.status ?? 1);
  }
}

function readPkg() {
  return JSON.parse(readFileSync(PKG_PATH, "utf8"));
}

// Matches the trailing-newline, 2-space style every other package.json in this repo uses.
function writePkg(pkg) {
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

function clearVendorTarballs() {
  if (!existsSync(VENDOR_DIR)) return;
  for (const f of readdirSync(VENDOR_DIR)) {
    if (f.endsWith(".tgz")) rmSync(resolve(VENDOR_DIR, f));
  }
}

function pack() {
  run("npm", ["run", "build", "--workspace", "shared"]);
  mkdirSync(VENDOR_DIR, { recursive: true });
  // Remove any stale tarball first so a leftover previous version is never installed.
  clearVendorTarballs();
  run("npm", ["pack", "--workspace", "shared", "--pack-destination", VENDOR_DIR]);
  const tarball = readdirSync(VENDOR_DIR).find((f) => f.endsWith(".tgz"));
  if (!tarball) {
    console.error("npm pack did not produce a .tgz in functions/vendor/");
    exit(1);
    return;
  }
  const pkg = readPkg();
  pkg.dependencies["@lailark/shared"] = `file:vendor/${tarball}`;
  writePkg(pkg);
  console.log(`\npacked shared/ -> functions/vendor/${tarball}`);
  console.log(`functions/package.json "@lailark/shared" -> "file:vendor/${tarball}"`);
}

function restore() {
  let changed = false;
  const pkg = readPkg();
  if (pkg.dependencies?.["@lailark/shared"] !== WORKSPACE_SPEC) {
    pkg.dependencies["@lailark/shared"] = WORKSPACE_SPEC;
    writePkg(pkg);
    changed = true;
  }
  if (existsSync(VENDOR_DIR)) {
    rmSync(VENDOR_DIR, { recursive: true, force: true });
    changed = true;
  }
  console.log(
    changed
      ? "restored functions/package.json to the workspace link (\"0.0.0\") and removed functions/vendor/"
      : "already restored: functions/package.json is on the workspace link, no functions/vendor/",
  );
}

if (argv.includes("--restore")) restore();
else pack();
