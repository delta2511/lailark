import type { JSX } from "preact";

import { COPY } from "../copy";

/** Sell is the big middle button from anywhere; the New sale screen lands in M2.8. */
export function Sell(): JSX.Element {
  return (
    <div class="empty-state" data-testid="screen-sell">
      <p>{COPY.sellBody}</p>
    </div>
  );
}
