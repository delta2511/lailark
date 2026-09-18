import { SHARED_VERSION } from "@lailark/shared";

import { getProjectId } from "../lib/project";

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
 * Hand-written router for the `api` function (no Express: prefer the
 * platform for a single-route scaffold). Hosting rewrites (`/api/**`) pass
 * the full original path through, so a request routed via
 * https://<host>/api/health arrives here with req.path === "/api/health".
 * The direct function URL already has the function name ("api") as its own
 * path segment, so a call to .../api/health arrives with req.path ===
 * "/health". Stripping a single leading "/api" segment (if present) before
 * matching handles both shapes with one code path.
 */
export function handleApiRequest(req: ApiRequestLike, res: ApiResponseLike): void {
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
