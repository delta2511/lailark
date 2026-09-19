/**
 * One batch, per brief section 17.4.
 *
 * Fields the Owner may set are only ever taken by the Draft -> Open button
 * (section 8.2's row): there is no later transition row that changes
 * `plannedJars`, `priceOpen`, `priceInStock` or `limitPerPerson`, and a raw
 * field write to `plannedJars` would leave `bookableJars` (a protected,
 * server-computed field) stale. ASSUMED (M2.4): so this screen shows Fill and
 * Price read only once the batch exists, rather than offering an edit that
 * brief 17.4 describes ("planned is editable while Open") but that M2.3's
 * transition table has no safe row for yet.
 *
 * Every other kitchen field here (`KITCHEN_BATCH_FIELDS`) is safe to edit in
 * place because nothing else is computed from it, except `packedOn`, which
 * feeds `bestBefore` and `saleStopOn` at the Bottled button and is shown read
 * only from Bottled on, for the same reason.
 */
import { batchLabelCapitalised, formatINR, liveHeldJars, type BatchCosts, type Role } from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { BATCHES } from "../copy";
import { isCostPaise, parseRupeesToPaise } from "../products/productMoney";
import type { IngredientDoc, ProductDoc, RecipeDoc } from "../products/data";
import { CookingActuals } from "./CookingActuals";
import { formatClock } from "./clock";
import {
  isPermissionDenied,
  updateBatchCosts,
  updateBatchField,
  useApprovalsForBatch,
  type BatchDoc,
} from "./data";
import { FillBar } from "./FillBar";
import { StateButton } from "./StateButton";

interface Props {
  readonly batch: BatchDoc;
  readonly role: Role;
  readonly uid: string;
  readonly product: ProductDoc | null;
  readonly recipe: RecipeDoc | null;
  readonly ingredients: readonly IngredientDoc[];
  readonly onClose: () => void;
}

const ZERO_COSTS: BatchCosts = { jarsLids: 0, boxInserts: 0, labelling: 0, gasPower: 0 };

const SOURCING_ON = new Set(["sourcing", "cooking", "bottled", "inStock", "soldOut", "archived"]);
const COOKING_ON = new Set(["cooking", "bottled", "inStock", "soldOut", "archived"]);
const BOTTLED_ON = new Set(["bottled", "inStock", "soldOut", "archived"]);

