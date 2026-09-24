/**
 * The document itself: brief 13.2's list, on one A5 page, in the design
 * system (sales flow doc section 10, `admin/src/styles/tokens.css`).
 *
 * ## Why pdf-lib and no font file
 *
 * A bill is drawn on a Cloud Function, cold, on a phone's connection, in
 * `asia-south1`. A headless browser is a hundred megabytes and several
 * seconds for one A5 page, and a font file is a binary asset with a licence
 * to keep track of. `pdf-lib` is pure JavaScript with no native build and no
 * dependency of its own, and it draws with the PDF core fonts, which every
 * reader already has: Times for headings and Helvetica for body, which is
 * exactly what `--font-heading` and `--font-body` resolve to.
 *
 * ## The rupee sign
 *
 * The core fonts are WinAnsi and **U+20B9 is not in WinAnsi**, so a core font
 * cannot print `₹`. The three ways out are: embed a font (a binary asset),
 * print "Rs." (the design says a rupee sign, and quietly printing something
 * else on a customer's bill is not a thing to do without asking), or draw the
 * glyph. This draws it: {@link RUPEE_PATHS} is the sign as four strokes on a
 * 1000-unit em, scaled to the text size and set on the baseline beside the
 * digits, so `₹649` on a bill is the same mark as `₹649` on the screen.
 * {@link drawAmount} is the only place an amount is ever put on a page, so
 * there is one rupee sign in the system rather than one per column.
 *
 * ## Colour
 *
 * Hard rule: Rust is a number colour, never a button or a heading; Leaf only
 * ever touches a claim. There is no claim on a bill, so Leaf does not appear
 * here at all, and Rust appears only on the document number and on the
 * amounts.
 */

