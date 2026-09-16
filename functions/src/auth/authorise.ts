/**
 * The decisions behind the `setRole` callable, with no Firebase in them, so
 * the authorisation matrix can be tested directly.
 *
 * Two ways in, and only two (D13, brief section 17.12):
 *  - the caller's own token says role === "owner"; or
 *  - the `users` collection is still empty and the call carries the bootstrap
 *    secret. That is the one-time way the first Owner gets a role, since
 *    there is no Owner yet to grant it.
 */
import { timingSafeEqual } from "node:crypto";
import { ROLES, type Role } from "@lailark/shared";

/** The subset of HttpsError codes this callable ever raises. */
export type ErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "failed-precondition";

export interface SetRoleInput {
  readonly phone: string;
  readonly role: Role;
  readonly name?: string;
  readonly bootstrapSecret?: string;
}

export interface Caller {
  /** null when the call carries no Firebase Auth token. */
  readonly uid: string | null;
  /** The `role` custom claim on that token, whatever it says. */
  readonly role: unknown;
}

export interface AuthoriseContext {
  readonly caller: Caller;
  /** True when `users` has no documents at all. */
  readonly usersEmpty: boolean;
  /** The configured bootstrap secret, or "" when none is bound. */
  readonly configuredSecret: string;
}

export type Failure = { readonly ok: false; readonly code: ErrorCode; readonly message: string };
export type Validated = { readonly ok: true; readonly value: SetRoleInput };
export type Authorised = { readonly ok: true; readonly by: "owner" | "bootstrap"; readonly actor: string };

/** E.164: a plus, a country code that does not start with zero, up to 15 digits. */
const E164 = /^\+[1-9]\d{7,14}$/;
const MAX_NAME = 80;

export function validateSetRoleInput(raw: unknown): Validated | Failure {
  if (typeof raw !== "object" || raw === null) {
    return invalid("setRole needs an object with phone and role.");
  }
  const data = raw as Record<string, unknown>;

  if (typeof data.phone !== "string" || !E164.test(data.phone.trim())) {
    return invalid("phone must be in E.164 form, for example +917736110087.");
  }
  if (typeof data.role !== "string" || !(ROLES as readonly string[]).includes(data.role)) {
    return invalid(`role must be one of ${ROLES.join(", ")}.`);
  }

  let name: string | undefined;
  if (data.name !== undefined && data.name !== null) {
    if (typeof data.name !== "string") return invalid("name must be text.");
    const trimmed = data.name.trim();
    if (trimmed.length > MAX_NAME) return invalid(`name must be ${MAX_NAME} characters or fewer.`);
    if (trimmed !== "") name = trimmed;
  }

  if (data.bootstrapSecret !== undefined && typeof data.bootstrapSecret !== "string") {
    return invalid("bootstrapSecret must be text.");
  }

  return {
    ok: true,
    value: {
      phone: data.phone.trim(),
      role: data.role as Role,
      ...(name === undefined ? {} : { name }),
      ...(typeof data.bootstrapSecret === "string" && data.bootstrapSecret !== ""
        ? { bootstrapSecret: data.bootstrapSecret }
        : {}),
    },
  };
}

export function authoriseSetRole(input: SetRoleInput, context: AuthoriseContext): Authorised | Failure {
  const { caller, usersEmpty, configuredSecret } = context;

  if (caller.uid !== null && caller.role === "owner") {
    return { ok: true, by: "owner", actor: caller.uid };
  }

  const offered = input.bootstrapSecret;
  if (offered !== undefined && offered !== "") {
    if (!usersEmpty) {
      return {
        ok: false,
        code: "failed-precondition",
        message: "The bootstrap secret only works while the users list is empty. Ask an Owner.",
      };
    }
    if (configuredSecret === "") {
      return {
        ok: false,
        code: "failed-precondition",
        message: "No bootstrap secret is configured for this project.",
      };
    }
    if (!secretsMatch(offered, configuredSecret)) {
      return { ok: false, code: "permission-denied", message: "That bootstrap secret is wrong." };
    }
    return { ok: true, by: "bootstrap", actor: "bootstrap" };
  }

  if (caller.uid === null) {
    return { ok: false, code: "unauthenticated", message: "Sign in first." };
  }
  return { ok: false, code: "permission-denied", message: "Only an Owner can set a role." };
}

/**
 * Merges the new role into whatever custom claims the user already carries,
 * so `setRole` never clobbers a claim it doesn't know about (brief section
 * 18.1 only specifies `role`; anything else on the token is not ours to
 * drop). Also reports whether the role itself changed, since that is the
 * signal for whether outstanding tokens need to be revoked.
 */
export function nextClaims(
  existing: Record<string, unknown> | undefined,
  role: Role,
): { readonly claims: Record<string, unknown>; readonly roleChanged: boolean } {
  const base = existing ?? {};
  return {
    claims: { ...base, role },
    roleChanged: base.role !== role,
  };
}

/**
 * An Owner may not take the last Owner away, themselves included: the system
 * would then have no one who can grant a role, and no bootstrap either
 * (the users list is not empty any more).
 */
export function guardLastOwner(args: {
  readonly targetUid: string;
  readonly newRole: Role;
  /** Every uid whose users document currently says role === "owner". */
  readonly ownerUids: readonly string[];
}): { readonly ok: true } | Failure {
  const { targetUid, newRole, ownerUids } = args;
  if (newRole === "owner") return { ok: true };
  if (!ownerUids.includes(targetUid)) return { ok: true };
  if (ownerUids.length > 1) return { ok: true };
  return {
    ok: false,
    code: "failed-precondition",
    message: "This is the only Owner. Make someone else an Owner first.",
  };
}

function invalid(message: string): Failure {
  return { ok: false, code: "invalid-argument", message };
}

function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
