#!/usr/bin/env node
// Tiny static server for admin/dist, used by the Playwright webServer.
// Mirrors the Hosting `admin` target: everything that is not a file falls
// back to index.html (the SPA rewrite in firebase.json).
// Not a new dependency: node:http is the platform.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// ADMIN_DIST lets the Playwright run serve its own emulator build (dist-test)
// without clobbering dist, which is what Hosting deploys.
const distDir = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  process.env.ADMIN_DIST || "dist",
);
const port = Number(process.env.PORT) || 4310;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
};

async function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const safe = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [join(distDir, safe), join(distDir, safe, "index.html")]) {
    try {
      const st = await stat(candidate);
      if (st.isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return join(distDir, "index.html");
}

const server = createServer(async (req, res) => {
  const filePath = await resolvePath(req.url ?? "/");
  try {
    const body = await readFile(filePath);
    const type = types[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`serve-dist listening on http://localhost:${port}`);
});
