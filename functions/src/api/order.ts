/**
 * `/api/order/<token>`: everything the private order page (`/o/<token>`) puts
 * in front of a customer, and nothing else.
 *
 * Brief §5: "'Where is my order' is answered by the agent on WhatsApp, or by
 * a private order link sent with the bill (`lailark.in/o/<long random
 * token>`). No login page." So the token **is** the access control, and two
 * things follow from that.
 *
 * **The token is never a query the caller shapes.** It is matched for length
 * and alphabet before Firestore is touched (`isOrderToken`), so a caller
 * cannot turn this into a scan of the orders collection, and an order that
 * carries no token (anything written before M3.8) can never be reached: a
 * missing field would otherwise match a missing token.
 *
 * **The reply is a projection, not the document.** The order document carries
 * things that are ours rather than the customer's: who sold it, the kitchen
 * note, the Razorpay ids, the audit stamps, the client reference, the
 * internal batch reference. None of it is here. What is here is what somebody
 * would look at the page to find out: what they bought, what they paid, where
 * it is going, which jar numbers are theirs, and their bill.
 *
 * Nor is the order's **state**, its channel, or the payment's status and
 * method (D63, and M3.8 round 2). D63 settled that the page does not tell a
 * customer the state, and the page draws none of the other three either.
 * They are our internal vocabulary, and this endpoint takes no sign-in, so a
 * field nothing renders is a field nobody should be handed.
 *
 * Nothing here writes anything, and `Cache-Control: no-store` is set by the
 * router: a private page must not sit in a CDN.
 */

import type { Firestore } from "firebase-admin/firestore";
import { isOrderToken } from "@lailark/shared";

import { readLinkFor } from "../money/files";

export interface PublicOrderLine {
  /**
   * What the customer bought, in words they wrote or we wrote.
   *
   * `""` when we have none: a web line carries no description of its own, and
   * its product may since have been renamed to nothing or deleted from the
   * Products screen. The line then draws no description at all rather than
   * its URL slug (A214, M3.8 round 3). It still carries the quantity, the
   * unit price, the batch number and the jar numbers, so it stays honest and
   * readable, and nothing had to be invented to fill the gap: D63 approved
   * this page's words one by one and a stand-in noun would be undrafted copy.
   */
  readonly description: string;
  readonly qty: number;
  readonly unitPricePaise: number;
  /** The printed batch number, or null while the batch has none (D21c). */
  readonly batchNo: string | null;
  /** The jars that are actually theirs, once packing has written them. */
  readonly jarNumbers: readonly number[];
}

export interface PublicOrderDocument {
  readonly kind: string;
  readonly number: string;
  /** `"YYYY-MM-DD"` in Asia/Kolkata. */
  readonly issuedOn: string | null;
  readonly totalPaise: number;
  /** A short-lived link to the PDF, or null when there is no file yet. */
  readonly url: string | null;
}

export interface PublicOrderPayload {
  readonly order: {
    readonly number: string;
    readonly placedOnMillis: number | null;
    readonly lines: readonly PublicOrderLine[];
    readonly shippingFeePaise: number;
    readonly totalPaise: number;
    /** Where the parcel is going, as the customer gave it. */
    readonly delivery: {
      readonly name: string;
      readonly lines: readonly string[];
      readonly city: string;
      readonly state: string;
      readonly pincode: string;
    } | null;
  };
  readonly documents: readonly PublicOrderDocument[];
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function millisOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const stamp = value as { toMillis?: () => number } | null | undefined;
  if (stamp && typeof stamp.toMillis === "function") return stamp.toMillis();
  return null;
}

/**
 * One named string field off a set of documents in one collection, read in
 * one `getAll`. Two of these are needed per page and neither is on the order.
 *
 * **The batch number** (D21c): an order stores the batch's internal
 * reference, and the printed number is a field on the batch, so the page has
 * to look it up rather than assume one.
 *
 * **The product's name** (M3.8 round 2): a web order's line carries
 * `customDescription: null` and a `productSlug`, and the slug is a URL, not
 * a name. Without this the page said "prawns-and-dates" to somebody who
 * bought Prawns and dates.
 */
