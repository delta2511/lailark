import { describe, expect, it } from "vitest";
import { roleFromClaims } from "./session";

describe("roleFromClaims", () => {
  it("accepts the three roles and nothing else", () => {
    expect(roleFromClaims({ role: "owner" })).toBe("owner");
    expect(roleFromClaims({ role: "kitchen" })).toBe("kitchen");
    expect(roleFromClaims({ role: "viewer" })).toBe("viewer");
  });

  it("refuses a made up role", () => {
    expect(roleFromClaims({ role: "admin" })).toBeNull();
    expect(roleFromClaims({ role: "Owner" })).toBeNull();
    expect(roleFromClaims({ role: "" })).toBeNull();
  });

  it("refuses a token with no role at all", () => {
    expect(roleFromClaims({})).toBeNull();
    expect(roleFromClaims({ role: 1 })).toBeNull();
    expect(roleFromClaims(null)).toBeNull();
    expect(roleFromClaims(undefined)).toBeNull();
    expect(roleFromClaims("owner")).toBeNull();
  });
});