import {
  type Color,
  LineCapStyle,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";
import { type DocumentRecord, DOCUMENT_KINDS, formatINR, type Paise } from "@lailark/shared";

import {
  CHANNEL_LABEL,
  documentTitle,
  GST_INCLUSIVE_LINE,
  LABELS,
  PAYMENT_LABEL,
  VOID_MARK,
} from "./copy";

/* -------------------------------------------------------------------------- */
/* The design system, as numbers a PDF understands                            */
/* -------------------------------------------------------------------------- */

/** A5 portrait, 148 x 210 mm, in PDF points. */
export const A5: readonly [number, number] = [419.53, 595.28];

const INK = rgb(0x17 / 255, 0x15 / 255, 0x0f / 255);
const PAPER = rgb(0xfa / 255, 0xf8 / 255, 0xf4 / 255);
/** Numbers only. Never a heading. */
const RUST = rgb(0xa3 / 255, 0x4a / 255, 0x28 / 255);
const GREY = rgb(0x6e / 255, 0x66 / 255, 0x5a / 255);
const HAIRLINE = rgb(0xe4 / 255, 0xdd / 255, 0xd0 / 255);

const MARGIN = 32;
const SP = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;

const SIZE = { small: 7.5, body: 9, sub: 8, heading: 15, title: 20 } as const;

/* -------------------------------------------------------------------------- */
/* The rupee sign                                                             */
/* -------------------------------------------------------------------------- */

/**
 * U+20B9 as four strokes on a 1000-unit em, y measured downward from the top
 * of the cap so that y = 700 is the baseline: the shirorekha, the bar under
 * the bowl, the bowl hanging off the shirorekha, and the leg.
 */
export const RUPEE_PATHS: readonly string[] = [
  "M 60 70 L 560 70",
  "M 60 300 L 560 300",
  "M 130 70 C 430 70 430 300 130 300",
  "M 215 300 L 530 690",
];

/** Stem weight, matching Helvetica's, on the same 1000-unit em. */
const RUPEE_STROKE = 76;

/** How wide the sign is, including its right side bearing, per unit of size. */
export const RUPEE_ADVANCE = 0.62;

/** Draws the rupee sign with its baseline at `y` and its left edge at `x`. */
export function drawRupee(page: PDFPage, x: number, y: number, size: number, color: Color): void {
  const scale = size / 1000;
  for (const d of RUPEE_PATHS) {
    page.drawSvgPath(d, {
      x,
      y: y + 700 * scale,
      scale,
      borderColor: color,
      borderWidth: RUPEE_STROKE,
      borderLineCap: LineCapStyle.Butt,
    });
  }
}

interface AmountOptions {
  readonly size?: number;
  readonly font: PDFFont;
  readonly color?: Color;
  /** Right-aligns the whole amount, sign included, on `x`. */
  readonly right?: boolean;
  readonly alwaysPaise?: boolean;
}

/** How wide `paise` will be once drawn, sign included. */
export function amountWidth(paise: Paise, options: AmountOptions): number {
  const size = options.size ?? SIZE.body;
  const text = formatINR(paise, { symbol: false, alwaysPaise: options.alwaysPaise });
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  const minus = negative ? options.font.widthOfTextAtSize("-", size) : 0;
  return minus + RUPEE_ADVANCE * size + options.font.widthOfTextAtSize(digits, size);
}

/**
 * The one place an amount reaches a page: a minus sign if there is one, then
 * the drawn rupee sign, then the digits `formatINR` grouped.
 */
export function drawAmount(page: PDFPage, x: number, y: number, paise: Paise, options: AmountOptions): void {
  const size = options.size ?? SIZE.body;
  const color = options.color ?? RUST;
  const text = formatINR(paise, { symbol: false, alwaysPaise: options.alwaysPaise });
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;

  let cursor = options.right ? x - amountWidth(paise, options) : x;
  if (negative) {
    page.drawText("-", { x: cursor, y, size, font: options.font, color });
    cursor += options.font.widthOfTextAtSize("-", size);
  }
  drawRupee(page, cursor, y, size, color);
  cursor += RUPEE_ADVANCE * size;
  page.drawText(digits, { x: cursor, y, size, font: options.font, color });
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * WinAnsi has no curly quotes, no ellipsis and no dash beyond the hyphen, and
 * `pdf-lib` throws rather than dropping a character it cannot encode. Text
 * reaching a document comes from a person typing at the counter, so it is
 * flattened here rather than trusted. There are no em dashes in Lailark's own
 * copy (CLAUDE.md section 3); this is for what a customer's name or a
 * discount reason might carry.
 */
export function winAnsi(text: string): string {
  // Tolerant of a value that is not a string at all: this is the last thing
  // between a half-written document and a throw inside a trigger.
  if (typeof text !== "string") return "";
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—‒]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
}

/**
 * Breaks one word that is wider than the column, character by character.
 *
 * An email address is a single unbreakable word, and a bill's "Billed to"
 * column is half an A5 page. Without this, one long address runs straight
 * across the page and into the Delivery block beside it.
 */
function breakWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const parts: string[] = [];
  let part = "";
  for (const character of word) {
    const candidate = part + character;
    if (part !== "" && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      parts.push(part);
      part = character;
    } else {
      part = candidate;
    }
  }
  if (part !== "") parts.push(part);
  return parts;
}

/**
 * `text`, broken into lines that each fit `maxWidth`. Nothing is truncated: a
 * customer's name and their email are not things to cut short on a bill, so a
 * long one takes another line rather than an ellipsis or an overrun.
 */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = winAnsi(text).split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line !== "" && font.widthOfTextAtSize(`${line} ${word}`, size) <= maxWidth) {
      line = `${line} ${word}`;
      continue;
    }
    if (line !== "") lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    const parts = breakWord(word, font, size, maxWidth);
    lines.push(...parts.slice(0, -1));
    line = parts[parts.length - 1] ?? "";
  }
  if (line !== "") lines.push(line);
  return lines;
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

