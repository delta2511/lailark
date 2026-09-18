import { describe, expect, it } from "vitest";

import { ROUTES, matchRoute } from "./router";

describe("matchRoute", () => {
  it("matches every route in the table by its own path", () => {
    for (const route of ROUTES) {
      expect(matchRoute(route.path)).toEqual(route);
    }
  });

  it("strips a trailing slash before matching", () => {
    expect(matchRoute("/orders/")).toEqual({ path: "/orders", title: "Orders" });
    expect(matchRoute("/more/settings/")).toEqual({ path: "/more/settings", title: "Settings" });
  });

  it("falls back to the root route for an unknown path", () => {
    expect(matchRoute("/nope")).toEqual(ROUTES[0]);
    expect(matchRoute("/more/nope")).toEqual(ROUTES[0]);
  });

  it("treats the bare root slash as its own route, not a trailing slash strip", () => {
    expect(matchRoute("/")).toEqual({ path: "/", title: "Today" });
  });
});
