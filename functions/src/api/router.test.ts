import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { SHARED_VERSION } from "@lailark/shared";
import { handleApiRequest, type ApiResponseLike } from "./router";

function createResponse() {
  const res = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res as unknown as ApiResponseLike;
    },
    set(name: string, value: string) {
      res.headers[name] = value;
      return res as unknown as ApiResponseLike;
    },
    json(body: unknown) {
      res.body = body;
    },
  };
  return res;
}

describe("handleApiRequest", () => {
  it("returns 200 + {ok:true, project, shared} for GET /api/health (hosting rewrite shape)", () => {
    const res = createResponse();
    handleApiRequest({ path: "/api/health", method: "GET" }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      project: expect.any(String),
      shared: SHARED_VERSION,
    });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("returns 200 + {ok:true, project, shared} for GET /health (direct function URL shape)", () => {
    const res = createResponse();
    handleApiRequest({ path: "/health", method: "GET" }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      project: expect.any(String),
      shared: SHARED_VERSION,
    });
  });

  it("returns 404 for an unknown path", () => {
    const res = createResponse();
    handleApiRequest({ path: "/api/nope", method: "GET" }, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "not found" });
  });

  it("returns 404 for the bare /api path", () => {
    const res = createResponse();
    handleApiRequest({ path: "/api", method: "GET" }, res);

    expect(res.statusCode).toBe(404);
  });

  it("returns 405 for POST on /api/health", () => {
    const res = createResponse();
    handleApiRequest({ path: "/api/health", method: "POST" }, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ ok: false, error: "method not allowed" });
  });

  it("returns 405 for POST on /health", () => {
    const res = createResponse();
    handleApiRequest({ path: "/health", method: "POST" }, res);

    expect(res.statusCode).toBe(405);
  });
});

describe("handleApiRequest /counts", () => {
  const payload = {
    products: {
      "prawns-and-dates": { mode: "inStock" as const, count: 3, total: 8 },
    },
  };

  it("returns 200 + the payload, cached for 15s at the CDN, for GET /api/counts", async () => {
    const res = createResponse();
    await handleApiRequest(
      { path: "/api/counts", method: "GET" },
      res,
      { getCounts: async () => payload },
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(payload);
    expect(res.headers["Cache-Control"]).toBe("public, max-age=15, s-maxage=15");
  });

  it("returns 200 for GET /counts (direct function URL shape)", async () => {
    const res = createResponse();
    await handleApiRequest({ path: "/counts", method: "GET" }, res, {
      getCounts: async () => payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(payload);
  });

  it("returns 405 for POST on /api/counts", async () => {
    const res = createResponse();
    await handleApiRequest(
      { path: "/api/counts", method: "POST" },
      res,
      { getCounts: async () => payload },
    );

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ ok: false, error: "method not allowed" });
  });

  it("never invents a count: a read failure is 503, uncached, no payload", async () => {
    const res = createResponse();
    await handleApiRequest(
      { path: "/api/counts", method: "GET" },
      res,
      {
        getCounts: async () => {
          throw new Error("firestore is down");
        },
      },
    );

    expect(res.statusCode).toBe(503);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body).toEqual({ ok: false, error: "counts unavailable" });
  });
});

