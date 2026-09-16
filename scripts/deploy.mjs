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
// script fetches /batch/001 and fails loudly (exit 2) if it is not a byte-for-byte
// match for site/public/batch/001/index.html.
//
// Set LAILARK_DEPLOY_DRY_RUN=1 to print every command this script would run without
// executing it, and to skip the /batch/001 network check. Used by scripts/test/.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { stdin, stdout, argv, env, exit } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DRY_RUN = env.LAILARK_DEPLOY_DRY_RUN === "1";
const PROJECTS = { staging: "staging", production: "default" };
const BATCH_URL = {
  default: "https://lailark.in/batch/001",
  staging: "https://lailark-staging.web.app/batch/001",
};
const BATCH_RECORD = resolve(ROOT, "site/public/batch/001/index.html");

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

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  if (DRY_RUN) {
    console.log("  (dry run: not executed)");
    return { status: 0 };
  }
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
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

// Fetches url and compares the body byte for byte against the printed-jar record.
// Exits 2 (loudly) on any mismatch, wrong status, or network failure.
async function verifyBatch001(url) {
  const expected = readFileSync(BATCH_RECORD);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error(`\n!!! could not reach ${url}: ${e.message}. Printed jars point here. Fix before anything else.`);
    exit(2);
    return;
  }
  if (res.status !== 200) {
    console.error(`\n!!! ${url} returned ${res.status}. Printed jars point here. Fix before anything else.`);
    exit(2);
    return;
  }
  const actual = Buffer.from(await res.arrayBuffer());
  if (!actual.equals(expected)) {
    console.error(
      `\n!!! ${url} does not match ${BATCH_RECORD} byte for byte (${actual.length} vs ${expected.length} bytes). Printed jars point here. Fix before anything else.`,
    );
    exit(2);
    return;
  }
  console.log(`\n${url} → 200, byte-identical to the record. Good.`);
}

async function main() {
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
    run("npm", ["run", "build", "--workspace", "admin"]);
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
      console.log(`\n(dry run) would verify ${BATCH_URL[alias]} against ${BATCH_RECORD}`);
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
