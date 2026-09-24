import type { JSX } from "preact";

import { MORE_EMPTY_BODY, type MoreRowKey } from "../copy";

interface MoreEmptyScreenProps {
  readonly rowKey: Exclude<MoreRowKey, "settings" | "products">;
}

/** The empty state shared by Concerns, Customers, Agent and Money. Products is its own screen from M2.1. */
export function MoreEmptyScreen({ rowKey }: MoreEmptyScreenProps): JSX.Element {
  return (
    <div class="empty-state" data-testid={`screen-more-${rowKey}`}>
      <p>{MORE_EMPTY_BODY[rowKey]}</p>
    </div>
  );
}
