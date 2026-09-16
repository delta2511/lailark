/**
 * Shared Cloud Functions options.
 *
 * Every export in this codebase runs in a single region and sets an explicit
 * maxInstances (see brief §22 / hard rules): no export may rely on the
 * platform default of unbounded scale-out.
 */

/** Region for every server-side function (brief §19.1, ST3). */
export const REGION = "asia-south1" as const;

/**
 * Default ceiling on concurrent instances for a function that has no
 * reason to need more. Individual functions may pass a larger value when
 * their task explicitly calls for it; every export must set one.
 */
export const DEFAULT_MAX_INSTANCES = 3;
