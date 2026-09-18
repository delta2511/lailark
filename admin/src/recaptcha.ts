/**
 * Cleaning up after Google's invisible reCAPTCHA (M1.12).
 *
 * `RecaptchaVerifier.clear()` is almost a no-op for an invisible widget: it
 * marks the instance destroyed and decrements a counter. It does not reset the
 * widget and it does not remove anything grecaptcha appended to the page. What
 * grecaptcha leaves behind, per render, is:
 *
 *   - a `div.grecaptcha-badge` (plus a hidden iframe) inside the container we
 *     gave it, and
 *   - a container appended to `document.body` holding the challenge iframe
 *     (`.../recaptcha/api2/bframe?...`). While the challenge is up that iframe
 *     covers the viewport; parked, the container sits at `top: -10000px`.
 *
 * If the container we gave it is unmounted while the widget is live, nothing
 * ever hides or removes that body-level container again, and a visible one
 * swallows every tap on the page underneath it. That is the sign-out bug: the
 * phone box could not be typed into until a reload.
 *
 * These helpers take the document (and window) as arguments so they can be
 * unit-tested against a hand-built fake DOM.
 */

/** The id of the host div App keeps mounted for the life of the app. */
export const RECAPTCHA_HOST_ID = "recaptcha";

interface GrecaptchaLike {
  reset?: (widgetId?: number) => void;
}

/**
 * Asks grecaptcha to reset the widget, which is what makes it hide a challenge
 * it is currently showing. Returns whether the reset actually happened.
 */
export function resetRecaptchaWidget(win: Window, widgetId: number | null): boolean {
  if (widgetId === null) return false;
  const grecaptcha = (win as Window & { grecaptcha?: GrecaptchaLike }).grecaptcha;
  if (!grecaptcha || typeof grecaptcha.reset !== "function") return false;
  try {
    grecaptcha.reset(widgetId);
    return true;
  } catch {
    // The widget's element is already gone. Removing the nodes still works.
    return false;
  }
}

/**
 * Removes the nodes grecaptcha left behind, and only those. Returns how many
 * nodes were removed, so a caller (or a test) can tell a clean page from a
 * littered one.
 *
 * Deliberately conservative. A node is removed only if it is
 *   - an element carrying grecaptcha's own `grecaptcha-badge` class, or
 *   - a `div` that is a direct child of `body`, carries neither an id nor a
 *     class (ours always carry one or the other), contains at least one
 *     iframe, and every iframe inside it is a reCAPTCHA iframe.
 */
export function clearRecaptchaArtifacts(doc: Document): number {
  const body: Element | null = doc.body ?? null;
  if (!body) return 0;

  const doomed: Element[] = [];
  for (const child of toArray(body.children)) {
    if (isChallengeContainer(child)) doomed.push(child);
  }
  collectBadges(body, doomed);

  let removed = 0;
  for (const node of doomed) {
    // A badge that sits inside a container already on the list goes with it.
    // It is removed once, and counted once.
    if (isInside(node, doomed)) continue;
    node.remove();
    removed += 1;
  }
  return removed;
}

function collectBadges(node: Element, into: Element[]): void {
  for (const child of toArray(node.children)) {
    if (hasClass(child, "grecaptcha-badge")) into.push(child);
    else collectBadges(child, into);
  }
}

function isChallengeContainer(node: Element): boolean {
  if (tag(node) !== "div") return false;
  if (node.id) return false;
  if (classNameOf(node).trim() !== "") return false;
  const frames = iframesIn(node);
  return frames.length > 0 && frames.every(isRecaptchaFrame);
}

function iframesIn(node: Element): Element[] {
  const found: Element[] = [];
  for (const child of toArray(node.children)) {
    if (tag(child) === "iframe") found.push(child);
    else found.push(...iframesIn(child));
  }
  return found;
}

function isRecaptchaFrame(frame: Element): boolean {
  const src = frame.getAttribute("src") ?? "";
  return src.includes("/recaptcha/");
}

/** True if any of `others` is an ancestor of `node`. */
function isInside(node: Element, others: readonly Element[]): boolean {
  let walker: Element | null = node.parentElement;
  while (walker) {
    if (others.includes(walker)) return true;
    walker = walker.parentElement;
  }
  return false;
}

function toArray(children: ArrayLike<Element> | undefined): Element[] {
  return children ? Array.prototype.slice.call(children) : [];
}

function tag(node: Element): string {
  return String(node.tagName ?? "").toLowerCase();
}

function classNameOf(node: Element): string {
  // SVG elements carry an SVGAnimatedString here, not a string.
  return typeof node.className === "string" ? node.className : "";
}

function hasClass(node: Element, name: string): boolean {
  return classNameOf(node).split(/\s+/).includes(name);
}
