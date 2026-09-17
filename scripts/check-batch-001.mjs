#!/usr/bin/env node
// Checks the deployed site's /batch/001 against the printed-jar record.
//
//   npm run check:batch-001                        production, https://lailark.in
//   npm run check:batch-001 -- --project staging    https://tree-quiz-74e04.web.app
//   npm run check:batch-001 -- --url http://127.0.0.1:5010   any base URL
//
// Compares the /batch/001 body byte for byte against site/public/batch/001/index.html
// and checks /batch/1 and /batch/01 301-redirect to /batch/001 (no redirects
// followed; the Location header is read directly). Prints one line per check.
// Exits 0 only if every check passes, exit 2 otherwise.

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const RECORD_PATH = resolve(ROOT, "site/public/batch/001/index.html");
// Read the staging project id from .firebaserc rather than hard-coding it, so a
// future repoint is one file.
const FIREBASERC = JSON.parse(readFileSync(resolve(ROOT, ".firebaserc"), "utf8"));

function arg(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

function baseUrl() {
  const explicit = arg("url");
  if (explicit && explicit !== true) return explicit.replace(/\/$/, "");
  if (arg("project") === "staging") return `https://${FIREBASERC.projects.staging}.web.app`;
  return "https://lailark.in";
}

let failed = false;

function report(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function checkRecord(base) {
  const url = `${base}/batch/001`;
  const expected = readFileSync(RECORD_PATH);
  let res;
  try {
    res = await fetch(url, { redirect: "manual" });
  } catch (e) {
    report(`GET ${url}`, false, `request failed: ${e.message}`);
    return;
  }
  if (res.status !== 200) {
    report(`GET ${url}`, false, `expected 200, got ${res.status}`);
    return;
  }
  const actual = Buffer.from(await res.arrayBuffer());
  if (!actual.equals(expected)) {
    report(
      `GET ${url}`,
      false,
      `body differs from ${RECORD_PATH} (${actual.length} vs ${expected.length} bytes)`,
    );
    return;
  }
  report(`GET ${url}`, true, "200, byte-identical to the record");
}

async function checkRedirect(base, path) {
  const url = `${base}${path}`;
  let res;
  try {
    res = await fetch(url, { redirect: "manual" });
  } catch (e) {
    report(`GET ${url}`, false, `request failed: ${e.message}`);
    return;
  }
  if (res.status !== 301) {
    report(`GET ${url}`, false, `expected 301, got ${res.status}`);
    return;
  }
  const location = res.headers.get("location") ?? "";
  if (!location.endsWith("/batch/001")) {
    report(`GET ${url}`, false, `expected Location ending in /batch/001, got "${location}"`);
    return;
  }
  report(`GET ${url}`, true, `301 → ${location}`);
}

async function main() {
  const base = baseUrl();
  console.log(`checking ${base} ...\n`);
  await checkRecord(base);
  await checkRedirect(base, "/batch/1");
  await checkRedirect(base, "/batch/01");
  if (failed) {
    console.error("\nfailed.");
    exit(2);
    return;
  }
  console.log("\nall good.");
  // fetch's keep-alive connection pool can otherwise hold the event loop open.
  exit(0);
}

main().catch((e) => {
  console.error(e);
  exit(2);
});
