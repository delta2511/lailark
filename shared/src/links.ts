/**
 * The two links a customer is ever handed: their own private order page, and
 * a share link back to the product they bought.
 *
 * Both are read by the site, written by the functions and drawn by the admin,
 * so the spelling of each lives here rather than in three places. Brief §5:
 * "'Where is my order' is answered by the agent on WhatsApp, or by a private
 * order link sent with the bill (`lailark.in/o/<long random token>`). No login
 * page." That URL is permanent (CLAUDE.md §5 puts customer URLs on the
 * never-assume list), so `/o/<token>` is built once, here.
 *
 * Nothing in this module sends anything. `waMeLink` builds the href the Owner
 * or the Kitchen taps themselves (D32: at launch every customer message is
 * sent by hand from a prefilled WhatsApp link, and the sender ticks it sent).
 */

/**
 * How many hex characters an order token carries: 32, which is 128 bits of
 * randomness. The token is the only thing standing between a stranger and
 * somebody's address and bill, so it is long enough that guessing is not a
 * strategy, and short enough to survive being pasted into WhatsApp.
 */
export const ORDER_TOKEN_LENGTH = 32;

const ORDER_TOKEN = /^[0-9a-f]{32}$/;

/** True for a string that could be an order token. Case sensitive: lower hex. */
export function isOrderToken(value: unknown): value is string {
  return typeof value === "string" && ORDER_TOKEN.test(value);
}

/**
 * The path of a private order page, `"/o/<token>"`, or null when the token is
 * not one. Null rather than a path with rubbish in it: a link that cannot
 * work should not be drawn at all.
 */
export function orderPath(token: unknown): string | null {
  return isOrderToken(token) ? `/o/${token}` : null;
}

/**
 * The same page as an absolute URL, for a message that leaves the site.
 * `base` is the site's origin, with or without a trailing slash.
 */
export function orderUrl(base: string, token: unknown): string | null {
  const path = orderPath(token);
  if (path === null || typeof base !== "string" || base.trim() === "") return null;
  return `${base.trim().replace(/\/+$/, "")}${path}`;
}

/**
 * A `wa.me` link that opens WhatsApp with the message already typed, for one
 * recipient (D32).
 *
 * `wa.me` wants the number in digits with no plus and no spaces, so an E.164
 * number is stripped to its digits. Returns null for anything that is not a
 * number we could message, so a missing phone draws no link rather than a
 * link to nobody.
 */
export function waMeLink(phoneE164: unknown, text: unknown): string | null {
  if (typeof phoneE164 !== "string") return null;
  const digits = phoneE164.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const body = typeof text === "string" ? text : "";
  const query = body.trim() === "" ? "" : `?text=${encodeURIComponent(body)}`;
  return `https://wa.me/${digits}${query}`;
}

/**
 * The share link a customer is given with their receipt (brief §7.2 step 4):
 * the product page with `?s=<shareCode>` on it, which is what
 * `createCheckout` records on any order that arrives through it.
 *
 * The code itself is on `customers/{phone}.shareCode`.
 */
export const SHARE_CODE_PARAM = "s";

/**
 * How many hex characters a share code carries. Shorter than an order token
 * on purpose: it guards nothing, it only says who sent somebody along, and it
 * is read aloud and retyped more often than it is tapped.
 */
export const SHARE_CODE_LENGTH = 10;

const SHARE_CODE = /^[0-9a-z]{4,32}$/;

/** True for a string that could be a share code. */
export function isShareCode(value: unknown): value is string {
  return typeof value === "string" && SHARE_CODE.test(value);
}

/** `"/pickles/<slug>?s=<code>"`, or the plain path when there is no code. */
export function shareLinkPath(productSlug: string, shareCode: unknown): string {
  const path = `/pickles/${encodeURIComponent(productSlug)}`;
  return isShareCode(shareCode) ? `${path}?${SHARE_CODE_PARAM}=${shareCode}` : path;
}
