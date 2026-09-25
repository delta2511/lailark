/**
 * One approved message, and the people it is for (D32).
 *
 * "Where the admin would send, it shows the drafted text with a prefilled
 * `wa.me` link per recipient, and the sender ticks it sent." That is this
 * card, and it is the whole of sending at launch: nothing in this repo puts a
 * message on a wire. The Owner taps a link, WhatsApp opens with the message
 * already typed, he sends it himself, and then he ticks it here.
 *
 * The list closes when the last row is ticked, or when he closes it. Either
 * way the card leaves the screen on its own, because the query behind it is
 * "lists that are still open".
 *
 * Owner only, as every answer is. Kitchen and Viewer see the card and no
 * controls; the callable refuses them whatever this screen draws.
 */
import { batchLabelCapitalised, type Role, waMeLink } from "@lailark/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { callableErrorMessage, type ApprovalDoc, type BatchDoc } from "../batches/data";
import { TODAY } from "../copy";
import { closeSendingList, markRecipientSent } from "./data";

interface Props {
  readonly approval: ApprovalDoc;
  readonly batch: BatchDoc | null;
  readonly productName: string;
  readonly role: Role;
}

/** One row of the list, as this card reads it off the document. */
interface Row {
  readonly phone: string;
  readonly name: string;
  readonly jars: number;
  readonly sent: boolean;
}

export function rowsOf(approval: ApprovalDoc): Row[] {
  const raw = approval.recipients;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const entry = row as unknown as Record<string, unknown>;
    return {
      phone: typeof entry.phone === "string" ? entry.phone : "",
      name: typeof entry.name === "string" ? entry.name : "",
      jars: typeof entry.jars === "number" ? entry.jars : 0,
      sent: entry.sentAt !== null && entry.sentAt !== undefined,
    };
  });
}

export function SendingCard({ approval, batch, productName, role }: Props): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const id = approval.id;
  const rows = rowsOf(approval);
  const left = rows.filter((row) => !row.sent).length;
  const draft = approval.draft ?? "";
  const label = batch
    ? batchLabelCapitalised(batch.batchNo ?? null, batch.id, batch.state ?? null)
    : batchLabelCapitalised(null, approval.batchRef ?? "", null);

  async function run(key: string, work: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(key);
    try {
      await work();
    } catch (caught) {
      setError(callableErrorMessage(caught, TODAY.answerRefused));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li class="approval-card" data-testid={`sending-card-${id}`}>
      <div class="approval-head">
        <span class="approval-batch" data-testid={`sending-batch-${id}`}>
          {productName === "" ? label : `${label}, ${productName}`}
        </span>
        <span class="state-chip" data-testid={`sending-remaining-${id}`}>
          {TODAY.sendingRemaining(left, rows.length)}
        </span>
      </div>

      <blockquote class="approval-message" data-testid={`sending-draft-${id}`}>
        {draft}
      </blockquote>
      <p class="notice-line">{TODAY.sendingHow}</p>

      {error ? (
        <p class="error" data-testid={`sending-error-${id}`}>
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p class="notice-line" data-testid={`sending-nobody-${id}`}>
          {TODAY.sendingNobody}
        </p>
      ) : (
        <ul class="sending-list">
          {rows.map((row) => {
            const href = waMeLink(row.phone, draft);
            return (
              <li key={row.phone} data-testid={`sending-row-${id}-${row.phone}`}>
                <span class="sending-who">{row.name === "" ? row.phone : row.name}</span>
                <span class="sending-jars">{TODAY.sendingJars(row.jars)}</span>
                {row.sent ? (
                  <span class="sending-done" data-testid={`sending-done-${id}-${row.phone}`}>
                    {TODAY.sendingSent}
                  </span>
                ) : (
                  <>
                    {href ? (
                      <a
                        class="quiet"
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        data-testid={`sending-open-${id}-${row.phone}`}
                      >
                        {TODAY.sendingOpen}
                      </a>
                    ) : null}
                    {role === "owner" ? (
                      <button
                        type="button"
                        class="state-button"
                        disabled={busy !== null}
                        data-testid={`sending-tick-${id}-${row.phone}`}
                        onClick={() =>
                          void run(row.phone, () => markRecipientSent(approval, row.phone))
                        }
                      >
                        {busy === row.phone ? TODAY.working : TODAY.sendingTick}
                      </button>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {role === "owner" ? (
        <button
          type="button"
          class="quiet"
          disabled={busy !== null}
          data-testid={`sending-close-${id}`}
          onClick={() => void run("close", () => closeSendingList(approval))}
        >
          {busy === "close" ? TODAY.working : TODAY.sendingClose}
        </button>
      ) : (
        <p class="notice-line" data-testid={`sending-owner-only-${id}`}>
          {TODAY.ownerOnly}
        </p>
      )}
    </li>
  );
}
