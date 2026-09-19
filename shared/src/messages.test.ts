/**
 * The three customer messages, decision D24 answering Q11.
 *
 * Two kinds of test here. The first kind is behaviour: each message renders
 * with the product substituted, an override in `settings/messages` wins, and
 * a missing or empty override falls back to the draft. The second kind is the
 * house style, asserted rather than trusted: no em dash anywhere, no promised
 * date anywhere, "we" rather than "I", and no invented count.
 */

import { describe, expect, it } from "vitest";

import {
  CUSTOMER_MESSAGE_NAMES,
  customerMessage,
  DEFAULT_CUSTOMER_MESSAGES,
  ingredientInSentence,
  messagePrice,
  productWordsFromSlug,
  renderCustomerMessage,
} from "./messages.js";
import { PRICE_IN_STOCK_PAISE, PRICE_OPEN_PAISE } from "./money.js";

const PRAWNS = {
  product: "Prawns and dates pickle",
  ingredient: "prawns",
  price: "₹599",
};

describe("the three drafts", () => {
  it("has one for each message the batch offers", () => {
    expect([...CUSTOMER_MESSAGE_NAMES]).toEqual(["batchOpen", "halfReached", "backInStock"]);
    for (const name of CUSTOMER_MESSAGE_NAMES) {
      expect(DEFAULT_CUSTOMER_MESSAGES[name].length).toBeGreaterThan(0);
    }
  });

  it("opens a batch with the product and the price, and no date", () => {
    expect(customerMessage("batchOpen", PRAWNS)).toBe(
      "A batch of Prawns and dates pickle is open for booking at ₹599. " +
        "We cook a small number of jars, so booking closes once they are taken.",
    );
  });

  it("renders brief 7.2's prawns line word for word at half reached", () => {
    // "Half the batch is paid for. We are arranging the prawns now."
    expect(customerMessage("halfReached", PRAWNS)).toBe(
      "Half the batch is paid for. We are arranging the prawns now.",
    );
  });

  it("reads the same shape for a product whose main ingredient is not prawns", () => {
    for (const [ingredient, expected] of [
      ["squid", "Half the batch is paid for. We are arranging the squid now."],
      ["beef", "Half the batch is paid for. We are arranging the beef now."],
      ["koorka", "Half the batch is paid for. We are arranging the koorka now."],
    ]) {
      expect(customerMessage("halfReached", { ...PRAWNS, ingredient })).toBe(expected);
    }
  });

  it("says plainly that in-stock jars are what was left over", () => {
    expect(customerMessage("backInStock", { ...PRAWNS, price: "₹649" })).toBe(
      "The jars left over from our last batch of Prawns and dates pickle are on sale at ₹649. " +
        "There are only a few.",
    );
  });

  it("substitutes the product into every one of the three that names it", () => {
    for (const name of CUSTOMER_MESSAGE_NAMES) {
      const rendered = customerMessage(name, { ...PRAWNS, product: "Koorka pickle" });
      expect(rendered).not.toMatch(/\{product\}|\{ingredient\}|\{price\}/);
      if (DEFAULT_CUSTOMER_MESSAGES[name].includes("{product}")) {
        expect(rendered).toContain("Koorka pickle");
      }
    }
  });
});

describe("the Owner's edit, settings/messages", () => {
  it("wins over the draft", () => {
    const rendered = customerMessage("batchOpen", PRAWNS, {
      batchOpen: "We have a batch of {product} open at {price}.",
    });
    expect(rendered).toBe("We have a batch of Prawns and dates pickle open at ₹599.");
  });

  it("falls back when the setting is absent, empty, or not a string", () => {
    const draft = customerMessage("batchOpen", PRAWNS);
    expect(customerMessage("batchOpen", PRAWNS, undefined)).toBe(draft);
    expect(customerMessage("batchOpen", PRAWNS, null)).toBe(draft);
    expect(customerMessage("batchOpen", PRAWNS, {})).toBe(draft);
    expect(customerMessage("batchOpen", PRAWNS, { batchOpen: "" })).toBe(draft);
    expect(customerMessage("batchOpen", PRAWNS, { batchOpen: "   " })).toBe(draft);
    expect(customerMessage("batchOpen", PRAWNS, { batchOpen: 42 })).toBe(draft);
  });

  it("edits one message without touching the other two", () => {
    const overrides = { halfReached: "Half paid. {ingredient} next." };
    expect(customerMessage("halfReached", PRAWNS, overrides)).toBe("Half paid. prawns next.");
    expect(customerMessage("batchOpen", PRAWNS, overrides)).toBe(
      customerMessage("batchOpen", PRAWNS),
    );
  });
});

