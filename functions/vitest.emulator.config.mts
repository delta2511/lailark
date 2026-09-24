import { defineConfig } from "vitest/config";

/**
 * The tests that need the emulator suite. Run by `npm test` inside
 * `firebase emulators:exec`, never on their own: without Firestore, Auth and
 * Functions listening they fail at the first call rather than passing
 * vacuously.
 *
 * One emulator, one database, and every file clears Firestore between tests,
 * so the files run one at a time. Triggers are delivered out of band, so the
 * timeouts are generous.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
