/**
 * The three customer messages a batch offers the Owner, decision D24.
 *
 * Question Q11 was: nobody had drafted the batch-open, half-reached and
 * back-in-stock wording, and customer-facing copy may not be invented in a
 * function (CLAUDE.md section 5). Shefin's answer (D24): Claude drafts the
 * three, and the Owner can edit them. So the drafts below are a **fallback**.
 * The live wording is `settings/messages`, which is the Owner's to rewrite,
 * and every message still lands in an `approvals` document with `sentAt` null
 * and waits for him (D5). Nothing here sends anything.
 *
 * The rules the drafts are written to, from CLAUDE.md section 3 and
 * `docs/strategy/lailark-story-and-narration.md` section 4:
 *
 *  - Lailark speaks as "we", never "I". Warm, sparse, plain.
 *  - No em dashes anywhere. No neat parallelism, no aphoristic ending.
 *  - No dark patterns: no countdown, no fake scarcity, no invented count.
 *  - **No promised date.** A batch is cooked when the fish and the weather
 *    allow, so no message may say when.
 *  - Nothing that sounds like a brand or a bot.
 *
 * The one line already drafted in the brief is the prawns half-reached
 * message, brief section 7.2 step 7: "Half the batch is paid for. We are
 * arranging the prawns now." The template below renders exactly that for
 * prawns, and the same shape for squid, beef or koorka, because the only part
 * that changes is the ingredient.
 */

import { formatINR } from "./money.js";

/** The three messages a batch can offer. The `settings/messages` keys. */
export const CUSTOMER_MESSAGE_NAMES = ["batchOpen", "halfReached", "backInStock"] as const;
export type CustomerMessageName = (typeof CUSTOMER_MESSAGE_NAMES)[number];

/**
 * What a template may substitute. Every one of these is read off the batch or
 * the product, never typed by hand, so a message cannot claim a number the
 * data does not have.
 */
export interface CustomerMessageValues {
  /** The product as a customer knows it, "Prawns and dates pickle". */
  readonly product: string;
  /** The main ingredient, as it reads mid-sentence: "prawns", "koorka". */
  readonly ingredient: string;
  /** The price this message is about, already rendered: "₹599". */
  readonly price: string;
}

/**
 * The drafts. One or two sentences each, and the Owner can replace any of them
 * from Settings without a deploy.
 */
export const DEFAULT_CUSTOMER_MESSAGES: Readonly<Record<CustomerMessageName, string>> = {
  /**
   * Brief 8.2, Draft -> Open: "the opted-in list is offered a message". To the
   * people who asked to be told. Says the price, says the jars are limited
   * because a batch really is a fixed number of jars, and promises no date.
   */
  batchOpen:
    "A batch of {product} is open for booking at {price}. " +
    "We cook a small number of jars, so booking closes once they are taken.",

  /**
   * Brief 7.2 step 7. For prawns this renders the brief's line word for word.
   * For any other product the ingredient is the only thing that changes, which
   * is what makes it read naturally for squid, beef or koorka.
   */
  halfReached: "Half the batch is paid for. We are arranging the {ingredient} now.",

  /**
   * Brief 8.2, Bottled -> In stock, to the notify-me list. The story doc
   * section 2: "Anything listed as in stock is what was left over from the
   * previous batch", which is the sentence that makes the two-mode shop make
   * sense, so the message says it rather than pretending to a warehouse.
   */
  backInStock:
    "The jars left over from our last batch of {product} are on sale at {price}. " +
    "There are only a few.",
};

const PLACEHOLDER = /\{(product|ingredient|price)\}/g;

/**
 * Substitutes `{product}`, `{ingredient}` and `{price}`.
 *
 * A placeholder with no value is left standing rather than replaced with
 * nothing, because the Owner reads this draft before it goes anywhere and a
 * visible `{product}` is a question he can answer, while a sentence with a
 * hole in it is one he might approve without noticing.
 */
export function renderCustomerMessage(
  template: string,
  values: Partial<CustomerMessageValues>,
): string {
  return template.replace(PLACEHOLDER, (whole, key: keyof CustomerMessageValues) => {
    const value = values[key];
    return typeof value === "string" && value.trim() !== "" ? value : whole;
  });
}

/**
 * One message, rendered: the Owner's Settings wording when there is one, the
 * draft above when there is not.
 *
 * `overrides` is `settings/messages` as read, which may be missing entirely,
 * missing this key, or carrying something that is not a string. All three mean
 * "the Owner has not written one", and all three fall back.
 */
export function customerMessage(
  name: CustomerMessageName,
  values: Partial<CustomerMessageValues>,
  overrides?: Partial<Record<CustomerMessageName, unknown>> | null,
): string {
  const override = overrides?.[name];
  const template =
    typeof override === "string" && override.trim() !== ""
      ? override.trim()
      : DEFAULT_CUSTOMER_MESSAGES[name];
  return renderCustomerMessage(template, values);
}

/**
 * An ingredient's label name as it reads inside a sentence.
 *
 * Label names are written for the label, capitalised: "Prawns", "Koorka". In
 * "We are arranging the prawns now" the word is lowercase. Only a plainly
 * capitalised word is lowered; anything carrying a second capital is left
 * alone, because that is a proper noun ("Kashmiri Chilli") and CLAUDE.md
 * section 3 says ingredient names are never paraphrased.
 */
export function ingredientInSentence(labelName: string): string {
  if (typeof labelName !== "string" || labelName === "") return "";
  const rest = labelName.slice(1);
  return rest === rest.toLowerCase() ? labelName.charAt(0).toLowerCase() + rest : labelName;
}

/**
 * A product slug read as words, for when the product document could not be
 * read: `"prawns-dates-pickle"` -> `"prawns dates pickle"`. Never prettier
 * than that, because a guessed product name in a customer message is exactly
 * what D24 put in front of the Owner to check.
 */
export function productWordsFromSlug(slug: string): string {
  return typeof slug === "string" ? slug.split("-").filter(Boolean).join(" ") : "";
}

/** The price a message quotes, from paise, so no message ever types one. */
export function messagePrice(paise: number): string {
  return formatINR(paise);
}
