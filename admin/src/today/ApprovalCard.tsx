/**
 * One card in Today's "Waiting on you" (brief 17.2, 7.3): what is being
 * asked, the message that would go out, and the three answers.
 *
 *   Yes                      the draft goes as it is
 *   Not yet, with a reason   nothing moves, and it comes back next morning
 *   Edit then yes            the Owner's own wording is what is approved
 *
 * The third is offered only when there is a message to edit. An approval with
 * an empty draft (a kitchen photo with no line on it, D5) still has to be
 * said yes to before anyone sees the photo, but there is nothing to rewrite,
 * so there is no edit box.
 *
 * Kitchen and Viewer see the card and no controls at all (brief 17.12). That
 * is a courtesy, not the enforcement: every answer goes to a callable that
 * refuses anyone but the Owner, whatever this screen draws.
 */
import { approvalHasMessage, batchLabelCapitalised, type Role } from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { callableErrorMessage, type ApprovalDoc, type BatchDoc } from "../batches/data";
import { BATCHES, TODAY } from "../copy";
import { answerNotYet, answerYes } from "./data";

type Panel = "none" | "notYet" | "edit";

interface Props {
  readonly approval: ApprovalDoc;
  readonly batch: BatchDoc | null;
  readonly productName: string;
  readonly role: Role;
}

/** What this approval is asking, in one line of admin English. */
export function askLine(approval: ApprovalDoc, batch: BatchDoc | null): string {
  switch (approval.kind) {
    case "halfReached":
      return TODAY.askHalfReached(batch?.paidCount ?? 0, batch?.bookableJars ?? 0);
    case "full":
      return TODAY.askFull;
    case "photoUpdate":
      return TODAY.askPhotoUpdate;
    case "broadcast":
      // Both broadcasts are the same kind, and the batch says which one this
      // is: a batch on sale is the open-batch offer, and a batch that has
      // been bottled and has jars left is the back-in-stock one.
      if (batch?.state === "inStock" || batch?.state === "bottled") return TODAY.askBackInStock;
      if (batch?.state === "open" || batch?.state === "halfReached" || batch?.state === "sourcing") {
        return TODAY.askBatchOpen;
      }
      return TODAY.askBroadcast;
    default:
      return TODAY.askBroadcast;
  }
}

