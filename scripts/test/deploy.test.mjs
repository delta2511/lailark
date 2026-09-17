// Tests for scripts/deploy.mjs. Drives it as a child process with piped stdin and
// LAILARK_DEPLOY_DRY_RUN=1 so no build step actually runs and no firebase/npx command
// is ever executed — every run() call just prints what it would have run. This keeps
// the suite fast and firebase-free while still exercising the real argument parsing,
// prompt flow, and command construction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DEPLOY_SCRIPT = resolve(ROOT, "scripts", "deploy.mjs");

function runDeploy(args, { input = "" } = {}) {
  const r = spawnSync(process.execPath, [DEPLOY_SCRIPT, ...args], {
    cwd: ROOT,
    input,
    env: { ...process.env, LAILARK_DEPLOY_DRY_RUN: "1" },
    encoding: "utf8",
    timeout: 15_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Piping the whole multi-line answer as one buffer (spawnSync's `input`) is fine for a
// single prompt, but node's readline/promises interface can drop lines that arrive
// before the next rl.question() has attached its own listener — several sequential
// prompts answered by one buffered write race that and hang. A human typing at a
// terminal never hits this because each keystroke line arrives with natural delay, so
// this helper answers one prompt at a time as it appears in stdout, mimicking that.
function runDeployInteractive(args, answers, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [DEPLOY_SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...process.env, LAILARK_DEPLOY_DRY_RUN: "1" },
    });
    let out = "";
    let err = "";
    let answerIndex = 0;
    let stdinEnded = false;

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${answerIndex} answer(s). stdout so far:\n${out}`));
    }, timeoutMs);

    function sendNextAnswer() {
      if (answerIndex < answers.length) {
        const line = answers[answerIndex++];
        setTimeout(() => child.stdin.write(`${line}\n`), 40);
      } else if (!stdinEnded) {
        stdinEnded = true;
        child.stdin.end();
      }
    }

    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
      sendNextAnswer();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolvePromise({ status, stdout: out, stderr: err });
    });
    child.on("error", reject);

    // Do NOT prime this before the first "data" event: the child's first prompt
    // is itself the first stdout chunk we see, and answering it is what the
    // "data" listener above already does. Priming here would answer a prompt
    // that hasn't been printed yet, shifting every later answer by one slot.
  });
}

test("(a) non-interactive preview channel deploy prints the exact firebase command", () => {
  const { status, stdout } = runDeploy([
    "--target",
    "customer",
    "--project",
    "staging",
    "--preview",
    "--channel",
    "test-ch",
  ]);
  assert.equal(status, 0);
  assert.match(
    stdout,
    /firebase hosting:channel:deploy test-ch --project staging --only customer --expires 7d/,
  );
});

test("(b) interactive path with empty channel name defaults to preview-YYYY-MM-DD", async () => {
  // answers, one per prompt: target, project, mode, channel (empty -> default)
  const { status, stdout } = await runDeployInteractive([], ["customer", "staging", "preview", ""]);
  assert.equal(status, 0);
  assert.match(
    stdout,
    /firebase hosting:channel:deploy preview-\d{4}-\d{2}-\d{2} --project staging --only customer --expires 7d/,
  );
});

test('(c) production --live stops with "stopped." on anything but a typed yes, runs no firebase command', () => {
  const { status, stdout } = runDeploy(
    ["--target", "customer", "--project", "production", "--live"],
    { input: "no\n" },
  );
  assert.equal(status, 0);
  assert.match(stdout, /stopped\./);
  assert.doesNotMatch(stdout, /firebase deploy/);
});

test('(c) production --live with a typed "yes" prints the firebase deploy command (dry run)', () => {
  const { status, stdout } = runDeploy(
    ["--target", "customer", "--project", "production", "--live"],
    { input: "yes\n" },
  );
  assert.equal(status, 0);
  assert.match(stdout, /firebase deploy --project default --only hosting:customer/);
});

test('(c) production --live gate requires an exact "yes" — "YES" stops, it does not case-fold and proceed', () => {
  const { status, stdout } = runDeploy(
    ["--target", "customer", "--project", "production", "--live"],
    { input: "YES\n" },
  );
  assert.equal(status, 0);
  assert.match(stdout, /stopped\./);
  assert.doesNotMatch(stdout, /\$ npx firebase/);
});

test("closed stdin before a prompt is answered exits 1 with a stderr message instead of silently succeeding", () => {
  const { status, stdout, stderr } = runDeploy([], { input: "customer\n" });
  assert.equal(status, 1);
  assert.match(stderr, /no answer on stdin, stopped\./);
  assert.doesNotMatch(stdout, /\$ npx firebase/);
});

test("buffered multi-line piped stdin (all answers written before the process asks) still answers every prompt", () => {
  const { status, stdout } = runDeploy([], { input: "customer\nstaging\npreview\n\n" });
  assert.equal(status, 0);
  assert.match(
    stdout,
    /firebase hosting:channel:deploy preview-\d{4}-\d{2}-\d{2} --project staging --only customer --expires 7d/,
  );
});

test("(d) --target admin refuses with the M1.6 placeholder message when admin/ has no build script", (t) => {
  const adminPkg = JSON.parse(readFileSync(resolve(ROOT, "admin", "package.json"), "utf8"));
  if (adminPkg.scripts && adminPkg.scripts.build) {
    t.skip("admin/package.json now has a build script (M1.6 landed) — this check no longer applies");
    return;
  }
  const { status, stdout, stderr } = runDeploy([
    "--target",
    "admin",
    "--project",
    "staging",
    "--preview",
    "--channel",
    "test-ch",
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /admin\/ is not set up yet \(M1\.6\)\./);
  assert.doesNotMatch(stdout, /firebase/);
});

test("(e) --functions --rules in live mode adds functions and firestore:rules,storage to --only", () => {
  const { status, stdout } = runDeploy(
    ["--target", "customer", "--project", "production", "--live", "--functions", "--rules"],
    { input: "yes\n" },
  );
  assert.equal(status, 0);
  assert.match(
    stdout,
    /firebase deploy --project default --only hosting:customer,functions,firestore:rules,storage/,
  );
});

test("(e) --functions --rules in preview mode deploys the hosting preview then functions/rules live, with a note", () => {
  const { status, stdout } = runDeploy([
    "--target",
    "customer",
    "--project",
    "staging",
    "--preview",
    "--channel",
    "test-ch",
    "--functions",
    "--rules",
  ]);
  assert.equal(status, 0);
  assert.match(
    stdout,
    /firebase hosting:channel:deploy test-ch --project staging --only customer --expires 7d/,
  );
  assert.match(stdout, /functions and rules do not have preview channels; deploying them live\./);
  assert.match(stdout, /firebase deploy --project staging --only functions,firestore:rules,storage/);
});

test("(f) --functions prints the restore-on-exit safety net note (dry run), --rules alone does not", () => {
  const withFunctions = runDeploy(
    ["--target", "customer", "--project", "production", "--live", "--functions"],
    { input: "yes\n" },
  );
  assert.equal(withFunctions.status, 0);
  assert.match(
    withFunctions.stdout,
    /\(dry run\) would restore functions\/package\.json via scripts\/pack-shared\.mjs --restore on exit, success or failure/,
  );

  const rulesOnly = runDeploy(
    ["--target", "customer", "--project", "production", "--live", "--rules"],
    { input: "yes\n" },
  );
  assert.equal(rulesOnly.status, 0);
  assert.doesNotMatch(rulesOnly.stdout, /would restore functions\/package\.json/);
});

test("--target both --project staging --preview fails fast on the admin message before any firebase call", (t) => {
  const adminPkg = JSON.parse(readFileSync(resolve(ROOT, "admin", "package.json"), "utf8"));
  if (adminPkg.scripts && adminPkg.scripts.build) {
    t.skip("admin/package.json now has a build script (M1.6 landed) — this check no longer applies");
    return;
  }
  const { status, stdout, stderr } = runDeploy([
    "--target",
    "both",
    "--project",
    "staging",
    "--preview",
    "--channel",
    "test-ch",
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /admin\/ is not set up yet \(M1\.6\)\./);
  assert.doesNotMatch(stdout, /hosting:channel:deploy|firebase deploy/);
});

test("(g) staging admin build passes VITE_FIREBASE_PROJECT for the staging project id, not production's default", (t) => {
  const adminPkg = JSON.parse(readFileSync(resolve(ROOT, "admin", "package.json"), "utf8"));
  if (!(adminPkg.scripts && adminPkg.scripts.build)) {
    t.skip("admin/ has no build script yet (M1.6 not landed) — this check does not apply");
    return;
  }
  const firebaserc = JSON.parse(readFileSync(resolve(ROOT, ".firebaserc"), "utf8"));
  const { status, stdout } = runDeploy([
    "--target",
    "admin",
    "--project",
    "staging",
    "--preview",
    "--channel",
    "test-ch",
  ]);
  assert.equal(status, 0);
  assert.match(
    stdout,
    new RegExp(`VITE_FIREBASE_PROJECT=${firebaserc.projects.staging} npm run build --workspace admin`),
  );
});

test("(g) production admin build passes VITE_FIREBASE_PROJECT=lailark", (t) => {
  const adminPkg = JSON.parse(readFileSync(resolve(ROOT, "admin", "package.json"), "utf8"));
  if (!(adminPkg.scripts && adminPkg.scripts.build)) {
    t.skip("admin/ has no build script yet (M1.6 not landed) — this check does not apply");
    return;
  }
  const { status, stdout } = runDeploy(
    ["--target", "admin", "--project", "production", "--live"],
    { input: "yes\n" },
  );
  assert.equal(status, 0);
  assert.match(stdout, /VITE_FIREBASE_PROJECT=lailark npm run build --workspace admin/);
});

test("DRY_RUN skips the /batch/001 network check after a live customer deploy and says so", () => {
  const { status, stdout } = runDeploy(
    ["--target", "customer", "--project", "production", "--live"],
    { input: "yes\n" },
  );
  assert.equal(status, 0);
  assert.match(stdout, /\(dry run\) would verify https:\/\/lailark\.in\/batch\/001/);
});
