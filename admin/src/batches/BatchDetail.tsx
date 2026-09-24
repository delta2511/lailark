/**
 * One batch, per brief section 17.4.
 *
 * **Price and the per-person limit are edited here, in place, on every batch
 * in every state, with no lock (D40, D44, M2.16.)** M2.4 showed them read
 * only and reasoned that the Draft -> Open button was the only safe way to
 * set them; Shefin was shown the risk of the alternative (a price changed
 * after people have booked and paid at the old one) and the two safer
 * options, and chose full flexibility, batch 001 and archived batches
 * included. That reasoning is gone rather than left here to mislead. Two
 * things hold it up:
 *
 * - **Nothing is ever repriced retrospectively.** An order line carries its
 *   own `unitPrice`, written once when the line is priced
 *   (`functions/src/orders/sale.ts`), and every bill, receipt and total is
 *   arithmetic on that line (`functions/src/money/plan.ts`). Nothing reads a
 *   batch's price back for an order that already exists.
 * - **An archived batch's P&L moves, and the screen says so.** D40: flagged,
 *   not prevented. The line is a consequence stated once, next to the boxes.
 *   It asks for nothing and blocks nothing.
 *
 * The ₹649 MRP still holds. It is checked here so nobody meets a raw
 * permission error, and by value in `firestore.rules` (`batchPricesOk`)
 * because the screen is not the last word: a batch's prices are a direct
 * client write with no callable in the way, exactly like `costs` below.
 *
 * `plannedJars` stays read only, for the reason M2.4 gave and D40 did not
 * touch: a raw write to it would leave `bookableJars` (protected, server
 * computed) stale. The Draft -> Open row is still the only thing that moves
 * it.
 *
 * The limit per person is the one field with a shape of its own (D44).
 * `perPersonLimit` is still the protected, server-computed quarter; the box
 * writes `perPersonLimitOverride` beside it, and shows the computed quarter
 * as its placeholder. Blank is automatic, a typed number stands through
 * later planned-jar changes, and everything that enforces the cap reads
 * `effectivePerPersonLimit` rather than either field on its own.
 *
 * Every other kitchen field here (`KITCHEN_BATCH_FIELDS`) is safe to edit in
 * place because nothing else is computed from it, except `packedOn`, which
 * feeds `bestBefore` and `saleStopOn` at the Bottled button and is shown read
 * only from Bottled on, for the same reason.
 *
 * M2.6: every field write here (and `costs` below) now goes through
 * `updateBatchField`/`updateBatchCosts` (`./data.ts`, themselves a thin
 * wrapper over `writeWithAudit`) and offers 8 seconds of undo through
 * {@link UndoToast}, the same seam M2.2 built for products. `saveBatchLine`
 * (the per-ingredient actuals, `CookingActuals.tsx`) is audited the same
 * way and, from M2.14, offers its own 8 second undo on its own toast (A79
 * superseded): see that file for the race analysis.
 */
import {
  batchLabelCapitalised,
  effectivePerPersonLimit,
  formatINR,
  liveHeldJars,
  MRP_PAISE,
  type BatchCosts,
  type Role,
} from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { BATCHES } from "../copy";
import { isCostPaise, isSellablePaise, parseRupeesToPaise } from "../products/productMoney";
import type { IngredientDoc, ProductDoc, RecipeDoc } from "../products/data";
import { Timeline } from "../timeline/Timeline";
import { UndoToast, type UndoToastState } from "../ui/UndoToast";
import { CookingActuals } from "./CookingActuals";
import { formatClock } from "./clock";
import {
  isPermissionDenied,
  undoBatchWrite,
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
  /**
   * D41: whether the recipes listener has answered yet. `StateButton` asks
   * once per main ingredient, so it has to tell a recipe still loading from
   * a recipe that names none.
   */
  readonly recipeLoading: boolean;
  readonly ingredients: readonly IngredientDoc[];
  readonly onClose: () => void;
}

const ZERO_COSTS: BatchCosts = { jarsLids: 0, boxInserts: 0, labelling: 0, gasPower: 0 };

const SOURCING_ON = new Set(["sourcing", "cooking", "bottled", "inStock", "soldOut", "archived"]);
const COOKING_ON = new Set(["cooking", "bottled", "inStock", "soldOut", "archived"]);
const BOTTLED_ON = new Set(["bottled", "inStock", "soldOut", "archived"]);

