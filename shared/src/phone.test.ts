import { describe, expect, it } from "vitest";

import {
  formatIndianMobile,
  isIndianMobileE164,
  nearMissNumbers,
  parseIndianMobile,
} from "./phone.js";

describe("parseIndianMobile", () => {
  it("normalises every spelling of one number to the same E.164 id", () => {
    for (const raw of [
      "7736110087",
      "07736110087",
      "91 7736110087",
      "+91 7736110087",
      "+91-77361-10087",
      "0091 7736110087",
      "(+91) 77361 10087",
    ]) {
      expect(parseIndianMobile(raw), raw).toMatchObject({ ok: true, e164: "+917736110087" });
    }
  });

  it("refuses a number that is not an Indian mobile", () => {
    expect(parseIndianMobile("")).toEqual({ ok: false, reason: "empty" });
    expect(parseIndianMobile("+14155550100")).toEqual({ ok: false, reason: "notIndian" });
    expect(parseIndianMobile("1234567890")).toEqual({ ok: false, reason: "invalid" });
    expect(parseIndianMobile("773611008")).toEqual({ ok: false, reason: "invalid" });
  });

  it("reads back on screen with the grouping people say it in", () => {
    expect(formatIndianMobile("+917736110087")).toBe("+91 77361 10087");
  });

  it("knows a canonical number when it sees one", () => {
    expect(isIndianMobileE164("+917736110087")).toBe(true);
    expect(isIndianMobileE164("+91 7736110087")).toBe(false);
    expect(isIndianMobileE164("+911736110087")).toBe(false);
  });
});

describe("nearMissNumbers", () => {
  const near = nearMissNumbers("+919446587027");

  it("finds a single wrong digit anywhere in the number", () => {
    expect(near).toContain("+919446587028");
    expect(near).toContain("+919446587127");
    expect(near).toContain("+919446587020");
  });

  it("finds two neighbouring digits typed the wrong way round", () => {
    // ...87027 typed as ...80727: the 7 and the 0 swapped.
    expect(nearMissNumbers("+919446587027")).toContain("+919446580727");
  });

  it("never offers the number itself, or anything that is not a mobile", () => {
    expect(near).not.toContain("+919446587027");
    expect(near.every((n) => /^\+91[6-9]\d{9}$/.test(n))).toBe(true);
    // The leading 9 has only three replacements that are still mobiles.
    expect(near.filter((n) => n.slice(3, 4) !== "9" && n.endsWith("446587027"))).toHaveLength(3);
  });

  it("stays a small, bounded list, so it is a read by id and never a scan", () => {
    expect(near.length).toBeLessThanOrEqual(99);
  });

  it("answers nothing for a number that is not valid in the first place", () => {
    expect(nearMissNumbers("+14155550100")).toEqual([]);
    expect(nearMissNumbers("")).toEqual([]);
  });
});
