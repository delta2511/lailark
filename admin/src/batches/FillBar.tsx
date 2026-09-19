/**
 * The fill bar, brief section 17.4: "fill bar (paid of bookable, half mark
 * drawn)". Paid of bookable fills the bar; the half mark is drawn at 50% so
 * it is visible against every fill level, including zero and full.
 *
 * D3: the ceiling is always bookable jars, never planned, so the bar and the
 * half mark can never disagree with the fill numbers printed beside them.
 */
import { halfOfBookable } from "@lailark/shared";
import type { JSX } from "preact";

interface Props {
  readonly paid: number;
  readonly bookable: number;
}

export function FillBar({ paid, bookable }: Props): JSX.Element {
  const fillPercent = bookable > 0 ? Math.min(100, Math.max(0, (paid / bookable) * 100)) : 0;
  // The half mark sits at half of bookable (rounded up, brief 7.1), not at a
  // fixed 50%: on an odd bookable count the two are not quite the same point,
  // and this is the shared helper every half-fill approval is triggered by.
  const halfMarkPercent = bookable > 0 ? Math.min(100, (halfOfBookable(bookable) / bookable) * 100) : 50;

  return (
    <div
      class="fill-bar"
      data-testid="fill-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={bookable}
      aria-valuenow={Math.min(paid, bookable)}
    >
      <div class="fill-bar-track">
        <div class="fill-bar-fill" data-testid="fill-bar-fill" style={{ width: `${fillPercent}%` }} />
        <div
          class="fill-bar-half-mark"
          data-testid="fill-bar-half-mark"
          style={{ left: `${halfMarkPercent}%` }}
        />
      </div>
    </div>
  );
}
