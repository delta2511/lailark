import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AUTH_EMULATOR, FIRESTORE_EMULATOR } from "./emulator";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const START_EMULATORS = [
  "The Firebase emulators are not running.",
  "",
  "Run `npm test -w @lailark/admin` from the repo root, which starts them for the run,",
  "or start `npm run emulators` first and then `npx playwright test` from admin/.",
].join("\n");

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status < 600;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  const auth = await reachable(AUTH_EMULATOR);
  const firestore = await reachable(FIRESTORE_EMULATOR);
  if (!auth || !firestore) {
    throw new Error(
      `${START_EMULATORS}\n\nauth ${AUTH_EMULATOR}: ${auth ? "up" : "down"}\n` +
        `firestore ${FIRESTORE_EMULATOR}: ${firestore ? "up" : "down"}`,
    );
  }

  const seed = spawnSync(
    process.execPath,
    [join(repoRoot, "functions", "scripts", "seed-users.mjs"), "--emulator"],
    { stdio: "inherit" },
  );
  if (seed.status !== 0) {
    throw new Error("seed-users failed; the admin allowlist was not seeded.");
  }
}
