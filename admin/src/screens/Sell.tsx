/**
 * Sell (brief sections 17.3 and 7A.1), M2.8.
 *
 * The big middle button of the bottom bar, one tap from anywhere, because
 * this is the screen used with a customer standing at the door. Two pieces:
 * the New sale form, and the list of today's counter sales with the void of
 * 7A.6 on each. Offline drafts (7A.4) are the third piece and are M2.10.
 *
 * ASSUMED (M2.8): brief 17.12 gives the Viewer "see everything except Money"
 * and no counter sale, so a Viewer gets today's list and no form. The list is
 * not Money: it is what happened at the door, which a CA or a helper is
 * exactly the person to be reading. The callable refuses a Viewer regardless,
 * which is where that rule actually lives; leaving the form off is only
 * politeness, and it is tested on the server as well as here.
 */
import type { JSX } from "preact";

import { SELL } from "../copy";
import { NewSale } from "../sell/NewSale";
import { TodaysSales } from "../sell/TodaysSales";
import type { Session } from "../session";

interface Props {
  readonly session: Session;
}

export function Sell({ session }: Props): JSX.Element {
  const canSell = session.role === "owner" || session.role === "kitchen";

  return (
    <div class="sell" data-testid="screen-sell">
      {canSell ? (
        // Today's list is a live query, so it shows the sale the moment the
        // transaction commits. Nothing here has to be told.
        <NewSale session={session} />
      ) : (
        <p class="notice-line" data-testid="sell-viewer">
          {SELL.viewerCannotSell}
        </p>
      )}
      <div class="hairline" />
      <TodaysSales />
    </div>
  );
}
