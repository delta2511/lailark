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
 * Validates money that is spent rather than charged: a batch's jar, box and
 * labelling costs, an ingredient's actual cost, a packing or courier cost.
 *
 * Returns true only for a whole number of paise, zero or more. Zero is
 * legitimate (a cost genuinely can be nothing), and the ₹649 MRP is a ceiling
 * on what a jar is sold for, never on what it cost to make, so no upper bound
 * applies here.
 */
export function isCostPaise(paise: number | null | undefined): boolean {
  if (paise === null || paise === undefined) return false;
  if (!Number.isInteger(paise)) return false;
  return paise >= 0;
}

/**
 * Validates the amount for a custom line: the same rule as a cost (a custom
 * line can be zero but never negative, and the MRP does not apply to it), so
 * it is that one rule under the name the Products screen reads by.
 */
export function isCustomLineAmountPaise(paise: number | null | undefined): boolean {
  return isCostPaise(paise);
}
