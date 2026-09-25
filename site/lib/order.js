/**
 * The private order page's reading of `/api/order/<token>`, kept out of the
 * component so it can be tested without a browser.
 *
 * Same discipline as `site/app/_lib/counts.js`: every field is checked on its
 * raw JSON value and anything that does not check out is dropped rather than
 * coerced. A page that tells somebody their order came to ₹0 because a field
 * was missing is worse than a page that does not show a total.
 *
 * Money is integers in paise here as everywhere else, and it is formatted
 * with `@lailark/shared`'s own formatter, never a second one.
 */

import { formatINR, isOrderToken } from "@lailark/shared";

export { formatINR, isOrderToken };

/**
 * The token out of `/o/<token>`, or null. Read off the path rather than a
 * query string, because the path is what brief §5 fixes and what is printed
 * in somebody's WhatsApp thread forever.
 */
export function tokenFromPath(pathname) {
  if (typeof pathname !== "string") return null;
  const match = /^\/o\/([^/?#]+)\/?$/.exec(pathname);
  if (!match) return null;
  return isOrderToken(match[1]) ? match[1] : null;
}

/** Where the page fetches from, for one token. */
export function orderApiUrl(token) {
  return isOrderToken(token) ? `/api/order/${token}` : null;
}

function int(value) {
  return Number.isInteger(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * `/api/order/<token>`'s payload as the page may use it, or null when the
 * reply is not one this page understands. Null is drawn as "we could not
 * find that order", which is also what a 404 draws: a customer does not need
 * to know which of the two happened, and neither answer should ever be a
 * stack trace.
 */
export function readOrderPayload(payload) {
  const order = payload?.order;
  if (!order || typeof order !== "object") return null;
  const number = text(order.number);
  if (number === "") return null;

  const rawLines = Array.isArray(order.lines) ? order.lines : [];
  const lines = rawLines
    .map((line) => ({
      // Trimmed, so an older deploy of the function that still sent a
      // whitespace-only name cannot draw a blank where a name belongs. `""`
      // is a line with no description, which the page draws as nothing at
      // all rather than as an empty column (A214, M3.8 round 3).
      description: text(line?.description).trim(),
      qty: int(line?.qty),
      unitPricePaise: int(line?.unitPricePaise),
      batchNo: typeof line?.batchNo === "string" && line.batchNo !== "" ? line.batchNo : null,
      jarNumbers: Array.isArray(line?.jarNumbers)
        ? line.jarNumbers.filter((n) => Number.isInteger(n))
        : [],
    }))
    .filter((line) => line.qty !== null && line.qty > 0);

  const contact = order.delivery;
  return {
    number,
    // The order's state, its channel and the payment's status and method are
    // deliberately not read: D63 keeps the state off this page, the endpoint
    // no longer sends any of the four, and nothing here draws them.
    placedOnMillis: typeof order.placedOnMillis === "number" ? order.placedOnMillis : null,
    lines,
    shippingFeePaise: int(order.shippingFeePaise),
    totalPaise: int(order.totalPaise),
    delivery:
      contact && typeof contact === "object"
        ? {
            name: text(contact.name),
            lines: Array.isArray(contact.lines) ? contact.lines.map(text).filter(Boolean) : [],
            city: text(contact.city),
            state: text(contact.state),
            pincode: text(contact.pincode),
          }
        : null,
    documents: Array.isArray(payload?.documents)
      ? payload.documents
          .map((doc) => ({
            kind: text(doc?.kind),
            number: text(doc?.number),
            issuedOn: typeof doc?.issuedOn === "string" ? doc.issuedOn : null,
            totalPaise: int(doc?.totalPaise),
            url: safeDocumentUrl(doc?.url),
          }))
          .filter((doc) => doc.number !== "")
      : [],
  };
}

/**
 * A document's link, or null.
 *
 * Only `https:` is ever drawn as an `href`. The url is a signed Storage link
 * the server builds, so nothing else can reach this today, but the page
 * should not be the thing standing between a stored string and a `javascript:`
 * or `data:` href if that ever stops being true.
 */
export function safeDocumentUrl(value) {
  if (typeof value !== "string" || value === "") return null;
  return /^https:\/\//i.test(value) ? value : null;
}

/** The whole address on one line, as a parcel label would read it. */
export function addressLines(delivery) {
  if (!delivery) return [];
  const tail = [delivery.city, delivery.state, delivery.pincode].filter(Boolean).join(", ");
  return [delivery.name, ...delivery.lines, tail].filter(Boolean);
}

/** "1 jar" / "3 jars", never "1 jars". Same words as the checkout uses. */
export function jarWords(qty) {
  return `${qty} jar${qty === 1 ? "" : "s"}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-09-04" as "4 Sep 2026", the same spelling the batch record uses. */
export function formatDate(iso) {
  if (typeof iso !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month} ${y}` : null;
}

/** Epoch millis as the same date spelling, in Asia/Kolkata. */
export function formatMillis(millis) {
  if (typeof millis !== "number" || !Number.isFinite(millis)) return null;
  return formatDate(new Date(millis + 330 * 60_000).toISOString().slice(0, 10));
}
