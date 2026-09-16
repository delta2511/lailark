// Stamps the module-format marker into each build output directory, so Node
// reads dist/cjs/*.js as CommonJS and dist/esm/*.js as ESM regardless of the
// package's own "type": "module". Run by `npm run build` after both tsc passes.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

for (const [dir, type] of [
  ["cjs", "commonjs"],
  ["esm", "module"],
]) {
  const target = join(root, "dist", dir);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "package.json"), `${JSON.stringify({ type }, null, 2)}\n`, "utf8");
}