export function BatchDetail({ batch, role, uid, product, recipe, ingredients, onClose }: Props): JSX.Element {
  const approvals = useApprovalsForBatch(batch.id);
  const canEditKitchenFields = role === "owner" || role === "kitchen";

  const waitingApprovals = approvals.items.filter((a) => a.status === "waiting");
  const clockApproval = waitingApprovals.find((a) => a.dueAt) ?? null;
  const dueAt = clockApproval?.dueAt ?? null;
  const clock = dueAt === null ? null : formatClock(dueAt);

  const label = batchLabelCapitalised(batch.batchNo ?? null, batch.id, batch.state ?? null);
  const productName = product?.name ?? batch.productName ?? batch.productSlug ?? "";

  const held = liveHeldJars(batch.heldJars, Date.now());
  const costs = batch.costs ?? ZERO_COSTS;

  return (
    <div class="detail" data-testid="batch-detail">
      <div class="batch-detail-header">
        <p class="state-chip" data-testid="detail-state-chip">
          {BATCHES.stateLabel[batch.state ?? ""] ?? batch.state}
        </p>
        <h2 class="section-heading" data-testid="detail-label">
          {label}
        </h2>
        <p class="field-value" data-testid="detail-product">
          {productName}
        </p>

        {waitingApprovals.length > 0 ? (
          <p class="approval-badge" data-testid="detail-approval-badge">
            {BATCHES.approvalWaiting}
          </p>
        ) : null}
        {clock ? (
          <p class="clock-pill" data-testid="detail-clock">
            {BATCHES.clock(clock)}
          </p>
        ) : null}

        <StateButton batch={batch} role={role} />
      </div>

      {/* ---- Fill, brief 17.4: read only, see the file header note ---- */}
      <p class="section-heading">{BATCHES.fillHeading}</p>
      <div class="fill-numbers">
        <Field label={BATCHES.plannedJars} value={String(batch.plannedJars ?? "")} testId="view-plannedJars" numeric />
        <Field label={BATCHES.bookable} value={String(batch.bookableJars ?? "")} testId="view-bookableJars" numeric />
        <Field label={BATCHES.paid} value={String(batch.paidCount ?? 0)} testId="view-paidCount" numeric />
        <Field label={BATCHES.heldNow} value={String(held)} testId="view-heldNow" numeric />
        <Field
          label={BATCHES.limitPerPerson}
          value={String(batch.perPersonLimit ?? "")}
          testId="view-perPersonLimit"
          numeric
        />
      </div>
      <FillBar paid={batch.paidCount ?? 0} bookable={batch.bookableJars ?? 0} />

      {/* ---- Price, Owner only, read only (see file header note) ---- */}
      {role === "owner" || role === "viewer" ? (
        <>
          <p class="section-heading">{BATCHES.priceHeading}</p>
          <Field
            label={BATCHES.priceOpen}
            value={batch.priceOpen === undefined ? "" : formatINR(batch.priceOpen)}
            testId="view-priceOpen"
            numeric
          />
          <Field
            label={BATCHES.priceInStock}
            value={batch.priceInStock === undefined ? "" : formatINR(batch.priceInStock)}
            testId="view-priceInStock"
            numeric
          />
        </>
      ) : null}

      {/* ---- Sourcing ---- */}
      {SOURCING_ON.has(batch.state ?? "") ? (
        <>
          <p class="section-heading">{BATCHES.sourcingHeading}</p>
          <EditableText
            label={BATCHES.source}
            value={batch.source ?? ""}
            canEdit={canEditKitchenFields}
            testId="source"
            onCommit={(text) => void updateBatchField(batch.id, { source: text }, uid)}
          />
          <EditableDate
            label={BATCHES.landedOn}
            value={batch.landedOn ?? ""}
            canEdit={canEditKitchenFields}
            testId="landedOn"
            onCommit={(text) => void updateBatchField(batch.id, { landedOn: text }, uid)}
          />
          <EditableNumber
            label={BATCHES.weightRaw}
            value={batch.weightRaw ?? null}
            canEdit={canEditKitchenFields}
            testId="weightRaw"
            onCommit={(n) => void updateBatchField(batch.id, { weightRaw: n }, uid)}
          />
        </>
      ) : null}

      {/* ---- Cooking ---- */}
      {COOKING_ON.has(batch.state ?? "") ? (
        <>
          <p class="section-heading">{BATCHES.cookingHeading}</p>
          <EditableDate
            label={BATCHES.cookedOn}
            value={batch.cookedOn ?? ""}
            canEdit={canEditKitchenFields}
            testId="cookedOn"
            onCommit={(text) => void updateBatchField(batch.id, { cookedOn: text }, uid)}
          />
          <EditableNumber
            label={BATCHES.weightCleaned}
            value={batch.weightCleaned ?? null}
            canEdit={canEditKitchenFields}
            testId="weightCleaned"
            onCommit={(n) => void updateBatchField(batch.id, { weightCleaned: n }, uid)}
          />
          <EditableNumber
            label={BATCHES.weightCooked}
            value={batch.weightCooked ?? null}
            canEdit={canEditKitchenFields}
            testId="weightCooked"
            onCommit={(n) => void updateBatchField(batch.id, { weightCooked: n }, uid)}
          />

          <CookingActuals
            batchRef={batch.id}
            recipe={recipe}
            ingredients={ingredients}
            canEdit={canEditKitchenFields}
            uid={uid}
          />
        </>
      ) : null}

      {/* ---- Bottling ---- */}
      {BOTTLED_ON.has(batch.state ?? "") ? (
        <>
          <p class="section-heading">{BATCHES.bottlingHeading}</p>
          <Field label={BATCHES.packedOn} value={batch.packedOn ?? ""} testId="view-packedOn" />
          <Field label={BATCHES.jarCount} value={String(batch.bottledJars ?? "")} testId="view-bottledJars" numeric />
          <Field label={BATCHES.bestBefore} value={batch.bestBefore ?? ""} testId="view-bestBefore" />
          <Field label={BATCHES.saleStopOn} value={batch.saleStopOn ?? ""} testId="view-saleStopOn" />
          <Field
            label={BATCHES.surplus}
            value={String(Math.max(0, (batch.bottledJars ?? 0) - (batch.paidCount ?? 0)))}
            testId="view-surplus"
            numeric
          />

          <CostsSection batch={batch} costs={costs} canEdit={canEditKitchenFields} uid={uid} />
        </>
      ) : null}

      {/* ---- P&L placeholder, brief 14.2. Real numbers arrive in M4.8. ---- */}
      <p class="section-heading">{BATCHES.pnlHeading}</p>
      <PnlSection batch={batch} />

      <div class="hairline" />
      <button class="quiet" type="button" onClick={onClose}>
        {BATCHES.backToBatches}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small read/edit field helpers                                             */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  testId,
  numeric,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
  readonly numeric?: boolean;
}): JSX.Element {
  return (
    <div class="settings-field">
      <p class="field-label">{label}</p>
      <p class={numeric ? "field-value number" : "field-value"} data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function EditableText({
  label,
  value,
  canEdit,
  testId,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly canEdit: boolean;
  readonly testId: string;
  readonly onCommit: (text: string) => void;
}): JSX.Element {
  if (!canEdit) return <Field label={label} value={value} testId={`view-${testId}`} />;
  return (
    <>
      <label for={`edit-${testId}`}>{label}</label>
      <input
        key={`${testId}-${value}`}
        id={`edit-${testId}`}
        type="text"
        defaultValue={value}
        data-testid={`input-${testId}`}
        onChange={(event) => onCommit((event.target as HTMLInputElement).value.trim())}
      />
    </>
  );
}

function EditableDate({
  label,
  value,
  canEdit,
  testId,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly canEdit: boolean;
  readonly testId: string;
  readonly onCommit: (text: string) => void;
}): JSX.Element {
  if (!canEdit) return <Field label={label} value={value} testId={`view-${testId}`} />;
  return (
    <>
      <label for={`edit-${testId}`}>{label}</label>
      <input
        key={`${testId}-${value}`}
        id={`edit-${testId}`}
        type="date"
        defaultValue={value}
        data-testid={`input-${testId}`}
        onChange={(event) => {
          const text = (event.target as HTMLInputElement).value;
          if (text.trim() !== "") onCommit(text);
        }}
      />
    </>
  );
}

/**
 * A weight, edited in place.
 *
 * ASSUMED (M2.4): an empty or whitespace-only box is "not given", never a
 * zero. `Number("")` and `Number("   ")` are both `0`, which is why clearing
 * one of these boxes used to silently store a literal zero over a real
 * weight. Blank now leaves the stored value exactly as it was and puts it
 * back in the box, because a person retyping a weight, or interrupted
 * mid-edit, has no reason to expect that clearing a box is how you say "this
 * weight is gone"; `StateButton.parseField` already reads an empty box as
 * "not given". A deliberate 0 typed into the box is a real number and saves.
 */
function EditableNumber({
  label,
  value,
  canEdit,
  testId,
  onCommit,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly canEdit: boolean;
  readonly testId: string;
  readonly onCommit: (n: number) => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return <Field label={label} value={value === null ? "" : `${value} g`} testId={`view-${testId}`} numeric />;
  }

  const stored = value === null ? "" : String(value);

  return (
    <>
      <label for={`edit-${testId}`}>{label}</label>
      <input
        key={`${testId}-${value}`}
        id={`edit-${testId}`}
        type="text"
        inputMode="decimal"
        defaultValue={stored}
        data-testid={`input-${testId}`}
        onChange={(event) => {
          const input = event.target as HTMLInputElement;
          const raw = input.value.trim();
          if (raw === "") {
            // Nothing typed is not a zero. Put the stored weight back so the
            // person can see that nothing was changed.
            input.value = stored;
            setError(null);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n) || n < 0) {
            setError(BATCHES.weightInvalid);
            return;
          }
          setError(null);
          onCommit(n);
        }}
      />
      {error ? (
        <p class="error" data-testid={`error-${testId}`}>
          {error}
        </p>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Bottling costs, brief 14.1: per batch, entered at Bottled                  */
/* -------------------------------------------------------------------------- */

function CostsSection({
  batch,
  costs,
  canEdit,
  uid,
}: {
  readonly batch: BatchDoc;
  readonly costs: BatchCosts;
  readonly canEdit: boolean;
  readonly uid: string;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  async function commit(patch: Partial<BatchCosts>): Promise<void> {
    setError(null);
    try {
      await updateBatchCosts(batch.id, { ...costs, ...patch }, uid);
    } catch (caught) {
      setError(isPermissionDenied(caught) ? BATCHES.saveRefused : BATCHES.saveFailed);
    }
  }

  function costField(key: keyof BatchCosts, label: string, testId: string, editable: boolean): JSX.Element {
    if (!editable) {
      return <Field label={label} value={formatINR(costs[key] ?? 0)} testId={`view-${testId}`} numeric />;
    }
    const stored = String((costs[key] ?? 0) / 100);
    return (
      <>
        <label for={`cost-${testId}`}>{label}</label>
        <input
          key={`${testId}-${costs[key]}`}
          id={`cost-${testId}`}
          type="text"
          inputMode="decimal"
          defaultValue={stored}
          data-testid={`input-cost-${testId}`}
          onChange={(event) => {
            const input = event.target as HTMLInputElement;
            const raw = input.value.trim();
            if (raw === "") {
              // Blank is "not given", the same as every other in-place box on
              // this screen: it changes nothing, and the stored cost comes back.
              input.value = stored;
              setError(null);
              return;
            }
            // `updateBatchCosts` is a direct client write, not a callable, so
            // this and `firestore.rules` are the only two things between a
            // typed box and the database. `parseRupeesToPaise` happily returns
            // -5000 for "-50"; a cost is a whole number of paise, zero or more
            // (CLAUDE.md section 3), and anything else is refused out loud.
            const paise = parseRupeesToPaise(raw);
            if (!isCostPaise(paise)) {
              setError(BATCHES.costInvalid);
              return;
            }
            void commit({ [key]: paise } as Partial<BatchCosts>);
          }}
        />
      </>
    );
  }

  return (
    <>
      {costField("jarsLids", BATCHES.jarsLids, "jarsLids", canEdit)}
      {costField("boxInserts", BATCHES.boxInserts, "boxInserts", canEdit)}
      {costField("labelling", BATCHES.labelling, "labelling", canEdit)}
      {/* Gas and power is a Settings figure applied automatically (brief 14.1), never typed here. */}
      {costField("gasPower", BATCHES.gasPower, "gasPower", false)}
      {error ? (
        <p class="error" data-testid="costs-error">
          {error}
        </p>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* P&L placeholder, brief 14.2. Real figures arrive in M4.8.                 */
/* -------------------------------------------------------------------------- */

function PnlSection({ batch }: { readonly batch: BatchDoc }): JSX.Element {
  const pnl = batch.pnl;
  // ASSUMED (M2.4): `pnl` always exists as a zeroed object from the moment a
  // batch is created (`functions/src/batches/transitions.ts`, `planCreate`),
  // so "when it does not [exist]" is read as "before the M4.8 trigger has
  // ever written a real figure into it", which every field being exactly
  // zero stands in for until that trigger exists.
  if (pnl === undefined || pnl === null || !Object.values(pnl).some((v) => v !== 0)) {
    return (
      <p class="notice-line" data-testid="pnl-not-yet">
        {BATCHES.pnlNotYet}
      </p>
    );
  }

  return (
    <div class="pnl-numbers" data-testid="pnl-figures">
      <Field label={BATCHES.revenue} value={formatINR(pnl.revenue)} testId="view-pnl-revenue" numeric />
      <Field
        label={BATCHES.ingredientCost}
        value={formatINR(pnl.ingredientCost)}
        testId="view-pnl-ingredientCost"
        numeric
      />
      <Field
        label={BATCHES.packagingCost}
        value={formatINR(pnl.packagingCost)}
        testId="view-pnl-packagingCost"
        numeric
      />
      <Field
        label={BATCHES.shippingCost}
        value={formatINR(pnl.shippingCost)}
        testId="view-pnl-shippingCost"
        numeric
      />
      <Field label={BATCHES.gatewayFees} value={formatINR(pnl.gatewayFees)} testId="view-pnl-gatewayFees" numeric />
      <Field
        label={BATCHES.writeOffCost}
        value={formatINR(pnl.writeOffCost)}
        testId="view-pnl-writeOffCost"
        numeric
      />
      <Field label={BATCHES.margin} value={formatINR(pnl.margin)} testId="view-pnl-margin" numeric />
    </div>
  );
}
