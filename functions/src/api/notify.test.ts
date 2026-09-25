import { describe, expect, it } from "vitest";

import { parseNotifyRequest } from "./notify";

describe("the notify-me beside a cooking batch, brief §7.5 (M3.8, D64)", () => {
  const good = { contact: "7736110087", source: "cooking", productSlug: "prawns-and-dates" };

  it("normalises the number to E.164 and keeps the pickle it was asked about", () => {
    const out = parseNotifyRequest(good);
    if (!out.ok) throw new Error(out.message);
    expect(out.value.contact).toBe("+917736110087");
    expect(out.value.source).toBe("cooking");
    expect(out.value.productSlug).toBe("prawns-and-dates");
  });

  it("takes the number in any of the spellings somebody would type", () => {
    for (const given of ["7736110087", "+91 7736110087", "+917736110087", "07736110087"]) {
      const out = parseNotifyRequest({ ...good, contact: given });
      expect(out.ok, given).toBe(true);
      if (out.ok) expect(out.value.contact).toBe("+917736110087");
    }
  });

  it("says plainly what is wrong with a number, and never stores one that is not", () => {
    for (const bad of ["", "12345", "not a number", "<script>alert(1)</script>"]) {
      const out = parseNotifyRequest({ ...good, contact: bad });
      expect(out.ok, bad).toBe(false);
      if (!out.ok) {
        expect(out.status).toBe(400);
        // Customer copy: a sentence, no em dash (CLAUDE.md §3).
        expect(out.message).not.toContain("—");
        expect(out.message.endsWith(".")).toBe(true);
      }
    }
  });

  it("points somebody abroad at WhatsApp rather than refusing them flatly", () => {
    const out = parseNotifyRequest({ ...good, contact: "+14155550123" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("WhatsApp");
  });

  it("refuses a source the rules do not allow", () => {
    for (const source of ["", "x", "orders", 7, null]) {
      expect(parseNotifyRequest({ ...good, source }).ok).toBe(false);
    }
    for (const source of ["index", "batch-001", "cooking"]) {
      expect(parseNotifyRequest({ ...good, source }).ok, source).toBe(true);
    }
  });

  it("drops a productSlug that is not one, rather than losing the number over it", () => {
    for (const slug of ["", "NOT A SLUG", "../secrets", "<script>", 7, null, undefined]) {
      const out = parseNotifyRequest({ ...good, productSlug: slug });
      expect(out.ok, String(slug)).toBe(true);
      if (out.ok) expect(out.value.productSlug).toBeNull();
    }
  });

  it("refuses a body that is not an object at all", () => {
    for (const raw of [null, undefined, "x", 7, []]) {
      expect(parseNotifyRequest(raw).ok).toBe(false);
    }
  });
});
