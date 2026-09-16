/**
 * The one place the Firebase web SDK is initialised.
 *
 * Emulators (A10 ports) are used when the dev server is running or when the
 * build was made with VITE_USE_EMULATORS=1 (the Playwright build). A
 * deployable build never talks to an emulator.
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";

import { configFor } from "./firebase-config";

/** Region for everything server-side (CLAUDE.md section 3, ST3). */
export const REGION = "asia-south1";

const EMULATOR_HOST = "127.0.0.1";
const AUTH_EMULATOR_PORT = 9099;
const FIRESTORE_EMULATOR_PORT = 8080;
const FUNCTIONS_EMULATOR_PORT = 5001;

export const useEmulators: boolean =
  import.meta.env.DEV || import.meta.env.VITE_USE_EMULATORS === "1";

export const app: FirebaseApp = initializeApp(configFor(import.meta.env.VITE_FIREBASE_PROJECT));

/**
 * Auth keeps its default persistence (indexedDB, falling back to
 * localStorage), so a signed-in session survives a reload and a relaunch.
 * ST4: each OTP is a billed SMS, so signing in should be rare.
 */
export const auth: Auth = getAuth(app);

/**
 * Firestore with the persistent local cache and the multi-tab manager, so the
 * admin keeps working on a weak signal (brief section 17.1) and M1.7's offline
 * pill has something to stand on.
 */
export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const functions: Functions = getFunctions(app, REGION);

if (useEmulators) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
  connectFunctionsEmulator(functions, EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
}
