/**
 * One `products/{slug}` document: brief sections 17.8 and 18.1.
 *
 * Products are the Owner's alone (17.12, "set prices"; `firestore.rules`
 * gives `products/{slug}` writes to `isOwner()` only). There is no Kitchen
 * switch the way ingredients and recipes have one (D22): the Kitchen and
 * the Viewer get the same read-only view every time, with no input,
 * select, textarea or file picker rendered anywhere on the screen.
 *
 * For the Owner, editing an existing product is in place rather than a
 * single form with a Save button: brief section 17.1, "Numbers editable in
 * place, with undo on a toast for 8 seconds." Every price, the jar size and
 * every custom line's amount save the moment they change and offer 8
 * seconds to undo through {@link UndoToast}. Creating a brand new product
 * is the one exception, because there is no document yet to patch in
 * place: that path is a small form with its own Create button, and the
 * slug typed there becomes the document id and is fixed from then on.
 *
 * M2.6: the undo-eligible writes above go through `writeWithAudit`
 * (`admin/src/audit/write.ts`) instead of a bare `setDoc`, and the toast's
 * `before` is the new `audit/{id}` entry's id, not the field's old value
 * kept in this screen's own state. Undo reads that entry back and checks it
 * has not raced another edit before it restores anything (see the file
 * header there). The fields not offered undo (name, HSN, type, veg, season,
 * shipping rule, active) still go straight through `onUpdate`: M2.6 replaces
 * the undo mechanism, not every product write, and those were never part of
 * it.
 */
import {
  formatINR,
  isValidMonthDay,
  PRODUCT_TYPES,
  SHIPPING_RULES,
  type CustomLine,
  type ProductType,
  type ShippingRule,
} from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { undoAuditEntry, writeWithAudit } from "../audit/write";
import { PRODUCTS } from "../copy";
import { UndoToast, type UndoToastState } from "../ui/UndoToast";
import { isPermissionDenied, type ProductDoc, type ProductInput } from "./data";
import { isCustomLineAmountPaise, isSellablePaise, parseRupeesToPaise } from "./productMoney";
import { ProductPhotos } from "./ProductPhotos";

interface Props {
  readonly product: ProductDoc | null;
  readonly canEdit: boolean;
  readonly uid: string;
  readonly onCreate: (slug: string, input: ProductInput) => Promise<void>;
  readonly onUpdate: (patch: Partial<ProductInput>) => Promise<void>;
  readonly onClose: () => void;
  readonly error: string | null;
}

const EMPTY_CUSTOM_LINES: readonly CustomLine[] = [];

function toRupeesText(paise: number | undefined): string {
  return paise === undefined ? "" : String(paise / 100);
}

function typeLabel(type: ProductType): string {
  return type === "hero" ? PRODUCTS.productTypeHero : PRODUCTS.productTypePipeline;
}

function shippingLabel(rule: ShippingRule): string {
  if (rule === "free") return PRODUCTS.shippingFree;
  if (rule === "flatFee") return PRODUCTS.shippingFlatFee;
  return PRODUCTS.shippingFreeOnTwo;
}

export function ProductDetail({ product, canEdit, uid, onCreate, onUpdate, onClose, error }: Props): JSX.Element {
  if (!canEdit) {
    return <ReadOnlyProduct product={product} onClose={onClose} />;
  }
  if (product === null) {
    return <CreateProduct onCreate={onCreate} onClose={onClose} error={error} />;
  }
  return <EditProduct product={product} uid={uid} onUpdate={onUpdate} onClose={onClose} error={error} />;
}

/* -------------------------------------------------------------------------- */
/* Read only: the Kitchen and the Viewer, and the Owner too before D22-style   */
/* gating is decided any other way. No input, select or textarea anywhere.     */
/* -------------------------------------------------------------------------- */

