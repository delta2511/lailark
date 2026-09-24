/**
 * Pure helpers for a batch record's content (M3.4), kept apart from the
 * `/batch/[nnn]` route's file discovery so they can be unit tested against
 * a fixture batch object, without a JSON file on disk.
 */

/**
 * "Prawns, dates, ..." with an optional "(NN%)" per ingredient (D28): an
 * ingredient renders its percent only when the batch's JSON supplies one.
 * Batch 001 supplies none, so its line has none; from batch 002 the JSON
 * can carry a percent per ingredient and this same function renders it.
 */
export function formatIngredients(ingredients) {
  const parts = ingredients.map((ing) =>
    typeof ing.percent === "number" ? `${ing.name} (${ing.percent}%)` : ing.name
  );
  return `${parts.join(", ")}.`;
}

/** The `<title>`, matching the printed-jar page's own for batch 001. */
export function batchTitle(batch) {
  return `Batch ${batch.number}. ${batch.name}. Lailark`;
}

/** The `<meta name="description">`, the four facts run together. */
export function batchDescription(batch) {
  return batch.facts.join(" ");
}
