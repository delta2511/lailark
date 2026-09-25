/**
 * `POST /api/notify`: the "tell me when these jars go on sale" line beside a
 * batch on the stove (brief §7.5, D64).
 *
 * Brief §7.5: "When cooking starts, booking closes. The card reads 'Being
 * cooked now. Unpaid jars go on sale when bottled' with a notify-me. At
 * Bottled, every unbooked jar goes on sale in stock at ₹649, and everyone on
 * the notify-me list is offered a message (owner approves the send)." This is
 * the list. Nothing here sends anything, ever: the offer at Bottled is an
 * approval the Owner answers (D32), and this endpoint only writes a row.
 *
 * It writes to `notify`, the collection the v0 site already used and
 * `firestore.rules` already bounds (CLAUDE.md §9). The site is a static
 * export with no Firebase SDK in it, so the write comes through here rather
 * than straight from the browser, which also means the row's shape and its
 * timestamp are ours rather than a caller's.
 *
 * **What it will not do.** It stores a number and nothing else: no name, no
 * address, no marketing tick. It answers the same `{ ok: true }` whether the
 * number was already on the list or not, because "you are already on this
 * list" is an answer that tells a stranger whether somebody signed up.
 * Rate limiting is M5.9's, with App Check, as it is for every other public
 * door on this site.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { parseIndianMobile } from "@lailark/shared";

/** The sources `firestore.rules` allows on a `notify` row. */
export type NotifySource = "index" | "batch-001" | "cooking";

const SOURCES: readonly string[] = ["index", "batch-001", "cooking"];
const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;

export interface NotifyRefusal {
  readonly ok: false;
  readonly status: number;
  readonly message: string;
}

export type NotifyResult = { readonly ok: true } | NotifyRefusal;

/**
 * The request, checked. Every message here is read by a customer, so each is
 * a sentence and none carries an em dash (CLAUDE.md §3).
 *
 * ASSUMED (M3.8): the two refusal sentences. D64 approved the label, the
 * button and the sentence after the tap, and drafted nothing for a number
 * that is not a number; the first of these is the checkout's own wording for
 * the same mistake, reused rather than invented twice.
 */
export function parseNotifyRequest(
  raw: unknown,
):
  | {
      readonly ok: true;
      readonly value: {
        readonly contact: string;
        readonly source: NotifySource;
        readonly productSlug: string | null;
      };
    }
  | NotifyRefusal {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, status: 400, message: "Please give us your WhatsApp number." };
  }
  const data = raw as Record<string, unknown>;

  const given = typeof data.contact === "string" ? data.contact.trim() : "";
  const phone = parseIndianMobile(given);
  if (!phone.ok) {
    return {
      ok: false,
      status: 400,
      message:
        phone.reason === "notIndian"
          ? "We ship inside India, so we need an Indian mobile number. Message us on WhatsApp if you are abroad."
          : "That does not look like a 10 digit Indian mobile number. Please check it.",
    };
  }

  const source = typeof data.source === "string" ? data.source : "";
  if (!SOURCES.includes(source)) {
    return { ok: false, status: 400, message: "Something went wrong. Please reload the page." };
  }

  // The slug says which batch somebody asked about, so the Owner's list at
  // Bottled is the people who asked about that pickle rather than everybody.
  // Dropped rather than refused when it is not a slug: the number is the
  // point, and a missing slug is a list that is merely wider.
  const rawSlug = typeof data.productSlug === "string" ? data.productSlug.trim() : "";
  const productSlug = SLUG.test(rawSlug) ? rawSlug : null;

  return { ok: true, value: { contact: phone.e164, source: source as NotifySource, productSlug } };
}

/**
 * Adds somebody to the list, or leaves it as it is when they are already on
 * it for the same thing. The id is derived from the number and what they
 * asked about, so a person who taps twice is one row, not two.
 */
export async function addToNotifyList(db: Firestore, raw: unknown): Promise<NotifyResult> {
  const parsed = parseNotifyRequest(raw);
  if (!parsed.ok) return parsed;
  const { contact, source, productSlug } = parsed.value;

  const id = `${source}_${productSlug ?? "any"}_${contact}`.replace(/[^A-Za-z0-9_+-]/g, "");
  await db
    .collection("notify")
    .doc(id)
    .set(
      {
        contact,
        source,
        productSlug,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  return { ok: true };
}
