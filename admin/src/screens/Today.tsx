import type { JSX } from "preact";

import { COPY } from "../copy";

/** The signed-in landing. Concerns move to the top of this screen once M2+ writes them. */
export function Today(): JSX.Element {
  return (
    <div class="empty-state" data-testid="screen-today">
      <p>{COPY.todayEmptyLine1}</p>
      <p class="lede">{COPY.todayEmptyLine2}</p>
    </div>
  );
}
