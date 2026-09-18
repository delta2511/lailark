/**
 * Firebase web SDK configuration.
 *
 * A web app config is public by design (the API key identifies the project, it
 * does not authorise anything: Auth and the security rules do). CLAUDE.md
 * section 3 allows it in the repo; nothing secret goes here.
 *
 * Production values come from `firebase apps:sdkconfig web --project lailark`.
 */
export interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
}

export const PROJECT_IDS = ["lailark", "tree-quiz-74e04"] as const;
export type ProjectId = (typeof PROJECT_IDS)[number];

export const production: FirebaseWebConfig = {
  apiKey: "AIzaSyBuM-P0x4vx9qNV2psQ4itvtVQTy9mUvNQ",
  authDomain: "lailark.firebaseapp.com",
  projectId: "lailark",
  storageBucket: "lailark.firebasestorage.app",
  messagingSenderId: "381330201718",
  appId: "1:381330201718:web:9d0052b22bb93a5bfe5357",
};

/**
 * Staging is the repurposed `tree-quiz-74e04` project (not a project literally
 * named "lailark-staging" — that name does not exist). Values below came from:
 * `firebase apps:sdkconfig WEB 1:168769355731:web:dd82afeb5cff871529f926 --project tree-quiz-74e04`
 */
export const staging: FirebaseWebConfig = {
  apiKey: "AIzaSyD0hyRuIVBS1TwrrmBUBsFVdCn3yDTerfk",
  authDomain: "tree-quiz-74e04.firebaseapp.com",
  projectId: "tree-quiz-74e04",
  storageBucket: "tree-quiz-74e04.firebasestorage.app",
  messagingSenderId: "168769355731",
  appId: "1:168769355731:web:dd82afeb5cff871529f926",
};

const configs: Record<ProjectId, FirebaseWebConfig> = {
  lailark: production,
  "tree-quiz-74e04": staging,
};

function isProjectId(value: string | undefined): value is ProjectId {
  return value === "lailark" || value === "tree-quiz-74e04";
}

/**
 * The config for a given VITE_FIREBASE_PROJECT value, defaulting to production.
 *
 * A generic Record lookup like this can't be reduced to a single object at
 * build time (it has to keep both configs around for any raw string), so
 * firebase.ts does NOT call this for the app's actual initialisation — it
 * compares import.meta.env.VITE_FIREBASE_PROJECT against a literal directly,
 * which lets the unselected project's config (and API key) be dropped from
 * that build entirely. This function exists for tests and any other code
 * that genuinely needs a project id -> config lookup.
 */
export function configFor(raw: string | undefined): FirebaseWebConfig {
  return configs[isProjectId(raw) ? raw : "lailark"];
}
