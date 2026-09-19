/**
 * Today (brief section 17.2), v1.
 *
 * Two of the eight sections are built here: "Waiting on you" and the Clocks.
 * The other six (Ships today, To pack, Ready for collection, Warnings, Day
 * close and the week's money line) need orders, shipments and counter sales,
 * which arrive in M2.8 and later. An empty screen still means the day is
 * done, which is why the empty state is the whole screen and not a heading
 * with nothing under it.
 */
import type { JSX } from "preact";

import { useBatches, type BatchDoc } from "../batches/data";
import { COPY, TODAY } from "../copy";
import { useProducts } from "../products/data";
import type { Session } from "../session";
import { ApprovalCard } from "../today/ApprovalCard";
import { Clocks } from "../today/Clocks";
import { clockRows, useOpenApprovals, waitingOnYou } from "../today/data";

interface Props {
  readonly session: Session;
}

export function Today({ session }: Props): JSX.Element {
  const approvals = useOpenApprovals();
  const batches = useBatches();
  const products = useProducts();

  const now = Date.now();
  const waiting = waitingOnYou(approvals.items, now);

  function batchOf(batchRef: string): BatchDoc | null {
    return batches.items.find((b) => b.id === batchRef) ?? null;
  }
  function productNameOf(batch: BatchDoc | null): string {
    if (!batch) return "";
    const product = products.items.find((p) => p.id === batch.productSlug);
    return product?.name ?? batch.productName ?? batch.productSlug ?? "";
  }

  const clocks = clockRows(approvals.items, (ref) => batchOf(ref)?.state, now);

  if (approvals.loading || batches.loading) {
    return (
      <div data-testid="screen-today">
        <p data-testid="today-loading">{TODAY.loading}</p>
      </div>
    );
  }

  if (approvals.denied) {
    return (
      <div data-testid="screen-today">
        <p data-testid="today-denied">{TODAY.readDenied}</p>
      </div>
    );
  }

  // Brief 17.2: "An empty screen means the day is done."
  if (waiting.length === 0 && clocks.length === 0) {
    return (
      <div class="empty-state" data-testid="screen-today">
        <p>{COPY.todayEmptyLine1}</p>
        <p class="lede">{COPY.todayEmptyLine2}</p>
      </div>
    );
  }

  return (
    <div class="today" data-testid="screen-today">
      <section class="today-section" data-testid="today-waiting">
        <h2 class="section-heading">{TODAY.waitingHeading}</h2>
        {waiting.length === 0 ? (
          <p class="notice-line" data-testid="waiting-empty">
            {COPY.todayEmptyLine1}
          </p>
        ) : (
          <ul class="approval-list">
            {waiting.map((approval) => {
              const batch = batchOf(approval.batchRef ?? "");
              return (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  batch={batch}
                  productName={productNameOf(batch)}
                  role={session.role}
                />
              );
            })}
          </ul>
        )}
      </section>

      <Clocks rows={clocks} batchOf={batchOf} productNameOf={productNameOf} />
    </div>
  );
}
