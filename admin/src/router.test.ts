import { describe, expect, it } from "vitest";

import { isOrderDetailRoute, matchRoute, orderDetailPath, ROUTES } from "./router";

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

  describe("/orders/<id>, M3.9's order detail", () => {
    it("matches an order id and carries it on the route", () => {
      const route = matchRoute("/orders/o-7f3a2c");
      expect(route.path).toBe("/orders");
      expect(isOrderDetailRoute(route)).toBe(true);
      if (isOrderDetailRoute(route)) {
        expect(route.orderId).toBe("o-7f3a2c");
      }
    });

    it("strips a trailing slash the same as any other route", () => {
      const route = matchRoute("/orders/o-7f3a2c/");
      expect(isOrderDetailRoute(route)).toBe(true);
      if (isOrderDetailRoute(route)) {
        expect(route.orderId).toBe("o-7f3a2c");
      }
    });

    it("decodes an id that needed escaping in the URL", () => {
      const route = matchRoute(`/orders/${encodeURIComponent("o with space")}`);
      expect(isOrderDetailRoute(route)).toBe(true);
      if (isOrderDetailRoute(route)) {
        expect(route.orderId).toBe("o with space");
      }
    });

    it("round-trips through orderDetailPath", () => {
      const route = matchRoute(orderDetailPath("o-7f3a2c"));
      expect(isOrderDetailRoute(route)).toBe(true);
      if (isOrderDetailRoute(route)) {
        expect(route.orderId).toBe("o-7f3a2c");
      }
    });

    it("does not match the bare list route, or a path with a further segment", () => {
      expect(isOrderDetailRoute(matchRoute("/orders"))).toBe(false);
      // Two segments past /orders is not a known shape: falls back to root
      // rather than being read as an id containing a slash.
      expect(matchRoute("/orders/a/b")).toEqual(ROUTES[0]);
    });

    it("is not fooled by an empty segment", () => {
      expect(isOrderDetailRoute(matchRoute("/orders//"))).toBe(false);
    });
  });
});
