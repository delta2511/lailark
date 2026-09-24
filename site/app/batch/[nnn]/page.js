import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Header, Footer } from "../../ds/PageShell";
import BatchContent from "./BatchContent";
import { batchDescription, batchTitle } from "../../../lib/batch";

// M3.4: the record page. `/batch/<nnn>` exists only from bottling and is
// always a record (D21c); there is no open-batch view on this route. The
// batch's story and photos go here (D47); the Legal Metrology block, the
// price and the buy button stay on `/pickles/<slug>`. One JSON file per
// batch under content/batches/, so a new batch is a new file and this
// template never changes. The content markup lives in ./BatchContent.js,
// which takes a batch object directly and has no dependency on the shared
// design system's JSX files, so it can be rendered from a fixture batch in
// a plain `node --test` run (tests-unit/batch.test.mjs) to prove the
// template is generic, without a second Next build.

const CONTENT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "content",
  "batches"
);

function listBatchNumbers() {
  return readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function loadBatch(nnn) {
  const raw = readFileSync(join(CONTENT_DIR, `${nnn}.json`), "utf8");
  return JSON.parse(raw);
}

export function generateStaticParams() {
  return listBatchNumbers().map((nnn) => ({ nnn }));
}

export async function generateMetadata({ params }) {
  const { nnn } = await params;
  let batch;
  try {
    batch = loadBatch(nnn);
  } catch {
    return {};
  }
  return {
    title: batchTitle(batch),
    description: batchDescription(batch),
  };
}

export default async function BatchPage({ params }) {
  const { nnn } = await params;
  let batch;
  try {
    batch = loadBatch(nnn);
  } catch {
    return null;
  }
  return (
    <div className="ds-shell">
      <Header />
      <BatchContent batch={batch} />
      <Footer />
    </div>
  );
}
