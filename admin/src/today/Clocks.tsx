/**
 * Today's Clocks (brief 17.2, item 3): the batches inside their 5-day or
 * 3-day production window (7.3 and 8.2).
 *
 * The number on screen is read from the approval's own `dueAt` and formatted
 * by the same `formatClock` the batch cards use (A61). Nothing here computes
 * five days from anything: the server started the clock, and this shows the
 * clock the server started, so Shefin is never given a second opinion about
 * how long he has.
 */
import type { JSX } from "preact";

import { formatClock } from "../batches/clock";
import type { BatchDoc } from "../batches/data";
import { BATCHES, TODAY } from "../copy";
import type { ClockRow } from "./data";
import { batchLabelCapitalised } from "@lailark/shared";

interface Props {
  readonly rows: readonly ClockRow[];
  readonly batchOf: (batchRef: string) => BatchDoc | null;
  readonly productNameOf: (batch: BatchDoc | null) => string;
}

export function Clocks({ rows, batchOf, productNameOf }: Props): JSX.Element {
  return (
    <section class="today-section" data-testid="today-clocks">
      <h2 class="section-heading">{TODAY.clocksHeading}</h2>

      {rows.length === 0 ? (
        <p class="notice-line" data-testid="clocks-empty">
          {TODAY.clocksEmpty}
        </p>
      ) : (
        <ul class="clock-list">
          {rows.map((row) => {
            const batch = batchOf(row.batchRef);
            const label = batchLabelCapitalised(
              batch?.batchNo ?? null,
              row.batchRef,
              batch?.state ?? null,
            );
            const product = productNameOf(batch);
            const clock = formatClock(row.dueAtMillis) ?? BATCHES.clockOverdue;
            return (
              <li
                key={row.approvalId}
                class={row.overdue ? "clock-row overdue" : "clock-row"}
                data-testid={`clock-row-${row.batchRef}`}
              >
                <span class="clock-batch">{product === "" ? label : `${label}, ${product}`}</span>
                <span class="clock-kind" data-testid={`clock-kind-${row.batchRef}`}>
                  {row.kind === "full" ? TODAY.clockFull : TODAY.clockHalf}
                </span>
                <span class="clock-left" data-testid={`clock-left-${row.batchRef}`}>
                  {clock}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
