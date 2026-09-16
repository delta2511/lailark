/**
 * Reads the active Firebase/GCP project id from the runtime environment.
 *
 * The Cloud Functions runtime (and the emulator) sets GCLOUD_PROJECT. Older
 * runtimes only set FIREBASE_CONFIG (a JSON blob containing projectId), so
 * that is used as a fallback. Falls back to "unknown" rather than throwing,
 * since this is used in a health check that should stay up even if the
 * environment is unexpectedly bare.
 */
export function getProjectId(): string {
  const direct = process.env.GCLOUD_PROJECT;
  if (direct) {
    return direct;
  }

  const configRaw = process.env.FIREBASE_CONFIG;
  if (configRaw) {
    try {
      const parsed = JSON.parse(configRaw) as { projectId?: string };
      if (parsed.projectId) {
        return parsed.projectId;
      }
    } catch {
      // Malformed FIREBASE_CONFIG: fall through to "unknown".
    }
  }

  return "unknown";
}
