"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useProductDetail, useShipping, canBuyToday } from "../_lib/counts";
import JarMarks from "../ds/JarMarks";
import {
  checkoutTotals,
  formatINR,
  jarChoicesFor,
  jarWords,
  readCheckoutQuery,
} from "../../lib/checkout";
import productContent from "../../content/products.json";

// M3.5: the checkout step of brief section 6.1 and 7.2.
//
// Two things about this file are deliberate and worth reading before
// changing it.
//
// **The Razorpay script is loaded here and nowhere else.** ST1 allows the
// customer site no external request other than Razorpay on the checkout
// step, so the <script> is appended by this component when it mounts, not
// by `app/layout.js`. Every other page on the site still talks to nothing
// but itself.
//
// **The total is never typed.** The unit price comes from the batch through
// `/api/counts`, the shipping from `settings/shipping`, and both go through
// the same `@lailark/shared` sum the server runs. The server is then asked
// to charge exactly the figure this page printed, and refuses if it has
// moved (brief 4.2: the fee is never first revealed at payment).
//
// ASSUMED (M3.5): every string a customer reads on this page. None of it is
// drafted in the docs, so it is kept to the fewest plain sentences the form
// needs, in the voice the rest of the site already uses.

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
const CHECKOUT_URL = "/api/checkout";

// `createCheckout`'s own words for "the checkout you started cannot be
// picked up, and it is safe to start a new one". The sentence the customer
// reads comes from the server with them. `alreadyPaid` is deliberately not
// here: money is on that order, and minting a fresh reference would let the
// next tap buy a second jar for an order that is already paid.
const START_FRESH_REASONS = ["holdLapsed", "orderChanged", "startAgain"];

const UNAVAILABLE = "We cannot show the count just now.";
const NOT_IN_KITCHEN = "Not in the kitchen just now.";
const SALE_STOPPED =
  "This batch is no longer sold online. It is still sold at the counter, up to its best before.";
const NO_PRODUCT = "Please pick a pickle first.";
const GENERIC_FAILURE = "Something went wrong on our side. Please try again in a minute.";
const PAY_FAILURE = "We could not open the payment window. Please try again.";
const THANK_YOU =
  "Thank you. We are confirming the payment with the bank, and your bill and jar will come to you on WhatsApp.";
const PAYMENT_CLOSED = "The payment window closed. Your jar is kept for a few more minutes.";

const heroBySlug = new Map(productContent.heroes.map((h) => [h.slug, h]));

/**
 * The Razorpay Checkout script, appended once, only on this page (ST1).
 *
 * No state: whether it has finished loading is asked at the moment it is
 * needed (`window.Razorpay`), which is the truth anyway, and which keeps a
 * script tag from causing a re-render of a form somebody is typing into.
 */
