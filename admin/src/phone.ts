/**
 * The admin's phone helpers.
 *
 * The parser itself moved to `@lailark/shared` in M2.8, because the
 * `createCounterSale` callable has to normalise a number the same way the
 * sign-in box does: the normalised number is the `customers/{phoneE164}`
 * document id, and two spellings of one number would be two customers. This
 * module re-exports it so every import written before M2.8 still resolves,
 * and keeps the one helper that is only ever about this app's OTP box.
 */
export {
  formatIndianMobile,
  INDIA_DIALLING_CODE,
  isIndianMobileE164,
  nearMissNumbers,
  parseIndianMobile,
  type PhoneParse,
} from "@lailark/shared";

/** The six digit code, cleaned of anything that is not a digit. */
export function cleanOtp(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}
