// The "oil" motion (Flow §10): a gradient moving on a 30 second cycle,
// behind the hero only. Purely atmospheric, so it is aria-hidden and
// carries no content. Uses only palette colours already defined
// (paper, hairline): there is no fifth colour.
export default function Oil({ className }) {
  return <div className={["ds-oil", className].filter(Boolean).join(" ")} aria-hidden="true" />;
}
