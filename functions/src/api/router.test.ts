import { describe, expect, it } from "vitest";
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
  it("returns 200 + {ok:true, project} for GET /api/health (hosting rewrite shape)", () => {
    const res = createResponse();
    handleApiRequest({ path: "/api/health", method: "GET" }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, project: expect.any(String) });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("returns 200 + {ok:true, project} for GET /health (direct function URL shape)", () => {
    const res = createResponse();
    handleApiRequest({ path: "/health", method: "GET" }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, project: expect.any(String) });
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
