// Tests for scripts/deploy.mjs's own /batch/001 guard (verifyBatch001), which since
// M3.4a calls scripts/check-batch-001.mjs's checkBatch001() instead of keeping a
// second copy of the record path and byte comparison. That second copy is what
// drifted: BATCH_RECORD in deploy.mjs pointed at site/public/batch/001/index.html,
// which stopped existing at M3.4 (the page moved to the site/app/batch/[nnn] route),
// so every real deploy's post-deploy guard threw ENOENT instead of ever checking
// anything.
//
// These tests drive deploy.mjs as a child process with
// LAILARK_DEPLOY_VERIFY_BATCH001_URL=<url> set, which makes it run only verifyBatch001
// against that URL and exit — no prompts, no build, no firebase command — against a
// local node:http server standing in for the deployed site, the same pattern
// scripts/test/check-batch-001.test.mjs uses for the checker itself. No network, no
// firebase, and (unlike scripts/test/deploy.test.mjs) LAILARK_DEPLOY_DRY_RUN is NOT
// set here, because dry run skips the /batch/001 network check entirely — the whole
// point of this file is to exercise the real, non-dry-run guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DEPLOY_SCRIPT = resolve(ROOT, "scripts", "deploy.mjs");
const CHECK_SCRIPT = resolve(ROOT, "scripts", "check-batch-001.mjs");

// Same build-output record M3.4 introduced (site/out/batch/001.html, not a nested
// index.html — see check-batch-001.mjs for why). Run "npm run build --workspace site"
// before running this file directly; the root "npm test" already builds first.
const RECORD_PATH = resolve(ROOT, "site", "out", "batch", "001.html");
if (!existsSync(RECORD_PATH)) {
  throw new Error(
    `${RECORD_PATH} not found. Run "npm run build --workspace site" before running scripts/test/deploy-batch001-guard.test.mjs.`,
  );
}
const RECORD = readFileSync(RECORD_PATH);

function startServer(handler) {
  const server = createServer(handler);
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise(server));
  });
}

