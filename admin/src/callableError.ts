/**
 * What a person reads when a callable refuses.
 *
 * Every callable in this repo writes its refusals as plain sentences meant to
 * be read by Shefin or Sumayya, mid-task, often with a customer waiting. The
 * Firebase Functions client then appends the HTTP status to the message it
 * hands back, so "Someone just bought the last one, so there are no jars free
 * on this batch." arrives as that sentence followed by " [409]".
 *
 * That number is for a log. It is taken off here, in the one place every
 * screen's error handling goes through, rather than in each of them.
 */

/**
 * Removes a trailing bracketed HTTP status, and nothing else.
 *
 * Only 100 to 599, so a sentence that genuinely ends in a bracketed number of
 * its own keeps it: a batch is called 001, and "...in batch [001]" must not
 * come out as "...in batch".
 */
export function stripStatusCode(message: string): string {
  return message.replace(/\s*\[[1-5]\d{2}\]\s*$/, "").trim();
}

/**
 * The sentence the server wrote, or `fallback` when what came back was not
 * one: a network error, an offline queue, anything without a message.
 */
export function callableMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") {
      const plain = stripStatusCode(message);
      if (plain !== "") return plain;
    }
  }
  return fallback;
}
