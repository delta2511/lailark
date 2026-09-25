/**
 * The hold expiry sweep. Brief §6.1 step 6: "Hold lapses at 15 minutes. Jars
 * return to the count."
 *
 * **The jars are already back before this runs.** Brief §9.3: "A hold counts
 * only while its expiry is in the future, so a lapsed hold frees the jar even
 * if the clean-up job is late." `liveHeldJars` skips a lapsed entry, so every
 * count in the system, the site's included, is already right. The sweep is
 * tidying, not arithmetic, and that is what makes it safe to run late, twice,
 * or not at all:
 *
 *  - it drops the dead keys out of `batches/{ref}.heldJars`, so the map does
 *    not grow forever on a busy batch; and
 *  - it moves the order those keys belonged to from `held` to `expired`, so
 *    Orders (M3.9) shows an abandoned checkout as abandoned rather than as
 *    something somebody is still paying for.
 *
 * **Idempotent, because the dead keys really go.** It only ever touches a
 * hold whose expiry has passed and an order in exactly `held` or
 * `awaitingPayment`, and both writes are in the same transaction. Run it
 * again a second later and it finds nothing to do.
 *
 * That last sentence was **false** in the first cut of this file (caught in
 * review, M3.5), and the bug is worth naming so nobody reintroduces it. The
 * write was `set({ merge: true })` with the whole surviving `heldJars` map,
 * and Firestore merges a map field **leaf by leaf**: a key left out of the
 * map is not removed, it is kept. So a lapsed hold was only ever dropped
 * when it was the last hold on the batch and the map came out `{}`, which
 * Firestore writes as a whole value. With any other live hold beside it the
 * dead key survived, the sweep reported it dropped every five minutes
 * forever, and `heldJars` grew without bound. No jar was ever oversold by
 * it, because `liveHeldJars` filters on expiry and the counts stayed right,
 * but the map and the audit trail did not. The fix is `update`, which
 * replaces the field as a whole, safe because the map is read inside the
 * same transaction that writes it.
 *
 * **Never touches a paid order.** The one case worth being careful about is
 * brief §9.3's rare one: a payment confirms just after its hold lapsed. The
 * order is moved only while its payment is still `created`, so a webhook that
 * got in first (M3.6, which sets `paidWaiting` and `captured` in its own
 * transaction) is never overwritten by this.
 */