export function BatchDetail({
  batch,
  role,
  uid,
  product,
  recipe,
  recipeLoading,
  ingredients,
  onClose,
}: Props): JSX.Element {
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

  // Whether the Price section appears at all. It is not a write gate, and it
  // is deliberately not named like one: the Kitchen never sees a price
  // (brief 17.12 gives "set prices" to the Owner), and the Viewer sees the
  // numbers and edits nothing. What may be *written* is the nested
  // `role === "owner"` below, which is the only gate to copy if another
  // field joins this section.
  const showsPrices = role === "owner" || role === "viewer";
  // D44: the computed quarter is the placeholder and the fallback; the
  // number anything actually enforces is the effective one.
  const computedLimit = batch.perPersonLimit ?? 0;
  const effectiveLimit = effectivePerPersonLimit(batch);

  // M2.6: the toast's `before` is the `audit/{id}` entry this write just
  // created (see `admin/src/audit/write.ts`), not the field's old value.
  const [toast, setToast] = useState<UndoToastState<string> | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  /**
   * Every direct field write on this screen goes through here: one write, one
   * `audit/{id}` entry, in the same Firestore batch (`updateBatchField`), so
   * the two can never separate. `before` is read off the `batch` prop this
   * screen already has, not a second Firestore read.
   */
  async function commitWithUndo(
    patch: Readonly<Record<string, unknown>>,
    before: Readonly<Record<string, unknown>>,
    message: string,
  ): Promise<void> {
    setFieldError(null);
    try {
      const { auditId } = await updateBatchField(batch.id, patch, before, uid);
      setToast({ message, before: auditId });
    } catch (caught) {
      setFieldError(isPermissionDenied(caught) ? BATCHES.saveRefused : BATCHES.saveFailed);
    }
  }

  async function commitCostsWithUndo(nextCosts: BatchCosts, message: string): Promise<void> {
    setFieldError(null);
    try {
      const { auditId } = await updateBatchCosts(batch.id, nextCosts, costs, uid);
      setToast({ message, before: auditId });
    } catch (caught) {
      setFieldError(isPermissionDenied(caught) ? BATCHES.saveRefused : BATCHES.saveFailed);
    }
  }

  /**
   * One of the two prices, in paise, already checked against the MRP by the
   * box that typed it. Nothing here reprices an order: an order line carries
   * its own `unitPrice`, and this changes only what the *next* sale is
   * offered at. See the file header.
   */
  function commitPrice(field: "priceOpen" | "priceInStock", label: string, paise: number): void {
    const before = batch[field] ?? null;
    if (before === paise) return;
    void commitWithUndo({ [field]: paise }, { [field]: before }, BATCHES.fieldChanged(label, formatINR(paise)));
  }

  /**
   * The Owner's own per-person cap (D44). `null` clears it back to automatic,
   * which is a real value here and not the "blank means not given" every
   * other box on this screen uses: blank *is* the instruction, and the
   * computed quarter takes over again.
   */
  function commitLimit(next: number | null): void {
    const before = batch.perPersonLimitOverride ?? null;
    if (before === next) return;
    void commitWithUndo(
      { perPersonLimitOverride: next },
      { perPersonLimitOverride: before },
      next === null
        ? BATCHES.limitPerPersonCleared
        : BATCHES.fieldChanged(BATCHES.limitPerPerson, String(next)),
    );
  }

  /**
   * The undo race and the back-door guard both live in `undoBatchWrite`
   * (`admin/src/batches/data.ts`): it refuses if the document changed again
   * since this write (the other person's edit stands, nothing here silently
   * overwrites it), and it refuses if `role` may not write one of the fields
   * being restored (an undo cannot reach a field its actor could never have
   * written directly). Either refusal is reported here, plainly, and nothing
   * is written.
   */
  async function handleUndo(auditId: string): Promise<void> {
    setToast(null);
    const outcome = await undoBatchWrite(auditId, uid, role);
    if (!outcome.ok) {
      setFieldError(
        outcome.reason === "raced"
          ? BATCHES.undoRaced
          : outcome.reason === "forbidden"
            ? BATCHES.undoForbidden
            : BATCHES.undoGone,
      );
      return;
    }
    setToast({ message: BATCHES.undone, before: outcome.auditId });
  }

  return (
    <div class="detail" data-testid="batch-detail">
      <UndoToast toast={toast} onUndo={(id) => void handleUndo(id)} onExpire={() => setToast(null)} />
      {fieldError ? (
        <p class="error" data-testid="batch-field-error">
          {fieldError}
        </p>
      ) : null}

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

        <StateButton
          batch={batch}
          role={role}
          recipe={recipe}
          recipeLoading={recipeLoading}
          ingredients={ingredients}
        />
      </div>

      {/* ---- Fill, brief 17.4. `plannedJars` stays read only: see the header ---- */}
      <p class="section-heading">{BATCHES.fillHeading}</p>
      <div class="fill-numbers">
        <Field label={BATCHES.plannedJars} value={String(batch.plannedJars ?? "")} testId="view-plannedJars" numeric />
        <Field label={BATCHES.bookable} value={String(batch.bookableJars ?? "")} testId="view-bookableJars" numeric />
        <Field label={BATCHES.paid} value={String(batch.paidCount ?? 0)} testId="view-paidCount" numeric />
        <Field label={BATCHES.heldNow} value={String(held)} testId="view-heldNow" numeric />
        <Field
          label={BATCHES.limitPerPerson}
          value={String(effectiveLimit)}
          testId="view-perPersonLimit"
          numeric
        />
      </div>
      <FillBar paid={batch.paidCount ?? 0} bookable={batch.bookableJars ?? 0} />

      {/* ---- The Owner's own cap, D44. Blank is automatic. The Viewer gets
               no box: the Fill row above already shows the effective cap,
               and brief 17.12 gives a Viewer no input anywhere. ---- */}
      {role === "owner" ? (
        <EditableLimit
          computed={computedLimit}
          override={batch.perPersonLimitOverride ?? null}
          bookable={batch.bookableJars ?? 0}
          onCommit={commitLimit}
        />
      ) : null}

      {/* ---- Price, Owner edits, Viewer reads. D40: no lock, in any state ---- */}
      {showsPrices ? (
        <>
          <p class="section-heading">{BATCHES.priceHeading}</p>
          <p class="notice-line" data-testid="price-help">
            {BATCHES.priceHelp}
          </p>
          {batch.state === "archived" ? (
            <p class="notice-line" data-testid="price-archived-note">
              {BATCHES.priceArchivedNote}
            </p>
          ) : null}
          {role === "owner" ? (
            <>
              <EditablePrice
                label={BATCHES.priceOpen}
                value={batch.priceOpen ?? null}
                testId="priceOpen"
                onCommit={(paise) => commitPrice("priceOpen", BATCHES.priceOpen, paise)}
                onInvalid={setFieldError}
              />
              <EditablePrice
                label={BATCHES.priceInStock}
                value={batch.priceInStock ?? null}
                testId="priceInStock"
                onCommit={(paise) => commitPrice("priceInStock", BATCHES.priceInStock, paise)}
                onInvalid={setFieldError}
              />
            </>
          ) : (
            <>
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
          )}
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
            onCommit={(text) =>
              void commitWithUndo(
                { source: text },
                { source: batch.source ?? null },
                BATCHES.fieldChanged(BATCHES.source, text),
              )
            }
          />
          <EditableDate
            label={BATCHES.landedOn}
            value={batch.landedOn ?? ""}
            canEdit={canEditKitchenFields}
            testId="landedOn"
            onCommit={(text) =>
              void commitWithUndo(
                { landedOn: text },
                { landedOn: batch.landedOn ?? null },
                BATCHES.fieldChanged(BATCHES.landedOn, text),
              )
            }
          />
          <EditableNumber
            label={BATCHES.weightRaw}
            value={batch.weightRaw ?? null}
            canEdit={canEditKitchenFields}
            testId="weightRaw"
            onCommit={(n) =>
              void commitWithUndo(
                { weightRaw: n },
                { weightRaw: batch.weightRaw ?? null },
                BATCHES.fieldChanged(BATCHES.weightRaw, `${n} g`),
              )
            }
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
            onCommit={(text) =>
              void commitWithUndo(
                { cookedOn: text },
                { cookedOn: batch.cookedOn ?? null },
                BATCHES.fieldChanged(BATCHES.cookedOn, text),
              )
            }
          />
          <EditableNumber
            label={BATCHES.weightCleaned}
            value={batch.weightCleaned ?? null}
            canEdit={canEditKitchenFields}
            testId="weightCleaned"
            onCommit={(n) =>
              void commitWithUndo(
                { weightCleaned: n },
                { weightCleaned: batch.weightCleaned ?? null },
                BATCHES.fieldChanged(BATCHES.weightCleaned, `${n} g`),
              )
            }
          />
          <EditableNumber
            label={BATCHES.weightCooked}
            value={batch.weightCooked ?? null}
            canEdit={canEditKitchenFields}
            testId="weightCooked"
            onCommit={(n) =>
              void commitWithUndo(
                { weightCooked: n },
                { weightCooked: batch.weightCooked ?? null },
                BATCHES.fieldChanged(BATCHES.weightCooked, `${n} g`),
              )
            }
          />

          <CookingActuals
            batchRef={batch.id}
            recipe={recipe}
            ingredients={ingredients}
            canEdit={canEditKitchenFields}
            uid={uid}
            role={role}
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

          <CostsSection costs={costs} canEdit={canEditKitchenFields} onCommit={commitCostsWithUndo} />
        </>
      ) : null}

      {/* ---- P&L placeholder, brief 14.2. Real numbers arrive in M4.8. ---- */}
      <p class="section-heading">{BATCHES.pnlHeading}</p>
      <PnlSection batch={batch} />

      {/* ---- Timeline, brief 17.4 and 11: "every object shows its timeline". M2.6. ---- */}
      <Timeline objectPath={`batches/${batch.id}`} />

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

/**
 * One of a batch's two prices, edited in place (D40, M2.16).
 *
 * The box refuses anything the rules would refuse, so nobody meets a raw
 * permission error: a price is a whole number of paise, at least one, and
 * never above the ₹649 MRP printed on the jar. `firestore.rules`
 * (`batchPricesOk`) checks the same thing by value, because this screen
 * writes straight to Firestore with no callable in the way and so cannot be
 * the last word on it.
 *
 * Blank changes nothing, like every other box on this screen: a price of
 * nothing is not a price, and a batch with no price on it is refused at the
 * counter by name (`functions/src/orders/sale.ts`) rather than sold for zero.
 */
function EditablePrice({
  label,
  value,
  testId,
  onCommit,
  onInvalid,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly testId: string;
  readonly onCommit: (paise: number) => void;
  readonly onInvalid: (message: string) => void;
}): JSX.Element {
  const stored = value === null ? "" : String(value / 100);

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
            input.value = stored;
            return;
          }
          const paise = parseRupeesToPaise(raw);
          if (paise === null) {
            onInvalid(BATCHES.priceInvalid);
            return;
          }
          if (!isSellablePaise(paise)) {
            onInvalid(paise > MRP_PAISE ? BATCHES.priceAboveMrp : BATCHES.priceTooLow);
            return;
          }
          onCommit(paise);
        }}
      />
    </>
  );
}

