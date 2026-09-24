/**
 * The timeline: brief section 11, "every object shows its timeline,
 * including what the agent did", and section 17.1, "Timeline" on the batch,
 * order and customer screens (17.4, 17.5, 17.9). M2.6.
 *
 * Reads `audit/{id}` (brief 18.1) for one document, newest first. It takes a
 * document path rather than a batch, an order or a customer, so it is the
 * same component wherever it is mounted:
 *
 * - **Batch** (this task): `<Timeline objectPath={`batches/${batch.id}`} />`.
 * - **Order** (M2.8 on): orders have no screen yet. Whichever task builds
 *   the order detail passes `orders/{id}` and needs nothing else from this
 *   file: every write M2.8's `createCounterSale` and later packing/shipping
 *   callables make must go through `functions/src/audit/write.ts` the way
 *   `transitionBatch` and `approveBatchFull` already do, or the order screen
 *   would show an empty timeline for a document with real history.
 * - **Customer** (M2.8 on, `customers/{phone}` is created there too): the
 *   same, for the direct client writes `firestore.rules` already lets both
 *   staff roles make (a name fixed, an address changed) once those writes
 *   are routed through `writeWithAudit` instead of a bare `setDoc`.
 *
 * Read only: brief 17.1 puts undo on the toast that appears right after a
 * write, for 8 seconds, not as a standing control on every past entry in a
 * list. There is nothing to click here.
 *
 * The query below filters on `object` and orders by a different field
 * (`at`), which Cloud Firestore (unlike the emulator, which lets it through)
 * refuses without a composite index: `firestore.indexes.json` carries one,
 * `object` ascending then `at` descending.
 *
 * M2.14: a second query alongside it picks up every entry `objectPath` owns
 * at any depth (`batches/{ref}/lines/{id}` today, the per-ingredient
 * actuals): without it, editing a cost on the Cooking screen wrote a real
 * `audit/{id}` entry (`saveBatchLine`, `admin/src/batches/data.ts`) that the
 * batch's own Timeline never showed, because its `object` is the line's
 * path, not the batch's. That entry's own undo landed correctly either way,
 * since undo reads the entry back by id rather than through this component
 * (see "read only" above), but the person watching the batch's timeline
 * never saw either the edit or the undo, which is most of what M2.14 was
 * reported against. A prefix range on `object` needs no new composite index
 * (a single-field range is covered by Firestore's automatic indexing), so
 * nothing in `firestore.indexes.json` changes for it. See `useTimeline`
 * below for the sentinel that bounds the range and why it must be written
 * as a visible escape, not the raw character.
 */
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { TIMELINE } from "../copy";
import { db } from "../firebase";

export interface TimelineEntry {
  readonly id: string;
  readonly object: string;
  readonly action: string;
  readonly fields: readonly string[];
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
  readonly by: string;
  readonly at: { readonly seconds: number; readonly nanoseconds: number } | null;
  readonly undoes: string | null;
  readonly source: "client" | "function";
}

interface TimelineState {
  readonly items: readonly TimelineEntry[];
  readonly loading: boolean;
  readonly denied: boolean;
}

function toEntry(d: { readonly id: string; data: () => unknown }): TimelineEntry {
  return { id: d.id, ...(d.data() as object) } as TimelineEntry;
}

/**
 * Newest first, by `at`, with entries sharing a timestamp broken by
 * nanoseconds. `at` is `null` for the short window between a write landing
 * locally and the server echoing back what its `serverTimestamp()` actually
 * resolved to (`onSnapshot` delivers the pending write with the field
 * unset). That window is always the newest thing the client knows about, in
 * both queries `useTimeline` merges here: sorting it first reproduces what
 * `ownQuery`'s own `orderBy("at", "desc")` already does for a pending write
 * server side. Sorting it last (`?? 0`, read as the Unix epoch) put the
 * entry for an edit someone had just made at the bottom of the list for the
 * round trip's ~50-150ms on loopback, several hundred on a phone, and made
 * it visibly jump to the top the moment the timestamp resolved.
 *
 * Exported for `Timeline.test.ts`, which sorts a small mixed list directly
 * rather than standing up the emulator to prove this one ordering rule.
 */
