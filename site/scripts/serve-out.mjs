#!/usr/bin/env node
// Tiny static file server for site/out, used by the Playwright webServer.
// Not a new dependency: node:http is the platform.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "out");
const port = Number(process.env.PORT) || 4300;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

// The Hosting rewrites this server has to mirror, or a Playwright test would
// be testing a shape the deployed site does not have. Keep in step with the
// `rewrites` block of firebase.json; `tests-unit/order.test.mjs` asserts the
// two agree.
const REWRITES = [
  // M3.8, brief §5: one static file serves every `/o/<token>`.
  { prefix: "/o/", file: "o.html" },
];

async function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const safe = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  for (const rule of REWRITES) {
    if (safe.startsWith(rule.prefix)) return join(outDir, rule.file);
  }
  const candidates = [
    join(outDir, safe),
    join(outDir, safe, "index.html"),
    join(outDir, `${safe}.html`),
  ];
  for (const candidate of candidates) {
    try {
      const st = await stat(candidate);
      if (st.isFile()) return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const filePath = await resolvePath(req.url ?? "/");
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  try {
    const body = await readFile(filePath);
    const type = types[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error");
  }
});

server.listen(port, () => {
  console.log(`serve-out listening on http://localhost:${port}`);
});
