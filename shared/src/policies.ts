/**
 * The five published policy pages, and the version an order records.
 *
 * M5.7, decision D66. `/orders`, `/shipping`, `/terms`, `/privacy` and
 * `/contact` are permanent paths on the customer site. The words live here,
 * in one place, because three things need the same text: the static site
 * renders it, `publish-policies.mjs` writes it into `policyVersions`, and
 * `createCheckout` stamps the version it derives from it onto every web
 * order. A second copy of the wording would drift from the version recorded
 * against somebody's order, which is the one thing this collection exists to
 * prevent.
 *
 * **Where the facts come from, and nothing else.** The seller's legal name,
 * the grievance officer and his designation, the published email, the
 * retention answer and the five paths are D66, answered by Shefin on 28 Sep
 * 2026. The address and the FSSAI number are the printed label's, copied from
 * the footer the site already carries. The Orders page is brief §10.4's
 * drafted copy word for word, with §20.4's "no cancellation fee" added as its
 * own sentence. Shipping is §11.1 and §11.2. Privacy is §7.2's checkout
 * fields and §20.6. Contact is §20.4. Nothing here is invented: no
 * registration number, no GSTIN (GST is off at launch), no jurisdiction
 * clause, no retention period in months, no breach-notification window, and
 * nothing at all about the December entity change (D66: the terms name the
 * current proprietorship and say nothing about a coming one).
 *
 * **No refund is promised and none is refused.** Brief §10.1 and §10.2 decide
 * that: the site does not talk about refunds, and the agent "never promises a
 * refund, never refuses one". So the Orders page invites a call, and the
 * terms say a failed batch ends in a call, not in a sum of money.
 *
 * The house rules the copy is written to (CLAUDE.md §3, and the story doc §4
 * "Voice"): we, never I. Warm, sparse, plain. **No em dashes anywhere**, and
 * `policies.test.ts` asserts that character is absent. No neat parallelism,
 * no aphoristic ending, a section may simply stop. No dark pattern: no
 * countdown, no scarcity, no shaming, and no price that appears only at the
 * end. No product claim: the claims and the ingredient lines belong to the
 * label and are copied character for character on the product pages, not
 * paraphrased here.
 */

import type { PolicyKind } from "./states.js";

/* -------------------------------------------------------------------------- */
/* The contact facts, in one place (D66)                                      */
/* -------------------------------------------------------------------------- */

/**
 * The identity and contact facts D66 settled. Every page below reads them
 * from here, and the site's footer says the same, so the number printed on a
 * jar and the number on a policy page cannot come apart.
 */
export const POLICY_CONTACT = {
  /** The seller's legal name. A proprietorship, not a company (D66). */
  legalName: "Shefin Muhamed",
  tradingName: "Lailark Kitchen",
  address: "Neduvanchalil Veedu, Kunnamangalam, Kozhikode, Kerala, India, PIN 673571",
  fssai: "21323244000035",
  /** Lailark's own number, as printed on the label and in the footer. */
  phone: "+91 88919 23827",
  /** Also the channel for a data access or deletion request (D66). */
  email: "founder.lailark@gmail.com",
  /** The grievance officer under the E-Commerce Rules, with his designation. */
  grievanceOfficer: "Shefin Muhamed",
  grievanceOfficerRole: "co-founder",
} as const;

/* -------------------------------------------------------------------------- */
/* The shape of a page                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One block of a policy page. Deliberately three kinds and no more: a
 * sub-heading, a paragraph, and a stack of short lines for an address or a
 * set of contact details. Anything richer would need markup inside the text,
 * and the text is what gets hashed into the version and read back years
 * later against an old order.
 *
 * Links are not in the data. The site's renderer turns the phone number and
 * the email address into `tel:` and `mailto:` links wherever they appear in a
 * block, and `policyLinkTargets` below is what it matches on, so a tappable
 * number never changes a page's text or its version.
 */
export type PolicyBlock =
  | { readonly type: "heading"; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "lines"; readonly lines: readonly string[] };

/** One published page. */
export interface PolicyPage {
  readonly kind: PolicyKind;
  /** The permanent path (D66). Never changed: these are linked from the footer. */
  readonly path: string;
  /** The `<title>`. */
  readonly title: string;
  /** The `h1`. */
  readonly heading: string;
  /** How the footer names the link. */
  readonly footerLabel: string;
  readonly blocks: readonly PolicyBlock[];
}

