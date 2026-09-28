/**
 * What a person types into the two money boxes on the refund panel, as paise.
 *
 * CLAUDE.md §3: money is integers in paise, never floats, never rupees, so
 * rupees exist only for as long as the box holds a string. The parsing itself is
 * `products/productMoney.ts`'s `parseRupeesToPaise`, which is the one every
 * other money box in the admin already goes through: round 1 of M4.5 defined a
 * second function of the same name here with different behaviour, and two rules
 * for one thing is how "6.5e2" comes to mean different amounts on two screens.
 *
 * What is left for this file is the two bounds, which differ by one thing:
 * refunding nothing is not a refund, and a gateway fee of nothing is a real
 * answer. Both are also checked on the server, which is where they count; these
 * exist so the box can say so before the hold rather than after it.
 */
import { isCostPaise, parseRupeesToPaise } from "../products/productMoney";

/** Rupees to paise for the refund amount: whole paise, above zero, or null. */
export function refundAmountPaise(value: string): number | null {
  const paise = parseRupeesToPaise(value);
  if (paise === null || !isCostPaise(paise) || paise <= 0) return null;
  return paise;
}

/** The same for the gateway fee, except that zero is a real answer. */
export function gatewayFeePaise(value: string): number | null {
  const paise = parseRupeesToPaise(value);
  if (paise === null || !isCostPaise(paise)) return null;
  return paise;
}
