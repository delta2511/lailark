import { onRequest } from "firebase-functions/v2/https";
import { REGION, DEFAULT_MAX_INSTANCES } from "../lib/options";
import { handleApiRequest } from "./router";

/**
 * HTTP entry point mounted at /api/* by the customer Hosting site's rewrite
 * (firebase.json). Small maxInstances by default: this is a low-traffic
 * scaffold today (just /api/health); later handlers can raise it if needed.
 */
export const api = onRequest(
  {
    // A callable's own auth is the Firebase Auth token this function checks
    // for itself, not IAM: Cloud Run must therefore let an anonymous request
    // reach it, or the SDK's call is refused before any of our code runs.
    // The CLI applies this on create, and a function whose first build failed
    // never got it (A254), so every export states it rather than inheriting
    // whatever a past deploy happened to leave behind.
    invoker: "public",
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    cors: false,
  },
  handleApiRequest,
);
