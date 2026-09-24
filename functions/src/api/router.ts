import { getFirestore } from "firebase-admin/firestore";
import { SHARED_VERSION } from "@lailark/shared";

import { getAdminApp } from "../lib/admin";
import { getProjectId } from "../lib/project";
import { computeCounts, type CountsPayload } from "./counts";

/**
 * Minimal request/response shapes the router needs. The real onRequest
 * handler is passed an Express-compatible Request/Response (firebase-functions
 * v2 https.Request extends express.Request), which satisfies this structurally
 * -- these narrower interfaces exist so the router can be unit-tested with
 * plain fake objects, no emulator required.
 */
export interface ApiRequestLike {
  path: string;
  method: string;
}

export interface ApiResponseLike {
  status(code: number): ApiResponseLike;
  set(name: string, value: string): ApiResponseLike;
  json(body: unknown): void;
}

/**
 * Dependencies the router may need beyond the request/response, injected so
 * `/counts` can be unit tested (this file's own style: plain fake objects,
 * no emulator) without a real Firestore behind it. `handleApiRequest` falls
 * back to the real, Firestore-backed `computeCounts` when none is given.
 */
export interface ApiDeps {
  getCounts?(): Promise<CountsPayload>;
}

function defaultGetCounts(): Promise<CountsPayload> {
  return computeCounts(getFirestore(getAdminApp()));
}

/**
 * Hand-written router for the `api` function (no Express: prefer the
 * platform for a single-route scaffold). Hosting rewrites (`/api/**`) pass
 * the full original path through, so a request routed via
 * https://<host>/api/health arrives here with req.path === "/api/health".
 * The direct function URL already has the function name ("api") as its own
 * path segment, so a call to .../api/health arrives with req.path ===
 * "/health". Stripping a single leading "/api" segment (if present) before
 * matching handles both shapes with one code path.
 */
export function handleApiRequest(
  req: ApiRequestLike,
  res: ApiResponseLike,
  deps: ApiDeps = {},
): void | Promise<void> {
  const path = stripLeadingApiSegment(req.path);

  if (path === "/health") {
    if (req.method !== "GET") {
      res
        .status(405)
        .set("Cache-Control", "no-store")
        .json({ ok: false, error: "method not allowed" });
      return;
    }

    res
      .status(200)
      .set("Cache-Control", "no-store")
      .json({ ok: true, project: getProjectId(), shared: SHARED_VERSION });
    return;
  }

  if (path === "/counts") {
    if (req.method !== "GET") {
      res
        .status(405)
        .set("Cache-Control", "no-store")
        .json({ ok: false, error: "method not allowed" });
      return;
    }

    const getCounts = deps.getCounts ?? defaultGetCounts;
    return getCounts()
      .then((payload) => {
        // Brief §19.2: cached at the CDN for 15 seconds. Public, so Hosting
        // may cache the whole response for any caller during that window.
        res.status(200).set("Cache-Control", "public, max-age=15, s-maxage=15").json(payload);
      })
      .catch(() => {
        // Never a stale or invented count: a read failure is a 503 with no
        // caching, so `site/app/_lib/counts.js` degrades to "unavailable"
        // rather than a card drawing a number that could not be trusted.
        res
          .status(503)
          .set("Cache-Control", "no-store")
          .json({ ok: false, error: "counts unavailable" });
      });
  }

  res.status(404).json({ ok: false, error: "not found" });
}

function stripLeadingApiSegment(path: string): string {
  if (path === "/api") {
    return "/";
  }
  if (path.startsWith("/api/")) {
    return path.slice("/api".length);
  }
  return path;
}
