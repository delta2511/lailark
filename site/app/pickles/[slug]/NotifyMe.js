"use client";

import { useState } from "react";

/**
 * The notify-me beside a batch on the stove (brief §7.5, M3.8).
 *
 * Brief §7.5 asks for it next to the cooking card: "When cooking starts,
 * booking closes. The card reads 'Being cooked now. Unpaid jars go on sale
 * when bottled' with a notify-me." The card's own line is the brief's, word
 * for word, and lives in `counts.js`. The three strings here are **D64**,
 * approved by Shefin on 25 Sep 2026, and nothing here may be reworded without
 * another answer from him (CLAUDE.md §5).
 *
 * What it does not do (CLAUDE.md §3): no countdown, no "12 people waiting",
 * no number of jars left, no date. It promises only what the batch lifecycle
 * actually guarantees, which is that the batch will be bottled and that we
 * will say so.
 *
 * The number goes to `POST /api/notify`, which writes one row to `notify`.
 * Nothing is sent to anybody by anything: at Bottled the Owner is offered a
 * message and approves it by hand (D32).
 */

/** D64, approved as drafted. */
export const NOTIFY_COPY = {
  label: "Tell me when these jars go on sale",
  button: "Tell me",
  done: "We have your number. We will tell you when this batch is bottled.",
};

/**
 * ASSUMED (M3.8): the placeholder and the two sentences below. D64 approved
 * the label, the button and the "done" line and drafted nothing for a number
 * that will not do or for a request that did not land. Both are the wording
 * the checkout already uses for the same two situations, so the site does not
 * say one thing two ways.
 */
const PLACEHOLDER = "WhatsApp number";
const BAD_NUMBER = "That does not look like a 10 digit Indian mobile number. Please check it.";
const UNAVAILABLE = "We could not add you just now. Please try again in a moment.";

export default function NotifyMe({ slug }) {
  // The id is per pickle, not a constant: two of these on one page (the home
  // page draws a card per product) would otherwise share one id, and a label
  // would point at the wrong box.
  const fieldId = `notify-contact-${slug}`;
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState("idle");
  const [problem, setProblem] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setProblem(null);
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact, source: "cooking", productSlug: slug }),
        cache: "no-store",
      });
      if (res.ok) {
        setStatus("done");
        return;
      }
      // The server's sentence when it gave one: it knows which of the two
      // things is wrong with the number, and this page does not.
      let said = null;
      try {
        const body = await res.json();
        if (typeof body?.error === "string" && body.error !== "") said = body.error;
      } catch {
        said = null;
      }
      setProblem(res.status === 400 ? (said ?? BAD_NUMBER) : UNAVAILABLE);
      setStatus("idle");
    } catch {
      setProblem(UNAVAILABLE);
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <p className="product-notify__done" aria-live="polite">
        {NOTIFY_COPY.done}
      </p>
    );
  }

  return (
    <form className="product-notify" onSubmit={submit}>
      <label className="product-notify__label" htmlFor={fieldId}>
        {NOTIFY_COPY.label}
      </label>
      <div className="product-notify__row">
        <input
          id={fieldId}
          name="contact"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={PLACEHOLDER}
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          required
        />
        <button type="submit" disabled={status === "sending"}>
          {NOTIFY_COPY.button}
        </button>
      </div>
      {problem ? (
        <p className="product-notify__problem" aria-live="polite">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