function ReadOnlyProduct({
  product,
  onClose,
}: {
  readonly product: ProductDoc | null;
  readonly onClose: () => void;
}): JSX.Element {
  const customLines = product?.customLines ?? EMPTY_CUSTOM_LINES;
  return (
    <div class="detail" data-testid="product-detail">
      <p class="notice-line" data-testid="read-only-note">
        {PRODUCTS.readOnly}
      </p>
      <Field label={PRODUCTS.productName} value={product?.name ?? ""} testId="view-name" />
      <Field label={PRODUCTS.slug} value={product?.id ?? ""} testId="view-slug" />
      <Field
        label={PRODUCTS.productType}
        value={product?.type ? typeLabel(product.type) : ""}
        testId="view-type"
      />
      <Field
        label={PRODUCTS.veg}
        value={product?.veg === undefined ? "" : product.veg ? PRODUCTS.vegYes : PRODUCTS.vegNo}
        testId="view-veg"
      />
      <Field label={PRODUCTS.hsn} value={product?.hsn ?? ""} testId="view-hsn" />
      <Field
        label={PRODUCTS.priceInStock}
        value={product?.priceInStock === undefined ? "" : formatINR(product.priceInStock)}
        testId="view-priceInStock"
        numeric
      />
      <Field
        label={PRODUCTS.priceOpen}
        value={product?.priceOpen === undefined ? "" : formatINR(product.priceOpen)}
        testId="view-priceOpen"
        numeric
      />
      <Field
        label={PRODUCTS.jarGrams}
        value={product?.jarGrams === undefined ? "" : `${product.jarGrams} g`}
        testId="view-jarGrams"
        numeric
      />
      <Field
        label={PRODUCTS.shippingRule}
        value={product?.shippingRule ? shippingLabel(product.shippingRule) : ""}
        testId="view-shippingRule"
      />
      <Field label={PRODUCTS.seasonStart} value={product?.seasonStart ?? ""} testId="view-seasonStart" />
      <Field label={PRODUCTS.seasonEnd} value={product?.seasonEnd ?? ""} testId="view-seasonEnd" />
      <Field
        label={PRODUCTS.active}
        value={product?.active === undefined ? "" : product.active ? PRODUCTS.activeYes : PRODUCTS.activeNo}
        testId="view-active"
      />

      <p class="field-label">{PRODUCTS.customLines}</p>
      <ul class="percent-list" data-testid="view-customLines">
        {customLines.map((line, index) => (
          <li key={index}>
            <span class="percent-name">{line.description}</span>
            <span class="percent-value">{formatINR(line.amountPaise)}</span>
          </li>
        ))}
      </ul>
      {customLines.length === 0 ? <p data-testid="customLines-empty">{PRODUCTS.customLinesEmpty}</p> : null}

      {product !== null ? <ProductPhotos slug={product.id} canEdit={false} /> : null}

      <div class="hairline" />
      <button class="quiet" type="button" onClick={onClose}>
        {PRODUCTS.backToProducts}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Creating a new product: the one form with a Save button, because there is  */
/* no document yet for "edit in place" to patch.                              */
/* -------------------------------------------------------------------------- */

function CreateProduct({
  onCreate,
  onClose,
  error,
}: {
  readonly onCreate: (slug: string, input: ProductInput) => Promise<void>;
  readonly onClose: () => void;
  readonly error: string | null;
}): JSX.Element {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<ProductType>("pipeline");
  const [veg, setVeg] = useState(true);
  const [hsn, setHsn] = useState("");
  const [priceInStock, setPriceInStock] = useState("");
  const [priceOpen, setPriceOpen] = useState("");
  const [jarGrams, setJarGrams] = useState("200");
  const [shippingRule, setShippingRule] = useState<ShippingRule>("free");
  const [seasonStart, setSeasonStart] = useState("");
  const [seasonEnd, setSeasonEnd] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setLocalError(null);

    const trimmedSlug = slug.trim();
    if (trimmedSlug === "") {
      setLocalError(PRODUCTS.slugRequired);
      return;
    }
    if (name.trim() === "") {
      setLocalError(PRODUCTS.nameRequired);
      return;
    }
    const stockPaise = parseRupeesToPaise(priceInStock);
    const openPaise = parseRupeesToPaise(priceOpen);
    if (stockPaise === null || openPaise === null) {
      setLocalError(PRODUCTS.priceInvalid);
      return;
    }
    if (!isSellablePaise(stockPaise)) {
      setLocalError(PRODUCTS.priceAboveMrp);
      return;
    }
    if (!isSellablePaise(openPaise)) {
      setLocalError(PRODUCTS.priceAboveMrp);
      return;
    }
    const grams = Number(jarGrams.trim());
    if (!Number.isInteger(grams) || grams <= 0) {
      setLocalError(PRODUCTS.jarGramsInvalid);
      return;
    }
    const start = seasonStart.trim();
    const end = seasonEnd.trim();
    if ((start === "" && end !== "") || (start !== "" && !isValidMonthDay(start))) {
      setLocalError(PRODUCTS.seasonInvalid);
      return;
    }
    if ((end === "" && start !== "") || (end !== "" && !isValidMonthDay(end))) {
      setLocalError(PRODUCTS.seasonInvalid);
      return;
    }

    setBusy(true);
    try {
      await onCreate(trimmedSlug, {
        name: name.trim(),
        type,
        veg,
        hsn: hsn.trim(),
        priceInStock: stockPaise,
        priceOpen: openPaise,
        jarGrams: grams,
        shippingRule,
        seasonStart: start === "" ? null : start,
        seasonEnd: end === "" ? null : end,
        active,
        customLines: [],
      });
    } catch (caught) {
      setLocalError(isPermissionDenied(caught) ? PRODUCTS.saveRefused : PRODUCTS.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="detail" data-testid="product-form" onSubmit={(event) => void submit(event)}>
      <label for="slug">{PRODUCTS.slug}</label>
      <input
        id="slug"
        name="slug"
        type="text"
        value={slug}
        onInput={(event) => setSlug((event.target as HTMLInputElement).value)}
      />
      <p class="field-help">{PRODUCTS.slugHelp}</p>

      <label for="name">{PRODUCTS.productName}</label>
      <input
        id="name"
        name="name"
        type="text"
        value={name}
        onInput={(event) => setName((event.target as HTMLInputElement).value)}
      />

      <label for="type">{PRODUCTS.productType}</label>
      <select
        id="type"
        name="type"
        value={type}
        onChange={(event) => setType((event.target as HTMLSelectElement).value as ProductType)}
      >
        {PRODUCT_TYPES.map((option) => (
          <option key={option} value={option}>
            {typeLabel(option)}
          </option>
        ))}
      </select>

      <label class="check-row" for="veg">
        <input
          id="veg"
          type="checkbox"
          checked={veg}
          onChange={(event) => setVeg((event.target as HTMLInputElement).checked)}
        />
        {veg ? PRODUCTS.vegYes : PRODUCTS.vegNo}
      </label>

      <label for="hsn">{PRODUCTS.hsn}</label>
      <input
        id="hsn"
        name="hsn"
        type="text"
        value={hsn}
        onInput={(event) => setHsn((event.target as HTMLInputElement).value)}
      />

      <label for="priceInStock">{PRODUCTS.priceInStock}</label>
      <input
        id="priceInStock"
        name="priceInStock"
        type="text"
        inputMode="decimal"
        value={priceInStock}
        onInput={(event) => setPriceInStock((event.target as HTMLInputElement).value)}
      />

      <label for="priceOpen">{PRODUCTS.priceOpen}</label>
      <input
        id="priceOpen"
        name="priceOpen"
        type="text"
        inputMode="decimal"
        value={priceOpen}
        onInput={(event) => setPriceOpen((event.target as HTMLInputElement).value)}
      />

      <label for="jarGrams">{PRODUCTS.jarGrams}</label>
      <input
        id="jarGrams"
        name="jarGrams"
        type="text"
        inputMode="numeric"
        value={jarGrams}
        onInput={(event) => setJarGrams((event.target as HTMLInputElement).value)}
      />

      <label for="shippingRule">{PRODUCTS.shippingRule}</label>
      <select
        id="shippingRule"
        name="shippingRule"
        value={shippingRule}
        onChange={(event) => setShippingRule((event.target as HTMLSelectElement).value as ShippingRule)}
      >
        {SHIPPING_RULES.map((option) => (
          <option key={option} value={option}>
            {shippingLabel(option)}
          </option>
        ))}
      </select>

      <label for="seasonStart">{PRODUCTS.seasonStart}</label>
      <input
        id="seasonStart"
        name="seasonStart"
        type="text"
        placeholder="MM-DD"
        value={seasonStart}
        onInput={(event) => setSeasonStart((event.target as HTMLInputElement).value)}
      />

      <label for="seasonEnd">{PRODUCTS.seasonEnd}</label>
      <input
        id="seasonEnd"
        name="seasonEnd"
        type="text"
        placeholder="MM-DD"
        value={seasonEnd}
        onInput={(event) => setSeasonEnd((event.target as HTMLInputElement).value)}
      />
      <p class="field-help">{PRODUCTS.seasonHelp}</p>

      <label class="check-row" for="active">
        <input
          id="active"
          type="checkbox"
          checked={active}
          onChange={(event) => setActive((event.target as HTMLInputElement).checked)}
        />
        {active ? PRODUCTS.activeYes : PRODUCTS.activeNo}
      </label>

      {localError ?? error ? (
        <p class="error" data-testid="save-error">
          {localError ?? error}
        </p>
      ) : null}

      <div class="hairline" />
      <button type="submit" disabled={busy} data-testid="save-product">
        {busy ? PRODUCTS.creating : PRODUCTS.createProduct}
      </button>
      <div class="hairline" />
      <button class="quiet" type="button" onClick={onClose}>
        {PRODUCTS.cancel}
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Editing an existing product: every field saves at once. Text and number    */
/* boxes are uncontrolled (`defaultValue`, keyed on the committed value) so a  */
/* re-render from one field's save never overwrites what a person is mid-way  */
/* through typing into another.                                              */
/* -------------------------------------------------------------------------- */

function EditProduct({
  product,
  uid,
  onUpdate,
  onClose,
  error,
}: {
  readonly product: ProductDoc;
  readonly uid: string;
  readonly onUpdate: (patch: Partial<ProductInput>) => Promise<void>;
  readonly onClose: () => void;
  readonly error: string | null;
}): JSX.Element {
  const [current, setCurrent] = useState<ProductDoc>(product);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // M2.6: the toast's `before` is now the audit entry this write just
  // created, not the field's old value (see the file header).
  const [toast, setToast] = useState<UndoToastState<string> | null>(null);
  const [newLineDescription, setNewLineDescription] = useState("");
  const [newLineAmount, setNewLineAmount] = useState("");

  const customLines = current.customLines ?? EMPTY_CUSTOM_LINES;

  /** The fields not offered undo: no audit trail, straight to Firestore. */
  async function applyPatch(patch: Partial<ProductInput>): Promise<boolean> {
    setFieldError(null);
    try {
      await onUpdate(patch);
      setCurrent((existing) => ({ ...existing, ...patch }));
      return true;
    } catch (caught) {
      setFieldError(isPermissionDenied(caught) ? PRODUCTS.saveRefused : PRODUCTS.saveFailed);
      return false;
    }
  }

  /**
   * The undo-eligible writes: price, jar size, a custom line's amount. Goes
   * through `writeWithAudit` so the field write and its `audit/{id}` entry
   * commit together (never one without the other), and the toast is handed
   * the new entry's id rather than the value it is offering to restore.
   */
  async function commitWithUndo(
    patch: Partial<ProductInput>,
    before: Partial<ProductInput>,
    message: string,
  ): Promise<void> {
    setFieldError(null);
    try {
      const { auditId } = await writeWithAudit({
        object: `products/${current.id}`,
        action: "update",
        patch: patch as Record<string, unknown>,
        before: before as Record<string, unknown>,
        by: uid,
      });
      setCurrent((existing) => ({ ...existing, ...patch }));
      setToast({ message, before: auditId });
    } catch (caught) {
      setFieldError(isPermissionDenied(caught) ? PRODUCTS.saveRefused : PRODUCTS.saveFailed);
    }
  }

  /**
   * A product is the Owner's alone (brief 17.12), and this screen is only
   * ever reached with `canEdit` true, so every field on it is Owner-writable:
   * there is no per-field restriction to check the way a batch has one.
   */
  async function handleUndo(auditId: string): Promise<void> {
    setToast(null);
    const outcome = await undoAuditEntry(auditId, uid, () => true);
    if (!outcome.ok) {
      setFieldError(
        outcome.reason === "raced"
          ? PRODUCTS.undoRaced
          : outcome.reason === "forbidden"
            ? PRODUCTS.undoForbidden
            : PRODUCTS.undoGone,
      );
      return;
    }
    setCurrent((existing) => ({ ...existing, ...(outcome.restored as Partial<ProductInput>) }));
    setToast({ message: PRODUCTS.undone, before: outcome.auditId });
  }

  function commitPriceInStock(text: string): void {
    const parsed = parseRupeesToPaise(text);
    if (parsed === null) {
      setFieldError(PRODUCTS.priceInvalid);
      return;
    }
    if (!isSellablePaise(parsed)) {
      setFieldError(PRODUCTS.priceAboveMrp);
      return;
    }
    const before = current.priceInStock ?? 0;
    if (before === parsed) return;
    void commitWithUndo(
      { priceInStock: parsed },
      { priceInStock: before },
      PRODUCTS.fieldChanged(PRODUCTS.priceInStock, formatINR(parsed)),
    );
  }

  function commitPriceOpen(text: string): void {
    const parsed = parseRupeesToPaise(text);
    if (parsed === null) {
      setFieldError(PRODUCTS.priceInvalid);
      return;
    }
    if (!isSellablePaise(parsed)) {
      setFieldError(PRODUCTS.priceAboveMrp);
      return;
    }
    const before = current.priceOpen ?? 0;
    if (before === parsed) return;
    void commitWithUndo(
      { priceOpen: parsed },
      { priceOpen: before },
      PRODUCTS.fieldChanged(PRODUCTS.priceOpen, formatINR(parsed)),
    );
  }

  function commitJarGrams(text: string): void {
    const value = Number(text.trim());
    if (!Number.isInteger(value) || value <= 0) {
      setFieldError(PRODUCTS.jarGramsInvalid);
      return;
    }
    const before = current.jarGrams ?? 0;
    if (before === value) return;
    void commitWithUndo(
      { jarGrams: value },
      { jarGrams: before },
      PRODUCTS.fieldChanged(PRODUCTS.jarGrams, `${value} g`),
    );
  }

  function commitName(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "") {
      setFieldError(PRODUCTS.nameRequired);
      return;
    }
    if (current.name === trimmed) return;
    void applyPatch({ name: trimmed });
  }

  function commitHsn(text: string): void {
    const trimmed = text.trim();
    if (current.hsn === trimmed) return;
    void applyPatch({ hsn: trimmed });
  }

  function commitSeasonStart(text: string): void {
    const trimmed = text.trim();
    if (trimmed !== "" && !isValidMonthDay(trimmed)) {
      setFieldError(PRODUCTS.seasonInvalid);
      return;
    }
    const next = trimmed === "" ? null : trimmed;
    if ((current.seasonStart ?? null) === next) return;
    void applyPatch({ seasonStart: next });
  }

  function commitSeasonEnd(text: string): void {
    const trimmed = text.trim();
    if (trimmed !== "" && !isValidMonthDay(trimmed)) {
      setFieldError(PRODUCTS.seasonInvalid);
      return;
    }
    const next = trimmed === "" ? null : trimmed;
    if ((current.seasonEnd ?? null) === next) return;
    void applyPatch({ seasonEnd: next });
  }

  function commitCustomLineDescription(index: number, text: string): void {
    const trimmed = text.trim();
    if (customLines[index]?.description === trimmed) return;
    const next = customLines.map((line, i) => (i === index ? { ...line, description: trimmed } : line));
    void applyPatch({ customLines: next });
  }

  function commitCustomLineAmount(index: number, text: string): void {
    const parsed = parseRupeesToPaise(text);
    if (parsed === null) {
      setFieldError(PRODUCTS.priceInvalid);
      return;
    }
    if (!isCustomLineAmountPaise(parsed)) {
      setFieldError(PRODUCTS.priceTooLow);
      return;
    }
    const before = customLines;
    if (before[index]?.amountPaise === parsed) return;
    const next = before.map((line, i) => (i === index ? { ...line, amountPaise: parsed } : line));
    void commitWithUndo(
      { customLines: next },
      { customLines: before },
      PRODUCTS.fieldChanged(before[index]?.description ?? PRODUCTS.customLineAmount, formatINR(parsed)),
    );
  }

  function addCustomLine(): void {
    const description = newLineDescription.trim();
    const amount = parseRupeesToPaise(newLineAmount);
    if (description === "" || amount === null) {
      setFieldError(PRODUCTS.priceInvalid);
      return;
    }
    if (!isCustomLineAmountPaise(amount)) {
      setFieldError(PRODUCTS.priceTooLow);
      return;
    }
    const line: CustomLine = { description, amountPaise: amount };
    void applyPatch({ customLines: [...customLines, line] }).then((ok) => {
      if (ok) {
        setNewLineDescription("");
        setNewLineAmount("");
      }
    });
  }

  function removeCustomLine(index: number): void {
    void applyPatch({ customLines: customLines.filter((_, i) => i !== index) });
  }

  return (
    <div class="detail" data-testid="product-detail">
      <UndoToast toast={toast} onUndo={handleUndo} onExpire={() => setToast(null)} />

      <div class="settings-field">
        <p class="field-label">{PRODUCTS.slug}</p>
        <p class="field-value" data-testid="view-slug">
          {current.id}
        </p>
      </div>

      <label for="edit-name">{PRODUCTS.productName}</label>
      <input
        key={`name-${current.name}`}
        id="edit-name"
        type="text"
        defaultValue={current.name ?? ""}
        onChange={(event) => commitName((event.target as HTMLInputElement).value)}
      />

      <label for="edit-type">{PRODUCTS.productType}</label>
      <select
        id="edit-type"
        value={current.type ?? "pipeline"}
        onChange={(event) => void applyPatch({ type: (event.target as HTMLSelectElement).value as ProductType })}
      >
        {PRODUCT_TYPES.map((option) => (
          <option key={option} value={option}>
            {typeLabel(option)}
          </option>
        ))}
      </select>

      <p class="field-label">{PRODUCTS.veg}</p>
      <label class="check-row" for="edit-veg">
        <input
          id="edit-veg"
          type="checkbox"
          checked={current.veg === true}
          onChange={(event) => void applyPatch({ veg: (event.target as HTMLInputElement).checked })}
        />
        {current.veg ? PRODUCTS.vegYes : PRODUCTS.vegNo}
      </label>

      <label for="edit-hsn">{PRODUCTS.hsn}</label>
      <input
        key={`hsn-${current.hsn}`}
        id="edit-hsn"
        type="text"
        defaultValue={current.hsn ?? ""}
        onChange={(event) => commitHsn((event.target as HTMLInputElement).value)}
      />

      <label for="edit-priceInStock">{PRODUCTS.priceInStock}</label>
      <input
        key={`priceInStock-${current.priceInStock}`}
        id="edit-priceInStock"
        type="text"
        inputMode="decimal"
        defaultValue={toRupeesText(current.priceInStock)}
        data-testid="input-priceInStock"
        onChange={(event) => commitPriceInStock((event.target as HTMLInputElement).value)}
      />

      <label for="edit-priceOpen">{PRODUCTS.priceOpen}</label>
      <input
        key={`priceOpen-${current.priceOpen}`}
        id="edit-priceOpen"
        type="text"
        inputMode="decimal"
        defaultValue={toRupeesText(current.priceOpen)}
        data-testid="input-priceOpen"
        onChange={(event) => commitPriceOpen((event.target as HTMLInputElement).value)}
      />

      <label for="edit-jarGrams">{PRODUCTS.jarGrams}</label>
      <input
        key={`jarGrams-${current.jarGrams}`}
        id="edit-jarGrams"
        type="text"
        inputMode="numeric"
        defaultValue={current.jarGrams === undefined ? "" : String(current.jarGrams)}
        data-testid="input-jarGrams"
        onChange={(event) => commitJarGrams((event.target as HTMLInputElement).value)}
      />

      <label for="edit-shippingRule">{PRODUCTS.shippingRule}</label>
      <select
        id="edit-shippingRule"
        value={current.shippingRule ?? "free"}
        onChange={(event) =>
          void applyPatch({ shippingRule: (event.target as HTMLSelectElement).value as ShippingRule })
        }
      >
        {SHIPPING_RULES.map((option) => (
          <option key={option} value={option}>
            {shippingLabel(option)}
          </option>
        ))}
      </select>

      <label for="edit-seasonStart">{PRODUCTS.seasonStart}</label>
      <input
        key={`seasonStart-${current.seasonStart}`}
        id="edit-seasonStart"
        type="text"
        placeholder="MM-DD"
        defaultValue={current.seasonStart ?? ""}
        onChange={(event) => commitSeasonStart((event.target as HTMLInputElement).value)}
      />

      <label for="edit-seasonEnd">{PRODUCTS.seasonEnd}</label>
      <input
        key={`seasonEnd-${current.seasonEnd}`}
        id="edit-seasonEnd"
        type="text"
        placeholder="MM-DD"
        defaultValue={current.seasonEnd ?? ""}
        onChange={(event) => commitSeasonEnd((event.target as HTMLInputElement).value)}
      />
      <p class="field-help">{PRODUCTS.seasonHelp}</p>

      <p class="field-label">{PRODUCTS.active}</p>
      <label class="check-row" for="edit-active">
        <input
          id="edit-active"
          type="checkbox"
          checked={current.active === true}
          onChange={(event) => void applyPatch({ active: (event.target as HTMLInputElement).checked })}
        />
        {current.active ? PRODUCTS.activeYes : PRODUCTS.activeNo}
      </label>

      <p class="field-label">{PRODUCTS.customLines}</p>
      <p class="field-help">{PRODUCTS.customLinesHelp}</p>
      <ul class="line-list" data-testid="custom-line-list">
        {customLines.map((line, index) => (
          <li key={index} class="line-row" data-testid={`custom-line-${index}`}>
            <label for={`custom-line-${index}-description`}>{PRODUCTS.customLineDescription}</label>
            <input
              key={`cl-desc-${index}-${line.description}`}
              id={`custom-line-${index}-description`}
              type="text"
              defaultValue={line.description}
              onChange={(event) => commitCustomLineDescription(index, (event.target as HTMLInputElement).value)}
            />

            <label for={`custom-line-${index}-amount`}>{PRODUCTS.customLineAmount}</label>
            <input
              key={`cl-amt-${index}-${line.amountPaise}`}
              id={`custom-line-${index}-amount`}
              type="text"
              inputMode="decimal"
              defaultValue={toRupeesText(line.amountPaise)}
              data-testid={`custom-line-amount-${index}`}
              onChange={(event) => commitCustomLineAmount(index, (event.target as HTMLInputElement).value)}
            />

            <button
              type="button"
              class="quiet"
              data-testid={`remove-custom-line-${index}`}
              onClick={() => removeCustomLine(index)}
            >
              {PRODUCTS.removeCustomLine}
            </button>
          </li>
        ))}
      </ul>
      {customLines.length === 0 ? <p data-testid="customLines-empty">{PRODUCTS.customLinesEmpty}</p> : null}

      <div class="line-row">
        <label for="new-line-description">{PRODUCTS.customLineDescription}</label>
        <input
          id="new-line-description"
          type="text"
          value={newLineDescription}
          onInput={(event) => setNewLineDescription((event.target as HTMLInputElement).value)}
        />
        <label for="new-line-amount">{PRODUCTS.customLineAmount}</label>
        <input
          id="new-line-amount"
          type="text"
          inputMode="decimal"
          value={newLineAmount}
          onInput={(event) => setNewLineAmount((event.target as HTMLInputElement).value)}
        />
        <button type="button" class="quiet" data-testid="add-custom-line" onClick={addCustomLine}>
          {PRODUCTS.addCustomLine}
        </button>
      </div>

      {fieldError ?? error ? (
        <p class="error" data-testid="save-error">
          {fieldError ?? error}
        </p>
      ) : null}

      <ProductPhotos slug={current.id} canEdit={true} />

      <div class="hairline" />
      <button class="quiet" type="button" onClick={onClose}>
        {PRODUCTS.backToProducts}
      </button>
    </div>
  );
}

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