/** A stored `documents/{id}`, as the renderer reads it. */
export type RenderableDocument = Omit<DocumentRecord, "createdAt" | "updatedAt" | "issuedAt"> & {
  readonly issuedOn: string;
};

/**
 * The name on the bill, or the number when there is no name left to print.
 *
 * `winAnsi` strips everything a core font cannot encode, and Kunnamangalam is
 * in Kerala, so "ആഷ മേനോൻ" flattens to nothing at all and the old
 * `name === "" ? phone : name` test never fired: the bill came out with an
 * empty "Billed to" line. The fallback is therefore on the **flattened**
 * name, not the typed one.
 */
export function customerName(doc: {
  readonly customer: { readonly name: string; readonly phone: string };
}): string {
  return winAnsi(doc.customer.name).trim() === "" ? doc.customer.phone : doc.customer.name;
}

/**
 * Fills in anything a stored document is missing, so drawing a page can never
 * throw on a field that is not there.
 *
 * A render runs on a trigger, off the request path, and a throw there takes
 * the function instance down and the counter sales sharing it with it. The
 * strong guard is `isRenderable` in `./issue.ts`, which refuses to draw
 * something that is not a document; this is the second line, for a document
 * that is real but has a field missing (an older shape, a half-written
 * write). A blank on a bill is a thing to notice; a dead instance is not.
 */
function safe(doc: RenderableDocument): RenderableDocument {
  const seller = (doc.seller ?? {}) as Partial<RenderableDocument["seller"]>;
  const customer = (doc.customer ?? {}) as Partial<RenderableDocument["customer"]>;
  const payment = (doc.payment ?? {}) as Partial<RenderableDocument["payment"]>;
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const num = (value: unknown): number => (typeof value === "number" ? value : 0);

  const kind = (DOCUMENT_KINDS as readonly string[]).includes(str(doc.kind))
    ? doc.kind
    : ("bill" as const);

  return {
    ...doc,
    kind,
    number: str(doc.number),
    orderId: str(doc.orderId),
    orderNumber: str(doc.orderNumber),
    issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(str(doc.issuedOn)) ? doc.issuedOn : "",
    seller: {
      name: str(seller.name),
      addressLines: Array.isArray(seller.addressLines) ? seller.addressLines : [],
      supportPhone: str(seller.supportPhone),
      fssai: str(seller.fssai),
      website: str(seller.website),
      gstin: typeof seller.gstin === "string" ? seller.gstin : null,
      handedOverText: str(seller.handedOverText),
    },
    customer: {
      name: str(customer.name),
      phone: str(customer.phone),
      email: typeof customer.email === "string" ? customer.email : null,
    },
    payment: {
      method: (payment.method ?? "") as RenderableDocument["payment"]["method"],
      status: str(payment.status),
      reference: typeof payment.reference === "string" ? payment.reference : null,
    },
    deliveryText: str(doc.deliveryText),
    placeOfSupply: str(doc.placeOfSupply),
    channel: str(doc.channel),
    lines: Array.isArray(doc.lines) ? doc.lines : [],
    subtotal: num(doc.subtotal),
    discount: num(doc.discount),
    shippingFee: num(doc.shippingFee),
    taxable: num(doc.taxable),
    cgst: num(doc.cgst),
    sgst: num(doc.sgst),
    igst: num(doc.igst),
    total: num(doc.total),
    voids: typeof doc.voids === "string" ? doc.voids : null,
    gstEnabled: doc.gstEnabled === true,
    voided: doc.voided ?? null,
  };
}

/**
 * One A5 page from one stored document. Pure: it reads nothing, so the same
 * document always renders the same page, today and in three years.
 */
