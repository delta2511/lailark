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

/**
 * `null` hides the section entirely (a screen with no document open yet):
 * the batch detail always has one, but this keeps the hook safe for a screen
 * that opens on nothing selected.
 */
export function useTimeline(objectPath: string | null): TimelineState {
  const [state, setState] = useState<TimelineState>({
    items: [],
    loading: objectPath !== null,
    denied: false,
  });

  useEffect(() => {
    if (objectPath === null) {
      setState({ items: [], loading: false, denied: false });
      return undefined;
    }
    setState({ items: [], loading: true, denied: false });
    const q = query(
      collection(db, "audit"),
      where("object", "==", objectPath),
      orderBy("at", "desc"),
    );
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as TimelineEntry);
        setState({ items, loading: false, denied: false });
      },
      () => setState({ items: [], loading: false, denied: true }),
    );
  }, [objectPath]);

  return state;
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
