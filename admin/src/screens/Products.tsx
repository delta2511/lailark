/**
 * Products (brief section 17.8), the part of it M2.1 builds: two lists,
 * Ingredients and Recipes, and a detail for each.
 *
 * Who may edit is D22 and A49: the Owner always, the Kitchen only while the
 * Owner's `settings/permissions.kitchenCanEditRecipes` switch is on, the
 * Viewer never. The switch is read with the shared helper the rules mirror,
 * so the screen and the database always agree about what will be allowed. If
 * a write is refused anyway (the switch flipped off between the read and the
 * save) the screen says so in one plain line rather than looking broken.
 */
import { formatINR } from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { PRODUCTS } from "../copy";
import { IngredientDetail } from "../products/IngredientDetail";
import {
  createIngredient,
  createProduct,
  createRecipe,
  isPermissionDenied,
  saveIngredient,
  saveRecipe,
  updateProduct,
  useCanEditRecipes,
  useIngredients,
  useProducts,
  useRecipes,
  type IngredientInput,
  type ProductDoc,
  type ProductInput,
  type RecipeInput,
} from "../products/data";
import { ProductDetail } from "../products/ProductDetail";
import { RecipeDetail } from "../products/RecipeDetail";
import type { Session } from "../session";

type Tab = "ingredients" | "recipes" | "products";

type View =
  | { readonly kind: "list" }
  | { readonly kind: "ingredient"; readonly id: string | null }
  | { readonly kind: "recipe"; readonly id: string | null }
  | { readonly kind: "product"; readonly id: string | null };

interface Props {
  readonly session: Session;
}