/* -------------------------------------------------------------------------- */
/* The pages                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Brief §10.4's drafted paragraph, word for word. D2 decided the page and its
 * wording; D66 confirms it is used as drafted and not improved. The only
 * thing added is the second sentence, which §20.4 requires: the E-Commerce
 * Rules do not allow a cancellation fee unless the seller carries a similar
 * charge when it cancels, and Lailark carries none.
 */
const ORDERS: PolicyPage = {
  kind: "orders",
  path: "/orders",
  title: "Orders. Lailark",
  heading: "Orders",
  footerLabel: "Orders",
  blocks: [
    {
      type: "paragraph",
      text:
        "Each jar is cooked for the person who ordered it, so we don't usually take " +
        "cancellations or returns. In-stock jars ship the next day. Open batches ship " +
        "after bottling. If something has gone wrong, a jar arrives broken or you need " +
        "to cancel, please call us on +91 88919 23827 and we will sort it out with you.",
    },
    {
      type: "paragraph",
      text: "We never charge a fee for cancelling.",
    },
  ],
};

/**
 * How a jar actually reaches somebody. Brief §11.2 (the parcel), §20.4 (the
 * total, with shipping, shown before payment) and D12 (shipping free at
 * launch, with a switch). No delivery date is given anywhere, because none is
 * promised: the courier's own estimate is not Lailark's to repeat.
 *
 * **India Post only, and no mention of Shiprocket** (Shefin, 3 Oct 2026).
 * Brief §11.1 prefers Shiprocket once an account exists and keeps India Post
 * as the fallback, and the page used to say so. A page is not a roadmap: an
 * account that is "being set up" is nothing a customer can use, and naming it
 * only raises a question the page then cannot answer. So the courier the
 * parcel actually goes by is the only one named here. The serviceability
 * logic in `checkout.ts` is untouched and still knows about both.
 */
const SHIPPING: PolicyPage = {
  kind: "shipping",
  path: "/shipping",
  title: "Shipping. Lailark",
  heading: "Shipping",
  footerLabel: "Shipping",
  blocks: [
    {
      type: "paragraph",
      text: "We send jars anywhere in India. We do not ship outside the country yet.",
    },
    {
      type: "paragraph",
      text:
        "A jar that is in stock is packed and handed to the courier the next day. A jar " +
        "from an open batch waits until the batch is bottled, and we do not put a date " +
        "on that.",
    },
    {
      type: "paragraph",
      text:
        "Delivery is included in the price at the moment, so the price on the jar is " +
        "the price you pay. If we ever do charge for it, the charge will be on the jar " +
        "card and in the total you see before you pay, not after.",
    },
    {
      type: "paragraph",
      text:
        "We post through India Post for now. We send the tracking number on WhatsApp " +
        "once the parcel is booked. The jar is taped and sealed in a small box, marked " +
        "fragile. If it reaches you broken, send us a photo or call on " +
        "+91 88919 23827 and we will sort it out with you.",
    },
  ],
};

/**
 * Who the seller is, and what buying a jar means when the batch is cooked to
 * order. D66: the current proprietorship, and nothing about a future entity.
 * The last block is the honest consequence of this collection existing: the
 * pages change, and an order keeps the version it was sold under.
 */
const TERMS: PolicyPage = {
  kind: "terms",
  path: "/terms",
  title: "Terms. Lailark",
  heading: "Terms",
  footerLabel: "Terms",
  blocks: [
    {
      type: "paragraph",
      text:
        "Lailark Kitchen is the trading name of Shefin Muhamed, who runs it as a " +
        "proprietorship. Everything sold here is cooked at home in Kunnamangalam.",
    },
    {
      type: "lines",
      lines: [
        `${POLICY_CONTACT.legalName}, trading as ${POLICY_CONTACT.tradingName}`,
        POLICY_CONTACT.address,
        `FSSAI ${POLICY_CONTACT.fssai}`,
        POLICY_CONTACT.phone,
        POLICY_CONTACT.email,
      ],
    },
    { type: "heading", text: "Buying a jar" },
    {
      type: "paragraph",
      text:
        "A jar that is in stock is already made and sitting here. It is yours once the " +
        "payment goes through, and it ships the next day.",
    },
    {
      type: "paragraph",
      text:
        "An open batch has not been cooked yet. When you pay for a jar from one, that " +
        "jar is kept for you and nothing more is asked of you later. Once half the " +
        "batch is paid for we buy what it needs and start cooking, and we send photos " +
        "from the kitchen while it happens. We do not put a date on it.",
    },
    {
      type: "paragraph",
      text:
        "The price on the page is the whole price. You see the total, with any delivery " +
        "charge in it, before you pay for anything. A jar holds 200 g and is never sold " +
        "above the price printed on the label.",
    },
    { type: "heading", text: "Cancelling, returns and a jar that arrives broken" },
    {
      type: "paragraph",
      text: "Our Orders page says how we handle these, and it is linked at the foot of every page.",
    },
    { type: "heading", text: "What is on the jar" },
    {
      type: "paragraph",
      text:
        "The ingredients and the claims on this site are copied from the printed label, " +
        "word for word. If you have an allergy or a health question, read the label and " +
        "ask your doctor.",
    },
    { type: "heading", text: "When a batch goes wrong" },
    {
      type: "paragraph",
      text:
        "Sometimes a batch does not come out right. If we cannot cook one you have " +
        "paid for, we will call you and sort it out with you.",
    },
    { type: "heading", text: "Changes to these pages" },
    {
      type: "paragraph",
      text:
        "We rewrite them when something about the kitchen changes. Every version is " +
        "kept, and your order records the one that was live on the day you placed it.",
    },
  ],
};

