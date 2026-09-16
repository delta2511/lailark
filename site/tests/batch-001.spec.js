import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const recordPath = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "public",
  "batch",
  "001",
  "index.html"
);

test("/batch/001 is byte-identical to the printed-jar record and stays local", async ({
  page,
  baseURL,
}) => {
  const record = await readFile(recordPath);

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const foreignRequests = [];
  const localOrigin = new URL(baseURL).origin;
  page.on("request", (req) => {
    const origin = new URL(req.url()).origin;
    if (origin !== localOrigin) foreignRequests.push(req.url());
  });

  const response = await page.goto("/batch/001");
  expect(response.status()).toBe(200);
  const served = await response.body();

  expect(served.equals(record)).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(foreignRequests).toEqual([]);
});
