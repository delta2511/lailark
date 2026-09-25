import { describe, expect, it } from "vitest";

import {
  isOrderToken,
  isShareCode,
  ORDER_TOKEN_LENGTH,
  orderPath,
  orderUrl,
  SHARE_CODE_PARAM,
  shareLinkPath,
  waMeLink,
} from "./links.js";

const TOKEN = "a".repeat(ORDER_TOKEN_LENGTH);

describe("order tokens", () => {
  it("accepts exactly 32 lower-case hex characters", () => {
    expect(isOrderToken(TOKEN)).toBe(true);
    expect(isOrderToken("0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("refuses anything else, so a bad link is never drawn", () => {
    expect(isOrderToken(TOKEN.toUpperCase())).toBe(false);
    expect(isOrderToken(TOKEN.slice(1))).toBe(false);
    expect(isOrderToken(`${TOKEN}0`)).toBe(false);
    expect(isOrderToken("../../etc/passwd")).toBe(false);
    expect(isOrderToken(null)).toBe(false);
    expect(isOrderToken(42)).toBe(false);
  });

  it("builds brief §5's path, and null for a token that is not one", () => {
    expect(orderPath(TOKEN)).toBe(`/o/${TOKEN}`);
    expect(orderPath("nope")).toBeNull();
  });

  it("builds the absolute URL, trailing slash or not", () => {
    expect(orderUrl("https://lailark.in", TOKEN)).toBe(`https://lailark.in/o/${TOKEN}`);
    expect(orderUrl("https://lailark.in/", TOKEN)).toBe(`https://lailark.in/o/${TOKEN}`);
    expect(orderUrl("", TOKEN)).toBeNull();
    expect(orderUrl("https://lailark.in", "nope")).toBeNull();
  });
});

describe("wa.me links (D32)", () => {
  it("strips the plus and encodes the message", () => {
    expect(waMeLink("+917736110087", "Half the batch is paid for.")).toBe(
      "https://wa.me/917736110087?text=Half%20the%20batch%20is%20paid%20for.",
    );
  });

  it("carries no query when there is nothing drafted", () => {
    expect(waMeLink("+917736110087", "")).toBe("https://wa.me/917736110087");
    expect(waMeLink("+917736110087", null)).toBe("https://wa.me/917736110087");
  });

  it("draws no link at all for a number we could not message", () => {
    expect(waMeLink("", "hello")).toBeNull();
    expect(waMeLink("12345", "hello")).toBeNull();
    expect(waMeLink(null, "hello")).toBeNull();
  });
});

describe("share links", () => {
  it("recognises a code", () => {
    expect(isShareCode("k3n9x2p1a7")).toBe(true);
    expect(isShareCode("ab")).toBe(false);
    expect(isShareCode("WITHCAPS123")).toBe(false);
    expect(isShareCode(null)).toBe(false);
  });

  it("hangs the code on the product page, and nothing when there is none", () => {
    expect(shareLinkPath("prawns-and-dates", "k3n9x2p1a7")).toBe(
      `/pickles/prawns-and-dates?${SHARE_CODE_PARAM}=k3n9x2p1a7`,
    );
    expect(shareLinkPath("prawns-and-dates", null)).toBe("/pickles/prawns-and-dates");
  });
});
