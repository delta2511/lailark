import { describe, expect, it } from "vitest";
import { configFor } from "./firebase-config";

describe("configFor", () => {
  it("returns the staging config (the repurposed tree-quiz-74e04 project) for that project id", () => {
    const config = configFor("tree-quiz-74e04");
    expect(config.projectId).toBe("tree-quiz-74e04");
    expect(config.authDomain).toBe("tree-quiz-74e04.firebaseapp.com");
  });

  it("returns the production config for the production project id", () => {
    expect(configFor("lailark").projectId).toBe("lailark");
  });

  it("falls back to production for an unknown or missing value", () => {
    expect(configFor(undefined).projectId).toBe("lailark");
    expect(configFor("lailark-staging").projectId).toBe("lailark");
    expect(configFor("made-up-project").projectId).toBe("lailark");
  });
});
