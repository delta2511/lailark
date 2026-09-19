/**
 * `@lailark/shared`: the vocabulary the site, the admin and the functions all
 * speak. Types for every Firestore collection, the state spellings, money in
 * paise, batch maths, calendar dates, and the number series.
 *
 * No runtime dependencies, and deliberately no Firebase SDK: this package is
 * imported by a static site and by a browser bundle as well as by the server.
 */
export * from "./version.js";
export * from "./states.js";
export * from "./money.js";
export * from "./dates.js";
export * from "./batch.js";
export * from "./numbers.js";
export * from "./messages.js";
export * from "./approvals.js";
export * from "./rules.js";
export * from "./recipe.js";
export * from "./catalogue.js";
export * from "./types/index.js";
