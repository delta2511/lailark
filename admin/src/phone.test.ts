import { describe, expect, it } from "vitest";
import { cleanOtp, formatIndianMobile, parseIndianMobile } from "./phone";

describe("parseIndianMobile", () => {
  it("accepts the two admin numbers in every spelling a person might type", () => {
    for (const raw of [
      "7736110087",
      "+917736110087",
      "+91 7736110087",
      "+91 77361 10087",
      "91 7736110087",
      "07736110087",
      "0091 7736110087",
      " 773-611-0087 ",
      "(+91) 7736110087",
    ]) {
      const parsed = parseIndianMobile(raw);
      expect(parsed, raw).toMatchObject({ ok: true, e164: "+917736110087" });
    }

    expect(parseIndianMobile("9446587027")).toMatchObject({ ok: true, e164: "+919446587027" });
  });

  it("refuses an empty box", () => {
    expect(parseIndianMobile("")).toEqual({ ok: false, reason: "empty" });
    expect(parseIndianMobile("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseIndianMobile("+")).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses a country code that is not India", () => {
    expect(parseIndianMobile("+14155550100")).toEqual({ ok: false, reason: "notIndian" });
    expect(parseIndianMobile("+971 50 123 4567")).toEqual({ ok: false, reason: "notIndian" });
  });

  it("refuses anything that is not a ten digit mobile", () => {
    for (const raw of ["123", "12345678901234", "1736110087", "5736110087", "77361100", "abcd"]) {
      expect(parseIndianMobile(raw), raw).toMatchObject({ ok: false });
    }
  });

  it("keeps a number that is not on the allowlist parseable (the claim decides, not the parser)", () => {
    expect(parseIndianMobile("9999999999")).toMatchObject({ ok: true, e164: "+919999999999" });
  });
});

describe("formatIndianMobile", () => {
  it("groups the ten digits five and five", () => {
    expect(formatIndianMobile("+917736110087")).toBe("+91 77361 10087");
  });

  it("leaves anything else alone", () => {
    expect(formatIndianMobile("+14155550100")).toBe("+14155550100");
  });
});

describe("cleanOtp", () => {
  it("keeps six digits and drops the rest", () => {
    expect(cleanOtp("123 456")).toBe("123456");
    expect(cleanOtp("1234567")).toBe("123456");
    expect(cleanOtp("12a3b4")).toBe("1234");
  });
});
