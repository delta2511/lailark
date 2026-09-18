/**
 * The one place the Products screen turns what a person typed into a price
 * box into paise. CLAUDE.md section 3: money is integers in paise, never
 * floats, never rupees, anywhere in code or data, so rupees exist only for
 * as long as the box holds a string; every call site converts through here
 * before a value reaches Firestore.
 */
import { MRP_PAISE, rupeesToPaise, type Paise } from "@lailark/shared";

/**
 * Parses a rupee amount typed into a box. Returns null for anything that is
 * not a finite number: an empty box, "abc", a lone minus sign. Never throws,
 * so a caller mid-keystroke can simply treat null as "not a valid amount
 * yet" rather than catching an exception on every render.
 */
export function parseRupeesToPaise(text: string): Paise | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  try {
    return rupeesToPaise(value);
  } catch {
    return null;
  }
}

/**
 * Validates a price for a product (in stock or open batch).
 * Returns true only for positive integers up to the MRP (64900 paise = ₹649).
 * A valid sellable price is at least 1 paise (₹0.01).
 */
export function isSellablePaise(paise: number | null | undefined): boolean {
  if (paise === null || paise === undefined) return false;
  if (!Number.isInteger(paise)) return false;
  return paise >= 1 && paise <= MRP_PAISE;
}

/**
 * Validates the amount for a custom line.
 * Returns true only for non-negative integers (a custom line can be zero cost
 * but never negative; the MRP does not apply to custom lines).
 */
export function isCustomLineAmountPaise(paise: number | null | undefined): boolean {
  if (paise === null || paise === undefined) return false;
  if (!Number.isInteger(paise)) return false;
  return paise >= 0;
}
