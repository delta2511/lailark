import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { COPY } from "../copy";

/**
 * ASSUMED (M1.7): "offline" means the browser's own `online`/`offline`
 * window events, not a Firestore metadata listener. The task text calls a
 * `fromCache && !hasPendingWrites` doc-metadata check over-engineering for
 * this milestone, so the pill answers "can this device reach the network at
 * all", not "is this specific read live". Good enough for a weak-signal
 * kitchen; a truer signal can replace it later without moving the pill.
 */
export function OfflinePill(): JSX.Element | null {
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <p class="offline-pill" role="status" data-testid="offline-pill">
      {COPY.offline}
    </p>
  );
}
