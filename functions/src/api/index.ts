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
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    cors: false,
  },
  handleApiRequest,
);
