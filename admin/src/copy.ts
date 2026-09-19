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

  /* -------------------------------------------------------------------- */
  /* Products: heroes, pipeline, brief section 17.8 (M2.2)                */
  /* -------------------------------------------------------------------- */

  productsTab: "Products",
  heroesHeading: "Heroes",
  pipelineHeading: "Pipeline",
  productsEmpty: "No products yet.",
  newProduct: "New product",

  slug: "Slug",
  slugHelp: "The product's URL and document id. Fixed once created.",
  slugRequired: "Please give it a slug.",
  slugTaken: (slug: string) => `A product with the slug "${slug}" already exists.`,
  productName: "Name",
  productType: "Type",
  productTypeHero: "Hero",
  productTypePipeline: "Pipeline",
  veg: "Veg or non-veg",
  vegYes: "Veg",
  vegNo: "Non-veg",
  hsn: "HSN",
  priceInStock: "Price in stock",
  priceOpen: "Price, open batch",
  priceAboveMrp: "That is above the ₹649 MRP. Please enter ₹649 or less.",
  priceTooLow: "Please enter a price of at least one paisa.",
  priceInvalid: "Please enter a price in rupees.",
  jarGrams: "Jar size, in g",
  jarGramsInvalid: "Please enter a whole number of grams.",
  shippingRule: "Shipping rule",
  shippingFree: "Free",
  shippingFlatFee: "Flat fee",
  shippingFreeOnTwo: "Free on 2 jars",
  seasonStart: "Season starts",
  seasonEnd: "Season ends",
  seasonHelp: 'Format "MM-DD", for example "11-01". Leave both empty for a product with no season.',
  seasonInvalid: 'Please use the "MM-DD" format, for example "11-01".',
  active: "Active",
  activeYes: "Active",
  activeNo: "Not active",
  createProduct: "Create product",
  creating: "Creating...",

  photos: "Photos",
  photosLoading: "Loading photos...",
  photosEmpty: "No photos yet.",
  addPhoto: "Add photo",
  addNotePhoto: "Add note photo",
  notePhoto: "Note",
  removePhoto: "Remove",
  photosLoadFailed: "Photos could not be read. Please check the signal.",
  photoUploadFailed: "That photo did not upload.",
  photoRemoveFailed: "That photo could not be removed.",
  photoNotAnImage: "Please choose an image file.",
  photoTooLarge: "That photo is larger than 8 MB.",
  saveFirst: "Save the product first, then add photos.",

  customLines: "Custom lines",
  customLinesHelp: "Things the kitchen may sell at the counter under this product, each at a set amount.",
  customLinesEmpty: "No custom lines yet.",
  customLineDescription: "Description",
  customLineAmount: "Amount",
  addCustomLine: "Add custom line",
  removeCustomLine: "Remove",

  undo: "Undo",
  fieldChanged: (label: string, value: string) => `${label} changed to ${value}.`,
} as const;

/**
 * The Batches screens (brief section 17.4): the list, the detail, and the
 * one big state button (section 8.2).
 */
