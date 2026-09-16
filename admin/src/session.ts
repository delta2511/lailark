/**
 * The role is a custom claim on the Firebase Auth user, set by the `setRole`
 * callable. The `users/{uid}` document carries the name and is a convenience:
 * the claim is what decides whether anyone gets in, and it is what the
 * Firestore rules read (brief section 18.1).
 */
import { ROLES, type Role } from "@lailark/shared";

/** The signed-in admin user, as the shell and its screens need it. */
export interface Session {
  readonly name: string;
  readonly role: Role;
  readonly phone: string;
}

/** The claim, if it is one of the three roles. Anything else is not admin. */
export function roleFromClaims(claims: unknown): Role | null {
  if (typeof claims !== "object" || claims === null) return null;
  const role = (claims as Record<string, unknown>).role;
  if (typeof role !== "string") return null;
  return (ROLES as readonly string[]).includes(role) ? (role as Role) : null;
}
