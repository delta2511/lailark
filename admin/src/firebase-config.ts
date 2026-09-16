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

export const PROJECT_IDS = ["lailark", "lailark-staging"] as const;
export type ProjectId = (typeof PROJECT_IDS)[number];

const production: FirebaseWebConfig = {
  apiKey: "AIzaSyBuM-P0x4vx9qNV2psQ4itvtVQTy9mUvNQ",
  authDomain: "lailark.firebaseapp.com",
  projectId: "lailark",
  storageBucket: "lailark.firebasestorage.app",
  messagingSenderId: "381330201718",
  appId: "1:381330201718:web:9d0052b22bb93a5bfe5357",
};

/**
 * TODO(Q2): the `lailark-staging` project does not exist yet, so there is no
 * web app to read a config from. Replace every value below with the output of
 * `firebase apps:sdkconfig web --project lailark-staging` once Shefin creates
 * it. The emulator does not read these values, so local work is unaffected.
 */
const staging: FirebaseWebConfig = {
  apiKey: "TODO(Q2)",
  authDomain: "lailark-staging.firebaseapp.com",
  projectId: "lailark-staging",
  storageBucket: "lailark-staging.firebasestorage.app",
  messagingSenderId: "TODO(Q2)",
  appId: "TODO(Q2)",
};

const configs: Record<ProjectId, FirebaseWebConfig> = {
  lailark: production,
  "lailark-staging": staging,
};

function isProjectId(value: string | undefined): value is ProjectId {
  return value === "lailark" || value === "lailark-staging";
}

/** The config for VITE_FIREBASE_PROJECT, defaulting to production. */
export function configFor(raw: string | undefined): FirebaseWebConfig {
  return configs[isProjectId(raw) ? raw : "lailark"];
}
