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

/** The one line shown on an empty More sub-screen, keyed by row. */
export const MORE_EMPTY_BODY: Record<Exclude<MoreRowKey, "settings">, string> = {
  concerns: "No concerns right now. This is where they will wait for you, oldest first.",
  products: "No other products yet. The prawn pickle lives in Batches until this arrives.",
  customers: "No customers yet. Every order will add one here.",
  agent: "The agent is not live yet. Its conversations will read here.",
  money: "Nothing to show yet. Payments, refunds and settlements will land here.",
};

/** "owner" reads as "Owner" on screen. */
export function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
