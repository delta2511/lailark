import { describe, expect, it } from "vitest";
import {
  BATCH_NO_MIN_DIGITS,
  BATCH_REF_ALPHABET,
  BATCH_REF_LENGTH,
  BATCH_REF_PREFIX,
  batchLabel,
  batchLabelCapitalised,
  batchRefFromBytes,
  counterId,
  DEFAULT_DOCUMENT_PREFIXES,
  DOCUMENT_NO_MIN_DIGITS,
  documentNumberFor,
  financialYearEnd,
  financialYearLabel,
  financialYearStart,
  financialYearStartYear,
  formatBatchNo,
  formatDocumentNumber,
  fromDocumentId,
  isBatchNo,
  isBatchRef,
  isDocumentNumber,
  isFinancialYearLabel,
  parseBatchNo,
  parseDocumentNumber,
  seriesKey,
  toDocumentId,
} from "./numbers.js";
import { formatCalDate } from "./dates.js";
import { DOCUMENT_KINDS } from "./states.js";

describe("the internal batch reference, decision D21c", () => {
  it("is `b-` plus six lowercase base32 characters", () => {
    expect(BATCH_REF_PREFIX).toBe("b-");
    expect(BATCH_REF_LENGTH).toBe(6);
    expect(isBatchRef("b-7f3a2c")).toBe(true);
    expect(isBatchRef("b-000000")).toBe(true);
    expect(isBatchRef("b-zzzzzz")).toBe(true);
  });

  it("drops the four characters that are read back wrong", () => {
    // Crockford's base32: no i, l, o or u.
    for (const bad of ["i", "l", "o", "u"]) {
      expect(BATCH_REF_ALPHABET).not.toContain(bad);
      expect(isBatchRef(`b-aaaaa${bad}`)).toBe(false);
    }
    expect(BATCH_REF_ALPHABET.length).toBe(32);
    expect(new Set(BATCH_REF_ALPHABET).size).toBe(32);
  });

  it("refuses anything that is not one, including a batch number", () => {
    for (const bad of ["001", "b-7f3a2", "b-7f3a2cd", "B-7F3A2C", "7f3a2c", "b_7f3a2c", "", "b-"]) {
      expect(isBatchRef(bad), bad).toBe(false);
    }
  });

  it("builds one from bytes, uniformly, with no modulo bias", () => {
    expect(batchRefFromBytes([0, 1, 2, 3, 4, 5])).toBe("b-012345");
    // 256 is exactly eight times 32, so every byte value maps to a character
    // and every character is hit the same number of times.
    const counts = new Map<string, number>();
    for (let byte = 0; byte < 256; byte += 1) {
      const ch = batchRefFromBytes([byte, 0, 0, 0, 0, 0]).charAt(2);
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    expect([...counts.values()]).toEqual(Array(32).fill(8));
  });

  it("only ever builds a reference that parses back", () => {
    for (let i = 0; i < 64; i += 1) {
      const bytes = Array.from({ length: 6 }, (_, k) => (i * 7 + k * 31) % 256);
      expect(isBatchRef(batchRefFromBytes(bytes))).toBe(true);
    }
  });

  it("refuses to build one from too few bytes, or from something that is not a byte", () => {
    expect(() => batchRefFromBytes([1, 2, 3])).toThrow(/6 bytes/);
    expect(() => batchRefFromBytes([1, 2, 3, 4, 5, 300])).toThrow(/not a byte/);
    expect(() => batchRefFromBytes([1, 2, 3, 4, 5, -1])).toThrow(/not a byte/);
  });
});

describe("how a batch is named for a person, decision D21c", () => {
  it("shows the printed number once there is one", () => {
    expect(batchLabel("001", "b-7f3a2c")).toBe("batch 001");
    expect(batchLabel("001", "b-7f3a2c", "bottled")).toBe("batch 001");
    expect(batchLabelCapitalised("001", "b-7f3a2c")).toBe("Batch 001");
  });

  it("shows the reference before bottling, with the state in front of a draft", () => {
    expect(batchLabel(null, "b-7f3a2c", "draft")).toBe("draft b-7f3a2c");
    expect(batchLabel(null, "b-7f3a2c", "open")).toBe("batch b-7f3a2c");
    expect(batchLabel(null, "b-7f3a2c")).toBe("batch b-7f3a2c");
    expect(batchLabel(undefined, "b-7f3a2c")).toBe("batch b-7f3a2c");
    expect(batchLabel("", "b-7f3a2c")).toBe("batch b-7f3a2c");
    expect(batchLabelCapitalised(null, "b-7f3a2c", "draft")).toBe("Draft b-7f3a2c");
  });
});

describe("batch numbers, brief 8.3", () => {
  it("zero pads to three digits", () => {
    expect(BATCH_NO_MIN_DIGITS).toBe(3);
    expect(formatBatchNo(1)).toBe("001");
    expect(formatBatchNo(2)).toBe("002");
    expect(formatBatchNo(22)).toBe("022");
    expect(formatBatchNo(100)).toBe("100");
    expect(formatBatchNo(999)).toBe("999");
  });

  it("grows past 999 rather than repadding everything before it", () => {
    expect(formatBatchNo(1000)).toBe("1000");
    expect(formatBatchNo(12345)).toBe("12345");
    expect(parseBatchNo("1000")).toBe(1000);
  });

  it("parses the canonical form", () => {
    expect(parseBatchNo("001")).toBe(1);
    expect(parseBatchNo("022")).toBe(22);
    expect(parseBatchNo("999")).toBe(999);
  });

  it("rejects every other spelling, because a stray zero is a second batch", () => {
    for (const bad of ["1", "01", "0001", "abc", "", "0", "000", " 001", "001 ", "1e3", "-1", "١٢٣"]) {
      expect(() => parseBatchNo(bad)).toThrow();
      expect(isBatchNo(bad)).toBe(false);
    }
  });

  it("round-trips every number from 1 to 1200", () => {
    for (let n = 1; n <= 1200; n += 1) {
      expect(parseBatchNo(formatBatchNo(n))).toBe(n);
    }
  });

  it("refuses zero, a fraction and a negative", () => {
    expect(() => formatBatchNo(0)).toThrow(/whole number from 1/);
    expect(() => formatBatchNo(1.5)).toThrow();
    expect(() => formatBatchNo(-1)).toThrow();
  });
});

describe("the financial year, brief 13.3", () => {
  it("runs 1 April to 31 March", () => {
    expect(financialYearLabel("2026-04-01")).toBe("26-27");
    expect(financialYearLabel("2026-09-04")).toBe("26-27");
    expect(financialYearLabel("2026-12-31")).toBe("26-27");
    expect(financialYearLabel("2027-01-02")).toBe("26-27");
    expect(financialYearLabel("2027-03-31")).toBe("26-27");
  });

  it("resets on the next 1 April", () => {
    expect(financialYearLabel("2027-04-01")).toBe("27-28");
    expect(financialYearLabel("2026-03-31")).toBe("25-26");
    expect(financialYearLabel("2026-03-01")).toBe("25-26");
  });

  it("gives the boundaries of the year a date falls in", () => {
    expect(financialYearStartYear("2026-09-04")).toBe(2026);
    expect(formatCalDate(financialYearStart("2027-01-02"))).toBe("2026-04-01");
    expect(formatCalDate(financialYearEnd("2027-01-02"))).toBe("2027-03-31");
    expect(formatCalDate(financialYearStart("2027-04-01"))).toBe("2027-04-01");
    expect(formatCalDate(financialYearEnd("2027-04-01"))).toBe("2028-03-31");
  });

  it("pads a single-digit year", () => {
    expect(financialYearLabel("2099-04-01")).toBe("99-00");
    expect(financialYearLabel("2100-04-01")).toBe("00-01");
    expect(financialYearLabel("2009-05-01")).toBe("09-10");
  });

  it("validates a label", () => {
    expect(isFinancialYearLabel("26-27")).toBe(true);
    expect(isFinancialYearLabel("2026-2027")).toBe(false);
    expect(isFinancialYearLabel("26/27")).toBe(false);
    expect(isFinancialYearLabel("")).toBe(false);
  });
});

describe("document numbers, brief 13.3", () => {
  it("uses the prefix per kind", () => {
    expect(DEFAULT_DOCUMENT_PREFIXES).toEqual({
      bill: "LK",
      creditNote: "LKC",
      receipt: "LKR",
      refundNote: "LKF",
    });
  });

  it("formats the four series the brief names", () => {
    expect(formatDocumentNumber("bill", "26-27", 1)).toBe("LK/26-27/0001");
    expect(formatDocumentNumber("creditNote", "26-27", 1)).toBe("LKC/26-27/0001");
    expect(formatDocumentNumber("receipt", "26-27", 1)).toBe("LKR/26-27/0001");
    expect(formatDocumentNumber("refundNote", "26-27", 1)).toBe("LKF/26-27/0001");
  });

  it("pads to four digits and then grows", () => {
    expect(DOCUMENT_NO_MIN_DIGITS).toBe(4);
    expect(formatDocumentNumber("bill", "26-27", 22)).toBe("LK/26-27/0022");
    expect(formatDocumentNumber("bill", "26-27", 9999)).toBe("LK/26-27/9999");
    expect(formatDocumentNumber("bill", "26-27", 10000)).toBe("LK/26-27/10000");
  });

  it("refuses a bad year label or a bad serial", () => {
    expect(() => formatDocumentNumber("bill", "2026-27", 1)).toThrow(/financial year label/);
    expect(() => formatDocumentNumber("bill", "26-27", 0)).toThrow(/whole number from 1/);
    expect(() => formatDocumentNumber("bill", "26-27", 1.5)).toThrow();
  });

  it("takes the prefixes as a setting, because a new entity starts a new series", () => {
    const other = { ...DEFAULT_DOCUMENT_PREFIXES, bill: "LLP" };
    expect(formatDocumentNumber("bill", "26-27", 1, other)).toBe("LLP/26-27/0001");
    expect(seriesKey("bill", "2026-09-04", other)).toBe("LLP/26-27");
    expect(parseDocumentNumber("LLP/26-27/0001", other).kind).toBe("bill");
    expect(isDocumentNumber("LLP/26-27/0001")).toBe(false);
  });

  it("parses back to kind, year and serial", () => {
    expect(parseDocumentNumber("LK/26-27/0001")).toEqual({
      kind: "bill",
      prefix: "LK",
      fyLabel: "26-27",
      n: 1,
    });
    expect(parseDocumentNumber("LKF/27-28/0123").kind).toBe("refundNote");
    expect(parseDocumentNumber("LKC/26-27/10000").n).toBe(10000);
  });

  it("round-trips every kind", () => {
    for (const kind of DOCUMENT_KINDS) {
      for (const n of [1, 9, 99, 999, 1000, 9999, 10000]) {
        const text = formatDocumentNumber(kind, "26-27", n);
        expect(parseDocumentNumber(text)).toEqual({
          kind,
          prefix: DEFAULT_DOCUMENT_PREFIXES[kind],
          fyLabel: "26-27",
          n,
        });
      }
    }
  });

  it("rejects a non-canonical or unknown number", () => {
    for (const bad of [
      "LK/26-27/1",
      "LK/26-27/001",
      "LK/26-27/00001",
      "LK/26-27/0000",
      "LX/26-27/0001",
      "LK-26-27-0001",
      "LK/2026-27/0001",
      "LK/26-27",
      "LK/26-27/0001/x",
      "",
    ]) {
      expect(() => parseDocumentNumber(bad)).toThrow();
      expect(isDocumentNumber(bad)).toBe(false);
    }
  });
});

describe("the Firestore id forms, brief 18.1", () => {
  it("dashes the number into a document id", () => {
    expect(toDocumentId("LK/26-27/0001")).toBe("LK-26-27-0001");
    expect(toDocumentId("LKC/27-28/1234")).toBe("LKC-27-28-1234");
  });

  it("reverses it", () => {
    expect(fromDocumentId("LK-26-27-0001")).toBe("LK/26-27/0001");
    expect(fromDocumentId("LKR-26-27-0042")).toBe("LKR/26-27/0042");
  });

  it("round-trips", () => {
    for (const kind of DOCUMENT_KINDS) {
      const text = formatDocumentNumber(kind, "26-27", 42);
      expect(fromDocumentId(toDocumentId(text))).toBe(text);
    }
  });

  it("refuses anything that is not one of the two forms", () => {
    expect(() => toDocumentId("LK-26-27-0001")).toThrow();
    expect(() => toDocumentId("LK/26-27")).toThrow();
    expect(() => fromDocumentId("LK/26-27/0001")).toThrow();
    expect(() => fromDocumentId("LK-26-27")).toThrow();
  });

  it("names the counter document without a slash in it", () => {
    expect(seriesKey("bill", "2026-09-04")).toBe("LK/26-27");
    expect(counterId("bill", "2026-09-04")).toBe("LK-26-27");
    expect(counterId("receipt", "2027-04-01")).toBe("LKR-27-28");
    expect(counterId("bill", "2026-09-04")).not.toContain("/");
  });

  it("gives the whole allocation in one call", () => {
    expect(documentNumberFor("bill", "2026-09-04", 1)).toEqual({
      number: "LK/26-27/0001",
      id: "LK-26-27-0001",
      counterId: "LK-26-27",
    });
    expect(documentNumberFor("receipt", "2027-03-31", 7)).toEqual({
      number: "LKR/26-27/0007",
      id: "LKR-26-27-0007",
      counterId: "LKR-26-27",
    });
    // One day later the series has reset.
    expect(documentNumberFor("receipt", "2027-04-01", 1).number).toBe("LKR/27-28/0001");
  });
});
