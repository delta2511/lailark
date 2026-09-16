/**
 * Batch numbers and document numbers.
 *
 * Both are issued by the server inside a transaction on a counter document.
 * This module only spells them: formatting, parsing and the financial year
 * they belong to. Nothing here allocates a number.
 */

import { type CalDate, type CalDateInput, toCalDate } from "./dates.js";
import { DOCUMENT_KINDS, type DocumentKind } from "./states.js";

/* -------------------------------------------------------------------------- */
/* Batch numbers, brief section 8.3                                           */
/* -------------------------------------------------------------------------- */

/**
 * Zero padded to three digits, which is what is printed on the label and what
 * `/batch/<nnn>` carries. Past 999 the number simply grows to four digits
 * rather than changing the padding of everything before it, so "001" stays
 * "001" forever and jar 1000 is "1000". Numbers are global across products,
 * sequential, and never reused.
 */
export const BATCH_NO_MIN_DIGITS = 3;

export function formatBatchNo(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`batch number must be a whole number from 1, got ${n}`);
  }
  return String(n).padStart(BATCH_NO_MIN_DIGITS, "0");
}

/**
 * Strict: the only accepted spelling of a batch number is the canonical one.
 * "1", "01" and "0001" are rejected, because a batch document id that differs
 * by a zero is a second batch.
 */
export function parseBatchNo(text: string): number {
  if (typeof text !== "string" || !/^\d+$/.test(text)) {
    throw new RangeError(`not a batch number: ${JSON.stringify(text)}`);
  }
  const n = Number(text);
  if (n < 1 || formatBatchNo(n) !== text) {
    throw new RangeError(`not a canonical batch number: ${JSON.stringify(text)}`);
  }
  return n;
}

