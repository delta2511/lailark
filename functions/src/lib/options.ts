/**
 * Shared Cloud Functions options.
 *
 * Every export in this codebase runs in a single region and sets an explicit
 * maxInstances (see brief §22 / hard rules): no export may rely on the
 * platform default of unbounded scale-out.
 */
import { setGlobalOptions } from "firebase-functions/v2";

/** Region for every server-side function (brief §19.1, ST3). */
export const REGION = "asia-south1" as const;

/**
 * Default ceiling on concurrent instances for a function that has no
 * reason to need more. Individual functions may pass a larger value when
 * their task explicitly calls for it; every export must set one.
 */
export const DEFAULT_MAX_INSTANCES = 3;

/**
 * Belt and braces: every export already passes its own { region, maxInstances }
 * (see api/index.ts, auth/setRole.ts), but this sets the platform-wide default
 * too, so a future export that forgets its own options is still capped and
 * still in asia-south1 rather than silently getting the platform default of
 * unbounded scale-out in us-central1.
 *
 * This module must be the first thing index.ts imports (see its comment) so
 * this call runs before any function module below it is evaluated.
 */
setGlobalOptions({ region: REGION, maxInstances: DEFAULT_MAX_INSTANCES });
