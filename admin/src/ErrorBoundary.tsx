import { Component, type ComponentChildren } from "preact";

import { COPY } from "./copy";

interface Props {
  readonly children: ComponentChildren;
}

interface State {
  readonly failed: boolean;
}

/**
 * The last resort (M1.12).
 *
 * A screen that throws while it is drawing leaves Preact unable to paint the
 * tree again, and the app looks alive but answers nothing: taps land, buttons
 * press, and no state reaches the screen. Rather than leave the kitchen
 * tapping a dead page, say so plainly and offer the reload that fixes it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  componentDidCatch(error: unknown): void {
    console.error("[lailark] a screen threw while drawing", error);
    this.setState({ failed: true });
  }

  render(): ComponentChildren {
    if (!this.state.failed) return this.props.children;

    return (
      <main class="screen" data-testid="crashed">
        <h1 class="wordmark">{COPY.crashed}</h1>
        <p class="lede">{COPY.crashedLede}</p>
        <div class="hairline" />
        <button type="button" onClick={() => window.location.reload()}>
          {COPY.crashedReload}
        </button>
      </main>
    );
  }
}
