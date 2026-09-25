import { getFirestore } from "firebase-admin/firestore";
import { isOrderToken, SHARED_VERSION } from "@lailark/shared";

import { getAdminApp } from "../lib/admin";
import { getProjectId } from "../lib/project";
import { computeCounts, type CountsPayload } from "./counts";
import { addToNotifyList, type NotifyResult } from "./notify";
import { readPublicOrder, type PublicOrderPayload } from "./order";

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
  /** Parsed JSON body, for the one route that takes a POST. */
  body?: unknown;
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
  getOrder?(token: string): Promise<PublicOrderPayload | null>;
  addNotify?(body: unknown): Promise<NotifyResult>;
}

function defaultGetCounts(): Promise<CountsPayload> {
  return computeCounts(getFirestore(getAdminApp()));
}

function defaultGetOrder(token: string): Promise<PublicOrderPayload | null> {
  return readPublicOrder(getFirestore(getAdminApp()), token);
}

function defaultAddNotify(body: unknown): Promise<NotifyResult> {
  return addToNotifyList(getFirestore(getAdminApp()), body);
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

  // `POST /api/notify`: the notify-me beside a batch on the stove (brief
  // §7.5, D64). Never cached, and it never answers with anything about who
  // is already on the list.
  if (path === "/notify") {
    if (req.method !== "POST") {
      res
        .status(405)
        .set("Cache-Control", "no-store")
        .json({ ok: false, error: "method not allowed" });
      return;
    }
    const addNotify = deps.addNotify ?? defaultAddNotify;
    return addNotify(req.body)
      .then((out) => {
        if (out.ok) {
          res.status(200).set("Cache-Control", "no-store").json({ ok: true });
          return;
        }
        res
          .status(out.status)
          .set("Cache-Control", "no-store")
          .json({ ok: false, error: out.message });
      })
      .catch(() => {
        res
          .status(503)
          .set("Cache-Control", "no-store")
          .json({ ok: false, error: "We could not add you just now. Please try again in a moment." });
      });
  }

  // `/api/order/<token>`: the private order page's only source (brief §5).
  // M3.8. Never cached anywhere: `no-store` on every answer, the 404
  // included, so a CDN cannot hold somebody's address or bill.
  if (path.startsWith("/order/")) {
    if (req.method !== "GET") {
      res
        .status(405)
        .set("Cache-Control", "no-store")
        .json({ ok: false, error: "method not allowed" });
      return;
    }
    const token = decodeToken(path.slice("/order/".length));
    // The shape is checked here, at the edge, before anything is asked of
    // Firestore. `readPublicOrder` checks it too and always will, but a
    // caller should not be able to reach a read at all with a string that
    // cannot be a token, and a mistyped link should not be an exception
    // escaping this handler (M3.8 round 2).
    if (token === null || !isOrderToken(token)) {
      res.status(404).set("Cache-Control", "no-store").json({ ok: false, error: "not found" });
      return;
    }
    const getOrder = deps.getOrder ?? defaultGetOrder;
    return getOrder(token)
      .then((payload) => {
        // One answer for a token that is the wrong shape, a token nobody
        // has, and a token that has been superseded: a caller learns
        // nothing from the difference.
        if (payload === null) {
          res.status(404).set("Cache-Control", "no-store").json({ ok: false, error: "not found" });
          return;
        }
        res.status(200).set("Cache-Control", "no-store").json(payload);
      })
      .catch(() => {
        res
          .status(503)
          .set("Cache-Control", "no-store")
          .json({ ok: false, error: "order unavailable" });
      });
  }

  res.status(404).set("Cache-Control", "no-store").json({ ok: false, error: "not found" });
}

/**
 * The token out of the path, or null when the path is not valid
 * percent-encoding. `req.path` is the raw pathname, undecoded, so `%`, `%zz`
 * and a truncated escape all reach here and `decodeURIComponent` throws on
 * every one of them. Null here, a JSON 404 above.
 *
 * **This guard is not the whole of A215, and M3.8 round 2 was wrong to say
 * it was** (M3.8 round 3). The claim there was that a malformed escape used
 * to escape this handler as an HTML error page and now does not. Only the
 * second half is true, and only for the escapes that get this far.
 *
 * A raw `%`, `%zz`, `%2`, `%E0%A4`, `%C0%80` and `%u0041` never reach this
 * function at all. They are decoded, and thrown on, one layer further out,
 * by the router that matches the request to the function in the first place:
 * `decodeParam` (`router/lib/layer.js`) rethrows the `URIError` with
 * `status = 400`, and whatever router owns that layer answers it. Measured
 * against the emulator at the function URL with `curl --path-as-is`: the
 * functions emulator logs "Beginning execution of asia-south1-api" for a
 * well-formed token and logs nothing at all for `/order/%`, `/order/%zz` and
 * `/order/%E0%A4`, which end as `URIError: Failed to decode param
 * 'order/%'` inside firebase-tools' own Express. No code mounted inside this
 * function, error middleware included, can answer a request the function is
 * never handed. The same is true of `POST /api/notify` with a body that is
 * not an object: firebase-tools' `body-parser` throws before we are called.
 *
 * What holds the `no-store` invariant for those is Hosting, not this file:
 * `firebase.json` sets `Cache-Control: no-store` on `/api/**` (with
 * `/api/counts` overriding it, brief §19.2), so an answer produced above us
 * still cannot be cached on the path a customer's browser actually uses.
 * The direct function URL, where the tester measured a bare 400, is a door
 * no customer and no page on this site ever calls: `orderApiUrl` builds
 * `/api/order/<token>` only for a token that already passes `isOrderToken`,
 * so a mistyped WhatsApp link is drawn by the page itself as D63's own
 * sentence and never becomes a request. Logged as A215 (ii).
 *
 * This `try` still earns its place: `%00`, `%25`, `abc%`, a double-encoded
 * escape and anything else the outer router decodes successfully do arrive
 * here, and each must be the same JSON 404 as a token nobody has.
 */
function decodeToken(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
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

