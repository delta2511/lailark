/**
 * One row of the Batches list, brief section 17.4: "cards with product,
 * batch number, state chip, fill bar (paid of bookable, half mark drawn),
 * clock if any, approval badge if waiting."
 */
import { batchLabelCapitalised } from "@lailark/shared";
import type { JSX } from "preact";

import { BATCHES } from "../copy";
import { formatClock } from "./clock";
import type { ApprovalDoc, BatchDoc } from "./data";
import { FillBar } from "./FillBar";

interface Props {
  readonly batch: BatchDoc;
  readonly productName: string;
  readonly approvals: readonly ApprovalDoc[];
  readonly onOpen: () => void;
}

export function BatchCard({ batch, productName, approvals, onOpen }: Props): JSX.Element {
  const label = batchLabelCapitalised(batch.batchNo ?? null, batch.id, batch.state ?? null);
  const waiting = approvals.filter((a) => a.status === "waiting");
  const dueAt = waiting.find((a) => a.dueAt)?.dueAt ?? null;
  // Null when the clock cannot be read: the card still draws everything else.
  const clock = dueAt === null ? null : formatClock(dueAt);

  return (
    <li>
      <button type="button" class="batch-card" data-testid={`batch-row-${batch.id}`} onClick={onOpen}>
        <div class="batch-card-top">
          <span class="batch-card-label" data-testid="card-label">
            {label}
          </span>
          <span class="state-chip" data-testid="card-state-chip">
            {BATCHES.stateLabel[batch.state ?? ""] ?? batch.state}
          </span>
        </div>
        <p class="batch-card-product" data-testid="card-product">
          {productName}
        </p>

        <FillBar paid={batch.paidCount ?? 0} bookable={batch.bookableJars ?? 0} />

        <div class="batch-card-bottom">
          {clock ? (
            <span class="clock-pill" data-testid="card-clock">
              {BATCHES.clock(clock)}
            </span>
          ) : null}
          {waiting.length > 0 ? (
            <span class="approval-badge" data-testid="card-approval-badge">
              {BATCHES.approvalWaiting}
            </span>
          ) : null}
        </div>
      </button>
    </li>
  );
}
