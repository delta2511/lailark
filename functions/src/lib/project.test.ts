import { afterEach, describe, expect, it } from "vitest";
import { getProjectId } from "./project";

const originalGcloudProject = process.env.GCLOUD_PROJECT;
const originalFirebaseConfig = process.env.FIREBASE_CONFIG;

function restoreEnv(name: "GCLOUD_PROJECT" | "FIREBASE_CONFIG", original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = original;
  }
}

afterEach(() => {
  restoreEnv("GCLOUD_PROJECT", originalGcloudProject);
  restoreEnv("FIREBASE_CONFIG", originalFirebaseConfig);
});

describe("getProjectId", () => {
  it("reads GCLOUD_PROJECT when set", () => {
    process.env.GCLOUD_PROJECT = "lailark";
    delete process.env.FIREBASE_CONFIG;

    expect(getProjectId()).toBe("lailark");
  });

  it("prefers GCLOUD_PROJECT over FIREBASE_CONFIG when both are set", () => {
    process.env.GCLOUD_PROJECT = "lailark";
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "lailark-staging" });

    expect(getProjectId()).toBe("lailark");
  });

  it("falls back to FIREBASE_CONFIG's projectId when GCLOUD_PROJECT is unset", () => {
    delete process.env.GCLOUD_PROJECT;
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "lailark-staging" });

    expect(getProjectId()).toBe("lailark-staging");
  });

  it("returns 'unknown' when FIREBASE_CONFIG is malformed JSON", () => {
    delete process.env.GCLOUD_PROJECT;
    process.env.FIREBASE_CONFIG = "not-json";

    expect(getProjectId()).toBe("unknown");
  });

  it("returns 'unknown' when neither is set", () => {
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIREBASE_CONFIG;

    expect(getProjectId()).toBe("unknown");
  });
});