export async function renderDocumentPdf(stored: RenderableDocument): Promise<Uint8Array> {
  const doc = safe(stored);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A5[0], A5[1]]);
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const heading = await pdf.embedFont(StandardFonts.TimesRoman);

  const title = documentTitle(doc.kind, doc.gstEnabled);
  pdf.setTitle(`${title} ${doc.number}`);
  pdf.setProducer("Lailark");
  pdf.setCreator("Lailark");
  // The day it was issued, not the moment it was drawn, so re-rendering the
  // same document a year later produces the same bytes rather than a page
  // that claims to have been made today.
  if (doc.issuedOn !== "") {
    const issued = new Date(`${doc.issuedOn}T00:00:00.000Z`);
    pdf.setCreationDate(issued);
    pdf.setModificationDate(issued);
  }

  const width = A5[0];
  const left = MARGIN;
  const right = width - MARGIN;
  const inner = right - left;

  page.drawRectangle({ x: 0, y: 0, width, height: A5[1], color: PAPER });

  let y = A5[1] - MARGIN;

  const text = (
    value: string,
    x: number,
    baseline: number,
    size: number,
    font: PDFFont,
    color: Color = INK,
  ): void => {
    page.drawText(winAnsi(value), { x, y: baseline, size, font, color });
  };

  const textRight = (
    value: string,
    x: number,
    baseline: number,
    size: number,
    font: PDFFont,
    color: Color = INK,
  ): void => {
    const clean = winAnsi(value);
    page.drawText(clean, { x: x - font.widthOfTextAtSize(clean, size), y: baseline, size, font, color });
  };

  const rule = (baseline: number): void => {
    page.drawLine({
      start: { x: left, y: baseline },
      end: { x: right, y: baseline },
      thickness: 0.6,
      color: HAIRLINE,
    });
  };

  /* ---- who it is from, and what it is ------------------------------- */

  y -= SIZE.heading;
  text(doc.seller.name, left, y, SIZE.heading, heading);
  textRight(title, right, y, SIZE.title, heading);

  y -= SP[3];
  for (const line of doc.seller.addressLines) {
    y -= SIZE.small + 2;
    text(line, left, y, SIZE.small, body, GREY);
  }
  y -= SIZE.small + 2;
  text(doc.seller.supportPhone, left, y, SIZE.small, body, GREY);
  y -= SIZE.small + 2;
  text(doc.seller.fssai, left, y, SIZE.small, body, GREY);
  y -= SIZE.small + 2;
  text(doc.seller.website, left, y, SIZE.small, body, GREY);
  if (doc.gstEnabled && doc.seller.gstin !== null) {
    y -= SIZE.small + 2;
    text(`${LABELS.gstin} ${doc.seller.gstin}`, left, y, SIZE.small, body, GREY);
  }

  /* ---- the number and the date, right column ------------------------ */

  let metaY = A5[1] - MARGIN - SIZE.heading - SP[4];
  const meta = (label: string, value: string, rusty = false): void => {
    metaY -= SIZE.sub + 3;
    textRight(label, right - 100, metaY, SIZE.small, body, GREY);
    textRight(value, right, metaY, SIZE.sub, rusty ? bold : body, rusty ? RUST : INK);
  };
  meta(LABELS.number(doc.kind, doc.gstEnabled), doc.number, true);
  meta(LABELS.date, doc.issuedOn);
  if (doc.voids !== null) meta(LABELS.against, doc.voids);

  y = Math.min(y, metaY) - SP[4];
  rule(y);

  /* ---- who it is to, brief 13.2 ------------------------------------- */

  y -= SP[4];
  const half = inner / 2 - SP[3];

  const blockTop = y;
  text(LABELS.billedTo, left, y, SIZE.small, body, GREY);

  // **Every line in this column is wrapped to the column.** It is half the
  // page wide, and "Kunhimuhammed Abdurahiman Nedumparambil" is 207pt of it,
  // which used to run straight across into the Delivery block on the right
  // and leave both illegible. A name is not a thing to truncate on a bill, so
  // it wraps rather than being cut.
  y -= SIZE.body + 3;
  for (const line of wrap(customerName(doc), bold, SIZE.body, half)) {
    text(line, left, y, SIZE.body, bold);
    y -= SIZE.body + 2;
  }
  y += SIZE.body + 2 - (SIZE.sub + 2);
  // When the name could not be printed at all, `customerName` has already put
  // the number on the line above, so printing it again here would set the
  // same number twice, one bold and one not. Considered and suppressed: the
  // phone line is there to name the person, and it has already done that.
  if (customerName(doc) !== doc.customer.phone) {
    text(doc.customer.phone, left, y, SIZE.sub, body);
  } else {
    y += SIZE.sub + 2;
  }
  if (doc.customer.email !== null && doc.customer.email !== "") {
    for (const line of wrap(doc.customer.email, body, SIZE.sub, half)) {
      y -= SIZE.sub + 2;
      text(line, left, y, SIZE.sub, body);
    }
  }
  const leftBottom = y;

  let rightY = blockTop;
  const rightX = left + inner / 2 + SP[3];
  text(LABELS.delivery, rightX, rightY, SIZE.small, body, GREY);
  for (const line of wrap(doc.deliveryText, body, SIZE.sub, half)) {
    rightY -= SIZE.sub + 2;
    text(line, rightX, rightY, SIZE.sub, body);
  }
  rightY -= SIZE.sub + SP[1];
  text(`${LABELS.placeOfSupply}: ${doc.placeOfSupply}`, rightX, rightY, SIZE.sub, body);
  rightY -= SIZE.sub + 2;
  text(
    `${LABELS.channel}: ${CHANNEL_LABEL[doc.channel] ?? doc.channel}`,
    rightX,
    rightY,
    SIZE.sub,
    body,
  );

  y = Math.min(leftBottom, rightY) - SP[4];
  rule(y);

  /* ---- the lines ---------------------------------------------------- */

  const colAmount = right;
  const colUnit = right - 72;
  const colQty = right - 122;
  const colDescription = left;
  const descriptionWidth = colQty - colDescription - SP[3] - 14;

  y -= SP[3] + SIZE.small;
  text(LABELS.description, colDescription, y, SIZE.small, body, GREY);
  textRight(LABELS.qty, colQty, y, SIZE.small, body, GREY);
  textRight(LABELS.unitPrice, colUnit, y, SIZE.small, body, GREY);
  textRight(LABELS.amount, colAmount, y, SIZE.small, body, GREY);
  y -= SP[2];
  rule(y);

  for (const line of doc.lines) {
    y -= SP[3] + SIZE.body;
    const wrapped = wrap(line.description, body, SIZE.body, descriptionWidth);
    text(wrapped[0] ?? "", colDescription, y, SIZE.body, body);
    textRight(String(line.qty), colQty, y, SIZE.body, body);
    drawAmount(page, colUnit, y, line.unitPrice, { font: body, right: true, color: INK });
    drawAmount(page, colAmount, y, line.amount, { font: body, right: true });

    for (const extra of wrapped.slice(1)) {
      y -= SIZE.body + 2;
      text(extra, colDescription, y, SIZE.body, body);
    }

    // Brief 13.2 puts the batch number and the jar numbers on the line.
    // **Wrapped, like everything else on this page**: `jarNumbers` is empty
    // until M4.1 fills it at packing, and Lailark's batch is 22 jars, so the
    // note becomes long the moment that task lands.
    const notes: string[] = [];
    if (line.batchNo !== null) notes.push(`${LABELS.batch} ${line.batchNo}`);
    if (line.jarNumbers.length > 0) notes.push(`${LABELS.jars} ${line.jarNumbers.join(", ")}`);
    if (doc.gstEnabled && line.hsn !== null) notes.push(`${LABELS.hsn} ${line.hsn}`);
    for (const note of wrap(notes.join(", "), body, SIZE.small, descriptionWidth)) {
      y -= SIZE.small + 2;
      text(note, colDescription, y, SIZE.small, body, GREY);
    }
  }

  y -= SP[3];
  rule(y);

  /* ---- what it comes to --------------------------------------------- */

  /**
   * One line of the totals block: a right-aligned label ending at `colUnit`,
   * and the amount right-aligned on the page edge.
   *
   * **The label wraps.** A discount carries the reason typed at the counter,
   * which `sale.ts` allows up to 200 characters, and an unwrapped label
   * right-aligned at x = 315 starts off the left edge of the paper at about
   * 60 characters and is mostly off the sheet by 120. A long label takes as
   * many lines as it needs and the amount sits level with its last one, so
   * the figure stays beside the label it belongs to. Nothing is truncated,
   * here as anywhere else on this page.
   */
  const labelWidth = colUnit - left;
  const totalRow = (label: string, amount: Paise, strong = false): void => {
    const size = strong ? SIZE.body + 2 : SIZE.sub;
    const labelSize = strong ? SIZE.sub : SIZE.small;
    const labelFont = strong ? bold : body;
    const lines = wrap(label, labelFont, labelSize, labelWidth);

    // The whole block's height is taken off the cursor **first**, then the
    // label is drawn downwards from the top of it. Reserving the space the
    // other way round (drawing the extra lines upwards from the row) puts
    // them over the row above, which is how the first attempt at this
    // overprinted Subtotal.
    const extra = (lines.length - 1) * (labelSize + 2);
    y -= (strong ? SP[3] : SP[2]) + size + extra;

    let lineY = y + extra;
    for (const line of lines) {
      textRight(line, colUnit, lineY, labelSize, labelFont, strong ? INK : GREY);
      lineY -= labelSize + 2;
    }

    // Level with the last line of its own label.
    drawAmount(page, colAmount, y, amount, { font: strong ? bold : body, size, right: true });
  };

  totalRow(LABELS.subtotal, doc.subtotal);
  if (doc.discount > 0) {
    const reason = (doc.discountReason ?? "").trim();
    totalRow(reason === "" ? LABELS.discount : `${LABELS.discount}, ${reason}`, -doc.discount);
  }
  if (doc.gstEnabled) {
    totalRow(LABELS.taxable, doc.taxable);
    if (doc.igst > 0) totalRow(LABELS.igst, doc.igst);
    else {
      totalRow(LABELS.cgst, doc.cgst);
      totalRow(LABELS.sgst, doc.sgst);
    }
  }
  totalRow(LABELS.total, doc.total, true);

  if (doc.gstEnabled) {
    y -= SP[3];
    textRight(GST_INCLUSIVE_LINE, colAmount, y, SIZE.small, body, GREY);
  }

  /* ---- how it was paid ---------------------------------------------- */

  y -= SP[6];
  rule(y);
  y -= SP[3] + SIZE.sub;
  const method = PAYMENT_LABEL[doc.payment.method] ?? doc.payment.method;
  text(`${LABELS.payment}: ${method}`, left, y, SIZE.sub, body);
  if (doc.payment.reference !== null && doc.payment.reference !== "") {
    y -= SIZE.sub + 3;
    text(`${LABELS.reference}: ${doc.payment.reference}`, left, y, SIZE.sub, body, GREY);
  }

  /* ---- voided, brief 13.3 -------------------------------------------- */

  if (doc.voided !== null) {
    y -= SP[4] + SIZE.sub;
    text(`${LABELS.voided}: ${doc.voided.reason}`, left, y, SIZE.sub, bold, RUST);

    // Across the page, faint, so it cannot be mistaken for a live bill and
    // cannot be photocopied into one either.
    page.drawText(VOID_MARK, {
      x: MARGIN + 30,
      y: A5[1] / 2 - 60,
      size: 96,
      font: bold,
      color: RUST,
      opacity: 0.14,
      rotate: degrees(32),
    });
  }

  return pdf.save();
}