export function byAtDesc(a: TimelineEntry, b: TimelineEntry): number {
  if (a.at === null || b.at === null) {
    if (a.at === null && b.at === null) return 0; // neither resolved yet: no real order between them
    return a.at === null ? -1 : 1; // the unresolved one sorts first
  }
  if (a.at.seconds !== b.at.seconds) return b.at.seconds - a.at.seconds;
  return b.at.nanoseconds - a.at.nanoseconds;
}

/**
 * `null` hides the section entirely (a screen with no document open yet):
 * the batch detail always has one, but this keeps the hook safe for a screen
 * that opens on nothing selected.
 */
export function useTimeline(objectPath: string | null): TimelineState {
  const [own, setOwn] = useState<TimelineState>({
    items: [],
    loading: objectPath !== null,
    denied: false,
  });
  const [children, setChildren] = useState<TimelineState>({
    items: [],
    loading: objectPath !== null,
    denied: false,
  });

  useEffect(() => {
    if (objectPath === null) {
      setOwn({ items: [], loading: false, denied: false });
      setChildren({ items: [], loading: false, denied: false });
      return undefined;
    }
    setOwn({ items: [], loading: true, denied: false });
    setChildren({ items: [], loading: true, denied: false });

    const ownQuery = query(collection(db, "audit"), where("object", "==", objectPath), orderBy("at", "desc"));
    const unsubOwn = onSnapshot(
      ownQuery,
      (snap) => setOwn({ items: snap.docs.map(toEntry), loading: false, denied: false }),
      () => setOwn({ items: [], loading: false, denied: true }),
    );

    // Unbounded, like `ownQuery` above: neither carries a `limit`. A home
    // kitchen's whole history on one batch, across every field it and its
    // lines ever had edited, is at most a few dozen entries (M2.13's own
    // round trips on batch 001 did not get near that), so paging would be
    // solving a problem this app does not have yet; adding one, if a batch
    // or an order ever does grow a long history, is `limit(n)` on both
    // queries and a "load more" the merge below does not need to change to
    // support (it just sorts whatever each side handed it).
    //
    // Everything this object owns, at any depth under it: a batch's
    // `lines/{id}` (the per-ingredient actuals, M2.14) today, and a future
    // audited write under `updates/{id}` or `writeOffs/{id}` tomorrow, all
    // belong on the batch's own timeline the same way brief section 11 means
    // "every object shows its timeline, including what the agent did" for
    // the object as a whole, not only writes to its own document. Not
    // ordered by `at` in the query itself (a range filter on `object` would
    // need `object` as the first `orderBy` too), so the two result sets are
    // merged and sorted client side below.
    //
    // `PREFIX_SENTINEL` is the Firestore idiom for "starts with `prefix`":
    // U+F8FF is the last codepoint in the Basic Multilingual Plane's
    // Private Use Area, higher than any character that appears in a
    // Firestore document path segment this app writes (`object` is always a
    // slash-joined run of collection ids and either a hand-written ref, a
    // hyphenated slug or a Firestore auto id, all plain ASCII), so every
    // `object` that starts with `prefix` sorts below `prefix + PREFIX_SENTINEL`
    // and nothing else can. Written as the explicit escape, not the raw
    // character, so the sentinel is visible in this file and in a diff
    // rather than an invisible byte nobody reviewing the change can see (a
    // literal U+F8FF here once read as an empty, always-false range on a
    // quick look, which is exactly the failure mode this comment exists to
    // rule out).
    const PREFIX_SENTINEL = "\uf8ff";
    const prefix = `${objectPath}/`;
    const childQuery = query(
      collection(db, "audit"),
      where("object", ">=", prefix),
      where("object", "<", `${prefix}${PREFIX_SENTINEL}`),
    );
    const unsubChildren = onSnapshot(
      childQuery,
      (snap) => setChildren({ items: snap.docs.map(toEntry), loading: false, denied: false }),
      () => setChildren({ items: [], loading: false, denied: true }),
    );

    return () => {
      unsubOwn();
      unsubChildren();
    };
  }, [objectPath]);

  if (own.denied || children.denied) return { items: [], loading: false, denied: true };
  if (own.loading || children.loading) return { items: [], loading: true, denied: false };
  return { items: [...own.items, ...children.items].sort(byAtDesc), loading: false, denied: false };
}

