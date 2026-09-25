/**
 * **Decision D32: at launch every customer message is sent by hand.**
 *
 * "Where the admin would send, it shows the drafted text from the brief or
 * Settings with a prefilled `wa.me` link per recipient, and the sender ticks
 * it sent." So the moment the Owner says yes to a batch message, the approval
 * grows a list: one row per customer who has paid into that batch, each with
 * the number, the jars they hold, and a `sentAt` that is null until somebody
 * ticks it.
 *
 * Three things this is careful about.
 *
 * **Nothing is sent here, and nothing can be.** The list is a list. It holds
 * no channel, no template id and no send call, and the approval's own
 * `sentAt` is untouched: that field is M5's, and it stays null through all of
 * this. What a tick records is that a person sent a message from their own
 * phone (CLAUDE.md §3).
 *
 * **The list is built once.** It is filled in on the first write that finds
 * the approval answered yes and no list on it, and never rebuilt, so a
 * customer who pays after the Owner said yes does not silently appear in a
 * list somebody is halfway through working down, and a tick is never undone
 * by a rebuild.
 *
 * **Who counts as paid is decided here, narrowly.** It is deliberately *not*
 * `ordersInBatch`'s predicate, which answers yes to a capture that sold
 * nothing (A203, left unfixed by D62): that counter is too loose, and a list
 * built on it would send "half the batch is paid for" to somebody whose
 * payment was refused and refunded. The test here is the order's own state
 * having reached a paid state, or `paidAt` being set, which only the path
 * that really completes a sale writes.
 */

import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { ORDER_STATES_PAID } from "@lailark/shared";

import { ORDERS } from "../batches/store";

/** One row of the sending list, as it is written to the approval. */
export interface PlannedRecipient {
  readonly phone: string;
  readonly name: string;
  readonly jars: number;
  readonly sentAt: null;
}

/**
 * Whether this order really took jars, as narrowly as it can be asked.
 *
 * `paidAt` is written by the path that completes a sale and deliberately not
 * by `writePaymentOnly`, which records the money on a capture that sold
 * nothing. `ORDER_STATES_PAID` is the order's own run through brief §9.1. An
 * order sitting in `held` with `payment.status: "captured"` is exactly the
 * A203 case, and it is **not** one of these: the money arrived, no jar moved,
 * and the Owner has a concern about it. Messaging that customer "half the
 * batch is paid for" would be wrong.
 */
export function orderTookJars(doc: DocumentSnapshot): boolean {
  const state = String(doc.get("state") ?? "");
  if (state === "voided") return false;
  if ((ORDER_STATES_PAID as readonly string[]).includes(state)) return true;
  return doc.get("paidAt") !== undefined && doc.get("paidAt") !== null;
}

/** The jars this order holds in this batch. Lines name the batch by reference. */
function jarsInBatch(doc: DocumentSnapshot, batchRef: string): number {
  const lines = doc.get("lines");
  if (!Array.isArray(lines)) return 0;
  let total = 0;
  for (const line of lines as Array<Record<string, unknown>>) {
    if (line?.batchRef === batchRef && typeof line?.qty === "number") total += line.qty;
  }
  return total;
}

/**
 * One row per customer who has paid into this batch, sorted by number so the
 * list reads the same way twice. A customer with two orders in the batch is
 * one row with their jars added up: they get one message, not two.
 */
export function planRecipients(
  docs: readonly DocumentSnapshot[],
  batchRef: string,
  names: ReadonlyMap<string, string>,
): PlannedRecipient[] {
  const byPhone = new Map<string, number>();
  for (const doc of docs) {
    if (!orderTookJars(doc)) continue;
    const phone = doc.get("customerPhone");
    if (typeof phone !== "string" || phone === "") continue;
    byPhone.set(phone, (byPhone.get(phone) ?? 0) + jarsInBatch(doc, batchRef));
  }
  return [...byPhone.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([phone, jars]) => ({ phone, name: names.get(phone) ?? "", jars, sentAt: null }));
}

/** Reads the batch's orders and the customers behind them, in one transaction. */
export async function readRecipients(
  tx: Transaction,
  db: Firestore,
  batchRef: string,
): Promise<PlannedRecipient[]> {
  const found = await tx.get(db.collection(ORDERS).where("batchRefs", "array-contains", batchRef));
  const phones = [
    ...new Set(
      found.docs
        .filter((doc) => orderTookJars(doc))
        .map((doc) => doc.get("customerPhone"))
        .filter((phone): phone is string => typeof phone === "string" && phone !== ""),
    ),
  ];
  const names = new Map<string, string>();
  if (phones.length > 0) {
    const snaps = await tx.getAll(
      ...phones.map((phone) => db.collection("customers").doc(phone)),
    );
    for (const snap of snaps) {
      const name = snap.get("name");
      if (typeof name === "string" && name !== "") names.set(snap.id, name);
    }
  }
  return planRecipients(found.docs, batchRef, names);
}