export const BATCHES = {
  loading: "Loading...",
  readDenied: "This screen could not be read. Ask Shefin to check your role.",
  empty: "No batches yet.",
  newBatch: "New batch",
  backToBatches: "Back to Batches",

  stateLabel: {
    draft: "Draft",
    open: "Open",
    halfReached: "Half reached",
    sourcing: "Sourcing",
    cooking: "Cooking",
    bottled: "Bottled",
    inStock: "In stock",
    soldOut: "Sold out",
    archived: "Archived",
    paused: "Paused",
  } as Record<string, string>,

  clock: (label: string) => `Clock: ${label}`,
  clockOverdue: "overdue",
  clockDueToday: "due today",
  clockDays: (days: number) => (days === 1 ? "1 day left" : `${days} days left`),
  approvalWaiting: "Waiting on you",

  /* ---- Create (none -> draft, Owner) ---- */
  createBatchHeading: "New batch",
  productSlug: "Product",
  recipe: "Recipe",
  plannedJars: "Planned jars",
  priceOpen: "Price, open batch",
  priceInStock: "Price in stock",
  createBatch: "Create batch",
  creating: "Creating...",
  productRequired: "Please choose a product.",
  recipeRequired: "Please choose a recipe.",
  plannedJarsInvalid: "Please enter a whole number of jars.",
  priceInvalid: "Please enter a price in rupees.",
  priceAboveMrp: "A jar is never priced above ₹649. Please enter ₹649 or less.",
  costInvalid: "Please enter a cost in rupees, zero or more.",
  weightInvalid: "Please enter a weight in grams, zero or more.",
  bookableZero: "That many planned jars leaves no bookable jar at the 90% cap. Please plan for more.",

  /* ---- Fill (brief 17.4) ---- */
  fillHeading: "Fill",
  bookable: "Bookable",
  paid: "Paid",
  heldNow: "Held now",
  limitPerPerson: "Limit per person",

  /* ---- Price, Owner only ---- */
  priceHeading: "Price",

  /* ---- Sourcing ---- */
  sourcingHeading: "Sourcing",
  source: "Source",
  landedOn: "Landed on",
  weightRaw: "Raw weight, g",
  costRaw: "Price paid",

  /* ---- Cooking ---- */
  cookingHeading: "Cooking",
  cookedOn: "Cooked on",
  weightCleaned: "Cleaned weight, g",
  weightCooked: "Cooked weight, g",
  actualsHeading: "Per-ingredient actuals",
  actualsHelp: "Prefilled from the recipe. Type what the pot actually used.",
  recipeQty: "Recipe",
  actualWeight: "Actual weight, g",
  actualCost: "Actual cost",
  driftWarning: (percent: number) =>
    `This is ${Math.round(percent)}% off the recipe. Check it before the label is printed.`,

  /* ---- Bottling ---- */
  bottlingHeading: "Bottling",
  packedOn: "Packed on",
  jarCount: "Jar count",
  bestBefore: "Best before",
  saleStopOn: "Sale stop",
  surplus: "Surplus",
  jarsLids: "Jars and lids",
  boxInserts: "Box and inserts",
  labelling: "Labelling and stickering",
  gasPower: "Gas and power",

  /* ---- P&L ---- */
  pnlHeading: "P&L",
  pnlNotYet: "P&L arrives in M4.8.",
  revenue: "Revenue",
  ingredientCost: "Ingredient cost",
  packagingCost: "Packaging cost",
  shippingCost: "Shipping cost",
  gatewayFees: "Gateway fees",
  writeOffCost: "Write-off cost",
  margin: "Margin",

  /* ---- The state button, section 8.2 ---- */
  openBatch: "Open the batch",
  sayYesSourcing: "Say yes: start sourcing",
  messageText: "Message to customers, optional edit",
  startCooking: "Start cooking",
  bottleBatch: "Bottle the batch",
  submit: "Save",
  saving: "Saving...",
  fieldRequired: "Please fill in every field this step asks for.",

  pause: "Pause",
  pauseReason: "Reason",
  confirmPause: "Confirm pause",
  resume: "Resume",

  fullWaitingLine: "The batch is full.",
  answerFull: "Say yes",

  waitingOpen: "Waiting for half of the bookable jars to be paid.",
  waitingHalfReached: "Waiting on the Owner to say yes to start sourcing.",
  waitingSourcingKitchenOnly: "Waiting on the kitchen to start cooking.",
  waitingCookingKitchenOnly: "Waiting on the kitchen to bottle the batch.",
  waitingBottled: "Waiting to go on sale or sell out.",
  waitingInStock: "Waiting to sell out.",
  waitingSoldOut: "Waiting for every order to close.",
  waitingArchived: "This batch is archived. Its P&L is locked.",
  waitingDraftNotOwner: "Waiting on the Owner to open this batch.",
  waitingNoAction: "Nothing to do here right now.",

  transitionRefused: "That did not go through.",
  saveRefused: "That did not save. Please check your role.",
  saveFailed: "That did not save. Please check the signal and try again.",

  undo: "Undo",
  fieldChanged: (label: string, value: string) => `${label} changed to ${value}.`,
} as const;

/**
 * Today (brief section 17.2), as far as M2.5 builds it: "Waiting on you" and
 * the Clocks.
 *
 * Every line here is **admin** wording, which CLAUDE.md section 5 lets the
 * build assume. The customer-facing lines are not here at all: they are the
 * `draft` on the approval document, written by `@lailark/shared`'s templates
 * or by the Owner in Settings (D24), or typed by the Kitchen beside her photo
 * (D5). Nothing on this screen invents a word a customer reads.
 */
export const TODAY = {
  waitingHeading: "Waiting on you",
  clocksHeading: "Clocks",
  loading: "Loading...",
  readDenied: "This screen could not be read. Ask Shefin to check your role.",

  /* ---- what each kind is asking ---- */
  askHalfReached: (paid: number, bookable: number) =>
    `Half the jars are paid for: ${paid} of ${bookable}. Start sourcing and tell the customers who booked?`,
  askFull: "The batch is full. Tell the customers who booked?",
  askBatchOpen: "The batch is open. Offer it to the people on the notify list?",
  askBackInStock: "There are jars left over. Offer them to the people on the notify list?",
  askBroadcast: "A message to the notify list is ready.",
  askPhotoUpdate: "The kitchen has added an update. Send it to the customers who booked?",

  /* ---- the message ---- */
  messageHeading: "Message to customers",
  noMessage: "No message to send with this one.",
  messageLabel: "Message to customers, edited",

  /* ---- the three answers (brief 7.3) ---- */
  yes: "Yes",
  notYet: "Not yet",
  editThenYes: "Edit then yes",
  reasonLabel: "Why not yet",
  confirmNotYet: "Save reason",
  confirmEdit: "Save and yes",
  cancel: "Cancel",
  working: "Saving...",
  reasonRequired: "Please say why, so tomorrow's card makes sense.",
  messageRequired: "Please leave a message, or answer yes without editing.",
  answerRefused: "That did not go through.",

  /** What the answer records. Nothing is sent here: M5 sends. */
  approvedPending: "Approved. It goes out when sending is switched on.",
  ownerOnly: "Only Shefin answers these.",
  putOffUntilTomorrow: (reason: string) => `Put off: ${reason}`,

  /**
   * The clocks (brief 7.3 and 8.2, A61). The days themselves are formatted by
   * `admin/src/batches/clock.ts` from the approval's own `dueAt`, in the same
   * words the batch cards use, so there is one clock in the admin and not two.
   */
  clockHalf: "5 day production clock",
  clockFull: "3 day production clock",
  clocksEmpty: "No batch is on a clock.",
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
