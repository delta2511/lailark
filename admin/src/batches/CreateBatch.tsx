/**
 * `none -> draft`, brief section 8.2's first row: Owner only, "Planned jars,
 * price, limit (prefilled). Bookable computed at 90%." The one small form
 * this screen has that is not "edit in place", because there is no document
 * yet to patch (same reasoning as `ProductDetail`'s `CreateProduct`).
 */
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { BATCHES } from "../copy";
import type { ProductDoc, RecipeDoc } from "../products/data";
import { isSellablePaise, parseRupeesToPaise } from "../products/productMoney";
import { callableErrorMessage, callTransitionBatch } from "./data";

interface Props {
  readonly products: readonly ProductDoc[];
  readonly recipes: readonly RecipeDoc[];
  readonly onCreated: (ref: string) => void;
  readonly onCancel: () => void;
}

export function CreateBatch({ products, recipes, onCreated, onCancel }: Props): JSX.Element {
  const [productSlug, setProductSlug] = useState(products[0]?.id ?? "");
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [plannedJars, setPlannedJars] = useState("");
  const [priceOpen, setPriceOpen] = useState("");
  const [priceInStock, setPriceInStock] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError(null);

    if (productSlug.trim() === "") {
      setError(BATCHES.productRequired);
      return;
    }
    if (recipeId.trim() === "") {
      setError(BATCHES.recipeRequired);
      return;
    }
    const jars = Number(plannedJars.trim());
    if (!Number.isInteger(jars) || jars < 1) {
      setError(BATCHES.plannedJarsInvalid);
      return;
    }
    const open = parseRupeesToPaise(priceOpen);
    const inStock = parseRupeesToPaise(priceInStock);
    if (open === null || inStock === null) {
      setError(BATCHES.priceInvalid);
      return;
    }
    // CLAUDE.md section 3: never above the ₹649 MRP, which is printed on the
    // jar. `isSellablePaise` is the same one rule the Products screen prices
    // against (A58), so a batch price and a product price cannot disagree
    // about what is sellable. The server refuses it too (`sellingPaise`).
    if (!isSellablePaise(open) || !isSellablePaise(inStock)) {
      setError(BATCHES.priceAboveMrp);
      return;
    }

    setBusy(true);
    try {
      const result = await callTransitionBatch({
        to: "draft",
        data: { productSlug, recipeId, plannedJars: jars, priceOpen: open, priceInStock: inStock },
      });
      onCreated(result.ref);
    } catch (caught) {
      setError(callableErrorMessage(caught, BATCHES.saveFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="detail" data-testid="create-batch-form" onSubmit={(event) => void submit(event)}>
      <label for="new-batch-product">{BATCHES.productSlug}</label>
      <select
        id="new-batch-product"
        value={productSlug}
        onChange={(event) => setProductSlug((event.target as HTMLSelectElement).value)}
      >
        <option value="">{BATCHES.productSlug}</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>

      <label for="new-batch-recipe">{BATCHES.recipe}</label>
      <select
        id="new-batch-recipe"
        value={recipeId}
        onChange={(event) => setRecipeId((event.target as HTMLSelectElement).value)}
      >
        <option value="">{BATCHES.recipe}</option>
        {recipes.map((recipe) => (
          <option key={recipe.id} value={recipe.id}>
            {recipe.productSlug ?? recipe.id}
          </option>
        ))}
      </select>

      <label for="new-batch-jars">{BATCHES.plannedJars}</label>
      <input
        id="new-batch-jars"
        type="text"
        inputMode="numeric"
        value={plannedJars}
        onInput={(event) => setPlannedJars((event.target as HTMLInputElement).value)}
      />

      <label for="new-batch-price-open">{BATCHES.priceOpen}</label>
      <input
        id="new-batch-price-open"
        type="text"
        inputMode="decimal"
        value={priceOpen}
        onInput={(event) => setPriceOpen((event.target as HTMLInputElement).value)}
      />

      <label for="new-batch-price-in-stock">{BATCHES.priceInStock}</label>
      <input
        id="new-batch-price-in-stock"
        type="text"
        inputMode="decimal"
        value={priceInStock}
        onInput={(event) => setPriceInStock((event.target as HTMLInputElement).value)}
      />

      {error ? (
        <p class="error" data-testid="create-batch-error">
          {error}
        </p>
      ) : null}

      <div class="hairline" />
      <button type="submit" disabled={busy} data-testid="submit-create-batch">
        {busy ? BATCHES.creating : BATCHES.createBatch}
      </button>
      <div class="hairline" />
      <button class="quiet" type="button" onClick={onCancel}>
        {BATCHES.backToBatches}
      </button>
    </form>
  );
}
