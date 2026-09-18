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
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { PRODUCTS } from "../copy";
import { IngredientDetail } from "../products/IngredientDetail";
import {
  createIngredient,
  createRecipe,
  isPermissionDenied,
  saveIngredient,
  saveRecipe,
  useCanEditRecipes,
  useIngredients,
  useRecipes,
  type IngredientInput,
  type RecipeInput,
} from "../products/data";
import { RecipeDetail } from "../products/RecipeDetail";
import type { Session } from "../session";

type Tab = "ingredients" | "recipes";

type View =
  | { readonly kind: "list" }
  | { readonly kind: "ingredient"; readonly id: string | null }
  | { readonly kind: "recipe"; readonly id: string | null };

interface Props {
  readonly session: Session;
}

export function Products({ session }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>("ingredients");
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);

  const ingredients = useIngredients();
  const recipes = useRecipes();
  const canEdit = useCanEditRecipes(session.role);

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

  const live = tab === "ingredients" ? ingredients : recipes;

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
      </div>

      {!canEdit ? (
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
      ) : (
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
      )}

      {!live.loading && !live.denied && live.items.length === 0 ? (
        <p data-testid="products-empty">
          {tab === "ingredients" ? PRODUCTS.ingredientsEmpty : PRODUCTS.recipesEmpty}
        </p>
      ) : null}

      {canEdit ? (
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
    </div>
  );
}