/** `users/{uid}` names, resolved once per uid seen and kept for the session. */
const nameCache = new Map<string, string>();

function useNamesFor(uids: readonly string[]): Record<string, string> {
  const [, setTick] = useState(0);
  const key = uids.join(",");

  useEffect(() => {
    let cancelled = false;
    const unresolved = uids.filter((uid) => uid !== "system" && !nameCache.has(uid));
    if (unresolved.length === 0) return undefined;

    void (async () => {
      for (const uid of unresolved) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          const name = snap.exists() ? (snap.data() as { name?: unknown }).name : undefined;
          nameCache.set(uid, typeof name === "string" && name.trim() !== "" ? name : uid);
        } catch {
          nameCache.set(uid, uid);
        }
      }
      if (!cancelled) setTick((t) => t + 1);
    })();

    return () => {
      cancelled = true;
    };
    // `key` is `uids` flattened to one stable string, which is what this
    // effect actually depends on: re-running it once per render of the same
    // list would refetch names it already has.
  }, [key]);

  const out: Record<string, string> = {};
  for (const uid of uids) out[uid] = uid === "system" ? TIMELINE.system : (nameCache.get(uid) ?? uid);
  return out;
}

function formatWhen(at: TimelineEntry["at"]): string {
  if (at === null) return "";
  try {
    return new Date(at.seconds * 1000).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

/** Field names as a screen shows them: no code-y `camelCase`. */
function humaniseField(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return (spaced.charAt(0).toLowerCase() + spaced.slice(1)).trim();
}

function describeEntry(entry: TimelineEntry): string {
  const fields = entry.fields.length > 0 ? entry.fields.map(humaniseField).join(", ") : "";
  if (entry.undoes !== null) {
    return fields === "" ? TIMELINE.actionUndo : TIMELINE.undidLine(fields);
  }
  if (entry.action === "create") return TIMELINE.createdLine;
  return fields === "" ? TIMELINE.actionUpdate : TIMELINE.changedFields(fields);
}

interface Props {
  /** The document this timeline is for, e.g. `"batches/b-7f3a2c"`. */
  readonly objectPath: string;
}

export function Timeline({ objectPath }: Props): JSX.Element {
  const { items, loading, denied } = useTimeline(objectPath);
  const names = useNamesFor(items.map((e) => e.by));

  return (
    <div data-testid="timeline">
      <p class="section-heading">{TIMELINE.heading}</p>
      {loading ? <p data-testid="timeline-loading">{TIMELINE.loading}</p> : null}
      {denied ? <p data-testid="timeline-denied">{TIMELINE.readDenied}</p> : null}
      {!loading && !denied && items.length === 0 ? (
        <p data-testid="timeline-empty">{TIMELINE.empty}</p>
      ) : null}
      {!loading && !denied && items.length > 0 ? (
        <ul class="timeline-list" data-testid="timeline-list">
          {items.map((entry) => (
            <li key={entry.id} class="timeline-entry" data-testid={`timeline-entry-${entry.id}`}>
              <p class="timeline-line" data-testid="timeline-line">
                {describeEntry(entry)}
              </p>
              <p class="timeline-meta" data-testid="timeline-meta">
                {TIMELINE.by(names[entry.by] ?? entry.by)}
                {entry.at !== null ? ` · ${formatWhen(entry.at)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
