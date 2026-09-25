/**
 * The two random strings an order and a customer carry: the order's private
 * page token, and the customer's share code.
 *
 * Both are minted on the server and only on the server. Nothing a client
 * sends is ever used as either, because a token a caller chose would be a
 * token a caller could guess for somebody else, and a share code a caller
 * chose would let one person answer to another person's name.
 *
 * `randomBytes`, not `Math.random`: this is the whole of the access control
 * on `/o/<token>` (brief §5, no login page), so it has to be unguessable
 * rather than merely unlikely.
 */

import { randomBytes } from "node:crypto";
import { ORDER_TOKEN_LENGTH, SHARE_CODE_LENGTH } from "@lailark/shared";

/**
 * A fresh order token: 32 lower-case hex characters, 128 bits of randomness.
 * Minted once, in the transaction that creates the order, and never changed:
 * a link that has been sent to a customer has to keep working.
 */
export function newOrderToken(): string {
  return randomBytes(ORDER_TOKEN_LENGTH / 2).toString("hex");
}

/**
 * A fresh share code for `customers/{phone}.shareCode`, in the alphabet
 * {@link SHARE_CODE_LENGTH} and `isShareCode` describe: digits and lower-case
 * letters, no ambiguous pairs stripped out because it is tapped rather than
 * read aloud, and short, because it guards nothing. It only says who sent
 * somebody along (brief §7.2 step 4, the share link on the receipt).
 */
export function newShareCode(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(SHARE_CODE_LENGTH);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
