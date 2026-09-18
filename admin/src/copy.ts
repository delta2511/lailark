/**
 * Every line of admin copy this screen can show, in one place, so the tests
 * assert against the same strings the app renders.
 *
 * House style (CLAUDE.md section 3): plain English, no em dashes. This is
 * admin wording, not customer wording, so it may name Shefin.
 */
export const COPY = {
  signInTitle: "Lailark",
  signInLede: "Sign in with the phone number Shefin put on the admin list.",
  phoneLabel: "Mobile number",
  phonePlaceholder: "7736110087",
  sendCode: "Send code",
  sending: "Sending...",
  codeLabel: "Six digit code",
  codeSentTo: (phone: string) => `We sent a code to ${phone}.`,
  verify: "Sign in",
  verifying: "Checking...",
  useAnotherNumber: "Use another number",
  signOut: "Sign out",

  phoneEmpty: "Please enter your mobile number.",
  phoneNotIndian: "Lailark admin signs in with an Indian mobile number only. Please use a +91 number.",
  phoneInvalid: "That does not look like a 10 digit Indian mobile number. Please check and try again.",
  codeInvalid: "That code did not work. Please check the six digits and try again.",
  codeEmpty: "Please enter the six digit code.",
  sendFailed: "We could not send the code just now. Please check the signal and try again.",
  notAllowed: "This number is not on the Lailark admin list. If it should be, ask Shefin.",

  /** M1.12: the last resort when a screen throws while it is drawing. */
  crashed: "Something went wrong on this screen.",
  crashedLede: "Reloading usually sets it right. If it keeps happening, tell Shefin what you were doing.",
  crashedReload: "Reload",

  offline: "Offline",

  navToday: "Today",
  navSell: "Sell",
  navBatches: "Batches",
  navOrders: "Orders",
  navMore: "More",

  todayEmptyLine1: "Nothing waiting on you.",
  todayEmptyLine2: "Concerns and clocks appear here.",

  sellBody:
    "Sell a jar at the door or over the phone. The sale screen is coming in the next milestone.",

  batchesEmptyLine1: "No batches yet.",
  batchesEmptyLine2: "Batch 001 is on the jars; it arrives here in the next milestone.",

  ordersEmpty: "No orders yet.",

  back: "Back",

  settingsName: "Name",
  settingsPhone: "Phone",
  settingsRole: "Role",
} as const;

/** One row per item in the More list, brief section 17.1. */
export const MORE_ROWS = [
  {
    key: "concerns",
    path: "/more/concerns",
    label: "Concerns",
    description: "Anything that needs the Owner's eyes lands here.",
    ownerAndViewerOnly: false,
  },
  {
    key: "products",
    path: "/more/products",
    label: "Products",
    description: "The prawn pickle, and whatever comes after it.",
    ownerAndViewerOnly: false,
  },
  {
    key: "customers",
    path: "/more/customers",
    label: "Customers",
    description: "Every person who has ordered, in one place.",
    ownerAndViewerOnly: false,
  },
  {
    key: "agent",
    path: "/more/agent",
    label: "Agent",
    description: "The WhatsApp agent's conversations, once it is live.",
    ownerAndViewerOnly: false,
  },
  {
    key: "money",
    path: "/more/money",
    label: "Money",
    description: "Payments, refunds and settlements.",
    ownerAndViewerOnly: true,
  },
  {
    key: "settings",
    path: "/more/settings",
    label: "Settings",
    description: "The signed-in account and the kitchen discount cap.",
    ownerAndViewerOnly: false,
  },
] as const;

export type MoreRowKey = (typeof MORE_ROWS)[number]["key"];

/**
 * The Products screen (brief section 17.8): ingredients and recipes.
 *
 * Admin wording, so it may be blunt. The only strings here that reach a
 * customer are the ones the recipe engine builds from the label itself, and
 * those are not written here: they come from `@lailark/shared`, which copies
 * the printed label character for character (CLAUDE.md section 3).
 */
export const PRODUCTS = {
  ingredientsTab: "Ingredients",
  recipesTab: "Recipes",

  ingredientsEmpty: "No ingredients yet.",
  recipesEmpty: "No recipes yet.",
  loading: "Loading...",
  readDenied: "This screen could not be read. Ask Shefin to check your role.",

  newIngredient: "New ingredient",
  newRecipe: "New recipe",
  edit: "Edit",
  save: "Save",
  saving: "Saving...",
  cancel: "Cancel",
  backToProducts: "Back to Products",

  labelName: "Label name",
  labelNameHelp: "Exactly as it is printed on the jar. Never paraphrased.",
  allergenTags: "Allergen tags",
  allergenTagsHelp: "One per line, in the wording the label uses.",
  unitCost: "Unit cost",
  unitCostHelp: "Rupees per unit. Stored in paise.",
  unit: "Unit",
  source: "Source",
  density: "Density in g/ml",
  densityHelp: "Only for something measured by volume. Gingelly oil is 0.92.",
  nutrition: "Nutrition per 100 g",
  nutritionHelp: "Leave a box empty when the figure is not known.",

  productSlug: "Product",
  version: "Version",
  expectedYieldJars: "Expected yield in jars",
  finishedWeightG: "Finished weight in g",
  finishedWeightHelp: "What the batch weighs in the jars. 22 jars of 200 g is 4400.",
  storageText: "Storage text",
  claimsText: "Claims text",
  lines: "Lines",
  addLine: "Add line",
  removeLine: "Remove",
  lineIngredient: "Ingredient",
  lineQty: "Quantity",
  lineUnit: "Unit",
  lineIsMain: "Declare a percentage",
  lineEvaporates: "Boils off",
  lineResidue: "Stays, in g",
  lineCompoundOf: "Compound parts, comma separated",

  basis: "Percentage basis",
  basisHelp: "The label basis doc settles this. B is the recommended one.",

  labelBlock: "Label block",
  labelIngredients: "Ingredients",
  labelAllergens: "Allergens",
  labelClaims: "Claims",
  labelStorage: "Storage",
  labelNutrition: "Nutrition per 100 g",
  labelNutritionNone: "No finished weight recorded, so there is nothing to divide by.",
  labelNutritionMissing: (names: string) => `No figure for ${names}.`,
  labelMissingIngredient: (names: string) => `These lines point at an ingredient that is gone: ${names}.`,

  driftHeading: "Against the printed batch 001 label",
  driftNone: "Every line matches the printed label.",
  driftCount: (n: number) => (n === 1 ? "1 difference from the printed label." : `${n} differences from the printed label.`),

  readOnly: "Read only. The Owner has not turned recipe editing on for the kitchen.",
  saveRefused: "That did not save. The Owner has not turned recipe editing on for the kitchen.",
  saveFailed: "That did not save. Please check the signal and try again.",
  nameRequired: "Please give it a label name.",
} as const;

/** The one line shown on an empty More sub-screen, keyed by row. */
export const MORE_EMPTY_BODY: Record<Exclude<MoreRowKey, "settings" | "products">, string> = {
  concerns: "No concerns right now. This is where they will wait for you, oldest first.",
  customers: "No customers yet. Every order will add one here.",
  agent: "The agent is not live yet. Its conversations will read here.",
  money: "Nothing to show yet. Payments, refunds and settlements will land here.",
};

/** "owner" reads as "Owner" on screen. */
export function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
