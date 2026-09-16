import type { JSX } from "preact";

import { COPY, roleLabel } from "../copy";
import type { Session } from "../session";

interface SettingsProps {
  readonly session: Session;
  readonly onSignOut: () => void;
}

/** The signed-in account. The sign-out button moved here from the M1.6 landing. */
export function Settings({ session, onSignOut }: SettingsProps): JSX.Element {
  return (
    <div class="settings" data-testid="screen-settings">
      <div class="settings-field">
        <p class="field-label">{COPY.settingsName}</p>
        <p class="field-value field-value-name" data-testid="signed-in">
          {session.name}
        </p>
      </div>
      <div class="settings-field">
        <p class="field-label">{COPY.settingsRole}</p>
        <p class="field-value field-value-role" data-testid="role">
          {roleLabel(session.role)}
        </p>
      </div>
      <div class="settings-field">
        <p class="field-label">{COPY.settingsPhone}</p>
        <p class="field-value" data-testid="phone">
          {session.phone}
        </p>
      </div>
      <div class="hairline" />
      <button class="quiet" type="button" onClick={() => onSignOut()}>
        {COPY.signOut}
      </button>
    </div>
  );
}
