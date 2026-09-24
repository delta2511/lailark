// The jar-count marks primitive (Flow §10, "the count").
// Jars are drawn as marks rather than written as a number. Takes the
// count as data, not typed text, and reads correctly for both counts a
// jar needs (D21c): "left" for stock on a product page, "paid" for jars
// sold in an open batch.
function Mark({ index, filled }) {
  return (
    <svg
      className={filled ? "ds-jarmark ds-jarmark--filled" : "ds-jarmark ds-jarmark--empty"}
      style={{ "--ds-mark-index": index }}
      viewBox="0 0 10 14"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 1h4v2.2l1.4 1.4V13a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1V4.6L3 3.2V1Z" />
    </svg>
  );
}

export default function JarMarks({ count, total, reading = "left", className }) {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  // The declared ceiling, only when the caller actually gave one: this
  // is what the accessible label reports.
  const declaredTotal = total != null ? Math.max(safeCount, Math.floor(Number(total) || 0)) : null;
  // The ceiling used purely to decide how many mark slots to draw: a
  // plain count of N with no ceiling draws N filled marks; a count of
  // zero with no ceiling still draws one empty mark so the reading has
  // something to point at, rather than an empty void. This never
  // affects the label, only the render.
  const visualTotal = declaredTotal ?? Math.max(safeCount, 1);
  const marks = Array.from({ length: visualTotal }, (_, i) => i < safeCount);
  // One jar is a jar, not "1 jars": this string is read aloud to a
  // customer using a screen reader, so it is customer-facing copy.
  const jarWord = safeCount === 1 ? "jar" : "jars";
  const label =
    declaredTotal != null
      ? `${safeCount} ${jarWord} ${reading} of ${declaredTotal}`
      : `${safeCount} ${jarWord} ${reading}`;

  return (
    <div
      className={["ds-jarmarks", className].filter(Boolean).join(" ")}
      role="img"
      aria-label={label}
    >
      {marks.map((filled, i) => (
        <Mark key={i} index={i} filled={filled} />
      ))}
    </div>
  );
}
