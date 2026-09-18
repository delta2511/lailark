/**
 * The Firestore side of the Products screen: `ingredients`, `recipes` and the
 * Owner's Q4 switch in `settings/permissions`.
 *
 * Writes go straight from the client, which is what `firestore.rules` allows
 * for these two collections. The audit wrapper that will stamp every write is
 * M2.6, so nothing here pretends to be one: `updatedAt`, `updatedBy` and
 * `createdAt`, `createdBy` are set here, by hand, the same three fields brief
 * section 18 puts on every document.
 */
import {
  KITCHEN_RECIPE_EDIT_SWITCH,
  kitchenCanEditRecipes,
  type CustomLine,
  type Ingredient,
  type NutritionPer100g,
  type Paise,
  type PermissionsSettings,
  type Product,
  type ProductType,
  type Recipe,
  type RecipeLine,
  type Role,
  type ShippingRule,
} from "@lailark/shared";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useState } from "preact/hooks";

import { db } from "../firebase";

export const INGREDIENTS = "ingredients";
export const RECIPES = "recipes";
export const PRODUCTS_COLLECTION = "products";

/** A document as a screen holds it: its id, and the fields it carries. */
export type IngredientDoc = Partial<Ingredient> & { readonly id: string; readonly labelName: string };
export type RecipeDoc = Partial<Recipe> & { readonly id: string; readonly lines: readonly RecipeLine[] };
/** The document id here is the slug itself (brief section 18.1). */
export type ProductDoc = Partial<Product> & { readonly id: string; readonly name: string };

/** What a form sends. Not `BaseDoc`: the three stamps are added on the way out. */
export interface IngredientInput {
  readonly labelName: string;
  readonly allergenTags: readonly string[];
  readonly nutritionPer100g: NutritionPer100g;
  /** Integers in paise, per CLAUDE.md section 3. */
  readonly unitCost: number;
  readonly unit: string;
  readonly source: string | null;
  readonly densityGPerMl?: number | null;
}

export interface RecipeInput {
  readonly productSlug: string;
  readonly version: number;
  readonly percentageBasis: string;
  readonly expectedYieldJars: number;
  readonly finishedWeightG: number;
  readonly storageText: string;
  readonly claimsText: string;
  readonly lines: readonly RecipeLine[];
}

/** Every field on `products/{slug}` but the three stamps. Brief section 18.1. */
export interface ProductInput {
  readonly name: string;
  readonly type: ProductType;
  readonly veg: boolean;
  readonly hsn: string;
  /** Integers in paise, per CLAUDE.md section 3. */
  readonly priceInStock: Paise;
  readonly priceOpen: Paise;
  readonly jarGrams: number;
  readonly shippingRule: ShippingRule;
  readonly seasonStart: string | null;
  readonly seasonEnd: string | null;
  readonly active: boolean;
  readonly customLines: readonly CustomLine[];
}

/** The state a live collection listener is in, so a screen can say which. */
export interface Live<T> {
  readonly items: readonly T[];
  readonly loading: boolean;
  readonly denied: boolean;
}

function useCollection<T extends { id: string }>(path: string): Live<T> {
  const [state, setState] = useState<Live<T>>({ items: [], loading: true, denied: false });

  useEffect(() => {
    const stop: Unsubscribe = onSnapshot(
      collection(db, path),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as T);
        setState({ items, loading: false, denied: false });
      },
      () => setState({ items: [], loading: false, denied: true }),
    );
    return stop;
  }, [path]);

  return state;
}

export function useIngredients(): Live<IngredientDoc> {
  return useCollection<IngredientDoc>(INGREDIENTS);
}

export function useRecipes(): Live<RecipeDoc> {
  return useCollection<RecipeDoc>(RECIPES);
}

export function useProducts(): Live<ProductDoc> {
  return useCollection<ProductDoc>(PRODUCTS_COLLECTION);
}

/**
 * D22 and A49: the Owner always edits, the Kitchen only while
 * `settings/permissions.kitchenCanEditRecipes` is a literal `true`, and the
 * Viewer never. The same helper the rules mirror decides it, so the screen
 * never offers an input the rules would refuse.
 *
 * A read that fails is treated as off, which is also what the rule does with
 * a missing document.
 */
export function useCanEditRecipes(role: Role): boolean {
  const [permissions, setPermissions] = useState<Partial<PermissionsSettings> | undefined>(undefined);

  useEffect(() => {
    if (role !== "kitchen") return;
    const ref = doc(db, KITCHEN_RECIPE_EDIT_SWITCH.collection, KITCHEN_RECIPE_EDIT_SWITCH.doc);
    return onSnapshot(
      ref,
      (snap) => setPermissions(snap.exists() ? (snap.data() as Partial<PermissionsSettings>) : {}),
      () => setPermissions({}),
    );
  }, [role]);

  if (role === "owner") return true;
  if (role !== "kitchen") return false;
  return kitchenCanEditRecipes(permissions);
}

function stamps(uid: string, creating: boolean): Record<string, unknown> {
  return creating
    ? { createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid }
    : { updatedAt: serverTimestamp(), updatedBy: uid };
}

export async function createIngredient(input: IngredientInput, uid: string): Promise<string> {
  const ref = await addDoc(collection(db, INGREDIENTS), { ...input, ...stamps(uid, true) });
  return ref.id;
}

export async function saveIngredient(id: string, input: IngredientInput, uid: string): Promise<void> {
  await setDoc(doc(db, INGREDIENTS, id), { ...input, ...stamps(uid, false) }, { merge: true });
}

export async function createRecipe(input: RecipeInput, uid: string): Promise<string> {
  const ref = await addDoc(collection(db, RECIPES), { ...input, ...stamps(uid, true) });
  return ref.id;
}

export async function saveRecipe(id: string, input: RecipeInput, uid: string): Promise<void> {
  await setDoc(doc(db, RECIPES, id), { ...input, ...stamps(uid, false) }, { merge: true });
}

/**
 * Products are the Owner's (brief section 17.12, `firestore.rules`): there is
 * no switch here the way there is for ingredients and recipes. `slug` is the
 * document id and is fixed once created (M2.2), so creating one checks first
 * that it does not already exist rather than silently overwriting it.
 */
export async function createProduct(slug: string, input: ProductInput, uid: string): Promise<void> {
  const ref = doc(db, PRODUCTS_COLLECTION, slug);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new SlugTakenError(slug);
  }
  await setDoc(ref, { ...input, ...stamps(uid, true) });
}

/**
 * Every "edit in place" on the product detail screen goes through this: a
 * partial patch, saved at once. The undo toast (brief section 17.1) calls it
 * a second time with the field's previous value to put it back, so this
 * function itself has no notion of undo; that seam is the toast component's.
 */
export async function updateProduct(
  slug: string,
  patch: Partial<ProductInput>,
  uid: string,
): Promise<void> {
  await setDoc(doc(db, PRODUCTS_COLLECTION, slug), { ...patch, ...stamps(uid, false) }, { merge: true });
}

export class SlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`A product with the slug "${slug}" already exists.`);
  }
}

/** True when a Firestore error is the rules saying no. */
export function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "permission-denied"
  );
}