export function ApprovalCard({ approval, batch, productName, role }: Props): JSX.Element {
  const [panel, setPanel] = useState<Panel>("none");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState(approval.draft ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = approval.id;
  const hasMessage = approvalHasMessage(approval.draft);
  const label = batch
    ? batchLabelCapitalised(batch.batchNo ?? null, batch.id, batch.state ?? null)
    : batchLabelCapitalised(null, approval.batchRef ?? "", null);

  async function run(work: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await work();
      // The listener repaints: an answered approval leaves this list on its
      // own, so there is nothing to reset here on success.
      setPanel("none");
    } catch (caught) {
      setError(callableErrorMessage(caught, TODAY.answerRefused));
    } finally {
      setBusy(false);
    }
  }

  function saveYes(): void {
    void run(() => answerYes(approval, null));
  }

  function saveEdit(): void {
    const trimmed = message.trim();
    if (trimmed === "") {
      setError(TODAY.messageRequired);
      return;
    }
    void run(() => answerYes(approval, trimmed));
  }

  function saveNotYet(): void {
    const trimmed = reason.trim();
    if (trimmed === "") {
      setError(TODAY.reasonRequired);
      return;
    }
    void run(() => answerNotYet(approval, trimmed));
  }

  return (
    <li class="approval-card" data-testid={`approval-card-${id}`}>
      <div class="approval-head">
        <span class="approval-batch" data-testid={`approval-batch-${id}`}>
          {productName === "" ? label : `${label}, ${productName}`}
        </span>
        {batch?.state ? (
          <span class="state-chip" data-testid={`approval-state-${id}`}>
            {BATCHES.stateLabel[batch.state] ?? batch.state}
          </span>
        ) : null}
      </div>

      <p class="approval-ask" data-testid={`approval-ask-${id}`}>
        {askLine(approval, batch)}
      </p>

      {approval.status === "notYet" && approval.reason ? (
        <p class="notice-line" data-testid={`approval-reason-shown-${id}`}>
          {TODAY.putOffUntilTomorrow(approval.reason)}
        </p>
      ) : null}

      {hasMessage ? (
        <blockquote class="approval-message" data-testid={`approval-draft-${id}`}>
          {approval.draft}
        </blockquote>
      ) : (
        <p class="notice-line" data-testid={`approval-no-message-${id}`}>
          {TODAY.noMessage}
        </p>
      )}

      {error ? (
        <p class="error" data-testid={`approval-error-${id}`}>
          {error}
        </p>
      ) : null}

      {role !== "owner" ? (
        <p class="notice-line" data-testid={`approval-owner-only-${id}`}>
          {TODAY.ownerOnly}
        </p>
      ) : (
        <>
          {panel === "none" ? (
            <div class="approval-answers">
              <button
                type="button"
                class="state-button"
                disabled={busy}
                data-testid={`approval-yes-${id}`}
                onClick={saveYes}
              >
                {busy ? TODAY.working : TODAY.yes}
              </button>
              <button
                type="button"
                class="quiet"
                disabled={busy}
                data-testid={`approval-not-yet-${id}`}
                onClick={() => {
                  setError(null);
                  setPanel("notYet");
                }}
              >
                {TODAY.notYet}
              </button>
              {/* No message, no edit: there is nothing to rewrite. */}
              {hasMessage ? (
                <button
                  type="button"
                  class="quiet"
                  disabled={busy}
                  data-testid={`approval-edit-${id}`}
                  onClick={() => {
                    setError(null);
                    setMessage(approval.draft ?? "");
                    setPanel("edit");
                  }}
                >
                  {TODAY.editThenYes}
                </button>
              ) : null}
            </div>
          ) : null}

          {panel === "notYet" ? (
            <div class="approval-panel" data-testid={`approval-not-yet-form-${id}`}>
              <label for={`approval-reason-${id}`}>{TODAY.reasonLabel}</label>
              <textarea
                id={`approval-reason-${id}`}
                rows={2}
                value={reason}
                data-testid={`approval-reason-${id}`}
                onInput={(event) => setReason((event.target as HTMLTextAreaElement).value)}
              />
              <button
                type="button"
                class="quiet"
                disabled={busy}
                data-testid={`approval-confirm-not-yet-${id}`}
                onClick={saveNotYet}
              >
                {busy ? TODAY.working : TODAY.confirmNotYet}
              </button>
              <button
                type="button"
                class="quiet"
                disabled={busy}
                data-testid={`approval-cancel-${id}`}
                onClick={() => setPanel("none")}
              >
                {TODAY.cancel}
              </button>
            </div>
          ) : null}

          {panel === "edit" ? (
            <div class="approval-panel" data-testid={`approval-edit-form-${id}`}>
              <label for={`approval-message-${id}`}>{TODAY.messageLabel}</label>
              <textarea
                id={`approval-message-${id}`}
                rows={3}
                value={message}
                data-testid={`approval-message-${id}`}
                onInput={(event) => setMessage((event.target as HTMLTextAreaElement).value)}
              />
              <button
                type="button"
                class="state-button"
                disabled={busy}
                data-testid={`approval-confirm-edit-${id}`}
                onClick={saveEdit}
              >
                {busy ? TODAY.working : TODAY.confirmEdit}
              </button>
              <button
                type="button"
                class="quiet"
                disabled={busy}
                data-testid={`approval-cancel-${id}`}
                onClick={() => setPanel("none")}
              >
                {TODAY.cancel}
              </button>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}