describe("rendering", () => {
  it("leaves a placeholder standing when there is no value for it", () => {
    // The Owner reads the draft before it goes anywhere, so a visible
    // {product} is a question he can answer. A hole is one he might miss.
    expect(renderCustomerMessage("A batch of {product} at {price}.", { price: "₹599" })).toBe(
      "A batch of {product} at ₹599.",
    );
    expect(renderCustomerMessage("{product}", { product: "  " })).toBe("{product}");
  });

  it("touches nothing it does not know", () => {
    expect(renderCustomerMessage("{jars} jars of {product}", PRAWNS)).toBe(
      "{jars} jars of Prawns and dates pickle",
    );
  });

  it("takes the price from paise, so no message ever types one", () => {
    expect(messagePrice(PRICE_OPEN_PAISE)).toBe("₹599");
    expect(messagePrice(PRICE_IN_STOCK_PAISE)).toBe("₹649");
  });

  it("reads an ingredient's label name as it sits in a sentence", () => {
    expect(ingredientInSentence("Prawns")).toBe("prawns");
    expect(ingredientInSentence("Koorka")).toBe("koorka");
    expect(ingredientInSentence("squid")).toBe("squid");
    // A second capital is a proper noun, and label names are never paraphrased.
    expect(ingredientInSentence("Kashmiri Chilli")).toBe("Kashmiri Chilli");
    expect(ingredientInSentence("")).toBe("");
  });

  it("reads a slug as words when the product document could not be read", () => {
    expect(productWordsFromSlug("prawns-dates-pickle")).toBe("prawns dates pickle");
    expect(productWordsFromSlug("koorka")).toBe("koorka");
  });
});

/* -------------------------------------------------------------------------- */
/* The house style, asserted                                                  */
/* -------------------------------------------------------------------------- */

/** Every draft as a customer would read it, for the style checks below. */
const RENDERED = CUSTOMER_MESSAGE_NAMES.map((name) => [
  name,
  customerMessage(name, PRAWNS),
] as const);

describe("what the drafts may not say", () => {
  it("contains no em dash, and no en dash either (CLAUDE.md section 3)", () => {
    for (const [name, text] of RENDERED) {
      expect(text, name).not.toContain("—");
      expect(text, name).not.toContain("–");
      expect(DEFAULT_CUSTOMER_MESSAGES[name], name).not.toContain("—");
    }
  });

  it("promises no date, in any spelling", () => {
    // A batch is cooked when the fish and the weather allow. Nothing here may
    // say when: no weekday, no month, no digit that could be one, no "within
    // N days", and no "tomorrow" or "next week".
    const promises = [
      /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
      /\b(today|tomorrow|tonight)\b/i,
      /\b(next|this|in a|within)\s+(day|week|month|fortnight)/i,
      /\b\d+\s*(day|week|month|hour|minute)s?\b/i,
      /\bby\s+(the\s+)?\d/i,
      /\d{4}-\d{2}-\d{2}/,
    ];
    for (const [name, text] of RENDERED) {
      for (const promise of promises) {
        expect(promise.test(text), `${name} promises a date: ${text}`).toBe(false);
      }
    }
  });

  it("speaks as we, never as I", () => {
    for (const [name, text] of RENDERED) {
      expect(/\bI\b|\bmy\b|\bmine\b/.test(text), name).toBe(false);
    }
    // At least one of the three says "we" out loud, which is the voice rule.
    expect(RENDERED.filter(([, text]) => /\bWe\b|\bwe\b|\bour\b/.test(text)).length).toBeGreaterThan(
      1,
    );
  });

  it("invents no count and runs no countdown", () => {
    for (const [name, text] of RENDERED) {
      // No bare number at all except inside the price, which is computed.
      expect(text.replace(/₹[\d,]+/g, ""), name).not.toMatch(/\d/);
      expect(text.toLowerCase(), name).not.toMatch(/hurry|last chance|only \d|left!|selling fast/);
    }
  });

  it("stays to one or two sentences", () => {
    for (const [name, text] of RENDERED) {
      const sentences = text.split(".").filter((part) => part.trim() !== "");
      expect(sentences.length, name).toBeLessThanOrEqual(2);
      expect(sentences.length, name).toBeGreaterThanOrEqual(1);
    }
  });
});
