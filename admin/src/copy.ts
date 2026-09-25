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

  batchesEmptyLine1: "No batches yet.",
  batchesEmptyLine2: "Batch 001 is on the jars; it arrives here in the next milestone.",

  ordersEmpty: "No orders yet.",

  back: "Back",

  settingsName: "Name",
  settingsPhone: "Phone",
  settingsRole: "Role",

  /** M2.6: the one Undo label, shared by every edit-in-place screen's toast. */
  undo: "Undo",
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
  // M2.13: two lines of one ingredient used to share one actuals document,
  // and their typed weights and costs swapped places when the lines were
  // reordered. One line per ingredient, refused at save.
  lineIngredientRepeated: (name: string) => `${name} is on two lines. Put each ingredient on one line.`,
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
  /** M2.6: the toast's own message when the write was itself an undo. */
  undone: "Undone.",
  undoRaced: "This changed again since then, so nothing was undone.",
  undoForbidden: "Your role cannot undo this.",
  undoGone: "That change can no longer be undone.",
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
  priceTooLow: "Please enter a price of at least one paisa.",
  costInvalid: "Please enter a cost in rupees, zero or more.",
  weightInvalid: "Please enter a weight in grams, zero or more.",
  // D42: the rules refuse these too, so the box says why rather than letting
  // Firestore answer with a permission error the person cannot act on.
  costTooLarge: "That cost looks too large for one ingredient. Please check it.",
  weightTooLarge: "That weight looks too large for one batch. Please check it.",
  bookableZero: "That many planned jars leaves no bookable jar at the 90% cap. Please plan for more.",

  /* ---- Fill (brief 17.4) ---- */
  fillHeading: "Fill",
  bookable: "Bookable",
  paid: "Paid",
  heldNow: "Held now",
  limitPerPerson: "Limit per person",
  /* D44: blank is automatic. The box shows the computed quarter as its
     placeholder, so the number a customer meets is on screen either way. */
  limitPerPersonHelp: "Leave it blank to keep a quarter of the bookable jars.",
  limitPerPersonAuto: (limit: number) => `${limit}, worked out from the bookable jars`,
  limitPerPersonInvalid: "Please enter a whole number of jars, one or more.",
  limitPerPersonOverBookable: (bookable: number) =>
    `That is more than the ${bookable} bookable jars. Please enter ${bookable} or less.`,
  limitPerPersonCleared: "Limit per person is back to automatic.",

  /* ---- Price, Owner only ---- */
  priceHeading: "Price",
  /* D40: prices are editable on every batch, in any state, with no lock. The
     two lines below say the two things that are true and nothing more: an
     order keeps what it was charged, and an archived batch's P&L moves. No
     confirmation, no warning colour, no block. */
  priceHelp: "An order already placed keeps the price it was charged.",
  priceArchivedNote: "This batch is archived. Changing a price here moves its P&L.",

  /* ---- Sourcing ---- */
  sourcingHeading: "Sourcing",
  source: "Source",
  landedOn: "Landed on",
  weightRaw: "Raw weight, g",
  costRaw: "Price paid",
  /* D41: Sourcing to Cooking asks once per main ingredient, and each row says
     which one it is asking about. Batch 001 has two, prawns and dates, and
     one unnamed pair of boxes recorded only the prawns. */
  weightRawFor: (ingredient: string) => `${ingredient}: raw weight, g`,
  costRawFor: (ingredient: string) => `${ingredient}: price paid`,
  mainsHelp: "One weight and one price for each main ingredient.",
  recipeLoading: "Reading the recipe.",

  /* ---- Cooking ---- */
  cookingHeading: "Cooking",
  cookedOn: "Cooked on",
  weightCleaned: "Cleaned weight, g",
  weightCooked: "Cooked weight, g",
  actualsHeading: "Per-ingredient actuals",
  actualsHelp: "Prefilled from the recipe. Type what the pot actually used.",
  recipeQty: "Recipe",
  // Shown beside a recipe quantity that was never weighed, so a working
  // figure is never read as a measured one.
  recipeQtyEstimated: "estimated",
  actualWeight: "Actual weight, g",
  actualCost: "Actual cost",
  // M2.14: the undo toast's own message for a per-ingredient actual, which
  // names the ingredient as well as the field, since several rows share the
  // one toast.
  actualFieldChanged: (ingredient: string, field: string, value: string) =>
    `${ingredient}, ${field} changed to ${value}.`,
  // Until the lines have loaded there is nothing to type into: a box opened
  // before them would not know which document it belongs to (M2.13).
  actualsLoading: "Loading the actuals...",
  actualsDenied: "The actuals could not be read. Ask Shefin to check your role.",
  // A line document recorded against an ingredient this recipe no longer
  // lists (the ingredient was swapped, or the recipe changed). The figures
  // stay on the screen rather than sitting unseen in the batch's costs.
  orphansHeading: "Recorded against something this recipe does not list",
  orphanLine: (name: string, figures: string) => `${name}: ${figures}`,
  orphanNoIngredient: "No ingredient named",
  orphanFigures: (weight: string, cost: string) => [weight, cost].filter((part) => part !== "").join(", "),
  orphanHelp:
    "Nothing is lost and nothing is counted twice. Put the ingredient back on the recipe to edit these figures, or leave them as they are and tell Shefin.",
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
  undone: "Undone.",
  undoRaced: "This changed again since then, so nothing was undone.",
  undoForbidden: "Your role cannot undo this.",
  undoGone: "That change can no longer be undone.",
} as const;

