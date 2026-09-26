// Tests the reproducibility guarantee behind the /batch/001 byte-for-byte check
// (CLAUDE.md §3): a build of the same source must produce a byte-identical
// site/out/batch/001.html.
//
// M3.4b found that it did not. site/next.config.mjs set no `generateBuildId`, so Next
// minted a random build id per build and embedded it in the page, and two builds of
// identical source differed by exactly those 20 bytes. The check could therefore only
// pass against the very artifact that was deployed, which means it could not tell "the
// jar page changed" from "someone rebuilt" — the one distinction it exists to make.
//
// This file does NOT run `next build`. Two reasons. A full double build is far too slow
// for the unit suite, and (A253) `node --test` runs test files concurrently, so a test
// that removed or rewrote site/out or site/.next would race the other script tests that
// read the real site/out/batch/001.html. So the guarantee is tested where it is cheap
// and deterministic: the config's build id is a stable constant, it is not derived from
// the commit or the tree, and the build id actually embedded in the built record is that
// same constant. The double-build proof itself is in M3.4b's report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CONFIG_PATH = resolve(ROOT, "site", "next.config.mjs");
// The same record every other script test diffs against. Only read here, never
// written or renamed (A253).
const RECORD_PATH = resolve(ROOT, "site", "out", "batch", "001.html");
if (!existsSync(RECORD_PATH)) {
  throw new Error(
    `${RECORD_PATH} not found. Run "npm run build --workspace site" before running scripts/test/site-build-id.test.mjs.`,
  );
}

const config = (await import(`file://${CONFIG_PATH}`)).default;

test("site/next.config.mjs pins the build id with a generateBuildId function", () => {
  assert.equal(
    typeof config.generateBuildId,
    "function",
    "site/next.config.mjs must set generateBuildId, or Next mints a random build id per build and every /batch/001 byte comparison becomes meaningless (M3.4b)",
  );
});

test("the pinned build id is a non-empty string and the same on every call", async () => {
  const first = await config.generateBuildId();
  assert.equal(typeof first, "string");
  assert.ok(first.length > 0, "the build id must not be empty");
  for (let i = 0; i < 5; i += 1) {
    assert.equal(
      await config.generateBuildId(),
      first,
      "generateBuildId must return the same value on every call, in every process",
    );
  }
});

// The orchestrator's decision for M3.4b: a constant, not the commit sha and not a hash
// of the source tree. The daily guard (.github/workflows/check-batch-001.yml) builds
// the default branch fresh and compares against whatever is currently deployed, so a
// build id tracking the commit or the tree would fail on every commit that touched the
// site but not the /batch/001 page — reintroducing exactly the false signal M3.4b
// removed.
//
// The declaration check below is anchored at both ends on purpose. An unanchored
// regex matches a *prefix* of the right-hand side, so
// `() => "lailark-" + (process.env.VERCEL_GIT_COMMIT_SHA || "")` satisfies it: the
// literal is there, and everything concatenated onto it goes unseen. That mutation
// is exactly the regression this test exists to catch, and it survives the other
// three tests (it returns the same value on every call within a process, and if the
// build ran with it — as it does in CI, where the build precedes the tests — the
// embedded id matches it too). So the anchored literal is the real guard here. The
// forbidden-pattern list after it is a second line of defence and nothing more:
// it is a blocklist, so it can always be evaded by a name nobody thought of.
test("the build id is a literal constant, not derived from git, the tree or the environment", () => {
  const src = readFileSync(CONFIG_PATH, "utf8");
  const declLine = src.match(/^.*\bgenerateBuildId:.*$/m);
  assert.ok(declLine, "expected a single-line generateBuildId declaration in site/next.config.mjs");
  // Anchored at both ends of the declaration line: the whole right-hand side must be
  // one bare quoted string and nothing else. A trailing line comment is allowed; a
  // concatenation, a template literal, a call, a conditional or an env read is not.
  assert.match(
    declLine[0].trim(),
    /^generateBuildId:\s*(?:async\s*)?\(\)\s*=>\s*(["'])[^"'`]+\1\s*,?\s*(?:\/\/.*)?$/,
    `generateBuildId must be an arrow function whose entire body is a bare string literal, so the build id cannot track the commit, the tree or the environment (M3.4b). Found: ${declLine[0].trim()}`,
  );

  // Second line of defence, over the code with comments stripped — the comments in
  // this config legitimately discuss shas and hashes in prose, and scanning them
  // would fail on its own explanation. This config is hand-written and has no "//"
  // inside a string literal, which is the one case the strip would get wrong.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[ \t])\/\/.*$/gm, "$1");
  for (const [forbidden, what] of [
    [/process\.env/, "an environment variable"],
    [/child_process|execSync|execFileSync|spawnSync/, "a shelled-out command"],
    [/\bgit\b|GIT_|_GIT|GITHUB/i, "git"],
    [/\bSHA\b|SHA1|SHA256|_SHA|COMMIT|REVISION|BRANCH/i, "a commit id"],
    [/createHash|\bcrypto\b/, "a hash"],
    [/Date\.now|new Date|Date\.UTC|performance\.now/, "the clock"],
    [/Math\.random|randomUUID|randomBytes/, "a random value"],
    [/readFileSync|readdirSync|statSync/, "a read of the source tree"],
  ]) {
    assert.doesNotMatch(
      code,
      forbidden,
      `site/next.config.mjs must not derive the build id from ${what} (matched ${forbidden}) — M3.4b requires a constant`,
    );
  }
});

test("the build id embedded in the built /batch/001 record is the pinned constant", async () => {
  const expected = await config.generateBuildId();
  const record = readFileSync(RECORD_PATH, "utf8");
  // Next serialises the build id into the page's flight payload as \"b\":\"<id>\",
  // inside a JavaScript string, hence the escaped quotes.
  const found = [...record.matchAll(/\\"b\\":\\"([^\\]*)\\"/g)].map((m) => m[1]);
  assert.ok(
    found.length > 0,
    "no build id found in the built record — if Next changed how it embeds the build id, this test needs updating, but do not delete it: it is the only thing tying the pinned constant to the bytes the /batch/001 check compares",
  );
  for (const id of found) {
    assert.equal(
      id,
      expected,
      "the built record carries a build id that is not the pinned constant, so site/out/batch/001.html is not reproducible (M3.4b). Rebuild the site, and if it persists, find what else is minting an id.",
    );
  }
});
