import { describe, expect, it } from "vitest";
import { resolveDisplayName, roleFromClaims } from "./session";

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

describe("resolveDisplayName", () => {
  it("prefers the users/{uid} document's name when it has one", () => {
    expect(resolveDisplayName("Shefin", "Auth Name", "9446587027")).toBe("Shefin");
  });

  it("falls back to the Auth user's displayName when the doc has no name", () => {
    expect(resolveDisplayName(undefined, "Sumayya", "9446587027")).toBe("Sumayya");
    expect(resolveDisplayName(null, "Sumayya", "9446587027")).toBe("Sumayya");
    expect(resolveDisplayName("", "Sumayya", "9446587027")).toBe("Sumayya");
    expect(resolveDisplayName("   ", "Sumayya", "9446587027")).toBe("Sumayya");
  });

  it("falls back to the phone number when neither the doc nor Auth has a name", () => {
    expect(resolveDisplayName(undefined, null, "9446587027")).toBe("9446587027");
    expect(resolveDisplayName(undefined, "", "9446587027")).toBe("9446587027");
    expect(resolveDisplayName(undefined, undefined, "9446587027")).toBe("9446587027");
  });
});
