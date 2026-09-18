// Tests for scripts/check-batch-001.mjs against a local node:http server that stands
// in for the deployed site: it serves the record on /batch/001 and 301s /batch/1 and
// /batch/01, matching firebase.json's hosting redirects. No network, no firebase.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CHECK_SCRIPT = resolve(ROOT, "scripts", "check-batch-001.mjs");
const RECORD_PATH = resolve(ROOT, "site", "public", "batch", "001", "index.html");
const RECORD = readFileSync(RECORD_PATH);

function startServer(body) {
  const server = createServer((req, res) => {
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
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// spawnSync would block this process's event loop while the child runs — but the
// child needs to talk to the http server we run in *this* process, so a synchronous
// spawn deadlocks (the server can't service the request until spawnSync returns, and
// spawnSync won't return until the child gets its response). Use async spawn instead.
function runCheck(baseUrl) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CHECK_SCRIPT, "--url", baseUrl], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
    child.on("error", reject);
  });
}

test("passes against a server that serves the exact record and correct redirects", async () => {
  const server = await startServer(RECORD);
  const { port } = server.address();
  try {
    const { status, stdout } = await runCheck(`http://127.0.0.1:${port}`);
    assert.equal(status, 0);
    assert.match(stdout, /PASS.*\/batch\/001/);
    assert.match(stdout, /PASS.*\/batch\/1\b/);
    assert.match(stdout, /PASS.*\/batch\/01\b/);
    assert.match(stdout, /all good\./);
  } finally {
    server.close();
  }
});

test("exits 2 when the served body differs from the record", async () => {
  const server = await startServer(Buffer.concat([RECORD, Buffer.from("<!-- tampered -->")]));
  const { port } = server.address();
  try {
    const { status, stdout } = await runCheck(`http://127.0.0.1:${port}`);
    assert.equal(status, 2);
    assert.match(stdout, /FAIL.*\/batch\/001/);
    assert.match(stdout, /body differs/);
  } finally {
    server.close();
  }
});

test("exits 2 when a redirect is missing (404 instead of 301)", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/batch/001") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(RECORD);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const { status, stdout } = await runCheck(`http://127.0.0.1:${port}`);
    assert.equal(status, 2);
    assert.match(stdout, /PASS.*\/batch\/001/);
    assert.match(stdout, /FAIL.*\/batch\/1\b/);
    assert.match(stdout, /expected 301, got 404/);
  } finally {
    server.close();
  }
});

test("--project staging targets the staging project's URL from .firebaserc, not a hard-coded name", async () => {
  const firebaserc = JSON.parse(readFileSync(resolve(ROOT, ".firebaserc"), "utf8"));
  const expectedBase = `https://${firebaserc.projects.staging}.web.app`;

  // Don't wait for the real network call to finish (there is no server listening
  // at that address in this test) — just capture the "checking ..." line the
  // script prints before it dials out, then kill it.
  const child = spawn(process.execPath, [CHECK_SCRIPT, "--project", "staging"], { cwd: ROOT });
  let stdout = "";
  await new Promise((resolvePromise) => {
    child.stdout.on("data", (c) => {
      stdout += c.toString();
      if (stdout.includes("checking ")) resolvePromise();
    });
  });
  child.kill();
  assert.match(stdout, new RegExp(`checking ${expectedBase.replace(/[.]/g, "\\.")} `));
});
