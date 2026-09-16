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
// Production live deploys ask for a typed "yes". After a customer deploy the script
// curls /batch/001 and fails loudly if it is not a 200.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit } from "node:process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const PROJECTS = { staging: "staging", production: "default" };
const BATCH_URL = {
  default: "https://lailark.in/batch/001",
  staging: null, // filled from the staging site URL once M1.2 has created it
};

function arg(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function ask(rl, q, choices) {
  for (;;) {
    const a = (await rl.question(`${q} `)).trim().toLowerCase();
    if (!choices) return a;
    const hit = choices.find((c) => c === a || c[0] === a);
    if (hit) return hit;
    console.log(`  one of: ${choices.join(", ")}`);
  }
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (r.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(" ")}`);
    exit(r.status ?? 1);
  }
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  let target = arg("target");
  if (!["customer", "admin", "both"].includes(target)) {
    target = await ask(rl, "Deploy what? [customer / admin / both]", ["customer", "admin", "both"]);
  }

  let project = arg("project");
  if (!["staging", "production"].includes(project)) {
    project = await ask(rl, "Where? [staging / production]", ["staging", "production"]);
  }

  let mode = arg("live") ? "live" : arg("preview") ? "preview" : undefined;
  if (!mode) {
    mode = await ask(rl, "Live, or a preview channel? [live / preview]", ["live", "preview"]);
  }

  let channel = arg("channel");
  if (mode === "preview" && (channel === undefined || channel === true)) {
    const def = `preview-${new Date().toISOString().slice(0, 10)}`;
    const a = await ask(rl, `Channel name? [${def}]`);
    channel = a || def;
  }

  const withFunctions = Boolean(arg("functions"));
  const withRules = Boolean(arg("rules"));

  if (project === "production" && mode === "live") {
    const yes = await ask(rl, "This goes live on lailark.in. Type yes to continue:");
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
    if (!existsSync(resolve(ROOT, "site/package.json"))) {
      console.error("site/ is not set up yet (M1.1).");
      exit(1);
    }
    run("npm", ["run", "build", "--workspace", "site"]);
  }
  if (targets.includes("admin")) {
    if (!existsSync(resolve(ROOT, "admin/package.json"))) {
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
    const url = BATCH_URL[alias];
    const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", url]);
    const code = r.stdout?.toString().trim();
    if (code !== "200") {
      console.error(`\n!!! ${url} returned ${code}. Printed jars point here. Fix before anything else.`);
      exit(2);
    }
    console.log(`\n${url} → 200. Good.`);
  }

  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
