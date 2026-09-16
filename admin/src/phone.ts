/**
 * Indian mobile numbers, typed the way people actually type them, turned into
 * the one spelling Firebase Auth and Firestore both store: E.164, +91 then ten
 * digits.
 *
 * Accepts: 7736110087, 07736110087, 91 7736110087, +91 7736110087, and any of
 * those with spaces, dashes or brackets in them.
 */
export type PhoneParse =
  | { readonly ok: true; readonly e164: string; readonly national: string }
  | { readonly ok: false; readonly reason: "empty" | "notIndian" | "invalid" };

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** Strips everything a keypad might add, keeping a single leading plus. */
function clean(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return plus ? `+${digits}` : digits;
}

export function parseIndianMobile(raw: string): PhoneParse {
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
  return { ok: true, e164: `+91${national}`, national };
}

/** "+917736110087" reads as "+91 77361 10087" on screen. */
export function formatIndianMobile(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match ? `+91 ${match[1]} ${match[2]}` : e164;
}

/** The six digit code, cleaned of anything that is not a digit. */
export function cleanOtp(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}
