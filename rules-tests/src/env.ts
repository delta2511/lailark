/**
 * One test environment for both rule files, pointed at the emulators
 * `firebase emulators:exec` started around this run.
 *
 * Deliberately hub-less: `initializeTestEnvironment` can discover ports from
 * the emulator hub, but the hub is not guaranteed to be up under
 * `emulators:exec --only firestore,storage`, and a silent fall-through to the
 * *production* project would be the worst possible failure mode for a file
 * full of `assertFails`. So the host and port are read from the environment
 * variables the CLI exports, and fall back to the ports written in
 * `firebase.json`. If nothing is listening the run fails loudly at startup.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

const here = dirname(fileURLToPath(import.meta.url));

/** The repo root: `rules-tests/src/..` twice. */
export const REPO_ROOT = resolve(here, "..", "..");

export const FIRESTORE_RULES_PATH = resolve(REPO_ROOT, "firestore.rules");
export const STORAGE_RULES_PATH = resolve(REPO_ROOT, "storage.rules");

/** Matches `firebase emulators:exec --project lailark`. */
export const PROJECT_ID = "lailark";

/** The uids the contexts below sign in as. */
export const OWNER_UID = "uid-owner";
export const KITCHEN_UID = "uid-kitchen";
export const VIEWER_UID = "uid-viewer";
export const NO_ROLE_UID = "uid-no-role";

function hostAndPort(envName: string, fallbackPort: number): { host: string; port: number } {
  const raw = process.env[envName];
  if (!raw) return { host: "127.0.0.1", port: fallbackPort };
  const bare = raw.replace(/^https?:\/\//, "");
  const lastColon = bare.lastIndexOf(":");
  if (lastColon < 0) return { host: bare, port: fallbackPort };
  const port = Number(bare.slice(lastColon + 1));
  return {
    host: bare.slice(0, lastColon) || "127.0.0.1",
    port: Number.isFinite(port) && port > 0 ? port : fallbackPort,
  };
}

export async function makeTestEnvironment(): Promise<RulesTestEnvironment> {
  const firestore = hostAndPort("FIRESTORE_EMULATOR_HOST", 8080);
  const storage = hostAndPort("FIREBASE_STORAGE_EMULATOR_HOST", 9199);

  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: firestore.host,
      port: firestore.port,
      rules: readFileSync(FIRESTORE_RULES_PATH, "utf8"),
    },
    storage: {
      host: storage.host,
      port: storage.port,
      rules: readFileSync(STORAGE_RULES_PATH, "utf8"),
    },
  });
}

/** The five callers every test in this package is written against. */
export interface Callers {
  /** Nobody. The public internet. */
  readonly unauth: RulesTestContext;
  /** Shefin. */
  readonly owner: RulesTestContext;
  /** Sumayya. */
  readonly kitchen: RulesTestContext;
  /** The CA or a helper, decision D13: read-only, sees Money. */
  readonly viewer: RulesTestContext;
  /**
   * Signed in through phone auth but with no `role` claim: any phone number
   * on earth can reach this state, because Firebase Auth creates a user for
   * whoever passes an OTP (assumption A31). This caller must see nothing.
   */
  readonly noRole: RulesTestContext;
}

export function callers(env: RulesTestEnvironment): Callers {
  return {
    unauth: env.unauthenticatedContext(),
    owner: env.authenticatedContext(OWNER_UID, { role: "owner" }),
    kitchen: env.authenticatedContext(KITCHEN_UID, { role: "kitchen" }),
    viewer: env.authenticatedContext(VIEWER_UID, { role: "viewer" }),
    noRole: env.authenticatedContext(NO_ROLE_UID, {}),
  };
}

/** The four signed-in callers, for "nobody may write this" loops. */
export function everyRole(c: Callers): ReadonlyArray<readonly [string, RulesTestContext]> {
  return [
    ["owner", c.owner],
    ["kitchen", c.kitchen],
    ["viewer", c.viewer],
    ["noRole", c.noRole],
    ["unauth", c.unauth],
  ];
}
