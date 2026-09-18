#!/usr/bin/env node
/**
 * Generates the PWA icons from the lark mark.
 *
 * No new dependency: the rasteriser is the headless Chromium that Playwright
 * already installs for the tests. Run it by hand with `npm run icons -w
 * @lailark/admin` when the mark changes; the PNGs it writes are committed.
 *
 * Ink mark on a Paper ground (Flow section 10). The maskable icon keeps the
 * mark inside the 80% safe circle so Android can crop it to any shape.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const markPath = join(repoRoot, "site", "public", "assets", "lark.svg");
const iconsDir = join(here, "..", "public", "icons");

const INK = "#17150F";
const PAPER = "#FAF8F4";

const targets = [
  { file: "icon-192.png", size: 192, inset: 0.14, radius: 0 },
  { file: "icon-512.png", size: 512, inset: 0.14, radius: 0 },
  { file: "maskable-512.png", size: 512, inset: 0.26, radius: 0 },
  { file: "apple-touch-icon-180.png", size: 180, inset: 0.16, radius: 0 },
];

function page(mark, size, inset) {
  const pad = Math.round(size * inset);
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${PAPER};}
    .box{width:${size}px;height:${size}px;background:${PAPER};display:flex;
         align-items:center;justify-content:center;color:${INK};}
    .box svg{width:${size - pad * 2}px;height:${size - pad * 2}px;display:block;}
  </style><div class="box">${mark}</div>`;
}

const mark = await readFile(markPath, "utf8");
await mkdir(iconsDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const { file, size, inset } of targets) {
    const tab = await browser.newPage({ viewport: { width: size, height: size } });
    await tab.setContent(page(mark, size, inset));
    const png = await tab.locator(".box").screenshot({ omitBackground: false });
    const out = file === "apple-touch-icon-180.png" ? join(iconsDir, "..", file) : join(iconsDir, file);
    await writeFile(out, png);
    console.log(`wrote ${out} (${size}x${size}, ${png.length} bytes)`);
    await tab.close();
  }
} finally {
  await browser.close();
}