function useRazorpayScript() {
  useEffect(() => {
    if (typeof window === "undefined" || window.Razorpay) return;
    if (document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`)) return;
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.async = true;
    document.head.appendChild(script);
  }, []);
}

/** One key the browser mints for this attempt, so a double tap is one hold. */
function mintClientRef() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `cr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * `window.location.search`, read the way React wants a browser value read:
 * a snapshot that is `""` on the server, so the prerendered HTML and the
 * first client render agree and nothing hydrates twice.
 */
const subscribeToNothing = () => () => {};
const serverSearch = () => "";
function useSearch() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => window.location.search,
    serverSearch,
  );
}

export default function CheckoutForm() {
  const search = useSearch();
  const query = useMemo(() => readCheckoutQuery(search), [search]);

  const slug = query.slug;
  const detail = useProductDetail(slug ?? "");
  const shipping = useShipping();
  useRazorpayScript();

  // Minted once, outside render, and read only when the form is submitted.
  const clientRef = useRef(null);
  useEffect(() => {
    if (clientRef.current === null) clientRef.current = mintClientRef();
  }, []);

  const hero = slug === null ? null : heroBySlug.get(slug);
  const entry = detail.status === "ready" ? detail.entry : null;
  const choices = useMemo(() => jarChoicesFor(entry), [entry]);

  // Derived, never synchronised in an effect: the customer's own choice if
  // they have made one, otherwise the `?q=` they arrived with, otherwise the
  // smallest the batch allows.
  const [chosenQty, setChosenQty] = useState(null);
  const qty =
    chosenQty !== null && choices.includes(chosenQty)
      ? chosenQty
      : choices.includes(query.qty)
        ? query.qty
        : (choices[0] ?? 1);

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    pincode: "",
    email: "",
    updates: false,
    marketing: false,
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(false);

  // The product's own shipping rule comes off `/api/counts`, which reads it
  // from the same `products/{slug}.shippingRule` the server enforces. It is
  // deliberately not read from `content/products.json`: that file carries no
  // such field, so every total this page printed used the global rule, and
  // the day the global switch left "free" the server's sum and this one
  // parted company and every order was refused (brief 4.2).
  const totals =
    entry && shipping
      ? checkoutTotals(entry, qty, shipping, entry.shippingRule ?? null)
      : null;

  const set = (field) => (event) => {
    const value =
      event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  async function submit(event) {
    event.preventDefault();
    if (busy || totals === null) return;
    setBusy(true);
    setProblem(null);

    let payload;
    try {
      const res = await fetch(CHECKOUT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            productSlug: slug,
            qty,
            customerName: form.customerName,
            customerPhone: form.customerPhone,
            email: form.email,
            address: {
              lines: [form.line1, form.line2],
              city: form.city,
              state: form.state,
              pincode: form.pincode,
            },
            consents: { updates: form.updates, marketing: form.marketing },
            expectedTotalPaise: totals.totalPaise,
            clientRef: clientRef.current ?? mintClientRef(),
          },
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.result) {
        // The checkout this attempt belonged to cannot be picked up: its
        // hold lapsed, or the customer changed what they are buying and the
        // server put the first jars back. Either way the next tap has to be
        // a new checkout rather than a retry of a dead one. The `clientRef`
        // is what makes a double tap take one hold, so it is dropped only on
        // a refusal the server gives after refusing to hold anything: a
        // network failure, where the hold may well have landed, must keep
        // the old ref or the retry takes a second jar.
        if (START_FRESH_REASONS.includes(body?.error?.details?.reason)) {
          clientRef.current = mintClientRef();
        }
        // The server's own sentence, which is written for a customer, or
        // ours when there is not one. Never a status code.
        setProblem(body?.error?.message ?? GENERIC_FAILURE);
        setBusy(false);
        return;
      }
      payload = body.result;
    } catch {
      setProblem(GENERIC_FAILURE);
      setBusy(false);
      return;
    }

    if (typeof window.Razorpay !== "function") {
      setProblem(PAY_FAILURE);
      setBusy(false);
      return;
    }

    try {
      const checkout = new window.Razorpay({
        key: payload.razorpayKeyId,
        order_id: payload.razorpayOrderId,
        amount: payload.totalPaise,
        currency: "INR",
        name: "Lailark",
        description: payload.lineDescription,
        prefill: {
          name: payload.customerName,
          contact: payload.customerPhone,
          ...(payload.customerEmail ? { email: payload.customerEmail } : {}),
        },
        notes: { lailark_order_id: payload.orderId },
        // Brief 9.2: the webhook is the source of truth, not this callback.
        // All it does is stop the page pretending nothing happened.
        handler: () => {
          setDone(true);
          setBusy(false);
        },
        modal: {
          ondismiss: () => {
            setProblem(PAYMENT_CLOSED);
            setBusy(false);
          },
        },
      });
      checkout.open();
    } catch {
      setProblem(PAY_FAILURE);
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="checkout-done" aria-live="polite">
        <h2>Paid</h2>
        <p>{THANK_YOU}</p>
        <p>
          <a href="/">Back to the kitchen</a>
        </p>
      </div>
    );
  }

  if (detail.status === "loading") {
    return <div className="checkout-waiting" aria-live="polite" />;
  }
  if (slug === null || !hero) {
    return (
      <div className="checkout-waiting" aria-live="polite">
        <p className="checkout-note">{NO_PRODUCT}</p>
        <p>
          <a href="/">See what is in the kitchen</a>
        </p>
      </div>
    );
  }
  if (detail.status !== "ready") {
    return (
      <div className="checkout-waiting" aria-live="polite">
        <p className="checkout-note">{UNAVAILABLE}</p>
      </div>
    );
  }
  if (entry.mode === "none") {
    return (
      <div className="checkout-waiting" aria-live="polite">
        <p className="checkout-note">{NOT_IN_KITCHEN}</p>
        <p>
          <a href="/">See what is in the kitchen</a>
        </p>
      </div>
    );
  }
  if (entry.mode === "inStock" && !canBuyToday(entry)) {
    return (
      <div className="checkout-waiting" aria-live="polite">
        <p className="checkout-note">{SALE_STOPPED}</p>
      </div>
    );
  }
  if (choices.length === 0 || totals === null) {
    return (
      <div className="checkout-waiting" aria-live="polite">
        <p className="checkout-note">{UNAVAILABLE}</p>
      </div>
    );
  }

  const inStock = entry.mode === "inStock";

  return (
    <form className="checkout" onSubmit={submit} noValidate>
      <section className="checkout-jar">
        <h2>{hero.name}</h2>
        <JarMarks
          count={entry.count}
          total={entry.total}
          reading={inStock ? "left" : "paid"}
        />
        <p className="checkout-reading">
          {inStock ? "jars left in this batch" : "jars paid into this batch"}
        </p>

        <label className="checkout-field checkout-field--qty" htmlFor="checkout-qty">
          <span>How many jars</span>
          <select
            id="checkout-qty"
            name="qty"
            value={qty}
            onChange={(event) => setChosenQty(Number(event.target.value))}
          >
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {jarWords(choice)}
              </option>
            ))}
          </select>
        </label>

        <dl className="checkout-total">
          <div>
            <dt>{jarWords(qty)}</dt>
            <dd className="checkout-figure">{formatINR(totals.subtotalPaise)}</dd>
          </div>
          <div>
            <dt>Shipping</dt>
            <dd className="checkout-figure">
              {totals.shippingFeePaise === 0 ? "Free" : formatINR(totals.shippingFeePaise)}
            </dd>
          </div>
          <div className="checkout-total__sum">
            <dt>To pay</dt>
            <dd className="checkout-figure">{formatINR(totals.totalPaise)}</dd>
          </div>
        </dl>
        <p className="checkout-note">
          {inStock
            ? "We post it the next working day."
            : "This batch is not cooked yet. When you pay, your jar is kept for you."}
        </p>
      </section>

      <section className="checkout-you">
        <h2>Where it goes</h2>

        <label className="checkout-field" htmlFor="checkout-name">
          <span>Your name</span>
          <input
            id="checkout-name"
            name="customerName"
            autoComplete="name"
            value={form.customerName}
            onChange={set("customerName")}
          />
        </label>

        <label className="checkout-field" htmlFor="checkout-phone">
          <span>WhatsApp number</span>
          <input
            id="checkout-phone"
            name="customerPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="10 digits"
            value={form.customerPhone}
            onChange={set("customerPhone")}
          />
        </label>

        <label className="checkout-field" htmlFor="checkout-line1">
          <span>Address</span>
          <input
            id="checkout-line1"
            name="line1"
            autoComplete="address-line1"
            value={form.line1}
            onChange={set("line1")}
          />
        </label>

        <label className="checkout-field" htmlFor="checkout-line2">
          <span className="checkout-field__quiet">Address, second line</span>
          <input
            id="checkout-line2"
            name="line2"
            autoComplete="address-line2"
            value={form.line2}
            onChange={set("line2")}
          />
        </label>

        <div className="checkout-row">
          <label className="checkout-field" htmlFor="checkout-city">
            <span>Town or city</span>
            <input
              id="checkout-city"
              name="city"
              autoComplete="address-level2"
              value={form.city}
              onChange={set("city")}
            />
          </label>
          <label className="checkout-field" htmlFor="checkout-state">
            <span>State</span>
            <input
              id="checkout-state"
              name="state"
              autoComplete="address-level1"
              value={form.state}
              onChange={set("state")}
            />
          </label>
        </div>

        <label className="checkout-field" htmlFor="checkout-pincode">
          <span>Pincode</span>
          <input
            id="checkout-pincode"
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            value={form.pincode}
            onChange={set("pincode")}
          />
        </label>

        <label className="checkout-field" htmlFor="checkout-email">
          <span className="checkout-field__quiet">Email, if you would like the bill there too</span>
          <input
            id="checkout-email"
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set("email")}
          />
        </label>

        <p className="checkout-note">We ship inside India only.</p>
      </section>

      <section className="checkout-consent">
        <label className="checkout-tick" htmlFor="checkout-updates">
          <input
            id="checkout-updates"
            name="updates"
            type="checkbox"
            checked={form.updates}
            onChange={set("updates")}
          />
          <span>
            Send my bill, my jar number and the tracking on WhatsApp. We need this to get the
            order to you.
          </span>
        </label>

        <label className="checkout-tick" htmlFor="checkout-marketing">
          <input
            id="checkout-marketing"
            name="marketing"
            type="checkbox"
            checked={form.marketing}
            onChange={set("marketing")}
          />
          <span>Tell me when a new batch opens.</span>
        </label>
      </section>

      {problem ? (
        <p className="checkout-problem" role="alert">
          {problem}
        </p>
      ) : null}

      <button type="submit" className="checkout-pay" disabled={busy}>
        {busy ? "One moment" : `Pay ${formatINR(totals.totalPaise)}`}
      </button>
      <p className="checkout-note checkout-note--last">
        Payment is handled by Razorpay. Nothing is charged until you finish there.
      </p>
    </form>
  );
}
