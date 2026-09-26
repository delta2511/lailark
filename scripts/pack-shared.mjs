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
//
// Packing also strips functions/package.json's devDependencies (eslint, typescript,
// typescript-eslint, vitest), restoring them byte-for-byte on --restore. Cloud Build
// runs `npm install` inside the uploaded functions/ alone, and vitest@5.0.1's long
// list of optional peers crashes npm 10.9.4's arborist there ("Cannot read properties
// of null (reading 'edgesOut')" in @npmcli/arborist's #loadPeerSet), which fails the
// deploy's Cloud Build step outright. None of these packages have a runtime role:
// functions.predeploy already runs `npm --prefix functions run build` locally, so
// what deploys is compiled lib/, not source. Do not put devDependencies back into
// what pack() ships without first confirming npm can install the resulting graph
// standalone (a scratch copy of functions/ without node_modules, `npm install`).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit } from "node:process";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const FUNCTIONS_DIR = resolve(ROOT, "functions");
const VENDOR_DIR = resolve(FUNCTIONS_DIR, "vendor");
const PKG_PATH = resolve(FUNCTIONS_DIR, "package.json");
// Where the stripped devDependencies are stashed between pack() and restore(). Lives
// inside functions/vendor/ (already gitignored) so it never shows up in git status,
// and it is a plain file, not a .tgz, so clearVendorTarballs() never touches it.
const DEV_DEPS_STASH_PATH = resolve(VENDOR_DIR, ".devDependencies.json");
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
  // Stash devDependencies (if still present, i.e. this isn't a re-pack) so restore()
  // can put them back byte-for-byte, then strip them from what ships to Cloud Build.
  // See the header comment for why: they have no runtime role and vitest's optional
  // peers crash npm's arborist when Cloud Build installs functions/ standalone.
  if (pkg.devDependencies) {
    writeFileSync(DEV_DEPS_STASH_PATH, `${JSON.stringify(pkg.devDependencies, null, 2)}\n`);
    delete pkg.devDependencies;
  }
  writePkg(pkg);
  console.log(`\npacked shared/ -> functions/vendor/${tarball}`);
  console.log(`functions/package.json "@lailark/shared" -> "file:vendor/${tarball}"`);
  console.log(`functions/package.json devDependencies stripped (stashed in functions/vendor/.devDependencies.json)`);
}

function restore() {
  let changed = false;
  const pkg = readPkg();
  if (pkg.dependencies?.["@lailark/shared"] !== WORKSPACE_SPEC) {
    pkg.dependencies["@lailark/shared"] = WORKSPACE_SPEC;
    changed = true;
  }
  if (!pkg.devDependencies && existsSync(DEV_DEPS_STASH_PATH)) {
    pkg.devDependencies = JSON.parse(readFileSync(DEV_DEPS_STASH_PATH, "utf8"));
    changed = true;
  }
  if (changed) writePkg(pkg);
  if (existsSync(VENDOR_DIR)) {
    rmSync(VENDOR_DIR, { recursive: true, force: true });
    changed = true;
  }
  console.log(
    changed
      ? "restored functions/package.json to the workspace link (\"0.0.0\") with devDependencies back, and removed functions/vendor/"
      : "already restored: functions/package.json is on the workspace link, no functions/vendor/",
  );
}

if (argv.includes("--restore")) restore();
else pack();
