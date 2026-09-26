#!/usr/bin/env node
// Lailark deploy.
//
//   npm run deploy                       interactive
//   npm run deploy -- --target both --project staging --preview
//   npm run deploy -- --target customer --project production --live
//   npm run deploy -- --target admin --project staging --preview --channel shefin-test
//   npm run deploy -- --functions --rules   (also deploy functions and firestore rules)
//
// Targets are the Firebase Hosting targets in .firebaserc: "customer" (lailark.in)
// and "admin" (the admin site's default .web.app URL). Projects are the aliases in
// .firebaserc: "staging" and "production" ("default"). A preview deploys to a Hosting
// preview channel and prints a temporary URL; live deploys to the real site.
//
// Production live deploys ask for a typed "yes". After a live customer deploy the
// script runs scripts/check-batch-001.mjs's own checkBatch001() against the deployed
// URL (the same record comparison and /batch/1, /batch/01 redirect checks that
// `npm run check:batch-001` runs) and fails loudly (exit 2) on any mismatch, wrong
// status, unreachable URL, or bad redirect. This guard used to keep its own copy of
// the record path and comparison; that copy drifted out of date at M3.4 and threw
// ENOENT on every real deploy, so M3.4a made it call the one real implementation
// instead. See check-batch-001.mjs for what "the record" is and how it is built.
//
// Set LAILARK_DEPLOY_DRY_RUN=1 to print every command this script would run without
// executing it, and to skip the /batch/001 network check. Used by scripts/test/.
//
// Set LAILARK_DEPLOY_VERIFY_BATCH001_URL=<url> to skip straight to running only that
// /batch/001 guard against <url> and exit, without building, prompting, or deploying
// anything. Test-only: lets scripts/test/ exercise the real (non-dry-run) guard
// against a local fake server instead of a live deploy.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { stdin, stdout, argv, env, exit } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBatch001 } from "./check-batch-001.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DRY_RUN = env.LAILARK_DEPLOY_DRY_RUN === "1";
const VERIFY_ONLY_URL = env.LAILARK_DEPLOY_VERIFY_BATCH001_URL;
const PROJECTS = { staging: "staging", production: "default" };
// Read project ids from .firebaserc rather than hard-coding them, so a future
// repoint (like this one, lailark-staging -> tree-quiz-74e04) is one file.
const FIREBASERC = JSON.parse(readFileSync(resolve(ROOT, ".firebaserc"), "utf8"));
const BATCH_URL = {
  default: "https://lailark.in/batch/001",
  staging: `https://${FIREBASERC.projects.staging}.web.app/batch/001`,
};

/** The Firebase/GCP project id a deploy `--project <alias>` targets, per .firebaserc. */
function projectIdFor(projectAlias) {
  return FIREBASERC.projects[PROJECTS[projectAlias]];
}

function arg(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

// Builds an asker bound to rl. Lines are captured via the "line" event (rather than
// rl.question, whose one-shot internal listener drops any line that arrives before the
// next question attaches it) so piped, buffered stdin queues up correctly and nothing
// answered ahead of time is lost. If stdin closes before a question is answered — a
// human hanging up, or a script piping fewer lines than there are prompts — nextLine()
// resolves null and we stop loudly instead of silently proceeding with no answer.
function createPrompter(rl) {
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on("line", (line) => {
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });

  function nextLine() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  }

  // Raw: trimmed only, no case folding. Used where an exact string must match.
  async function raw(q) {
    stdout.write(`${q} `);
    const line = await nextLine();
    if (line === null) {
      console.error("\nno answer on stdin, stopped.");
      exit(1);
      return undefined;
    }
    return line.trim();
  }

  async function ask(q, choices) {
    for (;;) {
      const line = await raw(q);
      if (line === undefined) return undefined;
      const a = line.toLowerCase();
      if (!choices) return a;
      const hit = choices.find((c) => c === a || c[0] === a);
      if (hit) return hit;
      console.log(`  one of: ${choices.join(", ")}`);
    }
  }

  return { ask, raw };
}