/**
 * The limit per person (D44), edited in place on any batch in any state.
 *
 * `perPersonLimit` stays the protected, server-computed quarter of the
 * bookable jars; this box writes `perPersonLimitOverride` beside it. The
 * computed quarter is the placeholder, so a batch nobody has touched shows
 * the number it is actually enforcing even though the box is empty, and an
 * empty box is the instruction "go back to automatic" rather than this
 * screen's usual "nothing given". A typed number stands through every later
 * planned-jar change, because only the computed field moves with the jars.
 */
function EditableLimit({
  computed,
  override,
  bookable,
  onCommit,
}: {
  readonly computed: number;
  readonly override: number | null;
  readonly bookable: number;
  readonly onCommit: (next: number | null) => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const stored = override === null ? "" : String(override);

  return (
    <>
      <label for="edit-perPersonLimitOverride">{BATCHES.limitPerPerson}</label>
      <input
        key={`perPersonLimitOverride-${override}`}
        id="edit-perPersonLimitOverride"
        type="text"
        inputMode="numeric"
        placeholder={String(computed)}
        defaultValue={stored}
        data-testid="input-perPersonLimitOverride"
        onChange={(event) => {
          const raw = (event.target as HTMLInputElement).value.trim();
          if (raw === "") {
            setError(null);
            onCommit(null);
            return;
          }
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1) {
            setError(BATCHES.limitPerPersonInvalid);
            return;
          }
          // The same ceiling `planOpen` puts on the Draft -> Open row: a cap
          // above the bookable jars is a cap on nothing.
          if (bookable > 0 && n > bookable) {
            setError(BATCHES.limitPerPersonOverBookable(bookable));
            return;
          }
          setError(null);
          onCommit(n);
        }}
      />
      <p class="field-help" data-testid="limit-help">
        {override === null ? BATCHES.limitPerPersonAuto(computed) : BATCHES.limitPerPersonHelp}
      </p>
      {error ? (
        <p class="error" data-testid="error-perPersonLimitOverride">
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
  costs,
  canEdit,
  onCommit,
}: {
  readonly costs: BatchCosts;
  readonly canEdit: boolean;
  /** The parent's `commitCostsWithUndo`: one write, one audit entry, one toast. */
  readonly onCommit: (nextCosts: BatchCosts, message: string) => Promise<void>;
}): JSX.Element {
  // Parse validation only (brief section 3: a whole number of paise, zero or
  // more). A permission refusal or a network failure on the write itself
  // surfaces through `onCommit`, which is the parent's `commitCostsWithUndo`
  // and reports at the top of the screen next to the other field writes.
  const [error, setError] = useState<string | null>(null);

  function commit(key: keyof BatchCosts, label: string, paise: number): Promise<void> {
    return onCommit({ ...costs, [key]: paise }, BATCHES.fieldChanged(label, formatINR(paise)));
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
            setError(null);
            void commit(key, label, paise as number);
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