export function Products({ session }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>("ingredients");
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);

  const ingredients = useIngredients();
  const recipes = useRecipes();
  const products = useProducts();
  const canEdit = useCanEditRecipes(session.role);
  // Products are the Owner's alone (brief 17.12, `firestore.rules`): there is
  // no Kitchen switch here the way D22 gives ingredients and recipes one.
  const canEditProducts = session.role === "owner";

  function close(): void {
    setError(null);
    setView({ kind: "list" });
  }

  async function guard(write: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await write();
      setView({ kind: "list" });
    } catch (caught) {
      setError(isPermissionDenied(caught) ? PRODUCTS.saveRefused : PRODUCTS.saveFailed);
    }
  }

  if (view.kind === "ingredient") {
    const ingredient = view.id === null ? null : (ingredients.items.find((i) => i.id === view.id) ?? null);
    return (
      <div class="products" data-testid="screen-more-products">
        <IngredientDetail
          key={view.id ?? "new"}
          ingredient={ingredient}
          canEdit={canEdit}
          error={error}
          onClose={close}
          onSave={(input: IngredientInput) =>
            guard(() =>
              view.id === null
                ? createIngredient(input, session.uid)
                : saveIngredient(view.id, input, session.uid),
            )
          }
        />
      </div>
    );
  }

  if (view.kind === "recipe") {
    const recipe = view.id === null ? null : (recipes.items.find((r) => r.id === view.id) ?? null);
    return (
      <div class="products" data-testid="screen-more-products">
        <RecipeDetail
          key={view.id ?? "new"}
          recipe={recipe}
          ingredients={ingredients.items}
          canEdit={canEdit}
          error={error}
          onClose={close}
          onSave={(input: RecipeInput) =>
            guard(() =>
              view.id === null
                ? createRecipe(input, session.uid)
                : saveRecipe(view.id, input, session.uid),
            )
          }
        />
      </div>
    );
  }

  if (view.kind === "product") {
    const product = view.id === null ? null : (products.items.find((p) => p.id === view.id) ?? null);
    return (
      <div class="products" data-testid="screen-more-products">
        <ProductDetail
          key={view.id ?? "new"}
          product={product}
          canEdit={canEditProducts}
          uid={session.uid}
          error={error}
          onClose={close}
          onCreate={(slug: string, input: ProductInput) =>
            guard(() => createProduct(slug, input, session.uid))
          }
          onUpdate={(patch: Partial<ProductInput>) => {
            if (view.id === null) return Promise.resolve();
            setError(null);
            return updateProduct(view.id, patch, session.uid);
          }}
        />
      </div>
    );
  }

  const live = tab === "ingredients" ? ingredients : tab === "recipes" ? recipes : products;
  const showReadOnlyNote = tab === "products" ? !canEditProducts : !canEdit;

  const heroes = products.items.filter((p) => p.type === "hero");
  const pipeline = products.items.filter((p) => p.type === "pipeline");

  return (
    <div class="products" data-testid="screen-more-products">
      <div class="tab-row" role="tablist">
        <button
          type="button"
          role="tab"
          class={`chip${tab === "ingredients" ? " chip-on" : ""}`}
          aria-selected={tab === "ingredients"}
          data-testid="products-tab-ingredients"
          onClick={() => setTab("ingredients")}
        >
          {PRODUCTS.ingredientsTab}
        </button>
        <button
          type="button"
          role="tab"
          class={`chip${tab === "recipes" ? " chip-on" : ""}`}
          aria-selected={tab === "recipes"}
          data-testid="products-tab-recipes"
          onClick={() => setTab("recipes")}
        >
          {PRODUCTS.recipesTab}
        </button>
        <button
          type="button"
          role="tab"
          class={`chip${tab === "products" ? " chip-on" : ""}`}
          aria-selected={tab === "products"}
          data-testid="products-tab-products"
          onClick={() => setTab("products")}
        >
          {PRODUCTS.productsTab}
        </button>
      </div>

      {showReadOnlyNote ? (
        <p class="notice-line" data-testid="read-only-note">
          {PRODUCTS.readOnly}
        </p>
      ) : null}

      {live.loading ? <p data-testid="products-loading">{PRODUCTS.loading}</p> : null}
      {live.denied ? <p data-testid="products-denied">{PRODUCTS.readDenied}</p> : null}

      {tab === "ingredients" ? (
        <ul class="more-list" data-testid="ingredient-list">
          {ingredients.items.map((ingredient) => (
            <li key={ingredient.id}>
              <button
                type="button"
                class="more-row"
                data-testid={`ingredient-row-${ingredient.id}`}
                onClick={() => setView({ kind: "ingredient", id: ingredient.id })}
              >
                <span class="more-row-label">{ingredient.labelName}</span>
                <span class="more-row-aside">{ingredient.unit ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "recipes" ? (
        <ul class="more-list" data-testid="recipe-list">
          {recipes.items.map((recipe) => (
            <li key={recipe.id}>
              <button
                type="button"
                class="more-row"
                data-testid={`recipe-row-${recipe.id}`}
                onClick={() => setView({ kind: "recipe", id: recipe.id })}
              >
                <span class="more-row-label">{recipe.productSlug ?? recipe.id}</span>
                <span class="more-row-aside">{`${recipe.lines?.length ?? 0}`}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "products" ? (
        <>
          {!live.loading && !live.denied && heroes.length > 0 ? (
            <>
              <p class="section-heading">{PRODUCTS.heroesHeading}</p>
              <ProductRows items={heroes} onOpen={(id) => setView({ kind: "product", id })} />
            </>
          ) : null}
          {!live.loading && !live.denied && pipeline.length > 0 ? (
            <>
              <p class="section-heading">{PRODUCTS.pipelineHeading}</p>
              <ProductRows items={pipeline} onOpen={(id) => setView({ kind: "product", id })} />
            </>
          ) : null}
        </>
      ) : null}

      {!live.loading && !live.denied && live.items.length === 0 ? (
        <p data-testid="products-empty">
          {tab === "ingredients"
            ? PRODUCTS.ingredientsEmpty
            : tab === "recipes"
              ? PRODUCTS.recipesEmpty
              : PRODUCTS.productsEmpty}
        </p>
      ) : null}

      {tab !== "products" && canEdit ? (
        <>
          <div class="hairline" />
          <button
            type="button"
            data-testid={tab === "ingredients" ? "new-ingredient" : "new-recipe"}
            onClick={() => setView({ kind: tab === "ingredients" ? "ingredient" : "recipe", id: null })}
          >
            {tab === "ingredients" ? PRODUCTS.newIngredient : PRODUCTS.newRecipe}
          </button>
        </>
      ) : null}

      {tab === "products" && canEditProducts ? (
        <>
          <div class="hairline" />
          <button type="button" data-testid="new-product" onClick={() => setView({ kind: "product", id: null })}>
            {PRODUCTS.newProduct}
          </button>
        </>
      ) : null}
    </div>
  );
}

function ProductRows({
  items,
  onOpen,
}: {
  readonly items: readonly ProductDoc[];
  readonly onOpen: (id: string) => void;
}): JSX.Element {
  return (
    <ul class="more-list" data-testid="product-list">
      {items.map((product) => (
        <li key={product.id}>
          <button
            type="button"
            class="more-row"
            data-testid={`product-row-${product.id}`}
            onClick={() => onOpen(product.id)}
          >
            <span class="more-row-label">{product.name}</span>
            <span class="more-row-aside">
              {product.priceInStock === undefined ? "" : formatINR(product.priceInStock)}
              {product.jarGrams === undefined ? "" : ` · ${product.jarGrams} g`}
              {product.active === false ? ` · ${PRODUCTS.activeNo}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