/**
 * The timeline (brief sections 11 and 17.1: "every object shows its
 * timeline"; 18.1: `audit/{id}`), M2.6. One component, wired onto a document
 * by its path: `batches/{ref}` today, `orders/{id}` and `customers/{phone}`
 * once those screens exist (M2.8, M2.9 and after).
 */
export const TIMELINE = {
  heading: "Timeline",
  loading: "Loading...",
  empty: "Nothing recorded yet.",
  readDenied: "The timeline could not be read. Ask Shefin to check your role.",

  /** `entry.action`, e.g. "update", read next to what changed. */
  actionUpdate: "Changed",
  actionCreate: "Created",
  actionUndo: "Undone",

  /** One line: what changed, from `entry.fields` and `entry.after`. */
  changedFields: (fields: string) => `Changed ${fields}.`,
  createdLine: "Created.",
  undidLine: (fields: string) => `Undid the change to ${fields}.`,

  by: (name: string) => `by ${name}`,
  system: "the system",
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
  /* ---- D32: the message is sent by hand, one customer at a time ---- */
  sendingHeading: "To send",
  sendingHow:
    "Nothing is sent by us. Open each one on WhatsApp, send the message, then tick it.",
  sendingJars: (jars: number) => `${jars} jar${jars === 1 ? "" : "s"}`,
  sendingOpen: "Open WhatsApp",
  sendingTick: "Sent",
  sendingSent: "Sent",
  sendingRemaining: (left: number, total: number) => `${left} of ${total} still to send`,
  sendingClose: "Close this list",
  sendingNobody: "Nobody has paid into this batch yet.",

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

/**
 * The Sell screen (brief sections 7A.1, 7A.6 and 17.3), M2.8.
 *
 * **Admin wording only.** Nothing on this screen is read by a customer, so
 * CLAUDE.md section 5 lets the build write it. The two lines that *are*
 * customer-facing, a custom line's description and a discount reason, are
 * typed by the person at the counter and checked by `checkCustomerText` in
 * the callable before they can ever reach a bill.
 *
 * Every refusal the server sends back is shown as the server wrote it: it
 * already speaks in sentences a person can act on ("someone took the last
 * jar"), and rewording it here would put two versions of one truth in the
 * system. The strings below are the ones the screen says on its own.
 */
export const SELL = {
  /* ---- 1. Customer, 7A.1 step 1 ---- */
  customerHeading: "Customer",
  phoneLabel: "WhatsApp number",
  phonePlaceholder: "7736110087",
  phoneInvalid: "That does not look like a 10 digit Indian mobile number.",
  phoneNotIndian: "Lailark sells to Indian mobile numbers. Please use a +91 number.",
  nameLabel: "Name",
  lookingUp: "Looking them up...",
  /** "3 jars before, last in November", the one line brief 7A.1 asks for. */
  history: (jars: number, orders: number) =>
    `${jars === 1 ? "1 jar" : `${jars} jars`} before, over ${orders === 1 ? "1 order" : `${orders} orders`}.`,
  historyNone: "No jars yet, but we have their number.",
  newNumber: "This number has never bought from us.",

  /* ---- the near misses, so a wrong digit does not invent a stranger ---- */
  nearMissHeading: "It is one digit from these:",
  nearMissUse: (name: string, phone: string) => `Use ${name || phone}`,
  nearMissJars: (jars: number) => (jars === 1 ? "1 jar" : `${jars} jars`),
  confirmNewCustomer: "It really is a new number. Add them.",
  newCustomerNeedsName: "Please give their name before adding them.",

  /* ---- 2. What, 7A.1 step 2 ---- */
  whatHeading: "What",
  productLabel: "Product",
  productPlaceholder: "Choose a product",
  batchLabel: "Batch",
  batchSuggested: "suggested",
  batchOption: (label: string, left: number, price: string) =>
    `${label}, ${left === 1 ? "1 jar" : `${left} jars`} left, ${price}`,
  noBatch: "Nothing of this product is on sale right now.",
  qtyLabel: "Jars",
  qtyInvalid: "Please enter a whole number of jars, one or more.",
  customLineToggle: "Something else",
  customLineToggleOff: "A jar",
  customLineDescription: "What was sold",
  customLineAmount: "Amount",
  customLinePick: "Pick one of the lines Shefin has set",
  customLineNoneSet: "Shefin has not set any custom lines on this product, so the kitchen cannot sell one.",
  customLineNeedsDescription: "Please say what was sold, so the bill reads properly.",
  customLineNeedsAmount: "Please give the amount.",
  customLineTiedToBatch: "Take jars off a batch",

  /* ---- 3. Amount, 7A.1 step 3 ---- */
  amountHeading: "Amount",
  unitPriceLabel: "Price each",
  unitPriceOwnerHelp: "Only you can change a jar's price, and never above ₹649.",
  priceAboveMrp: "A jar is never sold above ₹649. Please enter ₹649 or less.",
  priceInvalid: "Please enter a price in rupees.",
  subtotal: "Subtotal",
  discountLabel: "Discount",
  discountReason: "Why",
  discountNoRights: "Shefin has not set a discount cap for the kitchen, so no discount can be given here.",
  discountCap: (cap: string) => `Up to ${cap}, with a reason.`,
  discountAnyAmount: "Any amount, with a reason.",
  discountOverCap: (cap: string) => `That is over the ${cap} cap. Anything more is Shefin's to give.`,
  discountOverSubtotal: "A discount cannot be more than the sale is worth.",
  discountNeedsReason: "Please say why this discount was given.",
  total: "Total",

  /* ---- 4. Fulfilment, 7A.1 step 4 ---- */
  fulfilmentHeading: "Fulfilment",
  handedOver: "Handed over now",
  ship: "Ship to an address",
  collect: "Collect later",
  addressName: "Name on the address",
  addressPhone: "Phone for the delivery",
  addressLines: "Address",
  addressLinesHelp: "One line each. Up to four.",
  addressCity: "Town or city",
  addressState: "State",
  addressPincode: "Pincode",

  /* ---- 5. Payment, 7A.1 step 5 ---- */
  paymentHeading: "Payment",
  cash: "Cash",
  upiToAccount: "UPI to our account",
  paymentLink: "Payment link",
  razorpayQrLater: "The Razorpay QR at the counter arrives with M3. Take cash, UPI to the account, or send a link.",
  upiRefLabel: "Last 4 of the UPI reference",
  upiRefHelp: "Optional. It makes the day close easy to check against the bank app.",
  paymentLinkNote: "The jar is held and the order waits as Awaiting payment. Sending the link itself arrives in M3.",

  /* ---- 6. Consent, 7A.1 step 6 ---- */
  consentHeading: "Consent",
  consentUpdates: "Happy to get the bill and updates on WhatsApp.",
  consentMarketing: "Wants to hear when a new batch opens.",

  /* ---- 7. Save, 7A.1 step 7 ---- */
  noteLabel: "Note, optional",
  save: "Save the sale",
  saving: "Saving...",
  saveFailed: "That did not save. Please check the signal and try again.",

  /* ---- what the screen says once it has ---- */
  soldHeading: "Sold.",
  soldLine: (description: string, total: string) => `${description}. ${total}.`,
  soldAwaitingPayment: "Waiting for the payment link to be paid.",
  soldCustomerCreated: (name: string) => `${name} is now on the customer list.`,
  jarsLeft: (left: number) => (left === 1 ? "1 jar left on that batch." : `${left} jars left on that batch.`),
  another: "New sale",

  /* ---- today's sales and the void, 7A.6 and 17.3 ---- */
  todayHeading: "Today's counter sales",
  todayEmpty: "No sales at the counter today.",
  todayLoading: "Loading...",
  todayDenied: "Today's sales could not be read. Ask Shefin to check your role.",
  saleVoided: "Voided",
  voidLabel: "Void",
  voidHeading: "Void this sale",
  voidReason: "Why it is being voided",
  voidReasonRequired: "Please say why this sale is being voided.",
  voidConfirm: "Void the sale",
  voidWorking: "Voiding...",
  voidCancel: "Keep it",
  voidFailed: "That did not go through. Please check the signal and try again.",
  voidDone: (jars: number) =>
    jars === 0 ? "Voided." : jars === 1 ? "Voided. 1 jar is back on the batch." : `Voided. ${jars} jars are back on the batch.`,
  /* ---- the bill, M2.9, brief 13.1 and D35 ---- */
  billLabel: "Bill",
  billOpening: "Opening...",
  billNone: "No bill for this one yet.",
  billFailed: "The bill did not open. Please check the signal and try again.",
  billBlocked: "Your phone stopped the bill opening. Allow pop-ups for this site, then tap again.",
  billVoided: "This bill is marked void.",

  /** Brief 7A.6: same day, before the bill has gone. */
  voidNotAvailable: "The bill has gone, so this is Shefin's to cancel with a credit note.",

  /* ---- the per-person limit, 7A.6, Owner only ---- */
  overrideLimit: "Sell it anyway, past the limit",
  overrideLimitHelp: "Only you can go past a batch's per-person limit, and the order records that you did.",

  /* ---- who may be here at all, brief 17.12 ---- */
  viewerCannotSell: "A Viewer can look at everything and sell nothing.",

  /**
   * M2.15: the save button stops being a dead end. Every reason a sale
   * cannot be saved yet, named plainly, each one a tap to the field it
   * belongs to. Brief §17.1: no red alarm, the same field-help voice as the
   * rest of the screen.
   */
  outstandingHeading: "Before this can be saved:",
  outstandingPhone: "Add the WhatsApp number.",
  outstandingName: "Add their name.",
  outstandingConfirm: "Say whether this is really a new number.",
  outstandingProduct: "Choose a product and a batch.",
  outstandingCustomLineNone:
    "Nothing is set up for a custom line here. Choose a jar instead, or ask Shefin to add one in Products.",
  outstandingAddressName: "Add the name on the address.",
  outstandingAddressPhone: "Add a phone for the delivery.",
  outstandingAddressLines: "Add the address.",
  outstandingAddressCity: "Add the town or city.",
  outstandingAddressState: "Add the state.",
  outstandingAddressPincode: "Add a six digit pincode.",
  outstandingTotal: "The discount cannot bring the total below zero.",
} as const;

/** Brief 7A.1 step 4. The screen's own wording for each mode. */
export const FULFILMENT_LABEL: Record<string, string> = {
  handedOver: SELL.handedOver,
  ship: SELL.ship,
  collect: SELL.collect,
};

/** Brief 7A.1 step 5, the three M2.8 builds. */
export const PAYMENT_LABEL: Record<string, string> = {
  cash: SELL.cash,
  upiToAccount: SELL.upiToAccount,
  paymentLink: SELL.paymentLink,
};
