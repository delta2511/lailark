import { describe, expect, it } from "vitest";

import type { OrderDoc } from "./data";
import { billMessageFor } from "./billMessage";

const TOKEN = "abcdef0123456789abcdef0123456789";

function order(overrides: Partial<OrderDoc>): OrderDoc {
  return {
    id: "o1",
    number: "o-9c2f1a",
    customerPhone: "+917736110087",
    total: 119_800,
    token: TOKEN,
    ...overrides,
  };
}

describe("billMessageFor", () => {
  it("drafts the bill with the order number, total and private link", () => {
    const message = billMessageFor(order({}), "https://lailark.in");
    expect(message.hasToken).toBe(true);
    expect(message.text).toBe(
      `Thank you, we have your order o-9c2f1a for ₹1,198. You can see the bill anytime at https://lailark.in/o/${TOKEN}.`,
    );
    expect(message.waLink).toBe(
      `https://wa.me/917736110087?text=${encodeURIComponent(message.text)}`,
    );
  });

  it("draws no link at all when the order has no token (A206, before M3.8)", () => {
    const message = billMessageFor(order({ token: null }), "https://lailark.in");
    expect(message.hasToken).toBe(false);
    expect(message.waLink).toBeNull();
  });

  it("draws no wa.me link when there is no usable phone number", () => {
    const message = billMessageFor(order({ customerPhone: "" }), "https://lailark.in");
    expect(message.hasToken).toBe(true);
    expect(message.waLink).toBeNull();
  });

  it("lets the Owner's settings/messages override win, same as the other three messages", () => {
    const message = billMessageFor(order({}), "https://lailark.in", {
      billSent: "Order {orderNumber}, {total}: {orderLink}",
    });
    expect(message.text).toBe(`Order o-9c2f1a, ₹1,198: https://lailark.in/o/${TOKEN}`);
  });

  it("refuses a token that is not 32 lower-case hex characters", () => {
    const message = billMessageFor(order({ token: "not-a-real-token" }), "https://lailark.in");
    expect(message.hasToken).toBe(false);
  });
});
