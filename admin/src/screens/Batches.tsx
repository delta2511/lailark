/**
 * Batches (brief section 17.4): the list, the detail, and the small form
 * that creates a draft (section 8.2's `none -> draft` row, Owner only).
 */
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { BatchCard } from "../batches/BatchCard";
import { BatchDetail } from "../batches/BatchDetail";
import { CreateBatch } from "../batches/CreateBatch";
import { useBatches, useWaitingApprovals, type ApprovalDoc } from "../batches/data";
import { BATCHES } from "../copy";
import { useIngredients, useProducts, useRecipes } from "../products/data";
import type { Session } from "../session";

type View = { readonly kind: "list" } | { readonly kind: "batch"; readonly ref: string } | { readonly kind: "create" };

interface Props {
  readonly session: Session;
}

function groupByBatch(approvals: readonly ApprovalDoc[]): Map<string, ApprovalDoc[]> {
  const byBatch = new Map<string, ApprovalDoc[]>();
  for (const approval of approvals) {
    if (!approval.batchRef) continue;
    const list = byBatch.get(approval.batchRef) ?? [];
    list.push(approval);
    byBatch.set(approval.batchRef, list);
  }
  return byBatch;
}

export function Batches({ session }: Props): JSX.Element {
  const [view, setView] = useState<View>({ kind: "list" });

  const batches = useBatches();
  const waitingApprovals = useWaitingApprovals();
  const products = useProducts();
  const recipes = useRecipes();
  const ingredients = useIngredients();

  const canCreate = session.role === "owner";
  const approvalsByBatch = groupByBatch(waitingApprovals.items);

  function productNameFor(batch: { readonly productSlug?: string; readonly productName?: string | null }): string {
    const product = products.items.find((p) => p.id === batch.productSlug);
    return product?.name ?? batch.productName ?? batch.productSlug ?? "";
  }

  if (view.kind === "create") {
    return (
      <div class="batches" data-testid="screen-batches">
        <CreateBatch
          products={products.items}
          recipes={recipes.items}
          onCreated={(ref) => setView({ kind: "batch", ref })}
          onCancel={() => setView({ kind: "list" })}
        />
      </div>
    );
  }

  if (view.kind === "batch") {
    const batch = batches.items.find((b) => b.id === view.ref);
    if (!batch) {
      return (
        <div class="batches" data-testid="screen-batches">
          <p data-testid="batches-loading">{BATCHES.loading}</p>
        </div>
      );
    }
    const recipe = recipes.items.find((r) => r.id === batch.recipeId) ?? null;
    const product = products.items.find((p) => p.id === batch.productSlug) ?? null;

    return (
      <div class="batches" data-testid="screen-batches">
        <BatchDetail
          batch={batch}
          role={session.role}
          uid={session.uid}
          product={product}
          recipe={recipe}
          ingredients={ingredients.items}
          onClose={() => setView({ kind: "list" })}
        />
      </div>
    );
  }

  return (
    <div class="batches" data-testid="screen-batches">
      {batches.loading ? <p data-testid="batches-loading">{BATCHES.loading}</p> : null}
      {batches.denied ? <p data-testid="batches-denied">{BATCHES.readDenied}</p> : null}

      {!batches.loading && !batches.denied && batches.items.length === 0 ? (
        <p data-testid="batches-empty">{BATCHES.empty}</p>
      ) : null}

      <ul class="batch-list" data-testid="batch-list">
        {batches.items.map((batch) => (
          <BatchCard
            key={batch.id}
            batch={batch}
            productName={productNameFor(batch)}
            approvals={approvalsByBatch.get(batch.id) ?? []}
            onOpen={() => setView({ kind: "batch", ref: batch.id })}
          />
        ))}
      </ul>

      {canCreate ? (
        <>
          <div class="hairline" />
          <button type="button" data-testid="new-batch" onClick={() => setView({ kind: "create" })}>
            {BATCHES.newBatch}
          </button>
        </>
      ) : null}
    </div>
  );
}
