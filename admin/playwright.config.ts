import { defineConfig } from "@playwright/test";

/**
 * Port 4310: clear of the site's Playwright server (4300), of the emulator
 * ports (A10) and of the emulator hub's reserved 4400/4500.
 */
const PORT = 4310;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  // One worker: the tests share one Auth emulator, and signing in and out is
  // the thing under test.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "test-results",
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node scripts/serve-dist.mjs",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT), ADMIN_DIST: "dist-test" },
    timeout: 30_000,
  },
});
