/**
 * The New sale screen, brief section 7A.1: "One screen, top to bottom, big
 * buttons, done in under a minute at the door."
 *
 * The seven steps of 7A.1 are the seven sections below, in that order, so
 * the screen reads the way the sale happens: who, what, how much, how it
 * goes, how it was paid, what they agreed to, save.
 *
 * **This component never decides anything that matters.** It writes no
 * order, no count and no rupee: `createCounterSale` does all of that inside
 * one transaction (`functions/src/orders/createCounterSale.ts`). What is
 * shown here is worked out with the very same functions the callable plans
 * with, `saleTotals`, `discountRights` and `checkDiscount` out of
 * `@lailark/shared`, so the number on the screen and the number that is
 * charged are the same number by construction. Where the two could still
 * disagree (a price that moved while the screen was open), the request
 * carries `expectedTotalPaise` and the server refuses the sale rather than
 * charging the difference: CLAUDE.md section 3, no surprise charges.
 *
 * Money is integers in paise throughout. A rupee exists only as the string
 * in a box, for as long as somebody is typing it, and `parseRupeesToPaise`
 * is the one door back.
 */
import {
  formatINR,
  checkDiscount,
  MRP_PAISE,
  type Paise,
  saleTotals,
  type SaleLineKind,
} from "@lailark/shared";
import type { JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";

import { useBatches } from "../batches/data";
import { FULFILMENT_LABEL, PAYMENT_LABEL, SELL } from "../copy";
import { parseIndianMobile, formatIndianMobile } from "../phone";
import { useProducts } from "../products/data";
import { parseRupeesToPaise } from "../products/productMoney";
import type { Session } from "../session";
import {
  callCreateCounterSale,
  isNewCustomerRefusal,
  isOverLimitRefusal,
  nearMissesFrom,
  saleErrorMessage,
  sellableBatchesFor,
  useCustomer,
  useDiscountRights,
  type CounterSaleResult,
  type NearMiss,
  type SellableBatch,
} from "./data";
import { canSaveFrom, computeOutstanding } from "./saveGate";

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

/** Brief 7A.1 step 4 and 5: the buttons that are one of a set. */
function ChipRow<T extends string>(props: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onPick: (value: T) => void;
  readonly testId: string;
}): JSX.Element {
  return (
    <div class="tab-row" data-testid={props.testId}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          id={`${props.testId}-${option.value}`}
          class={`chip${props.value === option.value ? " chip-on" : ""}`}
          aria-pressed={props.value === option.value}
          data-testid={`${props.testId}-${option.value}`}
          onClick={() => props.onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A number on this screen is rust, which is the only thing rust is for. */
function Money({ label, paise, testId }: { label: string; paise: Paise; testId: string }): JSX.Element {
  return (
    <div class="settings-field">
      <span class="field-label">{label}</span>
      <span class="field-value number" data-testid={testId}>
        {formatINR(paise)}
      </span>
    </div>
  );
}

function batchName(batch: SellableBatch): string {
  return batch.batchNo === null ? `Batch ${batch.ref}` : `Batch ${batch.batchNo}`;
}

/* -------------------------------------------------------------------------- */
/* The screen                                                                 */
/* -------------------------------------------------------------------------- */

type Fulfilment = "handedOver" | "ship" | "collect";
type Payment = "cash" | "upiToAccount" | "paymentLink";

interface Props {
  readonly session: Session;
  /** Told when a sale lands, so today's list knows to look fresh. */
  readonly onSold?: (result: CounterSaleResult) => void;
}

/**
 * An id for one sale at the counter. `crypto.randomUUID` where the browser
 * has it, and a random string where it does not: this only has to be
 * different from every other sale, not unguessable.
 */
function newClientRef(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `sale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function NewSale({ session, onSold }: Props): JSX.Element {
  /* ---- 1. Customer ---------------------------------------------------- */
  const [phoneText, setPhoneText] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [nearMisses, setNearMisses] = useState<readonly NearMiss[]>([]);
  const [askingNewCustomer, setAskingNewCustomer] = useState(false);
  /**
   * Brief 7A.6: "Override the per-person limit" is the Owner's row and his
   * alone. It is offered only after the limit has actually refused a sale,
   * never as a standing switch: a limit that can be waived before it is hit
   * is not a limit, and the Owner should have to see the sentence he is
   * overruling. The server checks the role again and records that it was
   * waived (`limitOverridden` on the order).
   */
  const [offerOverride, setOfferOverride] = useState(false);

  const parsedPhone = parseIndianMobile(phoneText);
  const phoneE164 = parsedPhone.ok ? parsedPhone.e164 : null;
  const { customer, loading: customerLoading, known } = useCustomer(phoneE164);

  // A known customer's name fills itself in, and stays filled in, until the
  // person at the counter types over it: brief 7A.1 step 1, "if known, name
  // and last address fill in".
  //
  // The **last address** half of that line is not built. Addresses live in
  // `customers/{phone}/addresses` and nothing has written one yet: online
  // orders arrive in M3, and a counter sale is the first thing that could
  // create one. Prefilling from an empty collection would be a box that
  // never fills, so a shipped counter sale is typed in full for now and
  // M3.6 wires the address book to both ends of it. Saying that here is
  // better than a control that looks like it remembers and does not.
  const shownName = nameTouched ? name : (customer?.name ?? name);

  /* ---- 2. What --------------------------------------------------------- */
  const products = useProducts();
  const batches = useBatches();

  // ASSUMED (M2.8): one line per sale. Brief 7A.1 step 2 is written in the
  // singular throughout ("Pick a product", "Or a custom line", "Quantity"),
  // the order shape carries an array because an online order will need one,
  // and a counter sale of two different things is two sales at a door where
  // the whole point is being done in under a minute. A cart is M3's problem,
  // and nothing here forecloses it: the request already sends a line, not a
  // flat body.
  const [productSlug, setProductSlug] = useState("");
  const [pickedBatchRef, setPickedBatchRef] = useState<string | null>(null);
  const [qtyText, setQtyText] = useState("1");
  const [isCustom, setIsCustom] = useState(false);
  const [customDescription, setCustomDescription] = useState("");
  const [customAmountText, setCustomAmountText] = useState("");
  const [customTakesJars, setCustomTakesJars] = useState(false);

  const product = products.items.find((p) => p.id === productSlug) ?? null;
  const offeredCustomLines = (product?.customLines ?? []) as readonly {
    description: string;
    amountPaise: number;
  }[];

  const sellable = useMemo(
    () => (productSlug === "" ? [] : sellableBatchesFor(batches.items, productSlug)),
    [batches.items, productSlug],
  );
  // Oldest in stock first is what the server would suggest anyway (7A.1 step
  // 2), so the screen shows that choice rather than making somebody guess it.
  const batch = sellable.find((b) => b.ref === pickedBatchRef) ?? sellable[0] ?? null;

  const qty = Number.parseInt(qtyText, 10);
  const qtyOk = Number.isInteger(qty) && qty >= 1;

  /* ---- 3. Amount ------------------------------------------------------- */
  const rights = useDiscountRights(session.role);

  const [unitPriceText, setUnitPriceText] = useState("");
  const [discountText, setDiscountText] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  const customAmount = parseRupeesToPaise(customAmountText);
  const ownerPrice = rights.mayChangePrice && unitPriceText.trim() !== "" ? parseRupeesToPaise(unitPriceText) : null;

  const kind: SaleLineKind = isCustom ? "custom" : (batch?.kind ?? "product");
  const unitPrice: Paise = isCustom ? (customAmount ?? 0) : (ownerPrice ?? batch?.unitPrice ?? 0);

  const discount: Paise = discountText.trim() === "" ? 0 : (parseRupeesToPaise(discountText) ?? 0);

  const totals = saleTotals({
    lines: [{ kind, unitPrice, qty: qtyOk ? qty : 0, batchRef: batch?.ref ?? null }],
    // A discount larger than the sale would make the total read as a negative
    // number while somebody is still typing. It is refused below either way,
    // so the figure on screen stays the honest one: the sale before the
    // discount that cannot be given.
    discount: 0,
  });
  const discountVerdict = checkDiscount({
    discount,
    reason: discountReason,
    subtotal: totals.subtotal,
    rights,
  });
  const discountAllowed = discountVerdict.ok ? discount : 0;
  const total: Paise = totals.subtotal - discountAllowed;

  /* ---- 4. Fulfilment --------------------------------------------------- */
  const [fulfilment, setFulfilment] = useState<Fulfilment>("handedOver");
  const [addressName, setAddressName] = useState("");
  const [addressPhone, setAddressPhone] = useState("");
  const [addressLines, setAddressLines] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressPincode, setAddressPincode] = useState("");

  /* ---- 5. Payment ------------------------------------------------------ */
  const [payment, setPayment] = useState<Payment>("cash");
  const [upiRef, setUpiRef] = useState("");

  /* ---- 6. Consent ------------------------------------------------------ */
  //
  // ASSUMED (M2.8): the bill tick starts on and the "tell me when a batch
  // opens" tick starts off. The brief gives the two sentences and no default.
  // They are not the same kind of thing: the first is the customer's own bill
  // reaching the customer, which is what the whole of 7A.2 assumes, and the
  // second is a marketing list. A pre-ticked marketing box is a dark pattern
  // (CLAUDE.md section 3), so it is never pre-ticked. Either can be unticked
  // before saving, and an unticked box never withdraws a consent already on
  // file: withdrawing is its own action on the Customers screen.
  const [consentUpdates, setConsentUpdates] = useState(true);
  const [consentMarketing, setConsentMarketing] = useState(false);

  /* ---- 7. Save --------------------------------------------------------- */
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  /**
   * One id for this sale, minted when the form is first shown and sent with
   * every attempt at it, including the second attempt after a new number is
   * confirmed and the Owner's attempt with the limit overridden. Those are
   * the same sale, so they must carry the same key: the server writes one
   * order for it however many times it arrives. Cleared only when the form is
   * reset for the next customer.
   */
  const clientRef = useRef(newClientRef());
  const [error, setError] = useState<string | null>(null);
  const [sold, setSold] = useState<CounterSaleResult | null>(null);

  /* ---- what the screen itself refuses ---------------------------------- */

  const phoneProblem =
    phoneText.trim() === ""
      ? null
      : parsedPhone.ok
        ? null
        : parsedPhone.reason === "notIndian"
          ? SELL.phoneNotIndian
          : SELL.phoneInvalid;

  const needsName = phoneE164 !== null && !customerLoading && !known;
  const discountProblem =
    discount === 0 || discountVerdict.ok
      ? null
      : discountVerdict.reason === "noReason"
        ? SELL.discountNeedsReason
        : discountVerdict.reason === "overSubtotal"
          ? SELL.discountOverSubtotal
          : discountVerdict.reason === "overCap"
            ? rights.maxDiscount === null || rights.maxDiscount === 0
              ? SELL.discountNoRights
              : SELL.discountOverCap(formatINR(rights.maxDiscount))
            : SELL.priceInvalid;

  const priceProblem =
    ownerPrice !== null && (ownerPrice < 1 || ownerPrice > MRP_PAISE) ? SELL.priceAboveMrp : null;

  const addressReady =
    fulfilment !== "ship" ||
    (addressName.trim() !== "" &&
      parseIndianMobile(addressPhone).ok &&
      addressLines.trim() !== "" &&
      addressCity.trim() !== "" &&
      addressState.trim() !== "" &&
      /^[1-9]\d{5}$/.test(addressPincode.trim()));

  /**
   * M2.15: `outstanding` is the one list of reasons this sale cannot be
   * saved yet; `canSave` is derived from it (`canSaveFrom` below) rather
   * than written next to it as a second, separately maintained boolean.
   * Two independent expressions of the same nine preconditions had already
   * drifted once: a Kitchen custom line with nothing set up in Products
   * made `lineReady` false (so `canSave` was correctly disabled) without
   * `outstanding` ever saying why. See `saveGate.ts` for the full account
   * and the logic itself, which is exercised on its own in
   * `saveGate.test.ts`.
   */
  const outstanding = useMemo(
    () =>
      computeOutstanding({
        phoneText,
        phoneProblem,
        phoneE164,
        needsName,
        shownName,
        askingNewCustomer,
        isCustom,
        mayChangePrice: rights.mayChangePrice,
        customDescription,
        customAmount,
        offeredCustomLinesCount: offeredCustomLines.length,
        hasBatch: batch !== null,
        qtyOk,
        priceProblem,
        discountProblem,
        total,
        fulfilment,
        addressReady,
        addressName,
        addressPhone,
        addressLines,
        addressCity,
        addressState,
      }),
    [
      phoneText,
      phoneProblem,
      phoneE164,
      needsName,
      shownName,
      askingNewCustomer,
      isCustom,
      rights.mayChangePrice,
      customDescription,
      customAmount,
      offeredCustomLines.length,
      batch,
      qtyOk,
      priceProblem,
      discountProblem,
      total,
      fulfilment,
      addressReady,
      addressName,
      addressPhone,
      addressLines,
      addressCity,
      addressState,
    ],
  );

  const canSave = canSaveFrom(outstanding, saving);

  /**
   * Scrolls the outstanding field into the middle of the screen and focuses
   * it, so a tap on the outstanding list is a tap that goes somewhere, not
   * just a longer sentence. A phone-sized viewport is the case this is for:
   * the field is very often off the bottom of the screen, or (the confirm
   * button) off the top of it.
   */
  function jumpTo(targetId: string): void {
    const el = document.getElementById(targetId);
    if (el === null) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  }

  function reset(): void {
    // The next customer is a different sale, so it gets a different key.
    clientRef.current = newClientRef();
    setPhoneText("");
    setName("");
    setNameTouched(false);
    setNearMisses([]);
    setAskingNewCustomer(false);
    setProductSlug("");
    setPickedBatchRef(null);
    setQtyText("1");
    setIsCustom(false);
    setCustomDescription("");
    setCustomAmountText("");
    setCustomTakesJars(false);
    setUnitPriceText("");
    setDiscountText("");
    setDiscountReason("");
    setFulfilment("handedOver");
    setAddressName("");
    setAddressPhone("");
    setAddressLines("");
    setAddressCity("");
    setAddressState("");
    setAddressPincode("");
    setPayment("cash");
    setUpiRef("");
    setConsentUpdates(true);
    setConsentMarketing(false);
    setNote("");
    setError(null);
    setSold(null);
    setOfferOverride(false);
  }

  /**
   * `confirmNewCustomer` is an argument rather than state because the second
   * attempt happens in the same tap as the confirmation: reading it back out
   * of state would send the old value.
   *
   * ASSUMED (M2.8): the near-miss check is the first Save, not a step of its
   * own before the form. A number is checked against `customers/{id}` by the
   * server, which is where the truth is, and asking before the sale is
   * written costs nothing; putting a "check this number" button ahead of the
   * form would be one more tap on every sale to catch the rare one. So the
   * ordinary sale is one tap, and only a number nobody has seen before ever
   * stops to ask.
   */
  async function save(confirmNewCustomer: boolean, overrideLimit = false): Promise<void> {
    if (phoneE164 === null) return;
    setSaving(true);
    setError(null);

    const batchRef = isCustom ? (customTakesJars ? (batch?.ref ?? null) : null) : (batch?.ref ?? null);

    try {
      const result = await callCreateCounterSale({
        clientRef: clientRef.current,
        customerPhone: phoneE164,
        customerName: shownName.trim() === "" ? null : shownName.trim(),
        confirmNewCustomer,
        line: {
          kind,
          productSlug: productSlug === "" ? null : productSlug,
          batchRef,
          qty,
          customDescription: isCustom ? customDescription.trim() : null,
          amountPaise: isCustom ? customAmount : null,
          unitPricePaise: !isCustom && ownerPrice !== null ? ownerPrice : null,
        },
        discountPaise: discountAllowed,
        discountReason: discountReason.trim(),
        fulfilment,
        deliveryContact:
          fulfilment === "ship"
            ? {
                name: addressName.trim(),
                phone: addressPhone.trim(),
                lines: addressLines
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line !== ""),
                city: addressCity.trim(),
                state: addressState.trim(),
                pincode: addressPincode.trim(),
              }
            : null,
        paymentMethod: payment,
        upiRef: payment === "upiToAccount" && upiRef.trim() !== "" ? upiRef.trim() : null,
        consents: { updates: consentUpdates, marketing: consentMarketing },
        // What the person was told. The server refuses the sale if its own
        // total differs, rather than charging the difference.
        expectedTotalPaise: total,
        kitchenNote: note.trim() === "" ? null : note.trim(),
        overrideLimit,
      });
      setSold(result);
      setNearMisses([]);
      setAskingNewCustomer(false);
      setOfferOverride(false);
      onSold?.(result);
    } catch (err) {
      if (isNewCustomerRefusal(err)) {
        // Brief 7A.1 step 1, and the reason `nearMissNumbers` exists: a wrong
        // digit at the door does not fail, it quietly invents a stranger. So
        // the sale stops once, names whoever the number is one slip from, and
        // waits to be told which it is.
        setNearMisses(nearMissesFrom(err));
        setAskingNewCustomer(true);
        setError(null);
      } else {
        setError(saleErrorMessage(err, SELL.saveFailed));
        // 7A.6: the only refusal with a way past it, and only for the Owner.
        setOfferOverride(rights.mayOverrideLimit && isOverLimitRefusal(err));
      }
    } finally {
      setSaving(false);
    }
  }

  /* ---- the sale that just happened ------------------------------------- */

  if (sold !== null) {
    return (
      <section class="sale-done" data-testid="sale-done">
        <h2 class="section-heading">{SELL.soldHeading}</h2>
        <p data-testid="sold-line">{SELL.soldLine(sold.lineDescription, formatINR(sold.total))}</p>
        {sold.paid ? null : <p class="notice-line">{SELL.soldAwaitingPayment}</p>}
        {sold.customerCreated ? (
          <p class="notice-line" data-testid="sold-customer-created">
            {SELL.soldCustomerCreated(shownName.trim())}
          </p>
        ) : null}
        <button type="button" data-testid="new-sale-again" onClick={reset}>
          {SELL.another}
        </button>
      </section>
    );
  }

  /* ---- the form -------------------------------------------------------- */

  return (
    <form
      class="new-sale"
      data-testid="new-sale"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void save(false);
      }}
    >
      {/* 1. Customer */}
      <section class="sale-step">
        <h2 class="section-heading">{SELL.customerHeading}</h2>
        <label for="sale-phone">{SELL.phoneLabel}</label>
        <input
          id="sale-phone"
          name="sale-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder={SELL.phonePlaceholder}
          data-testid="sale-phone"
          value={phoneText}
          onInput={(event) => {
            setPhoneText((event.target as HTMLInputElement).value);
            setNearMisses([]);
            setAskingNewCustomer(false);
            setOfferOverride(false);
            setNameTouched(false);
            setError(null);
          }}
        />
        {phoneProblem !== null ? (
          <p class="error" data-testid="sale-phone-error">
            {phoneProblem}
          </p>
        ) : null}

        {phoneE164 !== null && customerLoading ? <p class="field-help">{SELL.lookingUp}</p> : null}

        {phoneE164 !== null && !customerLoading && known ? (
          <p class="notice-line" data-testid="customer-history">
            {(customer?.stats?.jars ?? 0) === 0
              ? SELL.historyNone
              : SELL.history(customer?.stats?.jars ?? 0, customer?.stats?.orders ?? 0)}
          </p>
        ) : null}

        {needsName ? (
          <p class="notice-line" data-testid="customer-new">
            {SELL.newNumber}
          </p>
        ) : null}

        {phoneE164 !== null ? (
          <>
            <label for="sale-name">{SELL.nameLabel}</label>
            <input
              id="sale-name"
              name="sale-name"
              type="text"
              autoComplete="off"
              data-testid="sale-name"
              value={shownName}
              onInput={(event) => {
                setNameTouched(true);
                setName((event.target as HTMLInputElement).value);
              }}
            />
            {needsName && shownName.trim() === "" ? (
              <p class="field-help" data-testid="name-needed">
                {SELL.newCustomerNeedsName}
              </p>
            ) : null}
          </>
        ) : null}

        {askingNewCustomer ? (
          <div class="near-misses" data-testid="near-misses">
            {nearMisses.length > 0 ? (
              <>
                <p class="field-help">{SELL.nearMissHeading}</p>
                <ul class="near-miss-list">
                  {nearMisses.map((miss) => (
                    <li key={miss.phone}>
                      <button
                        type="button"
                        class="quiet"
                        data-testid={`near-miss-${miss.phone}`}
                        onClick={() => {
                          setPhoneText(miss.phone);
                          setName(miss.name);
                          setNameTouched(false);
                          setNearMisses([]);
                          setAskingNewCustomer(false);
                        }}
                      >
                        {SELL.nearMissUse(miss.name, formatIndianMobile(miss.phone))}
                      </button>
                      <span class="field-help">
                        {formatIndianMobile(miss.phone)}, {SELL.nearMissJars(miss.jars)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p class="field-help">{SELL.newNumber}</p>
            )}
            <button
              type="button"
              id="confirm-new-customer"
              data-testid="confirm-new-customer"
              disabled={saving || shownName.trim() === ""}
              onClick={() => void save(true)}
            >
              {SELL.confirmNewCustomer}
            </button>
            {shownName.trim() === "" ? <p class="field-help">{SELL.newCustomerNeedsName}</p> : null}
          </div>
        ) : null}
      </section>

      <div class="hairline" />

      {/* 2. What */}
      <section class="sale-step">
        <h2 class="section-heading">{SELL.whatHeading}</h2>
        <label for="sale-product">{SELL.productLabel}</label>
        <select
          id="sale-product"
          name="sale-product"
          data-testid="sale-product"
          value={productSlug}
          onChange={(event) => {
            setProductSlug((event.target as HTMLSelectElement).value);
            setPickedBatchRef(null);
            setUnitPriceText("");
            setCustomDescription("");
            setCustomAmountText("");
            setError(null);
          }}
        >
          <option value="">{SELL.productPlaceholder}</option>
          {products.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {productSlug === "" ? (
          <p class="field-help" data-testid="product-needed">
            {SELL.outstandingProduct}
          </p>
        ) : null}

        {productSlug !== "" ? (
          <ChipRow
            value={isCustom ? "custom" : "jar"}
            options={[
              { value: "jar", label: SELL.customLineToggleOff },
              { value: "custom", label: SELL.customLineToggle },
            ]}
            onPick={(value) => {
              setIsCustom(value === "custom");
              setError(null);
            }}
            testId="sale-line-kind"
          />
        ) : null}

        {productSlug !== "" && !isCustom ? (
          sellable.length === 0 ? (
            <p class="notice-line" data-testid="no-batch">
              {SELL.noBatch}
            </p>
          ) : (
            <>
              <label for="sale-batch">{SELL.batchLabel}</label>
              <select
                id="sale-batch"
                name="sale-batch"
                data-testid="sale-batch"
                value={batch?.ref ?? ""}
                onChange={(event) => setPickedBatchRef((event.target as HTMLSelectElement).value)}
              >
                {sellable.map((option, index) => (
                  <option key={option.ref} value={option.ref}>
                    {SELL.batchOption(batchName(option), option.available, formatINR(option.unitPrice))}
                    {index === 0 ? ` (${SELL.batchSuggested})` : ""}
                  </option>
                ))}
              </select>
            </>
          )
        ) : null}

        {isCustom ? (
          <>
            {!rights.mayChangePrice ? (
              offeredCustomLines.length === 0 ? (
                <p class="notice-line" data-testid="custom-line-none">
                  {SELL.customLineNoneSet}
                </p>
              ) : (
                <>
                  <p class="field-help">{SELL.customLinePick}</p>
                  <div class="tab-row" id="custom-line-options" data-testid="custom-line-options">
                    {offeredCustomLines.map((line) => (
                      <button
                        key={line.description}
                        type="button"
                        class={`chip${customDescription === line.description ? " chip-on" : ""}`}
                        onClick={() => {
                          setCustomDescription(line.description);
                          // The amount is the Owner's, never retyped: 7A.6
                          // gives the kitchen a custom line "at an amount set
                          // by the owner in Products", and the server checks
                          // both the wording and the amount against his list.
                          setCustomAmountText(String(line.amountPaise / 100));
                        }}
                      >
                        {line.description}, {formatINR(line.amountPaise)}
                      </button>
                    ))}
                  </div>
                  {customDescription.trim() === "" ? (
                    <p class="field-help" data-testid="custom-line-needed">
                      {SELL.customLineNeedsDescription}
                    </p>
                  ) : null}
                </>
              )
            ) : (
              <>
                <label for="custom-description">{SELL.customLineDescription}</label>
                <input
                  id="custom-description"
                  name="custom-description"
                  type="text"
                  data-testid="custom-description"
                  value={customDescription}
                  onInput={(event) => setCustomDescription((event.target as HTMLInputElement).value)}
                />
                {customDescription.trim() === "" ? (
                  <p class="field-help" data-testid="custom-description-needed">
                    {SELL.customLineNeedsDescription}
                  </p>
                ) : null}
                <label for="custom-amount">{SELL.customLineAmount}</label>
                <input
                  id="custom-amount"
                  name="custom-amount"
                  type="text"
                  inputMode="decimal"
                  data-testid="custom-amount"
                  value={customAmountText}
                  onInput={(event) => setCustomAmountText((event.target as HTMLInputElement).value)}
                />
                {customDescription.trim() !== "" && (customAmount === null || customAmount < 1) ? (
                  <p class="field-help" data-testid="custom-amount-needed">
                    {SELL.customLineNeedsAmount}
                  </p>
                ) : null}
              </>
            )}

            {batch !== null ? (
              <label class="check-row">
                <input
                  type="checkbox"
                  data-testid="custom-takes-jars"
                  checked={customTakesJars}
                  onChange={(event) => setCustomTakesJars((event.target as HTMLInputElement).checked)}
                />
                {SELL.customLineTiedToBatch}
              </label>
            ) : null}
          </>
        ) : null}

        <label for="sale-qty">{SELL.qtyLabel}</label>
        <input
          id="sale-qty"
          name="sale-qty"
          type="number"
          inputMode="numeric"
          min={1}
          data-testid="sale-qty"
          value={qtyText}
          onInput={(event) => setQtyText((event.target as HTMLInputElement).value)}
        />
        {!qtyOk ? <p class="error">{SELL.qtyInvalid}</p> : null}
      </section>

      <div class="hairline" />

      {/* 3. Amount */}
      <section class="sale-step">
        <h2 class="section-heading">{SELL.amountHeading}</h2>

        {!isCustom && rights.mayChangePrice ? (
          <>
            <label for="sale-unit-price">{SELL.unitPriceLabel}</label>
            <input
              id="sale-unit-price"
              name="sale-unit-price"
              type="text"
              inputMode="decimal"
              placeholder={batch === null ? "" : String(batch.unitPrice / 100)}
              data-testid="sale-unit-price"
              value={unitPriceText}
              onInput={(event) => setUnitPriceText((event.target as HTMLInputElement).value)}
            />
            <p class="field-help">{SELL.unitPriceOwnerHelp}</p>
            {priceProblem !== null ? (
              <p class="error" data-testid="price-error">
                {priceProblem}
              </p>
            ) : null}
          </>
        ) : (
          <Money label={SELL.unitPriceLabel} paise={unitPrice} testId="sale-unit-price-shown" />
        )}

        <Money label={SELL.subtotal} paise={totals.subtotal} testId="sale-subtotal" />

        <label for="sale-discount">{SELL.discountLabel}</label>
        <p class="field-help" data-testid="discount-rights">
          {rights.maxDiscount === null
            ? SELL.discountAnyAmount
            : rights.maxDiscount === 0
              ? SELL.discountNoRights
              : SELL.discountCap(formatINR(rights.maxDiscount))}
        </p>
        <input
          id="sale-discount"
          name="sale-discount"
          type="text"
          inputMode="decimal"
          data-testid="sale-discount"
          disabled={!rights.mayDiscount}
          value={discountText}
          onInput={(event) => setDiscountText((event.target as HTMLInputElement).value)}
        />
        {discount > 0 ? (
          <>
            <label for="sale-discount-reason">{SELL.discountReason}</label>
            <input
              id="sale-discount-reason"
              name="sale-discount-reason"
              type="text"
              data-testid="sale-discount-reason"
              value={discountReason}
              onInput={(event) => setDiscountReason((event.target as HTMLInputElement).value)}
            />
          </>
        ) : null}
        {discountProblem !== null ? (
          <p class="error" data-testid="discount-error">
            {discountProblem}
          </p>
        ) : null}

        <div class="sale-total">
          <span class="field-label">{SELL.total}</span>
          <span class="sale-total-value" data-testid="sale-total">
            {formatINR(total)}
          </span>
        </div>
      </section>

      <div class="hairline" />

      {/* 4. Fulfilment */}
      <section class="sale-step">
        <h2 class="section-heading">{SELL.fulfilmentHeading}</h2>
        <ChipRow<Fulfilment>
          value={fulfilment}
          options={[
            { value: "handedOver", label: FULFILMENT_LABEL.handedOver },
            { value: "ship", label: FULFILMENT_LABEL.ship },
            { value: "collect", label: FULFILMENT_LABEL.collect },
          ]}
          onPick={setFulfilment}
          testId="sale-fulfilment"
        />

        {fulfilment === "ship" ? (
          <div class="sale-address" data-testid="sale-address">
            <label for="address-name">{SELL.addressName}</label>
            <input
              id="address-name"
              name="address-name"
              type="text"
              data-testid="address-name"
              value={addressName}
              onInput={(event) => setAddressName((event.target as HTMLInputElement).value)}
            />
            {addressName.trim() === "" ? (
              <p class="field-help" data-testid="address-name-needed">
                {SELL.outstandingAddressName}
              </p>
            ) : null}
            <label for="address-phone">{SELL.addressPhone}</label>
            <input
              id="address-phone"
              name="address-phone"
              type="tel"
              inputMode="tel"
              data-testid="address-phone"
              value={addressPhone}
              onInput={(event) => setAddressPhone((event.target as HTMLInputElement).value)}
            />
            {!parseIndianMobile(addressPhone).ok ? (
              <p class="field-help" data-testid="address-phone-needed">
                {SELL.outstandingAddressPhone}
              </p>
            ) : null}
            <label for="address-lines">{SELL.addressLines}</label>
            <textarea
              id="address-lines"
              name="address-lines"
              rows={3}
              data-testid="address-lines"
              value={addressLines}
              onInput={(event) => setAddressLines((event.target as HTMLTextAreaElement).value)}
            />
            <p class="field-help">{SELL.addressLinesHelp}</p>
            {addressLines.trim() === "" ? (
              <p class="field-help" data-testid="address-lines-needed">
                {SELL.outstandingAddressLines}
              </p>
            ) : null}
            <label for="address-city">{SELL.addressCity}</label>
            <input
              id="address-city"
              name="address-city"
              type="text"
              data-testid="address-city"
              value={addressCity}
              onInput={(event) => setAddressCity((event.target as HTMLInputElement).value)}
            />
            {addressCity.trim() === "" ? (
              <p class="field-help" data-testid="address-city-needed">
                {SELL.outstandingAddressCity}
              </p>
            ) : null}
            <label for="address-state">{SELL.addressState}</label>
            <input
              id="address-state"
              name="address-state"
              type="text"
              data-testid="address-state"
              value={addressState}
              onInput={(event) => setAddressState((event.target as HTMLInputElement).value)}
            />
            {addressState.trim() === "" ? (
              <p class="field-help" data-testid="address-state-needed">
                {SELL.outstandingAddressState}
              </p>
            ) : null}
            <label for="address-pincode">{SELL.addressPincode}</label>
            <input
              id="address-pincode"
              name="address-pincode"
              type="text"
              inputMode="numeric"
              data-testid="address-pincode"
              value={addressPincode}
              onInput={(event) => setAddressPincode((event.target as HTMLInputElement).value)}
            />
            {!/^[1-9]\d{5}$/.test(addressPincode.trim()) ? (
              <p class="field-help" data-testid="address-pincode-needed">
                {SELL.outstandingAddressPincode}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <div class="hairline" />

      {/* 5. Payment */}
      <section class="sale-step">
        <h2 class="section-heading">{SELL.paymentHeading}</h2>
        <ChipRow<Payment>
          value={payment}
          options={[
            { value: "cash", label: PAYMENT_LABEL.cash },
            { value: "upiToAccount", label: PAYMENT_LABEL.upiToAccount },
            { value: "paymentLink", label: PAYMENT_LABEL.paymentLink },
          ]}
          onPick={setPayment}
          testId="sale-payment"
        />
        {/* Brief 7A.1 step 5 lists five ways to pay. The Razorpay QR and part
            payment are M3 and M4; saying so is better than a button that
            pretends. */}
        <p class="field-help">{SELL.razorpayQrLater}</p>

        {payment === "upiToAccount" ? (
          <>
            <label for="sale-upi-ref">{SELL.upiRefLabel}</label>
            <input
              id="sale-upi-ref"
              name="sale-upi-ref"
              type="text"
              inputMode="numeric"
              data-testid="sale-upi-ref"
              value={upiRef}
              onInput={(event) => setUpiRef((event.target as HTMLInputElement).value)}
            />
            <p class="field-help">{SELL.upiRefHelp}</p>
          </>
        ) : null}

        {payment === "paymentLink" ? <p class="notice-line">{SELL.paymentLinkNote}</p> : null}
      </section>

      <div class="hairline" />

      {/* 6. Consent */}
      <section class="sale-step">
        <h2 class="section-heading">{SELL.consentHeading}</h2>
        <label class="check-row">
          <input
            type="checkbox"
            data-testid="consent-updates"
            checked={consentUpdates}
            onChange={(event) => setConsentUpdates((event.target as HTMLInputElement).checked)}
          />
          {SELL.consentUpdates}
        </label>
        <label class="check-row">
          <input
            type="checkbox"
            data-testid="consent-marketing"
            checked={consentMarketing}
            onChange={(event) => setConsentMarketing((event.target as HTMLInputElement).checked)}
          />
          {SELL.consentMarketing}
        </label>
      </section>

      <div class="hairline" />

      {/* 7. Save */}
      <section class="sale-step">
        <label for="sale-note">{SELL.noteLabel}</label>
        <textarea
          id="sale-note"
          name="sale-note"
          rows={2}
          data-testid="sale-note"
          value={note}
          onInput={(event) => setNote((event.target as HTMLTextAreaElement).value)}
        />

        {error !== null ? (
          <p class="error" data-testid="sale-error">
            {error}
          </p>
        ) : null}

        {offerOverride ? (
          <div class="override-limit" data-testid="override-limit">
            <p class="field-help">{SELL.overrideLimitHelp}</p>
            <button
              type="button"
              class="quiet"
              data-testid="override-limit-confirm"
              disabled={saving}
              onClick={() => void save(true, true)}
            >
              {SELL.overrideLimit}
            </button>
          </div>
        ) : null}

        {/*
         * M2.15: the save button stopping dead was the whole problem.
         * Everything `canSave` is waiting on, named, each one a tap to
         * where it lives on the screen. Brief §17.1, no red alarm: the same
         * field-help voice and quiet button as the rest of the screen.
         */}
        {!saving && outstanding.length > 0 ? (
          <div class="outstanding" data-testid="outstanding">
            <p class="field-help">{SELL.outstandingHeading}</p>
            <ul class="outstanding-list">
              {outstanding.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    class="quiet outstanding-item"
                    data-testid={`outstanding-${item.id}`}
                    onClick={() => jumpTo(item.targetId)}
                  >
                    {item.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button type="submit" data-testid="save-sale" disabled={!canSave}>
          {saving ? SELL.saving : SELL.save}
        </button>
      </section>
    </form>
  );
}
