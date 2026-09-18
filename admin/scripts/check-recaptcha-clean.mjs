#!/usr/bin/env node
/**
 * M1.12 manual check: the real staging build, on localhost, with real
 * reCAPTCHA available, up to but never past a sign-in.
 *
 * NO SMS IS SENT. It loads the page and looks at the DOM. It never presses
 * Send code, so signInWithPhoneNumber is never called.
 *
 * What it is for: the Playwright suite runs against the Auth emulator, which
 * uses a mock reCAPTCHA and never loads Google's widget, so nothing in the
 * suite can see the nodes the real widget leaves on document.body. This looks
 * at the built staging bundle instead and asserts the page starts clean: no
 * loose reCAPTCHA container over the page, the host div present and out of
 * layout, and the phone box enabled, un-capped and actually typeable.
 *
 * Run it from admin/:
 *   VITE_FIREBASE_PROJECT=tree-quiz-74e04 npm run build -w @lailark/admin
 *   node scripts/check-recaptcha-clean.mjs
 *   npm run build -w @lailark/admin    # put dist back to the production build
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4397;

const server = spawn("node", [join(ADMIN, "scripts", "serve-dist.mjs")], {
  cwd: ADMIN,
  env: { ...process.env, PORT: String(PORT), ADMIN_DIST: "dist" },
  stdio: "ignore",
});

const failures = [];
const check = (ok, line) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${line}`);
  if (!ok) failures.push(line);
};

try {
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const noisy = [];
  page.on("pageerror", (error) => noisy.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") noisy.push(`console: ${message.text()}`);
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const host = document.getElementById("recaptcha");
    const input = document.getElementById("phone");
    const rect = input?.getBoundingClientRect();
    const hit = rect
      ? document.elementFromPoint(
          Math.round(rect.x + rect.width / 2),
          Math.round(rect.y + rect.height / 2),
        )
      : null;
    const hostRect = host?.getBoundingClientRect();
    return {
      loose: [...document.body.children].filter(
        (el) => !el.id && !el.className && el.querySelector("iframe"),
      ).length,
      hostPresent: Boolean(host),
      hostArea: hostRect ? hostRect.width * hostRect.height : -1,
      inputPresent: Boolean(input),
      maxlength: input?.getAttribute("maxlength") ?? null,
      disabled: input instanceof HTMLInputElement ? input.disabled : true,
      hitIsInput: hit === input,
    };
  });

  check(state.loose === 0, `no loose reCAPTCHA container on body (found ${state.loose})`);
  check(state.hostPresent, "the reCAPTCHA host div is mounted");
  check(state.hostArea === 0, `the host takes no space (area ${state.hostArea})`);
  check(state.inputPresent, "the phone box is on the page");
  check(state.maxlength === null, `the phone box has no maxlength (got ${state.maxlength})`);
  check(!state.disabled, "the phone box is enabled");
  check(state.hitIsInput, "the middle of the phone box is the phone box");

  await page.click("#phone");
  await page.locator("#phone").pressSequentially("9446587027");
  const typed = await page.inputValue("#phone");
  check(typed === "9446587027", `the phone box takes keystrokes (read back ${JSON.stringify(typed)})`);
  check(noisy.length === 0, `nothing shouted on load (${noisy.join(" | ") || "silent"})`);

  await browser.close();
} finally {
  server.kill();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll clear. No code was sent, no SMS was billed.");