/**
 * What is collected, why, how long, and how to ask for it back or ask for it
 * gone. Brief §7.2 for the checkout fields, §18.1 for what is stored, §20.5
 * and §20.6 for consent being separate from buying, and D66 for the retention
 * answer, which names no fixed period on purpose. Razorpay is named because
 * it is the processor and a customer's card details go to it rather than to
 * us. No breach-notification window is stated: nothing in the docs decides
 * one, and a page is the wrong place to invent it.
 */
const PRIVACY: PolicyPage = {
  kind: "privacy",
  path: "/privacy",
  title: "Privacy. Lailark",
  heading: "Privacy",
  footerLabel: "Privacy",
  blocks: [
    {
      type: "paragraph",
      text: "We ask for as little as we can.",
    },
    { type: "heading", text: "What we ask for" },
    {
      type: "paragraph",
      text:
        "To send you a jar we need your name, your WhatsApp number, and the address and " +
        "pincode it goes to. That is everything the checkout asks.",
    },
    {
      type: "paragraph",
      text:
        "We use it to pack the order, to tell you what is happening with it, and to " +
        "keep our books. The address goes to the courier who delivers it. Nobody else " +
        "gets any of it, and we do not sell it.",
    },
    { type: "heading", text: "Paying" },
    {
      type: "paragraph",
      text:
        "Payments are handled by Razorpay. Your card or UPI details go to them and " +
        "never to us, so we do not hold them and could not show them to you. We keep " +
        "the payment reference, which is what lets us find your order later.",
    },
    { type: "heading", text: "Where it is kept" },
    {
      type: "paragraph",
      text:
        "On Google's Firebase, in their Mumbai region, so it stays in India.",
    },
    { type: "heading", text: "How long we keep it" },
    {
      type: "paragraph",
      text:
        "Order records are kept for as long as the law requires us to keep our books of " +
        "account. Your WhatsApp number is kept until you ask us to remove it. We keep " +
        "nothing else.",
    },
    { type: "heading", text: "The two ticks at checkout" },
    {
      type: "paragraph",
      text:
        "One tick lets us send your bill, your jar number and the tracking on WhatsApp. " +
        "We need that one to get the order to you, and it is all we use your number for.",
    },
    {
      type: "paragraph",
      text:
        "The other asks whether we may tell you when a new batch opens. That one is " +
        "yours to leave alone, nothing about your order changes either way, and we " +
        "never make buying depend on it. If you said yes and want it stopped, reply " +
        "Stop on WhatsApp and we take you off that list at once.",
    },
    { type: "heading", text: "Seeing it, or having it removed" },
    {
      type: "paragraph",
      text:
        "Write to founder.lailark@gmail.com and ask. We will send you what we hold " +
        "about you, or delete it. The bills and order records we have to keep for the " +
        "books stay, and we will tell you which those are.",
    },
    {
      type: "paragraph",
      text: "Anything you want to ask about this, call +91 88919 23827 or write to the same address.",
    },
  ],
};

/**
 * Brief §20.4: the legal name, the address, the contact and a **named**
 * grievance officer with his designation, plus the two commitments the Rules
 * make, acknowledgement within 48 hours and resolution within a month. The
 * same-day answer is the decided Owner response time (brief §0 and §24.1).
 */
