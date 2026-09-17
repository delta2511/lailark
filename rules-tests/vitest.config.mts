import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // One emulator, one shared database. Every file clears Firestore and
    // Storage between tests, so two files running at once would wipe each
    // other's seed data. Run them one at a time.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
