/**
 * The undo toast, brief section 17.1: "Numbers editable in place, with
 * undo on a toast for 8 seconds. No 'are you sure' dialogs."
 *
 * This component only ever shows a message and an Undo button for 8
 * seconds, then calls `onExpire`. It holds no Firestore reference and knows
 * nothing about what "before" means: the caller decides what to save, this
 * component only decides how long the offer to undo it stays open. That is
 * deliberate: M2.6 wires the same undo seam to the `audit/{id}` log (brief
 * section 18.1, "the undo log... reads from here") instead of a value kept
 * in a screen's own state, and it should be able to reuse this component
 * unchanged, passing it whatever `before` it reads back off that document.
 */
import type { JSX } from "preact";
import { useEffect } from "preact/hooks";

import { PRODUCTS } from "../copy";

export const UNDO_SECONDS = 8;

export interface UndoToastState<T> {
  readonly message: string;
  readonly before: T;
}

export interface UndoToastProps<T> {
  /** Null hides the toast. A new object (even for the same field) restarts the clock. */
  readonly toast: UndoToastState<T> | null;
  /** Called with the value the field held before the change that raised this toast. */
  readonly onUndo: (before: T) => void;
  /** Called when the toast's own 8 second clock runs out, so the caller clears its state. */
  readonly onExpire: () => void;
}

export function UndoToast<T>({ toast, onUndo, onExpire }: UndoToastProps<T>): JSX.Element | null {
  useEffect(() => {
    if (toast === null) return undefined;
    const timer = window.setTimeout(onExpire, UNDO_SECONDS * 1000);
    return () => window.clearTimeout(timer);
    // Restarting on `toast` alone (not `onExpire`) is deliberate: every
    // caller passes a stable-enough callback, and re-arming on it too would
    // reset the clock on a render that changes nothing the person can see.
  }, [toast]);

  if (toast === null) return null;

  return (
    <div class="undo-toast" role="status" data-testid="undo-toast">
      <p class="undo-toast-message">{toast.message}</p>
      <button
        type="button"
        class="quiet undo-toast-button"
        data-testid="undo-toast-undo"
        onClick={() => onUndo(toast.before)}
      >
        {PRODUCTS.undo}
      </button>
    </div>
  );
}
