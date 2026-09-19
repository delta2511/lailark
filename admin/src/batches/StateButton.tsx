/**
 * The one big state button, brief section 17.4 and 8.2: whatever the next
 * transition is for the signed-in role, collected in a small form and sent
 * to `transitionBatch`. Automatic transitions are never buttons: the batch
 * shows what it is waiting for instead (`waitingLine`).
 *
 * Pause, resume and the full-flag yes are secondary, smaller controls beside
 * the primary button, not the button itself: brief 17.4 calls out "the one
 * big state button" for the forward move, and D23's pause is a modifier on
 * top of whichever state the batch is in, available in six of the ten states
 * at once, which is not "the next step" in the same sense.
 */
import type { Role } from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { BATCHES } from "../copy";
import { isCostPaise, isSellablePaise, parseRupeesToPaise } from "../products/productMoney";
import {
  callableErrorMessage,
  callApproveBatchFull,
  callTransitionBatch,
  type BatchDoc,
} from "./data";
import {
  findTransitionRow,
  isPausable,
  waitingLine,
  type TransitionField,
  type TransitionRow,
} from "./transitionRows";

interface Props {
  readonly batch: BatchDoc;
  readonly role: Role;
}

export function StateButton({ batch, role }: Props): JSX.Element {
  const state = batch.state;

  if (state === "paused") {
    return <ResumeControl batch={batch} role={role} />;
  }

  const row = findTransitionRow(state, role);
  const pausable = role === "owner" && isPausable(state);
  const fullWaiting = role === "owner" && Boolean(batch.fullReachedAt) && !batch.fullApprovedAt;

  return (
    <div class="state-button-area" data-testid="state-button-area">
      {row ? (
        <TransitionForm key={`${row.from}->${row.to}`} batch={batch} row={row} />
      ) : (
        <p class="notice-line" data-testid="state-waiting">
          {waitingLine(state, role)}
        </p>
      )}

      {fullWaiting ? <FullApprovalControl batch={batch} /> : null}
      {pausable ? <PauseControl batch={batch} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The forward transition: the big button and its small form                 */
/* -------------------------------------------------------------------------- */

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * One box of a transition form. A refusal carries the line the person reads,
 * so a price above the MRP does not come back as "fill in every field": the
 * two mistakes are nothing alike and the box is the same shape.
 */
function parseField(field: TransitionField, raw: string): Parsed {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return field.required ? { ok: false, message: BATCHES.fieldRequired } : { ok: true, value: undefined };
  }
  switch (field.kind) {
    case "text":
    case "textarea":
      return { ok: true, value: trimmed };
    case "date":
      return { ok: true, value: trimmed };
    case "price": {
      // CLAUDE.md section 3: a jar is never sold above the ₹649 MRP printed on
      // it. The server refuses this too (`sellingPaise`); this is the line the
      // person reads before the round trip.
      const paise = parseRupeesToPaise(trimmed);
      if (paise === null) return { ok: false, message: BATCHES.priceInvalid };
      if (!isSellablePaise(paise)) return { ok: false, message: BATCHES.priceAboveMrp };
      return { ok: true, value: paise };
    }
    case "rupees": {
      // Money the kitchen spends: no ceiling, never negative, whole paise.
      const paise = parseRupeesToPaise(trimmed);
      if (!isCostPaise(paise)) return { ok: false, message: BATCHES.costInvalid };
      return { ok: true, value: paise };
    }
    case "whole": {
      const n = Number(trimmed);
      return Number.isInteger(n) && n >= 0
        ? { ok: true, value: n }
        : { ok: false, message: BATCHES.fieldRequired };
    }
    case "positive": {
      const n = Number(trimmed);
      return Number.isFinite(n) && n > 0
        ? { ok: true, value: n }
        : { ok: false, message: BATCHES.weightInvalid };
    }
    default:
      return { ok: false, message: BATCHES.fieldRequired };
  }
}

function TransitionForm({ batch, row }: { readonly batch: BatchDoc; readonly row: TransitionRow }): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(row.fields.map((f) => [f.key, ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError(null);

    const data: Record<string, unknown> = {};
    for (const field of row.fields) {
      const parsed = parseField(field, values[field.key] ?? "");
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
      if (parsed.value !== undefined) data[field.key] = parsed.value;
    }

    setBusy(true);
    try {
      await callTransitionBatch({ ref: batch.id, to: row.to, data });
      // The live batch listener repaints the screen with the new state; no
      // local state to reset, the row itself will be a different one next
      // render and this form remounts fresh under its new key.
    } catch (caught) {
      setError(callableErrorMessage(caught, BATCHES.transitionRefused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="state-form" data-testid="state-form" onSubmit={(event) => void submit(event)}>
      {row.fields.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key] ?? ""}
          onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))}
        />
      ))}

      {error ? (
        <p class="error" data-testid="transition-error">
          {error}
        </p>
      ) : null}

      <button type="submit" class="state-button" disabled={busy} data-testid="state-button">
        {busy ? BATCHES.saving : row.buttonLabel}
      </button>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  readonly field: TransitionField;
  readonly value: string;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  const id = `state-field-${field.key}`;
  if (field.kind === "textarea") {
    return (
      <>
        <label for={id}>{field.label}</label>
        <textarea
          id={id}
          rows={2}
          value={value}
          data-testid={id}
          onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
        />
      </>
    );
  }
  const inputType = field.kind === "date" ? "date" : "text";
  const inputMode =
    field.kind === "price" || field.kind === "rupees" || field.kind === "positive"
      ? "decimal"
      : field.kind === "whole"
        ? "numeric"
        : undefined;
  return (
    <>
      <label for={id}>{field.label}</label>
      <input
        id={id}
        type={inputType}
        inputMode={inputMode}
        value={value}
        data-testid={id}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Resume: paused always resumes to `pausedFrom`, never the Owner's choice   */
/* -------------------------------------------------------------------------- */

function ResumeControl({ batch, role }: { readonly batch: BatchDoc; readonly role: Role }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role !== "owner") {
    return (
      <p class="notice-line" data-testid="state-waiting">
        {waitingLine(batch.state, role)}
      </p>
    );
  }

  async function resume(): Promise<void> {
    if (!batch.pausedFrom) {
      setError(BATCHES.transitionRefused);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await callTransitionBatch({ ref: batch.id, to: batch.pausedFrom, data: {} });
    } catch (caught) {
      setError(callableErrorMessage(caught, BATCHES.transitionRefused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="state-button-area" data-testid="state-button-area">
      {error ? (
        <p class="error" data-testid="transition-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        class="state-button"
        disabled={busy}
        data-testid="resume-button"
        onClick={() => void resume()}
      >
        {busy ? BATCHES.saving : BATCHES.resume}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pause: a secondary control, available from six states (D23)               */
/* -------------------------------------------------------------------------- */

function PauseControl({ batch }: { readonly batch: BatchDoc }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" class="quiet" data-testid="pause-button" onClick={() => setOpen(true)}>
        {BATCHES.pause}
      </button>
    );
  }

  async function confirm(): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed === "") {
      setError(BATCHES.fieldRequired);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await callTransitionBatch({ ref: batch.id, to: "paused", data: { reason: trimmed } });
      setOpen(false);
      setReason("");
    } catch (caught) {
      setError(callableErrorMessage(caught, BATCHES.transitionRefused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="pause-form" data-testid="pause-form">
      <label for="pause-reason">{BATCHES.pauseReason}</label>
      <textarea
        id="pause-reason"
        rows={2}
        value={reason}
        data-testid="pause-reason"
        onInput={(event) => setReason((event.target as HTMLTextAreaElement).value)}
      />
      {error ? (
        <p class="error" data-testid="transition-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        class="quiet"
        disabled={busy}
        data-testid="confirm-pause"
        onClick={() => void confirm()}
      >
        {busy ? BATCHES.saving : BATCHES.confirmPause}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The full flag's yes: A62, not a state hop                                 */
/* -------------------------------------------------------------------------- */

function FullApprovalControl({ batch }: { readonly batch: BatchDoc }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await callApproveBatchFull(batch.id);
    } catch (caught) {
      setError(callableErrorMessage(caught, BATCHES.transitionRefused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="full-approval" data-testid="full-approval">
      <p class="notice-line">{BATCHES.fullWaitingLine}</p>
      {error ? (
        <p class="error" data-testid="transition-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        class="quiet"
        disabled={busy}
        data-testid="answer-full"
        onClick={() => void answer()}
      >
        {busy ? BATCHES.saving : BATCHES.answerFull}
      </button>
    </div>
  );
}