async function fieldFor(
  db: Firestore,
  collection: string,
  ids: readonly string[],
  field: string,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) return out;
  const snaps = await db.getAll(...unique.map((id) => db.collection(collection).doc(id)));
  for (const snap of snaps) {
    const value = snap.get(field);
    // Trimmed, not merely non-empty: a name of `"   "` is not a name, and it
    // used to pass this guard and render as a blank space where the pickle's
    // name belongs (M3.8 round 3). A document that is missing entirely never
    // reaches here with a string at all, so it lands on the same `null`.
    const text = typeof value === "string" ? value.trim() : "";
    out.set(snap.id, text === "" ? null : text);
  }
  return out;
}

/**
 * One order by its token, projected for the customer, or null when no order
 * carries that token. Null for a malformed token too, so a caller learns
 * nothing from the difference between "wrong shape" and "no such order".
 */
export async function readPublicOrder(
  db: Firestore,
  token: unknown,
): Promise<PublicOrderPayload | null> {
  if (!isOrderToken(token)) return null;

  const found = await db.collection("orders").where("token", "==", token).limit(1).get();
  const snap = found.docs[0];
  if (!snap) return null;

  const data = snap.data();
  const rawLines = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
  const [batchNos, productNames] = await Promise.all([
    fieldFor(
      db,
      "batches",
      rawLines.map((line) => str(line.batchRef)),
      "batchNo",
    ),
    fieldFor(
      db,
      "products",
      rawLines.map((line) => str(line.productSlug)),
      "name",
    ),
  ]);

  const lines: PublicOrderLine[] = rawLines.map((line) => ({
    // A counter sale's own description first (it is what was actually
    // written on the bill), then the product's name, and then nothing.
    //
    // The slug is never a third choice. It is a URL, and A214 says a customer
    // must never read one: Shefin can rename or delete a product on the
    // Products screen long after a batch has sold, and every customer holding
    // an `/o/<token>` link we sent with their bill would have read
    // "prawns-and-dates" from that moment on. A line with no description is
    // the honest answer, and the only one that invents no word (M3.8 round 3).
    description:
      str(line.customDescription).trim() || productNames.get(str(line.productSlug)) || "",
    qty: num(line.qty),
    unitPricePaise: num(line.unitPrice),
    batchNo: batchNos.get(str(line.batchRef)) ?? null,
    jarNumbers: Array.isArray(line.jarNumbers)
      ? (line.jarNumbers as unknown[]).filter((n): n is number => typeof n === "number")
      : [],
  }));

  const contact = (data.deliveryContact ?? null) as Record<string, unknown> | null;

  const documents = await readPublicDocuments(db, snap.id);

  return {
    order: {
      number: str(data.number) || snap.id,
      placedOnMillis: millisOf(data.createdAt),
      lines,
      shippingFeePaise: num(data.shippingFee),
      totalPaise: num(data.total),
      delivery:
        contact === null
          ? null
          : {
              name: str(contact.name),
              lines: Array.isArray(contact.lines)
                ? (contact.lines as unknown[]).map((l) => str(l))
                : [],
              city: str(contact.city),
              state: str(contact.state),
              pincode: str(contact.pincode),
            },
    },
    documents,
  };
}

/**
 * The bills and receipts on this order, newest first, each with a short-lived
 * link to its PDF when one has been rendered.
 *
 * A link that cannot be built is a `null` url rather than a failure: the page
 * still has the document's number and date, which is most of what somebody
 * wants, and a Storage hiccup should not blank the whole page.
 */
async function readPublicDocuments(
  db: Firestore,
  orderId: string,
): Promise<PublicOrderDocument[]> {
  const found = await db.collection("documents").where("orderId", "==", orderId).get();
  const rows = found.docs
    .map((doc) => ({ doc, at: millisOf(doc.get("issuedAt")) ?? 0 }))
    .sort((a, b) => b.at - a.at);

  const out: PublicOrderDocument[] = [];
  for (const { doc } of rows) {
    const pdfPath = doc.get("pdfPath");
    let url: string | null = null;
    if (typeof pdfPath === "string" && pdfPath !== "") {
      try {
        url = (await readLinkFor(pdfPath)).url;
      } catch {
        url = null;
      }
    }
    out.push({
      kind: str(doc.get("kind")),
      number: str(doc.get("number")) || doc.id,
      issuedOn: typeof doc.get("issuedOn") === "string" ? (doc.get("issuedOn") as string) : null,
      totalPaise: num(doc.get("total")),
      url,
    });
  }
  return out;
}