const CONTACT: PolicyPage = {
  kind: "contact",
  path: "/contact",
  title: "Contact. Lailark",
  heading: "Contact",
  footerLabel: "Contact",
  blocks: [
    {
      type: "paragraph",
      text:
        "Call or message us on +91 88919 23827, or write to founder.lailark@gmail.com. " +
        "One of us answers, usually the same day.",
    },
    { type: "heading", text: "Who you are buying from" },
    {
      type: "lines",
      lines: [
        `${POLICY_CONTACT.legalName}, trading as ${POLICY_CONTACT.tradingName}`,
        POLICY_CONTACT.address,
        `FSSAI ${POLICY_CONTACT.fssai}`,
      ],
    },
    { type: "heading", text: "Grievance officer" },
    {
      type: "lines",
      lines: [
        `${POLICY_CONTACT.grievanceOfficer}, ${POLICY_CONTACT.grievanceOfficerRole}`,
        POLICY_CONTACT.phone,
        POLICY_CONTACT.email,
      ],
    },
    {
      type: "paragraph",
      text:
        "If you have a complaint, call or write and it reaches him. We will tell you we " +
        "have it within 48 hours, and we will settle it within a month.",
    },
  ],
};

/** The five pages, in the order the footer lists them. */
export const POLICY_PAGES: readonly PolicyPage[] = [
  ORDERS,
  SHIPPING,
  TERMS,
  PRIVACY,
  CONTACT,
];

/** Look a page up by kind. Throws on an unknown kind, which cannot happen. */
export function policyPage(kind: PolicyKind): PolicyPage {
  const page = POLICY_PAGES.find((p) => p.kind === kind);
  if (page === undefined) throw new Error(`No policy page for kind "${kind}".`);
  return page;
}

/**
 * The strings the site's renderer turns into links. Not part of any page's
 * text, so linking them cannot change a version.
 */
export const policyLinkTargets = [
  { match: POLICY_CONTACT.phone, href: `tel:${POLICY_CONTACT.phone.replace(/\s+/g, "")}` },
  { match: POLICY_CONTACT.email, href: `mailto:${POLICY_CONTACT.email}` },
] as const;

/* -------------------------------------------------------------------------- */
/* The version                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One page's text, exactly as `policyVersions/{id}.text` stores it: the
 * heading, then every block in order, one block to a line and one line of a
 * `lines` block to a line. Nothing else, so the stored text reads as the page
 * reads and two pages that differ by a word differ here by a word.
 */
export function policyPageText(page: PolicyPage): string {
  const parts: string[] = [page.heading];
  for (const block of page.blocks) {
    if (block.type === "lines") parts.push(...block.lines);
    else parts.push(block.text);
  }
  return parts.join("\n");
}

/**
 * A 64-bit FNV-1a fingerprint of a string, as 16 hex characters.
 *
 * **Why not SHA-256.** This package is imported by the browser bundle as well
 * as by the server (see the note at the top of `index.ts`), so it may not
 * reach for `node:crypto`, and the Web Crypto digest is async, which a
 * constant like {@link POLICY_SET_VERSION} cannot await. FNV-1a is a content
 * fingerprint and nothing is riding on it being hard to collide with: the
 * only inputs are five pages of copy that we write ourselves, there is no
 * adversary choosing them, and the id is a label on a version rather than a
 * proof of one. `policies.test.ts` pins that a one-character edit moves it.
 */
function fingerprint(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * The version of the whole set of pages, derived from their words.
 *
 * An order carries one string, not five, so the string names the set: all
 * five pages as they stood when the order was placed. It is computed from the
 * text rather than typed, which is the point. A hand-bumped number can be
 * forgotten, and then an order records a version whose text has since been
 * rewritten underneath it. Editing one word of one page here changes this id,
 * so the next order records a new version and the old one keeps pointing at
 * what it was actually sold under.
 */
export function policySetVersion(pages: readonly PolicyPage[] = POLICY_PAGES): string {
  const canonical = pages
    .map((page) => `${page.kind}\n${policyPageText(page)}`)
    .join("\n\u0000\n");
  return `p-${fingerprint(canonical)}`;
}

/** The live version of the pages in this build. */
export const POLICY_SET_VERSION: string = policySetVersion();

/**
 * The `policyVersions/{id}` document id for one page of one set. The set
 * version is the prefix, so an order's `policyVersion` finds all five of its
 * pages by id without a query, and a new set never overwrites an old one.
 */
export function policyVersionDocId(setVersion: string, kind: PolicyKind): string {
  return `${setVersion}-${kind}`;
}
