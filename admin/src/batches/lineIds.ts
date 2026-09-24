/**
 * Which document in `batches/{ref}/lines` each recipe line's actuals belong
 * to, and which documents no line claims (M2.13).
 *
 * Until M2.13 this was `isMain ? "main" : ingredientId`. That is wrong the
 * moment a recipe has two main lines, which batch 001's has: prawns and
 * dates are both named in the product name, so 5(2)(g) asks for a percentage
 * against each and both carry `isMain`. Both rows read and wrote
 * `lines/main`, so a cost typed against prawns landed on dates and the row
 * typed first looked as though it had never saved. Money typed by hand was
 * lost with no error shown.
 *
 * The scheme here:
 *
 * - **A line is keyed by its ingredient.** Stable across renders and
 *   reloads, unique between two main lines, and untouched if an editor later
 *   flips `isMain` on or off: an actual already typed can never be orphaned
 *   by a flag that has nothing to do with which ingredient went in the pot.
 * - **A repeated ingredient is suffixed, and the suffix is checked against
 *   every other id in play** (`salt`, `salt~2`; `batchLineIds` in
 *   `@lailark/shared`, which the server derives the same ids from), because
 *   ingredient ids are
 *   not all opaque: batch 001's are hand-written slugs, so an ingredient
 *   genuinely called `salt~2` is possible and two rows must never land on
 *   one document again. `RecipeDetail` now refuses to save two lines of one
 *   ingredient at all (M2.13), so this is a backstop for recipes saved
 *   before that, not a shape the admin can still create.
 * - **A legacy `lines/main` document is adopted by the line it was written
 *   for**, and keeps that id. See `LEGACY_MAIN_ID`.
 * - **A document no line claims is an orphan, and the screen says so.** It
 *   is never reassigned to another ingredient and never hidden.
 */
import { batchLineIds, type BatchLineRef } from "@lailark/shared";

/**
 * The id `sourcing -> cooking` used to write the main ingredient's raw
 * weight and cost under (brief 14.1, `functions/src/batches/transitions.ts`,
 * `planStartCooking`). That write now uses the main ingredient's own id, so
 * no new document is ever created here. Batches cooked before M2.13 still
 * have one, on the emulator and possibly on staging, and it may carry a cost
 * somebody typed.
 *
 * Rather than move that money between documents, the row it was written for
 * adopts it: the row goes on reading and writing `lines/main`, so nothing is
 * copied, nothing is deleted, no write can half-finish and no migration has
 * to be run (or run twice) anywhere. Every other row, including a second
 * main line, gets its own id, which is what the bug was about.
 *
 * Adoption is decided from the documents that have actually loaded, so
 * `CookingActuals` must not resolve or commit anything while the listener is
 * still loading: a row resolved against an empty list would bind to its own
 * id, and a commit in that window would strand the legacy money in a second
 * document under the same ingredient, which a later P&L would then count
 * twice.
 */
export const LEGACY_MAIN_ID = "main";

/**
 * D41 (M2.19): the ingredient-keyed part of this scheme moved to
 * `@lailark/shared` (`batchLineIds`), because Sourcing -> Cooking now writes
 * one line document per main ingredient and the server has to derive the
 * same ids this screen reads. What stays here is what only the screen needs:
 * the legacy `lines/main` adoption and the orphan report.
 */
export type RecipeLineRef = BatchLineRef;

export interface ExistingLineRef {
  readonly id: string;
  readonly ingredientId?: string;
}

export interface ResolvedLine {
  /** The document in `batches/{ref}/lines` this row reads and writes. */
  readonly docId: string;
  /**
   * What the row is called on the screen: its ingredient-keyed id, whatever
   * document it happens to be bound to. Element ids and test ids use this,
   * so a legacy row is not addressed by a different name than a fresh one.
   */
  readonly rowKey: string;
}

/** A line document no row in this recipe claims. Its money is still real. */
export interface OrphanLine<T extends ExistingLineRef = ExistingLineRef> {
  readonly doc: T;
  /**
   * The ingredient it names, or null when it names none: the placeholder
   * `planStartCooking` writes for a recipe with no main ingredient at all.
   */
  readonly ingredientId: string | null;
}

/**
 * One resolved line per recipe line, in the recipe's own order, plus every
 * loaded document no line claims.
 *
 * `existing` is the `lines` subcollection as the screen currently holds it,
 * and the caller must only pass it once the listener has loaded (see
 * `LEGACY_MAIN_ID`). It decides whether a pre-M2.13 `lines/main` document is
 * adopted; it never changes the id of a line that has a document of its own.
 */
export function resolveActuals<T extends ExistingLineRef>(
  lines: readonly RecipeLineRef[],
  existing: readonly T[],
): { readonly rows: readonly ResolvedLine[]; readonly orphans: readonly OrphanLine<T>[] } {
  const keys = batchLineIds(lines);
  const ids = resolveLineIds(lines, existing);
  const claimed = new Set(ids);
  return {
    rows: ids.map((docId, i) => ({ docId, rowKey: keys[i] as string })),
    orphans: existing
      .filter((doc) => !claimed.has(doc.id))
      .map((doc) => ({
        doc,
        ingredientId:
          typeof doc.ingredientId === "string" && doc.ingredientId !== "" && doc.ingredientId !== LEGACY_MAIN_ID
            ? doc.ingredientId
            : null,
      })),
  };
}

/** The document ids alone, in the recipe's own order. */
export function resolveLineIds(
  lines: readonly RecipeLineRef[],
  existing: readonly ExistingLineRef[],
): readonly string[] {
  const ids = batchLineIds(lines);
  const legacy = existing.find((doc) => doc.id === LEGACY_MAIN_ID);
  if (legacy === undefined) return ids;
  // An ingredient genuinely called "main" owns the id; nothing to adopt.
  if (ids.includes(LEGACY_MAIN_ID)) return ids;

  const named =
    typeof legacy.ingredientId === "string" && legacy.ingredientId !== LEGACY_MAIN_ID
      ? legacy.ingredientId
      : null;
  const adopter =
    named !== null
      ? lines.findIndex((line) => line.ingredientId === named)
      : lines.findIndex((line) => line.isMain === true);
  if (adopter === -1) return ids;

  // A document already written under that row's own id wins: the legacy one
  // has been superseded, and reaching back for it would undo a later edit.
  // The superseded document does not disappear; it comes back as an orphan,
  // so the money in it is on the screen rather than silently in the sum.
  const own = ids[adopter];
  if (existing.some((doc) => doc.id === own)) return ids;

  const adopted = [...ids];
  adopted[adopter] = LEGACY_MAIN_ID;
  return adopted;
}
