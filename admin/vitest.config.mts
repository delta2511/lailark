import { defineConfig } from "vitest/config";

/**
 * Unit tests only: pure helpers under src/. The Playwright suite lives in
 * tests/ and is run by `npm test`, not by vitest.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