// A server that serves the exact record on /batch/001 and correct redirects on
// /batch/1 and /batch/01 — the "everything is fine" fixture, matching what
// checkBatch001 needs to see to return exit code 0.
function startGoodServer(body = RECORD) {
  return startServer((req, res) => {
    if (req.url === "/batch/001") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(body);
      return;
    }
    if (req.url === "/batch/1" || req.url === "/batch/01") {
      res.writeHead(301, { Location: "/batch/001" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

function runDeployVerifyOnly(url) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [DEPLOY_SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, LAILARK_DEPLOY_VERIFY_BATCH001_URL: url },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
    child.on("error", reject);
  });
}

test("deploy guard exits 0 and prints success when the served body and redirects match the record", async () => {
  const server = await startGoodServer();
  const { port } = server.address();
  try {
    const { status, stdout } = await runDeployVerifyOnly(`http://127.0.0.1:${port}`);
    assert.equal(status, 0);
    assert.match(stdout, /passed the \/batch\/001 check/);
    assert.match(stdout, /done\./);
  } finally {
    server.close();
  }
});

test("deploy guard fails loudly with exit 2 when the served body differs by even one byte", async () => {
  // Flip the last byte of the record rather than appending or truncating, so the
  // lengths match and only a byte comparison (not a length check) can catch it.
  const tampered = Buffer.from(RECORD);
  tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;
  const server = await startGoodServer(tampered);
  const { port } = server.address();
  try {
    const { status, stdout, stderr } = await runDeployVerifyOnly(`http://127.0.0.1:${port}`);
    assert.equal(status, 2);
    assert.match(stdout, /FAIL.*\/batch\/001/);
    assert.match(stderr, /failed the \/batch\/001 check above\. Printed jars point here\. Fix before anything else\./);
  } finally {
    server.close();
  }
});

test("deploy guard fails loudly with exit 2 when the URL is unreachable", async () => {
  // Grab a port and immediately close the server, so nothing is listening there.
  const probe = await startServer(() => {});
  const { port } = probe.address();
  await new Promise((resolvePromise) => probe.close(resolvePromise));

  const { status, stdout, stderr } = await runDeployVerifyOnly(`http://127.0.0.1:${port}`);
  assert.equal(status, 2);
  assert.match(stdout, /FAIL.*\/batch\/001.*request failed/);
  assert.match(stderr, /failed the \/batch\/001 check above/);
});

test("deploy guard fails loudly with exit 2 when the URL returns a non-200 status", async () => {
  const server = await startServer((req, res) => {
    res.writeHead(503);
    res.end("service unavailable");
  });
  const { port } = server.address();
  try {
    const { status, stdout, stderr } = await runDeployVerifyOnly(`http://127.0.0.1:${port}`);
    assert.equal(status, 2);
    assert.match(stdout, /FAIL.*\/batch\/001.*expected 200, got 503/);
    assert.match(stderr, /failed the \/batch\/001 check above/);
  } finally {
    server.close();
  }
});

test("deploy guard fails loudly with exit 2 when a redirect is missing", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/batch/001") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(RECORD);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const { port } = server.address();
  try {
    const { status, stdout, stderr } = await runDeployVerifyOnly(`http://127.0.0.1:${port}`);
    assert.equal(status, 2);
    assert.match(stdout, /FAIL.*\/batch\/1\b.*expected 301, got 404/);
    assert.match(stderr, /failed the \/batch\/001 check above/);
  } finally {
    server.close();
  }
});

// The specific regression this task fixes: deploy.mjs used to keep its own
// BATCH_RECORD constant pointing at site/public/batch/001/index.html, a path that
// stopped existing when M3.4 moved the page to the site/app/batch/[nnn] route. That
// made every real deploy's guard throw ENOENT instead of ever checking anything.
//
// The most direct test for that is not a fresh existsSync check here (this file's own
// top-of-file guard, above, already refuses to run at all if the record is missing —
// and re-checking existsSync live, in a test body, would race scripts/test/check-batch-
// 001.test.mjs's "build output is missing" test, which renames the record aside for
// the duration of one of its own tests; both files can run concurrently under `node
// --test`). The real regression test is the very first test in this file: it drives
// deploy.mjs's guard, unmodified, against a live server serving the actual record —
// exactly deploy.mjs's real code path — and that is precisely what threw ENOENT before
// M3.4a. This test instead pins down that there is now only one copy of the path to
// drift: check-batch-001.mjs exports it, and deploy.mjs imports checkBatch001 rather
// than defining its own.
test("check-batch-001.mjs exports the one RECORD_PATH deploy.mjs relies on, instead of deploy.mjs keeping a second copy", async () => {
  const mod = await import(`file://${CHECK_SCRIPT}`);
  assert.equal(mod.RECORD_PATH, RECORD_PATH);
});

test("deploy.mjs does not keep its own copy of the batch record path — it imports the one real implementation", () => {
  const src = readFileSync(DEPLOY_SCRIPT, "utf8");
  // Match the actual code shape of the old bug (a resolve() call building the stale
  // path, or a BATCH_RECORD identifier holding it), not any mention of the string —
  // the comments above intentionally name the old path in prose to explain the fix.
  assert.doesNotMatch(
    src,
    /resolve\([^)]*["']site\/public\/batch\/001/,
    "deploy.mjs still builds the stale pre-M3.4 record path with resolve() — this is the exact regression M3.4a fixed",
  );
  assert.doesNotMatch(
    src,
    /\bBATCH_RECORD\s*=/,
    "deploy.mjs should no longer define its own record-path constant",
  );
  assert.match(
    src,
    /from ["']\.\/check-batch-001\.mjs["']/,
    "deploy.mjs should import checkBatch001 from check-batch-001.mjs rather than reimplementing the check",
  );
});
