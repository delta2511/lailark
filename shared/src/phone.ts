/**
 * Indian mobile numbers: the one place in the repo that decides what a number
 * is and how it is spelled.
 *
 * A phone number is the `customers/{phoneE164}` document id (brief section
 * 18.1), which is what makes "one customer per number" true by construction.
 * That is only true if every part of the system normalises a typed number the
 * same way, so the sign-in box, the counter sale screen and the
 * `createCounterSale` callable all come through here. Two spellings of one
 * number would be two customers, two allowances against a batch's per-person
 * limit, and two histories.
 *
 * This lived in `admin/src/phone.ts` from M1.6; M2.8 moved it here unchanged
 * so the server could use the same parser rather than write a second one.
 * `admin/src/phone.ts` re-exports it, so every existing import still works.
 *
 * Accepts: 7736110087, 07736110087, 91 7736110087, +91 7736110087, 0091...,
 * and any of those with spaces, dashes or brackets in them.
 */

export type PhoneParse =
  | { readonly ok: true; readonly e164: string; readonly national: string }
  | { readonly ok: false; readonly reason: "empty" | "notIndian" | "invalid" };

/** An Indian mobile is ten digits and starts 6, 7, 8 or 9. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** E.164 as Firebase Auth and `customers/{id}` store it. */
export const INDIA_DIALLING_CODE = "+91";

/** Strips everything a keypad might add, keeping a single leading plus. */
function clean(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return plus ? `+${digits}` : digits;
}

export function parseIndianMobile(raw: string): PhoneParse {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const value = clean(raw);

  if (value === "" || value === "+") {
    return { ok: false, reason: "empty" };
  }

  if (value.startsWith("+")) {
    if (!value.startsWith("+91")) {
      return { ok: false, reason: "notIndian" };
    }
    return fromNational(value.slice(3));
  }

  // 0091..., 91..., 0..., or a bare ten digit number.
  if (value.startsWith("0091")) return fromNational(value.slice(4));
  if (value.length === 12 && value.startsWith("91")) return fromNational(value.slice(2));
  if (value.length === 11 && value.startsWith("0")) return fromNational(value.slice(1));
  return fromNational(value);
}

function fromNational(national: string): PhoneParse {
  if (!INDIAN_MOBILE.test(national)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, e164: `${INDIA_DIALLING_CODE}${national}`, national };
}

/** "+917736110087" reads as "+91 77361 10087" on screen. */
export function formatIndianMobile(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match ? `+91 ${match[1]} ${match[2]}` : e164;
}

/** True for a number already in the canonical `+91` + ten digits form. */
export function isIndianMobileE164(value: unknown): value is string {
  return typeof value === "string" && /^\+91[6-9]\d{9}$/.test(value);
}

/* -------------------------------------------------------------------------- */
/* Near misses (M2.8)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every number one typing slip away from `e164`: the ten single-digit
 * substitutions at each of the ten positions, and the nine swaps of two
 * neighbouring digits.
 *
 * **Why this exists.** The counter sale creates `customers/{phone}` when the
 * number is new, so a number typed wrong at the door does not fail, it
 * quietly invents a stranger: a person with no history, whose bill goes to
 * somebody else's WhatsApp, and whose real record never gets the jar. There
 * is nothing later that notices.
 *
 * The list is bounded (at most 99 numbers, all of them exact document ids),
 * so checking it is a batched read by id, never a scan and never an index.
 * A near miss is only ever shown to the person at the counter to confirm; it
 * never changes a number by itself.
 *
 * Only spellings that are themselves valid Indian mobiles come back, so a
 * substitution that puts 0 at the front is dropped rather than offered.
 */
export function nearMissNumbers(e164: string): string[] {
  const parsed = parseIndianMobile(e164);
  if (!parsed.ok) return [];
  const digits = parsed.national.split("");
  const out = new Set<string>();

  for (let i = 0; i < digits.length; i += 1) {
    for (let d = 0; d <= 9; d += 1) {
      const swapped = [...digits];
      swapped[i] = String(d);
      const candidate = swapped.join("");
      if (candidate !== parsed.national && INDIAN_MOBILE.test(candidate)) {
        out.add(`${INDIA_DIALLING_CODE}${candidate}`);
      }
    }
  }

  for (let i = 0; i < digits.length - 1; i += 1) {
    if (digits[i] === digits[i + 1]) continue;
    const swapped = [...digits];
    swapped[i] = digits[i + 1];
    swapped[i + 1] = digits[i];
    const candidate = swapped.join("");
    if (INDIAN_MOBILE.test(candidate)) out.add(`${INDIA_DIALLING_CODE}${candidate}`);
  }

  return [...out];
}