import {
  FieldValue,
  type Firestore,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { writeAudit } from "../audit/write";
import { BATCHES, heldJarsWithCustomerFrom } from "../batches/store";
import { getAdminApp } from "../lib/admin";
import { DEFAULT_MAX_INSTANCES, REGION } from "../lib/options";
import { ORDERS } from "./store";

const ACTOR = "sweep";

/** The two order states a lapsed hold may be sitting in. Brief §9.1. */
const SWEEPABLE_ORDER_STATES = ["held", "awaitingPayment"];

/** How many batches one run will look at. A home kitchen has a handful. */
const MAX_BATCHES_PER_RUN = 200;

export interface SweepReport {
  readonly batchesTouched: number;
  readonly holdsDropped: number;
  readonly jarsReturned: number;
  readonly ordersExpired: number;
}

/**
 * One pass over every batch carrying a `heldJars` entry.
 *
 * Exported and taking its clock as an argument so the emulator test can run
 * it directly with a fake `now`, rather than waiting a quarter of an hour.
 */
export async function sweepExpiredHolds(
  db: Firestore,
  nowMillis: number = Date.now(),
): Promise<SweepReport> {
  // Every batch, filtered in memory: there are a handful, and a query on a
  // map field's inner expiry is not something Firestore can index (A82's
  // reasoning, for the same reason).
  const batches = await db.collection(BATCHES).limit(MAX_BATCHES_PER_RUN).get();

  let batchesTouched = 0;
  let holdsDropped = 0;
  let jarsReturned = 0;
  let ordersExpired = 0;

  for (const doc of batches.docs) {
    const held = heldJarsWithCustomerFrom(doc);
    const lapsed = Object.entries(held).filter(([, hold]) => hold.expiresAt <= nowMillis);
    if (lapsed.length === 0) continue;

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.collection(BATCHES).doc(doc.id));
      if (!snap.exists) return { dropped: 0, jars: 0, expired: 0 };

      const current = heldJarsWithCustomerFrom(snap);
      const stillLapsed = Object.entries(current).filter(
        ([, hold]) => hold.expiresAt <= nowMillis,
      );
      if (stillLapsed.length === 0) return { dropped: 0, jars: 0, expired: 0 };

      // Every read before any write: the Node SDK refuses the other order.
      const orderSnaps = await Promise.all(
        stillLapsed.map(([orderId]) => tx.get(db.collection(ORDERS).doc(orderId))),
      );

      const nextHeldJars: Record<
        string,
        { qty: number; expiresAt: Timestamp; customerPhone: string }
      > = {};
      for (const [orderId, hold] of Object.entries(current)) {
        if (hold.expiresAt <= nowMillis) continue;
        nextHeldJars[orderId] = {
          qty: hold.qty,
          expiresAt: Timestamp.fromMillis(hold.expiresAt),
          customerPhone: hold.customerPhone ?? "",
        };
      }

      const patch = { heldJars: nextHeldJars };
      // `update`, never `set({ merge: true })`: see the note at the top of
      // this file. A merging write would keep every key this map omits,
      // which is exactly the keys this sweep exists to remove.
      tx.update(db.collection(BATCHES).doc(doc.id), {
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: ACTOR,
      });
      writeAudit(tx, db, {
        object: `${BATCHES}/${doc.id}`,
        action: "holdExpired",
        patch,
        beforeSnap: snap,
        by: ACTOR,
      });

      let expired = 0;
      orderSnaps.forEach((orderSnap, index) => {
        if (!orderSnap.exists) return;
        const state = String(orderSnap.get("state") ?? "");
        const paymentStatus = String((orderSnap.get("payment") ?? {})?.status ?? "");
        // Brief §9.3's rare case: a payment that confirmed just after its
        // hold lapsed has already moved the order on, and this must not
        // walk over it.
        if (!SWEEPABLE_ORDER_STATES.includes(state)) return;
        if (paymentStatus !== "" && paymentStatus !== "created") return;

        // A merging set is right here: this patch omits no key of anything,
        // it sets two scalars on an order that has many more.
        const orderPatch = { state: "expired", holdExpiresAt: null };
        tx.set(
          db.collection(ORDERS).doc(stillLapsed[index][0]),
          { ...orderPatch, updatedAt: FieldValue.serverTimestamp(), updatedBy: ACTOR },
          { merge: true },
        );
        writeAudit(tx, db, {
          object: `${ORDERS}/${stillLapsed[index][0]}`,
          action: "holdExpired",
          patch: orderPatch,
          beforeSnap: orderSnap,
          by: ACTOR,
        });
        expired += 1;
      });

      return {
        dropped: stillLapsed.length,
        jars: stillLapsed.reduce((sum, [, hold]) => sum + hold.qty, 0),
        expired,
      };
    });

    if (outcome.dropped > 0) {
      batchesTouched += 1;
      holdsDropped += outcome.dropped;
      jarsReturned += outcome.jars;
      ordersExpired += outcome.expired;
    }
  }

  return { batchesTouched, holdsDropped, jarsReturned, ordersExpired };
}

/**
 * Every five minutes, which is a third of a fifteen-minute hold: often enough
 * that Orders never shows an abandoned checkout as live for long, and cheap
 * enough that it costs a handful of reads when there is nothing to do.
 */
export const sweepHolds = onSchedule(
  {
    region: REGION,
    maxInstances: DEFAULT_MAX_INSTANCES,
    schedule: "every 5 minutes",
    timeZone: "Asia/Kolkata",
    retryCount: 0,
  },
  async () => {
    const report = await sweepExpiredHolds(getFirestore(getAdminApp()));
    if (report.holdsDropped > 0) {
      console.log("sweepHolds", report);
    }
  },
);
