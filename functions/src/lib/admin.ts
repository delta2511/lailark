import { getApps, initializeApp, type App } from "firebase-admin/app";

/**
 * Lazily-initialised, singleton Firebase Admin app. Every function that
 * touches Firestore/Auth/Storage should go through this instead of calling
 * initializeApp() itself, so the SDK is only ever initialised once per
 * instance.
 */
let app: App | undefined;

export function getAdminApp(): App {
  if (!app) {
    app = getApps()[0] ?? initializeApp();
  }
  return app;
}
