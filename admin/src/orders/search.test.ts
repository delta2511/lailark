import { describe, expect, it } from "vitest";

import type { DocumentDoc, OrderDoc } from "./data";
import { orderMatchesSearch } from "./search";

function order(overrides: Partial<OrderDoc>): OrderDoc {
  return {
    id: "o1",
    number: "o-7f3a2c",
    customerPhone: "+917736110087",
    deliveryContact: {
      name: "Asha Menon",
      phone: "+917736110087",
      lines: ["12 Beach Road"],
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673001",
    },
    ...overrides,
  };
}

describe("orderMatchesSearch", () => {
  it("matches everything on an empty or blank query", () => {
    expect(orderMatchesSearch(order({}), "")).toBe(true);
    expect(orderMatchesSearch(order({}), "   ")).toBe(true);
  });

  it("matches the order's own number, case-insensitively", () => {
    expect(orderMatchesSearch(order({}), "7F3A2C")).toBe(true);
    expect(orderMatchesSearch(order({}), "o-7f3a2c")).toBe(true);
    expect(orderMatchesSearch(order({}), "not-this-one")).toBe(false);
  });

  it("matches the delivery contact's name", () => {
    expect(orderMatchesSearch(order({}), "asha")).toBe(true);
    expect(orderMatchesSearch(order({}), "MENON")).toBe(true);
  });

  it("matches the pincode", () => {
    expect(orderMatchesSearch(order({}), "673001")).toBe(true);
    expect(orderMatchesSearch(order({}), "673002")).toBe(false);
  });

  it("matches the customer's phone number when there is no delivery contact", () => {
    expect(orderMatchesSearch(order({ deliveryContact: null }), "7736110087")).toBe(true);
  });

  it("matches a bill number, from the documents passed in for this order", () => {
    const documents: DocumentDoc[] = [{ id: "d1", number: "LK/26-27/0001" }];
    expect(orderMatchesSearch(order({}), "26-27/0001", documents)).toBe(true);
    expect(orderMatchesSearch(order({}), "LK/26-27/0001", documents)).toBe(true);
    expect(orderMatchesSearch(order({}), "LK/26-27/0002", documents)).toBe(false);
  });

  it("never matches a bill number when no documents are passed (denied or none yet)", () => {
    expect(orderMatchesSearch(order({}), "26-27/0001", [])).toBe(false);
  });

  it("matches nothing that is not on the order at all", () => {
    expect(orderMatchesSearch(order({}), "zzz-not-anywhere")).toBe(false);
  });
});
