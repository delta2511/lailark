import type { Role } from "@lailark/shared";
import type { JSX } from "preact";

import { MORE_ROWS } from "../copy";
import { navigate } from "../router";
import { ChevronRightIcon } from "../shell/icons";

interface MoreProps {
  readonly role: Role;
}

/**
 * Six rows (brief section 17.1). Money is hidden for Kitchen: Owner and
 * Viewer both see money (Viewer read only, D13), Kitchen sees everything
 * else (brief section 17.12).
 */
export function More({ role }: MoreProps): JSX.Element {
  const rows = MORE_ROWS.filter((row) => role !== "kitchen" || !row.ownerAndViewerOnly);

  return (
    <ul class="more-list" data-testid="screen-more">
      {rows.map((row) => (
        <li key={row.key}>
          <button
            type="button"
            class="more-row"
            data-testid={`more-row-${row.key}`}
            onClick={() => navigate(row.path)}
          >
            <span class="more-row-label">{row.label}</span>
            <ChevronRightIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}
