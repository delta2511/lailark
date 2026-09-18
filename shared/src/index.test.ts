import { describe, expect, it } from "vitest";
import * as shared from "./index.js";

/**
 * The public surface of `@lailark/shared`, spelled out. Adding an export is a
 * one-line change here; removing one is a deliberate break that this test
 * makes visible to `site`, `admin` and `functions` at once.
 */
const EXPECTED_EXPORTS = [
  // version
  "SHARED_VERSION",
  // states
  "BATCH_STATES",
  "BATCH_STATES_OPEN_FOR_BOOKING",
  "BATCH_STATES_IN_STOCK",
  "BATCH_STATES_PAUSABLE",
  "BATCH_TRANSITIONS",
  "canTransitionBatch",
  "ORDER_STATES",
  "ORDER_STATES_TERMINAL",
  "ORDER_STATES_RAISING_CONCERN",
  "ORDER_STATES_PAID",
  "PAYMENT_STATUSES",
  "PAYMENT_METHODS",
  "PAYMENT_METHODS_ONLINE",
  "ORDER_CHANNELS",
  "FULFILMENT_MODES",
  "DOCUMENT_KINDS",
  "REFUND_METHODS",
  "REFUND_STATUSES",
  "COURIERS",
  "SHIPMENT_STATUSES",
  "SHIPPING_RULES",
  "APPROVAL_KINDS",
  "APPROVAL_STATUSES",
  "CONCERN_TYPES",
  "MESSAGE_DIRECTIONS",
  "ROLES",
  "PRODUCT_TYPES",
  "POLICY_KINDS",
  "SETTINGS_NAMES",
  // money
  "PAISE_PER_RUPEE",
  "PRICE_IN_STOCK_PAISE",
  "PRICE_OPEN_PAISE",
  "MRP_PAISE",
  "IN_STOCK_PER_PERSON_LIMIT",
  "isPaise",
  "rupeesToPaise",
  "paiseToRupees",
  "addPaise",
  "subtractPaise",
  "multiplyPaise",
  "groupIndianDigits",
  "formatINR",
  "isAtOrBelowMrp",
  "assertAtOrBelowMrp",
  // dates
  "KOLKATA_UTC_OFFSET_MINUTES",
  "isLeapYear",
  "daysInMonth",
  "isValidCalDate",
  "formatCalDate",
  "parseCalDate",
  "toCalDate",
  "toDayNumber",
  "fromDayNumber",
  "addDays",
  "subtractDays",
  "diffDays",
  "compareCalDate",
  "isBefore",
  "isAfter",
  "isSameDate",
  "addMonths",
  "toEpochMillis",
  "kolkataDate",
  "kolkataStartOfDay",
  // batch
  "BOOKABLE_NUMERATOR",
  "BOOKABLE_DENOMINATOR",
  "PER_PERSON_LIMIT_DIVISOR",
  "bookableJars",
  "halfOfBookable",
  "perPersonLimit",
  "batchMaths",
  "surplusJars",
  "withinPerPersonLimit",
  "remainingPerPersonAllowance",
  "SHELF_LIFE_MONTHS",
  "SHELF_LIFE_DAYS",
  "DEFAULT_SHELF_LIFE_RULE",
  "bestBefore",
  "minRemainingDaysOnArrival",
  "saleStopOn",
  "saleStopWarnOn",
  "shelfLife",
  "isOnlineSaleAllowed",
  "daysToSaleStop",
  "liveHeldJars",
  "batchAvailability",
  "inStockAvailability",
  "canHold",
  // numbers
  "BATCH_NO_MIN_DIGITS",
  "formatBatchNo",
  "parseBatchNo",
  "isBatchNo",
  "FINANCIAL_YEAR_START_MONTH",
  "FINANCIAL_YEAR_START_DAY",
  "financialYearStartYear",
  "financialYearStart",
  "financialYearEnd",
  "financialYearLabel",
  "isFinancialYearLabel",
  "DEFAULT_DOCUMENT_PREFIXES",
  "DOCUMENT_NO_MIN_DIGITS",
  "seriesKey",
  "counterId",
  "formatDocumentNumber",
  "parseDocumentNumber",
  "isDocumentNumber",
  "toDocumentId",
  "fromDocumentId",
  "documentNumberFor",
  // rules
  "PROTECTED_BATCH_FIELDS",
  "KITCHEN_BATCH_FIELDS",
  "isProtectedBatchField",
  "isKitchenBatchField",
  "writableBatchFields",
  "KITCHEN_RECIPE_EDIT_SWITCH",
  "kitchenCanEditRecipes",
  // recipe
  "PERCENTAGE_BASES",
  "DEFAULT_PERCENTAGE_BASIS",
  "isPercentageBasis",
  "PERCENTAGE_BASIS_NOTES",
  "PERCENTAGE_BASIS_LABELS",
  "COMPOUND_DECLARATION_THRESHOLD_PERCENT",
  "RECIPE_UNITS",
  "toGrams",
  "roundToDecimals",
  "TABLE_DECIMALS",
  "declaredPercent",
  "formatLabelPercent",
  "indexIngredients",
  "computeRecipePercentages",
  "compoundDeclarationRequired",
  "labelIngredientText",
  "labelIngredientsLine",
  "allergenTagsFor",
  "allergenLine",
  "NUTRIENT_KEYS",
  "NUTRIENT_LABELS",
  "NUTRIENT_UNITS",
  "nutritionPer100g",
  "PRINTED_LABEL_BATCH_001",
  "DEFAULT_CLAIMS_TEXT",
  "DEFAULT_STORAGE_TEXT",
  "buildLabelBlock",
  "parseIngredientsLine",
  "compareLabelText",
  "verifyAgainstPrintedLabel",
  // catalogue
  "isValidMonthDay",
  "isWithinSeasonWindow",
] as const;

describe("the barrel", () => {
  it("exports exactly the documented surface", () => {
    expect(Object.keys(shared).sort()).toEqual([...EXPECTED_EXPORTS].sort());
  });

  it("carries no runtime dependency on Firebase", () => {
    expect(Object.keys(shared)).not.toContain("Timestamp");
  });

  it("works end to end on batch 001", () => {
    const maths = shared.batchMaths(22);
    expect(maths.bookableJars).toBe(19);
    expect(shared.formatBatchNo(1)).toBe("001");
    expect(shared.formatINR(shared.PRICE_IN_STOCK_PAISE)).toBe("₹649");
    expect(shared.formatCalDate(shared.bestBefore("2026-09-04"))).toBe("2027-03-04");
    expect(shared.formatCalDate(shared.saleStopOn("2026-09-04"))).toBe("2027-01-02");
    expect(shared.documentNumberFor("bill", "2026-09-04", 1).number).toBe("LK/26-27/0001");
    expect(shared.DEFAULT_PERCENTAGE_BASIS).toBe("B");
    expect(shared.PRINTED_LABEL_BATCH_001.claimsText).toBe(
      "No added preservatives. Prepared by traditional method.",
    );
  });
});
