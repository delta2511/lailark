import type { JSX } from "preact";

import { COPY } from "../copy";

export function Batches(): JSX.Element {
  return (
    <div class="empty-state" data-testid="screen-batches">
      <p>{COPY.batchesEmptyLine1}</p>
      <p class="lede">{COPY.batchesEmptyLine2}</p>
    </div>
  );
}
