/**
 * Hold-to-confirm, brief §17.1: "No 'are you sure' dialogs, except for actions
 * that leave the system: sending a Razorpay refund and sending a broadcast.
 * Those use hold-to-confirm."
 *
 * M4.5 is the first of those to be built, so this is the pattern rather than a
 * copy of one. Anything later that leaves the system (M4.5b's Razorpay refund,
 * the broadcast) uses this component; a second way of asking the same question
 * would be a second thing to get wrong.
 *
 * ## How it behaves
 *
 * The finger goes down, a bar fills across the button for {@link HOLD_MS}, and
 * the action fires when it reaches the end. Lifting, dragging off, or the
 * browser taking the pointer away cancels it and the bar goes back to nothing.
 * Nothing fires on a tap, which is the whole point: a thumb that brushes the
 * screen with flour on it cannot send money back.
 *
 * It is a real `<button>`, so it is reachable by keyboard and read as a button:
 * Space or Enter held down starts the fill the same way a finger does, and the
 * key coming up cancels it. `onKeyDown` repeats while a key is held, so the
 * repeat is ignored rather than restarting the timer.
 *
 * The label says what holding will do and the hint underneath says to hold, so
 * the instruction is never only in the animation. No countdown number, because
 * a number ticking down is the countdown CLAUDE.md §3 forbids; this is a
 * progress bar on the person's own finger, which is not a deadline.
 */
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** How long the finger stays down. Long enough to be a decision, short enough not to annoy. */
export const HOLD_MS = 1200;

interface Props {
  readonly label: string;
  /** The line under the button, e.g. "Hold to record". */
  readonly hint: string;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
  readonly testId: string;
  /**
   * How long this particular action wants. Defaults to {@link HOLD_MS}; a
   * heavier action later (a broadcast to everyone who paid) may want longer.
   */
  readonly holdMs?: number;
}

export function HoldToConfirm({
  label,
  hint,
  onConfirm,
  disabled = false,
  testId,
  holdMs = HOLD_MS,
}: Props): JSX.Element {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  function stop(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  }

  function start(): void {
    if (disabled || timer.current !== null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, holdMs);
  }

  // A pending hold must never outlive the panel it was in: the order moves on
  // underneath this screen (another phone, a webhook), the section unmounts,
  // and a timer still running would fire a refund at a screen that is gone.
  useEffect(() => stop, []);

  // Once it is disabled mid-hold (a submit already sent, the order moved on),
  // the fill stops with it rather than running on to fire the action.
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);

  return (
    <div class="hold-confirm">
      <button
        type="button"
        class={holding ? "hold-confirm-button holding" : "hold-confirm-button"}
        style={holding ? { "--hold-ms": `${holdMs}ms` } : undefined}
        data-testid={testId}
        data-holding={holding ? "yes" : "no"}
        disabled={disabled}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            if (!event.repeat) start();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") stop();
        }}
        // A real button also fires on click, which would be a tap-to-send.
        onClick={(event) => event.preventDefault()}
      >
        <span class="hold-confirm-fill" aria-hidden="true" />
        <span class="hold-confirm-label">{label}</span>
      </button>
      <p class="field-label" data-testid={`${testId}-hint`}>
        {hint}
      </p>
    </div>
  );
}
