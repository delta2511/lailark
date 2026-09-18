import { render } from "preact";

import { App } from "./app";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles/tokens.css";
import "./styles/app.css";

const root = document.getElementById("app");
if (root) {
  render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
    root,
  );
}