// envVars are printed on the command line (so a dry run, and the tests that read
// its stdout, can see exactly what would be exported) and passed to the child
// process's real environment when it actually runs.
function run(cmd, args, { envVars = {} } = {}) {
  const prefix = Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const shown = prefix ? `${prefix} ${cmd} ${args.join(" ")}` : `${cmd} ${args.join(" ")}`;
  console.log(`\n$ ${shown}`);
  if (DRY_RUN) {
    console.log("  (dry run: not executed)");
    return { status: 0 };
  }
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, env: { ...env, ...envVars } });
  if (r.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(" ")}`);
    exit(r.status ?? 1);
  }
  return r;
}

// A workspace is deployable once its package.json declares a "build" script.
// site/ and admin/ both start life as placeholder packages (M1.1) so this is
// the real signal, not just package.json existing.
function hasBuildScript(pkgPath) {
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return Boolean(pkg.scripts && pkg.scripts.build);
  } catch {
    return false;
  }
}

// Runs the real /batch/001 check (scripts/check-batch-001.mjs's checkBatch001: the
// record comparison plus the /batch/1 and /batch/01 redirect checks) against url.
// Exits 2 (loudly) on any mismatch, wrong status, bad redirect, or network failure.
// This used to be its own copy of the record path and byte comparison; that copy
// pointed at a file that stopped existing at M3.4 (site/public/batch/001/index.html)
// and threw ENOENT on every real deploy instead of ever running the check. M3.4a
// replaced it with the one real implementation so the two cannot drift again.
async function verifyBatch001(url) {
  const code = await checkBatch001(url);
  if (code !== 0) {
    console.error(
      `\n!!! ${url} failed the /batch/001 check above. Printed jars point here. Fix before anything else.`,
    );
    exit(2);
    return;
  }
  console.log(`\n${url} passed the /batch/001 check. Good.`);
}

async function main() {
  // Test-only fast path: run just the /batch/001 guard against a given URL and stop,
  // no prompts, no build, no firebase command. See LAILARK_DEPLOY_VERIFY_BATCH001_URL
  // in the header comment; scripts/test/ uses this to exercise the real (non-dry-run)
  // guard against a local fake server.
  if (VERIFY_ONLY_URL) {
    await verifyBatch001(VERIFY_ONLY_URL);
    console.log("\ndone.");
    exit(0);
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const { ask, raw } = createPrompter(rl);

  let target = arg("target");
  if (!["customer", "admin", "both"].includes(target)) {
    target = await ask("Deploy what? [customer / admin / both]", ["customer", "admin", "both"]);
  }

  let project = arg("project");
  if (!["staging", "production"].includes(project)) {
    project = await ask("Where? [staging / production]", ["staging", "production"]);
  }

  let mode = arg("live") ? "live" : arg("preview") ? "preview" : undefined;
  if (!mode) {
    mode = await ask("Live, or a preview channel? [live / preview]", ["live", "preview"]);
  }

  let channel = arg("channel");
  if (mode === "preview" && (channel === undefined || channel === true)) {
    const def = `preview-${new Date().toISOString().slice(0, 10)}`;
    const a = await ask(`Channel name? [${def}]`);
    channel = a || def;
  }

  const withFunctions = Boolean(arg("functions"));
  const withRules = Boolean(arg("rules"));

  // firebase-tools only runs a target's postdeploy hook once predeploy, prepare, deploy,
  // and release have all succeeded: deploy/index.js chains them inside one try with no
  // catch (only a finally for telemetry), so a failure at any stage skips straight past
  // postdeploy. functions.postdeploy (firebase.json) restores functions/package.json to
  // the workspace link and deletes functions/vendor/ after functions.predeploy packed
  // @lailark/shared into it — if a `firebase deploy --only functions` below fails
  // partway through, that hook never runs and the repo is left mid-pack. Arm a
  // process-exit safety net so this script restores regardless of success or failure.
  // pack-shared.mjs --restore is idempotent, so restoring twice (once from a successful
  // postdeploy hook, once here) is harmless.
  if (withFunctions) {
    if (DRY_RUN) {
      console.log(
        "\n(dry run) would restore functions/package.json via scripts/pack-shared.mjs --restore on exit, success or failure",
      );
    } else {
      process.on("exit", () => {
        spawnSync(process.execPath, [resolve(ROOT, "scripts", "pack-shared.mjs"), "--restore"], {
          stdio: "inherit",
          cwd: ROOT,
        });
      });
    }
  }

  if (project === "production" && mode === "live") {
    // Raw (not ask()): the production gate must match the literal string "yes", not
    // any case-folded variant — "YES" or "Yes" must stop, not proceed.
    const yes = await raw("This goes live on lailark.in. Type yes to continue:");
    if (yes !== "yes") {
      console.log("stopped.");
      rl.close();
      return;
    }
  }
  rl.close();

  const alias = PROJECTS[project];
  const targets = target === "both" ? ["customer", "admin"] : [target];

  // Build only what is being deployed.
  if (targets.includes("customer")) {
    if (!hasBuildScript(resolve(ROOT, "site/package.json"))) {
      console.error("site/ is not set up yet (M1.1).");
      exit(1);
    }
    run("npm", ["run", "build", "--workspace", "site"]);
  }
  if (targets.includes("admin")) {
    if (!hasBuildScript(resolve(ROOT, "admin/package.json"))) {
      console.error("admin/ is not set up yet (M1.6).");
      exit(1);
    }
    // The admin build must point at the project it is being deployed to, not
    // whatever VITE_FIREBASE_PROJECT defaults to (production) — otherwise a
    // staging deploy ships an admin bundle that talks to production.
    run("npm", ["run", "build", "--workspace", "admin"], {
      envVars: { VITE_FIREBASE_PROJECT: projectIdFor(project) },
    });
  }
  if (withFunctions) run("npm", ["run", "build", "--workspace", "functions"]);

  if (mode === "preview") {
    // Preview channels: one call per target, each prints its URL.
    run("npx", [
      "firebase",
      "hosting:channel:deploy",
      channel,
      "--project",
      alias,
      "--only",
      targets.join(","),
      "--expires",
      "7d",
    ]);
    if (withFunctions || withRules) {
      console.log("\nfunctions and rules do not have preview channels; deploying them live.");
      const only = [withFunctions && "functions", withRules && "firestore:rules,storage"]
        .filter(Boolean)
        .join(",");
      run("npx", ["firebase", "deploy", "--project", alias, "--only", only]);
    }
  } else {
    const only = [
      ...targets.map((t) => `hosting:${t}`),
      withFunctions && "functions",
      withRules && "firestore:rules",
      withRules && "storage",
    ]
      .filter(Boolean)
      .join(",");
    run("npx", ["firebase", "deploy", "--project", alias, "--only", only]);
  }

  // The one check that must never be skipped.
  if (mode === "live" && targets.includes("customer") && BATCH_URL[alias]) {
    if (DRY_RUN) {
      console.log(`\n(dry run) would verify ${BATCH_URL[alias]} via scripts/check-batch-001.mjs`);
    } else {
      await verifyBatch001(BATCH_URL[alias]);
    }
  }

  console.log("\ndone.");
  // fetch's keep-alive connection pool (used by verifyBatch001) can otherwise
  // hold the event loop open after everything is finished.
  exit(0);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
