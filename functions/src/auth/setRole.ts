/**
 * `setRole`: the only way a phone number becomes an admin user.
 *
 * It writes the role in two places, on purpose:
 *  - a custom claim on the Firebase Auth user, which is what the Firestore
 *    security rules read (brief section 18.1); and
 *  - `users/{uid}`, which is what admin screens read for the name.
 *
 * Who may call it is decided in ./authorise, which has no Firebase in it.
 */
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { authoriseSetRole, guardLastOwner, nextClaims, validateSetRoleInput } from "./authorise";

/**
 * Lives in Secret Manager in a real project; the emulator reads it from
 * functions/.secret.local, which is gitignored. It is only ever accepted
 * while the users collection is empty.
 */
const BOOTSTRAP_SECRET = defineSecret("SETROLE_BOOTSTRAP_SECRET");

export const setRole = onCall(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    secrets: [BOOTSTRAP_SECRET],
    // App Check arrives with M5.9; until then the claim check is the gate.
    enforceAppCheck: false,
  },
  async (request) => {
    const validated = validateSetRoleInput(request.data);
    if (!validated.ok) throw new HttpsError(validated.code, validated.message);
    const input = validated.value;

    const db = getFirestore(getAdminApp());
    const auth = getAuth(getAdminApp());

    const anyUser = await db.collection("users").limit(1).get();

    const decision = authoriseSetRole(input, {
      caller: {
        uid: request.auth?.uid ?? null,
        role: request.auth?.token?.role,
      },
      usersEmpty: anyUser.empty,
      configuredSecret: readSecret(),
    });
    if (!decision.ok) throw new HttpsError(decision.code, decision.message);

    const user = await findOrCreateByPhone(auth, input.phone);

    const owners = await db.collection("users").where("role", "==", "owner").get();
    const guard = guardLastOwner({
      targetUid: user.uid,
      newRole: input.role,
      ownerUids: owners.docs.map((doc) => doc.id),
    });
    if (!guard.ok) throw new HttpsError(guard.code, guard.message);

    // Merge into whatever claims the user already has — `setCustomUserClaims`
    // replaces the claim set wholesale, and `role` is not the only claim
    // this project may ever set.
    const { claims, roleChanged } = nextClaims(user.customClaims, input.role);
    await auth.setCustomUserClaims(user.uid, claims);

    // Firestore rules and every `onCall` read the `role` claim off the
    // caller's *current* ID token, and a token already issued keeps its old
    // claims baked in for up to an hour. Revoking refresh tokens forces the
    // client's next silent refresh to fetch a fresh token with the new
    // claim — the admin app re-reads the token on load, so it picks this up
    // on its next page load / token refresh. It does not invalidate an
    // access token that is already in a caller's hand and not yet expired
    // (see the emulator note in check-setrole.mjs / the fix-round report).
    if (roleChanged) {
      await auth.revokeRefreshTokens(user.uid);
    }

    const ref = db.collection("users").doc(user.uid);
    const existing = await ref.get();
    const now = FieldValue.serverTimestamp();
    const previousName = existing.exists ? (existing.get("name") as string | undefined) : undefined;

    await ref.set(
      {
        name: input.name ?? previousName ?? input.phone,
        phone: input.phone,
        role: input.role,
        active: true,
        updatedAt: now,
        updatedBy: decision.actor,
        ...(existing.exists ? {} : { createdAt: now, createdBy: decision.actor }),
      },
      { merge: true },
    );

    return { uid: user.uid, role: input.role };
  },
);

/** The Auth user for this number, created with no other detail if new. */
async function findOrCreateByPhone(
  auth: ReturnType<typeof getAuth>,
  phone: string,
): Promise<UserRecord> {
  try {
    return await auth.getUserByPhoneNumber(phone);
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") {
      return auth.createUser({ phoneNumber: phone });
    }
    throw error;
  }
}

/**
 * `.value()` throws when the secret is not bound (a local `tsc` run, a unit
 * test). An empty string then means "no bootstrap possible", which is the
 * safe reading.
 */
function readSecret(): string {
  try {
    return BOOTSTRAP_SECRET.value() ?? "";
  } catch {
    return "";
  }
}
