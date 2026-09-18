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
  type Ingredient,
  type NutritionPer100g,
  type PermissionsSettings,
  type Recipe,
  type RecipeLine,
  type Role,
} from "@lailark/shared";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useState } from "preact/hooks";

import { db } from "../firebase";

export const INGREDIENTS = "ingredients";
export const RECIPES = "recipes";

/** A document as a screen holds it: its id, and the fields it carries. */
export type IngredientDoc = Partial<Ingredient> & { readonly id: string; readonly labelName: string };
export type RecipeDoc = Partial<Recipe> & { readonly id: string; readonly lines: readonly RecipeLine[] };

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

/** True when a Firestore error is the rules saying no. */
export function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "permission-denied"
  );
}
