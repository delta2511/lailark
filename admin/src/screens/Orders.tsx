import type { JSX } from "preact";

import { COPY } from "../copy";

export function Orders(): JSX.Element {
  return (
    <div class="empty-state" data-testid="screen-orders">
      <p>{COPY.ordersEmpty}</p>
    </div>
  );
}
