import { describe, expect, it } from "vitest";

import { checkCustomerText, FORBIDDEN_DASHES, hasForbiddenDash } from "./messages.js";
import { POLICY_KINDS } from "./states.js";
import {
  POLICY_CONTACT,
  POLICY_PAGES,
  POLICY_SET_VERSION,
  policyPage,
  policyPageText,
  policySetVersion,
  policyVersionDocId,
} from "./policies.js";

describe("the five pages", () => {
  it("is one page per policy kind, on the paths D66 fixed", () => {
    expect(POLICY_PAGES.map((p) => p.kind)).toEqual([...POLICY_KINDS]);
    expect(POLICY_PAGES.map((p) => p.path)).toEqual([
      "/orders",
      "/shipping",
      "/terms",
      "/privacy",
      "/contact",
    ]);
  });

  it("looks a page up by kind", () => {
    for (const kind of POLICY_KINDS) expect(policyPage(kind).kind).toBe(kind);
    // @ts-expect-error not a policy kind
    expect(() => policyPage("refunds")).toThrow();
  });

  it("has a heading, a title and at least one block on every page", () => {
    for (const page of POLICY_PAGES) {
      expect(page.heading.length).toBeGreaterThan(0);
      expect(page.title).toContain("Lailark");
      expect(page.blocks.length).toBeGreaterThan(0);
      for (const block of page.blocks) {
        if (block.type === "lines") expect(block.lines.length).toBeGreaterThan(0);
        else expect(block.text.trim()).toBe(block.text);
      }
    }
  });
});

/** Named, so a failure says what to do rather than printing a code point. */
const FORBIDDEN_DASH_NOTE = "a long dash. Use a comma, a colon or a full stop.";

describe("the voice rules, which are absolute", () => {
  /** Every character a customer reads on these five pages. */
  const everyWord = POLICY_PAGES.map((page) => `${page.title}\n${policyPageText(page)}`).join("\n");

  it("passes the same dash gate every customer message passes", () => {
    // CLAUDE.md section 3 and the story doc section 4: periods, commas,
    // colons. Legal prose reaches for a dash, so this is pinned rather than
    // trusted, and through `checkCustomerText` rather than a second check of
    // its own.
    for (const page of POLICY_PAGES) {
      const text = `${page.title}\n${policyPageText(page)}`;
      expect(checkCustomerText(text), `${page.path}: ${FORBIDDEN_DASH_NOTE}`).toEqual({ ok: true });
      expect(hasForbiddenDash(text)).toBe(false);
    }
    for (const dash of FORBIDDEN_DASHES) expect(everyWord).not.toContain(dash);
  });

  it("never says I or my", () => {
    // Lailark speaks as "we". "Sumayya" and "we", never a first person
    // singular, even in a sentence about the two of us.
    expect(everyWord).not.toMatch(/\b(I|I'm|I've|my|mine)\b/);
  });

  it("names the facts D66 settled, and no others", () => {
    expect(everyWord).toContain(POLICY_CONTACT.phone);
    expect(everyWord).toContain(POLICY_CONTACT.email);
    expect(everyWord).toContain(POLICY_CONTACT.address);
    expect(everyWord).toContain(`FSSAI ${POLICY_CONTACT.fssai}`);
    expect(everyWord).toContain(`${POLICY_CONTACT.grievanceOfficer}, ${POLICY_CONTACT.grievanceOfficerRole}`);
    // No GSTIN (GST is off at launch), no company registration, and nothing
    // about the December entity change (D66).
    expect(everyWord).not.toMatch(/GSTIN|CIN|December|private limited|Pvt/i);
  });

  it("puts no price and no promised date on a policy page", () => {
    // Prices are the product pages' business, computed, never typed; and no
    // message or page anywhere promises a date.
    expect(everyWord).not.toMatch(/₹|Rs\.?\s*\d/);
    expect(everyWord).not.toMatch(/\bwithin \d+ (days|weeks)\b/);
  });

  it("carries the E-Commerce Rules' two commitments on the contact page", () => {
    const contact = policyPageText(policyPage("contact"));
    expect(contact).toContain("within 48 hours");
    expect(contact).toContain("within a month");
  });

  it("keeps brief 10.4's Orders paragraph word for word", () => {
    // D2 and D66: used as drafted, not improved. If this string is ever
    // edited, the edit is a decision and not a tidy-up.
    expect(policyPageText(policyPage("orders"))).toContain(
      "Each jar is cooked for the person who ordered it, so we don't usually take " +
        "cancellations or returns. In-stock jars ship the next day. Open batches ship " +
        "after bottling. If something has gone wrong, a jar arrives broken or you need " +
        "to cancel, please call us on +91 88919 23827 and we will sort it out with you.",
    );
    // Section 20.4: no cancellation fee, said plainly and on its own.
    expect(policyPageText(policyPage("orders"))).toContain("We never charge a fee for cancelling.");
  });

  it("promises no refund and refuses none", () => {
    // Brief 10.1 and 10.2: the site does not talk about refunds, and nothing
    // here may promise or refuse one. "Refund" appears once, on the privacy
    // page, about the payment reference, and nowhere as a promise.
    expect(everyWord).not.toMatch(/we (will |do )?(not )?refund/i);
    expect(everyWord).not.toMatch(/no refunds/i);
    expect(everyWord).not.toMatch(/money back/i);
  });
});

describe("the version", () => {
  it("is derived from the words, so the live one is the pages in this build", () => {
    expect(POLICY_SET_VERSION).toBe(policySetVersion());
    expect(POLICY_SET_VERSION).toMatch(/^p-[0-9a-f]{16}$/);
  });

  it("changes when one character of one page changes", () => {
    const edited = POLICY_PAGES.map((page) =>
      page.kind === "shipping"
        ? { ...page, blocks: [...page.blocks, { type: "paragraph" as const, text: "." }] }
        : page,
    );
    expect(policySetVersion(edited)).not.toBe(POLICY_SET_VERSION);
  });

  it("changes when a page's heading changes", () => {
    const edited = POLICY_PAGES.map((page) =>
      page.kind === "terms" ? { ...page, heading: "Terms " } : page,
    );
    expect(policySetVersion(edited)).not.toBe(POLICY_SET_VERSION);
  });

  it("does not change when nothing changes", () => {
    expect(policySetVersion([...POLICY_PAGES])).toBe(POLICY_SET_VERSION);
  });

  it("gives one document id per page, prefixed by the set", () => {
    expect(policyVersionDocId("p-0123456789abcdef", "terms")).toBe("p-0123456789abcdef-terms");
    const ids = POLICY_KINDS.map((kind) => policyVersionDocId(POLICY_SET_VERSION, kind));
    expect(new Set(ids).size).toBe(POLICY_KINDS.length);
    for (const id of ids) expect(id.startsWith(`${POLICY_SET_VERSION}-`)).toBe(true);
  });
});

describe("the stored text", () => {
  it("starts with the heading and holds every block in order", () => {
    const text = policyPageText(policyPage("contact"));
    const lines = text.split("\n");
    expect(lines[0]).toBe("Contact");
    expect(lines).toContain("Grievance officer");
    expect(lines).toContain(POLICY_CONTACT.email);
    expect(lines.indexOf("Grievance officer")).toBeLessThan(lines.indexOf(POLICY_CONTACT.email));
  });
});