export function isBatchNo(text: string): boolean {
  try {
    parseBatchNo(text);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Financial year, brief section 13.3                                         */
/* -------------------------------------------------------------------------- */

/** The Indian financial year runs 1 April to 31 March. */
export const FINANCIAL_YEAR_START_MONTH = 4;
export const FINANCIAL_YEAR_START_DAY = 1;

/** The calendar year the financial year containing `date` begins in. */
export function financialYearStartYear(date: CalDateInput): number {
  const { y, m } = toCalDate(date);
  return m >= FINANCIAL_YEAR_START_MONTH ? y : y - 1;
}

/** 1 April of the financial year containing `date`. */
export function financialYearStart(date: CalDateInput): CalDate {
  return {
    y: financialYearStartYear(date),
    m: FINANCIAL_YEAR_START_MONTH,
    d: FINANCIAL_YEAR_START_DAY,
  };
}

/** 31 March of the financial year containing `date`. */
export function financialYearEnd(date: CalDateInput): CalDate {
  return { y: financialYearStartYear(date) + 1, m: 3, d: 31 };
}

function twoDigitYear(y: number): string {
  return String(((y % 100) + 100) % 100).padStart(2, "0");
}

/**
 * `"26-27"` for any date from 1 Apr 2026 to 31 Mar 2027. The series resets on
 * the next 1 April.
 */
export function financialYearLabel(date: CalDateInput): string {
  const start = financialYearStartYear(date);
  return `${twoDigitYear(start)}-${twoDigitYear(start + 1)}`;
}

const FY_LABEL = /^\d{2}-\d{2}$/;

export function isFinancialYearLabel(text: string): boolean {
  return typeof text === "string" && FY_LABEL.test(text);
}

/* -------------------------------------------------------------------------- */
/* Document numbers, brief sections 13.3 and 18.1                             */
/* -------------------------------------------------------------------------- */

export type DocumentPrefixes = Readonly<Record<DocumentKind, string>>;

/**
 * The launch prefixes. They are a setting (`settings/prefixes`, brief section
 * 17.11), because a new legal entity starts a new series, so every function
 * here takes them as an optional argument rather than reading a constant.
 */
export const DEFAULT_DOCUMENT_PREFIXES: DocumentPrefixes = {
  bill: "LK",
  creditNote: "LKC",
  receipt: "LKR",
  refundNote: "LKF",
};

/** Four digits minimum; past 9999 the number grows rather than restarting. */
export const DOCUMENT_NO_MIN_DIGITS = 4;

function prefixFor(kind: DocumentKind, prefixes: DocumentPrefixes): string {
  const prefix = prefixes[kind];
  if (typeof prefix !== "string" || !/^[A-Z]+$/.test(prefix)) {
    throw new RangeError(`no usable prefix for document kind ${JSON.stringify(kind)}`);
  }
  return prefix;
}

/**
 * The human series key: `"LK/26-27"`. One counter per series per financial
 * year. Not a Firestore document id, because of the slash: see
 * {@link counterId}.
 */
export function seriesKey(
  kind: DocumentKind,
  date: CalDateInput,
  prefixes: DocumentPrefixes = DEFAULT_DOCUMENT_PREFIXES,
): string {
  return `${prefixFor(kind, prefixes)}/${financialYearLabel(date)}`;
}

/**
 * The id of the `counters/{series}` document: `"LK-26-27"`. A Firestore
 * document id cannot contain a slash, so the series key is dashed the same way
 * a document id is.
 */
export function counterId(
  kind: DocumentKind,
  date: CalDateInput,
  prefixes: DocumentPrefixes = DEFAULT_DOCUMENT_PREFIXES,
): string {
  return seriesKey(kind, date, prefixes).split("/").join("-");
}

/** `formatDocumentNumber("bill", "26-27", 1)` -> `"LK/26-27/0001"`. */
export function formatDocumentNumber(
  kind: DocumentKind,
  fyLabel: string,
  n: number,
  prefixes: DocumentPrefixes = DEFAULT_DOCUMENT_PREFIXES,
): string {
  if (!isFinancialYearLabel(fyLabel)) {
    throw new RangeError(`not a financial year label: ${JSON.stringify(fyLabel)}`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`document number must be a whole number from 1, got ${n}`);
  }
  const serial = String(n).padStart(DOCUMENT_NO_MIN_DIGITS, "0");
  return `${prefixFor(kind, prefixes)}/${fyLabel}/${serial}`;
}

export interface ParsedDocumentNumber {
  readonly kind: DocumentKind;
  readonly prefix: string;
  readonly fyLabel: string;
  readonly n: number;
}

/** The inverse of {@link formatDocumentNumber}. Strict about padding. */
export function parseDocumentNumber(
  text: string,
  prefixes: DocumentPrefixes = DEFAULT_DOCUMENT_PREFIXES,
): ParsedDocumentNumber {
  if (typeof text !== "string") {
    throw new RangeError(`not a document number: ${JSON.stringify(text)}`);
  }
  const parts = text.split("/");
  if (parts.length !== 3) {
    throw new RangeError(`not a document number: ${JSON.stringify(text)}`);
  }
  const [prefix, fyLabel, serial] = parts;

  const kind = DOCUMENT_KINDS.find((candidate) => prefixes[candidate] === prefix);
  if (!kind) {
    throw new RangeError(`unknown document prefix ${JSON.stringify(prefix)}`);
  }
  if (!isFinancialYearLabel(fyLabel)) {
    throw new RangeError(`not a financial year label: ${JSON.stringify(fyLabel)}`);
  }
  if (!/^\d+$/.test(serial)) {
    throw new RangeError(`not a document serial: ${JSON.stringify(serial)}`);
  }
  const n = Number(serial);
  if (n < 1 || String(n).padStart(DOCUMENT_NO_MIN_DIGITS, "0") !== serial) {
    throw new RangeError(`not a canonical document serial: ${JSON.stringify(serial)}`);
  }
  return { kind, prefix, fyLabel, n };
}

export function isDocumentNumber(
  text: string,
  prefixes: DocumentPrefixes = DEFAULT_DOCUMENT_PREFIXES,
): boolean {
  try {
    parseDocumentNumber(text, prefixes);
    return true;
  } catch {
    return false;
  }
}

/** The shape both id forms round-trip through. */
const DOCUMENT_NUMBER_SHAPE = /^[A-Z]+\/\d{2}-\d{2}\/\d{4,}$/;
const DOCUMENT_ID_SHAPE = /^[A-Z]+-\d{2}-\d{2}-\d{4,}$/;

/**
 * `"LK/26-27/0001"` -> `"LK-26-27-0001"`, the `documents/{series-number}`
 * document id of brief section 18.1. A Firestore document id cannot contain a
 * slash, and making the id the number itself is what stops a number being used
 * twice.
 */
export function toDocumentId(documentNumber: string): string {
  if (typeof documentNumber !== "string" || !DOCUMENT_NUMBER_SHAPE.test(documentNumber)) {
    throw new RangeError(`not a document number: ${JSON.stringify(documentNumber)}`);
  }
  return documentNumber.split("/").join("-");
}

/** `"LK-26-27-0001"` -> `"LK/26-27/0001"`. */
export function fromDocumentId(documentId: string): string {
  if (typeof documentId !== "string" || !DOCUMENT_ID_SHAPE.test(documentId)) {
    throw new RangeError(`not a document id: ${JSON.stringify(documentId)}`);
  }
  const [prefix, fyStart, fyEnd, serial] = documentId.split("-");
  return `${prefix}/${fyStart}-${fyEnd}/${serial}`;
}

/** The whole allocation in one call, once the counter has given `n`. */
export function documentNumberFor(
  kind: DocumentKind,
  date: CalDateInput,
  n: number,
  prefixes: DocumentPrefixes = DEFAULT_DOCUMENT_PREFIXES,
): { readonly number: string; readonly id: string; readonly counterId: string } {
  const number = formatDocumentNumber(kind, financialYearLabel(date), n, prefixes);
  return {
    number,
    id: toDocumentId(number),
    counterId: counterId(kind, date, prefixes),
  };
}
