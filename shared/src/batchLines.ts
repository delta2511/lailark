/**
 * Which document in `batches/{ref}/lines` each recipe line's actuals belong
 * to.
 *
 * M2.13 worked this out for the actuals screen: a line is keyed by its own
 * ingredient, never by the literal id `"main"`, because a recipe may flag
 * two lines `isMain` (batch 001's does: prawns and dates are both named in
 * the product name) and one id for both made them one document. D41 brings
 * the Sourcing -> Cooking step into the same shape: it asks for a weight and
 * a cost per main ingredient and writes one line document each, so the
 * server now has to derive the same ids the screen does.
 *
 * It lives here rather than in either of them because two implementations of
 * this are the bug: an id the server writes and an id the screen reads have
 * to be the same string, or the money is in a document nobody edits.
 * `admin/src/batches/lineIds.ts` builds the screen's legacy adoption on top
 * of this; `functions/src/batches/transitions.ts` writes against it.
 */

/** The part of a recipe line an id is derived from. */
export interface BatchLineRef {
  readonly ingredientId: string;
  readonly isMain?: boolean;
}

/** A main recipe line and the document its actuals live in. */
export interface MainBatchLine {
  readonly ingredientId: string;
  readonly lineId: string;
}

/**
 * One document id per recipe line, in the recipe's own order.
 *
 * A repeated ingredient is suffixed with the lowest `~n` that no other
 * line's ingredient id and no id already handed out is using (`salt`,
 * `salt~2`), because ingredient ids are not all opaque: batch 001's are
 * hand-written slugs, so an ingredient genuinely called `salt~2` is possible
 * and two lines must never land on one document. The suffix counts every
 * line of the recipe, main or not, so the id a main line gets does not
 * change depending on who is asking.
 */
export function batchLineIds(lines: readonly BatchLineRef[]): readonly string[] {
  const taken = new Set(lines.map((line) => line.ingredientId));
  const used = new Set<string>();
  return lines.map((line) => {
    if (!used.has(line.ingredientId)) {
      used.add(line.ingredientId);
      return line.ingredientId;
    }
    let n = 2;
    let candidate = `${line.ingredientId}~${n}`;
    while (taken.has(candidate) || used.has(candidate)) {
      n += 1;
      candidate = `${line.ingredientId}~${n}`;
    }
    used.add(candidate);
    return candidate;
  });
}

/**
 * The recipe's main lines, in the recipe's own order, each with the document
 * its weight and cost belong in.
 *
 * D41: Sourcing -> Cooking asks once per entry here. An empty list is a
 * recipe that names no main ingredient at all, which is Q16's question and
 * not this function's to answer.
 */
export function mainBatchLines(lines: readonly BatchLineRef[]): readonly MainBatchLine[] {
  const ids = batchLineIds(lines);
  const mains: MainBatchLine[] = [];
  lines.forEach((line, i) => {
    if (line.isMain === true) mains.push({ ingredientId: line.ingredientId, lineId: ids[i] as string });
  });
  return mains;
}