describe("GET /api/order/<token>, the private order page (M3.8)", () => {
  const TOKEN = "0123456789abcdef0123456789abcdef";
  const payload = {
    order: {
      number: "o-7f3a2c",
      placedOnMillis: 1,
      lines: [],
      shippingFeePaise: 0,
      totalPaise: 59_900,
      delivery: null,
    },
    documents: [],
  };

  it("hands the token through and answers with the order, never cached", async () => {
    const res = createResponse();
    let asked: string | null = null;
    await handleApiRequest({ path: `/api/order/${TOKEN}`, method: "GET" }, res, {
      getOrder: (token) => {
        asked = token;
        return Promise.resolve(payload);
      },
    });
    expect(asked).toBe(TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(payload);
    // A private page must never sit in a CDN.
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("answers 404, uncached, for a token nobody has", async () => {
    const res = createResponse();
    await handleApiRequest({ path: `/order/${TOKEN}`, method: "GET" }, res, {
      getOrder: () => Promise.resolve(null),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "not found" });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("refuses anything but GET", async () => {
    const res = createResponse();
    await handleApiRequest({ path: `/api/order/${TOKEN}`, method: "POST" }, res, {
      getOrder: () => Promise.reject(new Error("must not be called")),
    });
    expect(res.statusCode).toBe(405);
  });

  it("turns a read failure into a 503 rather than leaking anything", async () => {
    const res = createResponse();
    await handleApiRequest({ path: `/api/order/${TOKEN}`, method: "GET" }, res, {
      getOrder: () => Promise.reject(new Error("firestore is down")),
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ ok: false, error: "order unavailable" });
  });

  it("does not match the bare /api/order path", () => {
    const res = createResponse();
    handleApiRequest({ path: "/api/order", method: "GET" }, res);
    expect(res.statusCode).toBe(404);
  });

  it("answers a path that is not valid percent-encoding with the same JSON 404", async () => {
    // Every escape the outer router decodes successfully, and then hands
    // us, must be the same JSON 404 as a token nobody has: the invariant
    // above is only true if every miss lands here.
    //
    // Round 2 claimed this also covered the escapes that make the *outer*
    // router throw (`%`, `%zz`, a truncated `%E0%A4`). It does not: those
    // never reach this function, and `decodeToken`'s own comment records
    // what was measured and which layer answers them (A215 ii). The strings
    // below are handed straight to the handler here, which is the contract
    // this test is for, not a claim about what arrives over the wire.
    for (const bad of ["%", "%zz", "%E0%A4%A", "abc%", "%%"]) {
      const res = createResponse();
      let asked = 0;
      await handleApiRequest(
        { path: `/api/order/${bad}`, method: "GET" },
        res,
        {
          getOrder: () => {
            asked += 1;
            return Promise.resolve(null);
          },
        },
      );
      expect(res.statusCode, bad).toBe(404);
      expect(res.body, bad).toEqual({ ok: false, error: "not found" });
      expect(res.headers["Cache-Control"], bad).toBe("no-store");
      // Nothing that is not a token ever reaches Firestore.
      expect(asked, bad).toBe(0);
    }
  });

  it("asks for nothing when the token is the wrong shape", async () => {
    const res = createResponse();
    let asked = 0;
    await handleApiRequest({ path: "/api/order/not-a-token", method: "GET" }, res, {
      getOrder: () => {
        asked += 1;
        return Promise.resolve(null);
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(asked).toBe(0);
  });
});

describe("POST /api/notify, the cooking card's notify-me (M3.8, brief §7.5)", () => {
  it("takes a number and says nothing about who is already on the list", async () => {
    const res = createResponse();
    let got: unknown = null;
    await handleApiRequest(
      { path: "/api/notify", method: "POST", body: { contact: "+917736110087", source: "cooking" } },
      res,
      {
        addNotify: (body) => {
          got = body;
          return Promise.resolve({ ok: true as const });
        },
      },
    );
    expect(got).toEqual({ contact: "+917736110087", source: "cooking" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("passes a refusal through with its own status and sentence", async () => {
    const res = createResponse();
    await handleApiRequest({ path: "/notify", method: "POST", body: {} }, res, {
      addNotify: () =>
        Promise.resolve({ ok: false as const, status: 400, message: "Please give us your WhatsApp number." }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "Please give us your WhatsApp number." });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("refuses anything but POST, so it can never be linked or prefetched", async () => {
    const res = createResponse();
    await handleApiRequest({ path: "/api/notify", method: "GET" }, res, {
      addNotify: () => Promise.reject(new Error("must not be called")),
    });
    expect(res.statusCode).toBe(405);
  });

  it("turns a write failure into a 503 a customer can read", async () => {
    const res = createResponse();
    await handleApiRequest({ path: "/api/notify", method: "POST", body: {} }, res, {
      addNotify: () => Promise.reject(new Error("firestore is down")),
    });
    expect(res.statusCode).toBe(503);
    expect(String((res.body as { error: string }).error)).not.toContain("firestore");
  });
});

/**
 * A215 (ii), M3.8 round 3. `/api/order/<token>` answers with somebody's
 * address and bill, and a malformed path is answered above this function by
 * a layer we do not own (see `decodeToken`). The one place the `no-store`
 * invariant can be enforced for every answer on that path, whoever produced
 * it, is Hosting, so the rule is asserted here rather than trusted.
 */
describe("Hosting's own Cache-Control on the API", () => {
  it("puts no-store on /api/**, with /api/counts the one deliberate exception", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../../firebase.json", import.meta.url), "utf8"),
    ) as {
      hosting: Array<{
        target?: string;
        headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
      }>;
    };
    const customer = config.hosting.find((site) => site.target === "customer");
    const headers = customer?.headers ?? [];

    const api = headers.findIndex((rule) => rule.source === "/api/**");
    expect(api, "firebase.json must carry a /api/** header rule").toBeGreaterThanOrEqual(0);
    expect(headers[api].headers.find((h) => h.key === "Cache-Control")?.value).toBe("no-store");

    // Brief §19.2: the public count is the one thing on /api that a CDN may
    // hold, and it only wins because it is matched after the rule above.
    const counts = headers.findIndex((rule) => rule.source === "/api/counts");
    expect(counts).toBeGreaterThan(api);
    expect(headers[counts].headers.find((h) => h.key === "Cache-Control")?.value).toBe(
      "public, max-age=15, s-maxage=15",
    );
  });
});
