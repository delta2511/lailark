import { describe, expect, it } from "vitest";
import {
  authoriseSetRole,
  guardLastOwner,
  nextClaims,
  validateSetRoleInput,
  type AuthoriseContext,
  type SetRoleInput,
} from "./authorise";

const SECRET = "a-throwaway-bootstrap-secret";

function context(over: Partial<AuthoriseContext> = {}): AuthoriseContext {
  return {
    caller: { uid: null, role: undefined },
    usersEmpty: false,
    configuredSecret: SECRET,
    ...over,
  };
}

function input(over: Partial<SetRoleInput> = {}): SetRoleInput {
  return { phone: "+917736110087", role: "owner", ...over };
}

describe("validateSetRoleInput", () => {
  it("accepts a well formed call and trims the name", () => {
    const result = validateSetRoleInput({
      phone: " +919446587027 ",
      role: "kitchen",
      name: "  Sumayya  ",
    });
    expect(result).toEqual({
      ok: true,
      value: { phone: "+919446587027", role: "kitchen", name: "Sumayya" },
    });
  });

  it("keeps the bootstrap secret when one is sent, and drops an empty one", () => {
    expect(validateSetRoleInput({ phone: "+917736110087", role: "owner", bootstrapSecret: "x" })).
      toMatchObject({ ok: true, value: { bootstrapSecret: "x" } });
    expect(
      validateSetRoleInput({ phone: "+917736110087", role: "owner", bootstrapSecret: "" }),
    ).toEqual({ ok: true, value: { phone: "+917736110087", role: "owner" } });
  });

  it("refuses anything that is not an object with the right fields", () => {
    for (const raw of [undefined, null, "owner", 7, [], {}]) {
      expect(validateSetRoleInput(raw), JSON.stringify(raw)).toMatchObject({
        ok: false,
        code: "invalid-argument",
      });
    }
  });

  it("refuses a phone that is not E.164", () => {
    for (const phone of ["7736110087", "+0 7736110087", "917736110087", "", "+91abc", "+911"]) {
      expect(validateSetRoleInput({ phone, role: "owner" }), phone).toMatchObject({
        ok: false,
        code: "invalid-argument",
      });
    }
  });

  it("refuses a role that is not one of the three", () => {
    for (const role of ["admin", "Owner", "", undefined, 3]) {
      expect(validateSetRoleInput({ phone: "+917736110087", role }), String(role)).toMatchObject({
        ok: false,
        code: "invalid-argument",
      });
    }
  });

  it("refuses a name that is not text or is too long", () => {
    expect(validateSetRoleInput({ phone: "+917736110087", role: "owner", name: 5 })).toMatchObject({
      ok: false,
      code: "invalid-argument",
    });
    expect(
      validateSetRoleInput({ phone: "+917736110087", role: "owner", name: "x".repeat(81) }),
    ).toMatchObject({ ok: false, code: "invalid-argument" });
  });
});

describe("authoriseSetRole: the matrix", () => {
  it("lets an Owner through, whatever the users collection looks like", () => {
    for (const usersEmpty of [true, false]) {
      expect(
        authoriseSetRole(input(), context({ caller: { uid: "u1", role: "owner" }, usersEmpty })),
      ).toEqual({ ok: true, by: "owner", actor: "u1" });
    }
  });

  it("refuses Kitchen, Viewer and a roleless signed-in caller with permission-denied", () => {
    for (const role of ["kitchen", "viewer", undefined, null, "", "OWNER"]) {
      expect(
        authoriseSetRole(input(), context({ caller: { uid: "u2", role } })),
        String(role),
      ).toMatchObject({ ok: false, code: "permission-denied" });
    }
  });

  it("refuses an anonymous caller with unauthenticated", () => {
    expect(authoriseSetRole(input(), context())).toMatchObject({
      ok: false,
      code: "unauthenticated",
    });
  });

  it("lets the bootstrap secret through only while users is empty", () => {
    expect(
      authoriseSetRole(input({ bootstrapSecret: SECRET }), context({ usersEmpty: true })),
    ).toEqual({ ok: true, by: "bootstrap", actor: "bootstrap" });

    expect(
      authoriseSetRole(input({ bootstrapSecret: SECRET }), context({ usersEmpty: false })),
    ).toMatchObject({ ok: false, code: "failed-precondition" });
  });

  it("refuses a wrong bootstrap secret, and one of the wrong length, with permission-denied", () => {
    for (const offered of ["wrong", `${SECRET}x`, SECRET.slice(0, -1), SECRET.toUpperCase()]) {
      expect(
        authoriseSetRole(input({ bootstrapSecret: offered }), context({ usersEmpty: true })),
        offered,
      ).toMatchObject({ ok: false, code: "permission-denied" });
    }
  });

  it("refuses the bootstrap path when no secret is configured", () => {
    expect(
      authoriseSetRole(
        input({ bootstrapSecret: SECRET }),
        context({ usersEmpty: true, configuredSecret: "" }),
      ),
    ).toMatchObject({ ok: false, code: "failed-precondition" });
  });

  it("prefers the Owner claim over a bad secret", () => {
    expect(
      authoriseSetRole(
        input({ bootstrapSecret: "wrong" }),
        context({ caller: { uid: "u1", role: "owner" }, usersEmpty: false }),
      ),
    ).toEqual({ ok: true, by: "owner", actor: "u1" });
  });
});

describe("nextClaims", () => {
  it("merges the new role into existing claims and reports the change", () => {
    expect(nextClaims({ foo: 1, role: "owner" }, "viewer")).toEqual({
      claims: { foo: 1, role: "viewer" },
      roleChanged: true,
    });
  });

  it("reports no change when the role is already the same", () => {
    expect(nextClaims({ foo: 1, role: "owner" }, "owner")).toEqual({
      claims: { foo: 1, role: "owner" },
      roleChanged: false,
    });
  });

  it("treats a first grant, with no existing claims, as a change", () => {
    expect(nextClaims(undefined, "owner")).toEqual({
      claims: { role: "owner" },
      roleChanged: true,
    });
  });
});

describe("guardLastOwner", () => {
  it("refuses to demote the only Owner", () => {
    expect(guardLastOwner({ targetUid: "u1", newRole: "viewer", ownerUids: ["u1"] })).toMatchObject({
      ok: false,
      code: "failed-precondition",
    });
    expect(guardLastOwner({ targetUid: "u1", newRole: "kitchen", ownerUids: ["u1"] })).toMatchObject(
      { ok: false },
    );
  });

  it("allows a demotion when another Owner remains", () => {
    expect(guardLastOwner({ targetUid: "u1", newRole: "viewer", ownerUids: ["u1", "u2"] })).toEqual({
      ok: true,
    });
  });

  it("allows setting Owner again, and allows anyone who is not an Owner to change", () => {
    expect(guardLastOwner({ targetUid: "u1", newRole: "owner", ownerUids: ["u1"] })).toEqual({
      ok: true,
    });
    expect(guardLastOwner({ targetUid: "u9", newRole: "viewer", ownerUids: ["u1"] })).toEqual({
      ok: true,
    });
  });
});
