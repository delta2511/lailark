import { describe, expect, it } from "vitest";

import { clearRecaptchaArtifacts, resetRecaptchaWidget } from "./recaptcha";

/**
 * A hand-built DOM. The unit suite runs in node (no jsdom), and the helper is
 * written against the small surface built here on purpose: an element has a
 * tag, an id, a class, children, attributes and remove().
 */
interface Fake {
  tagName: string;
  id: string;
  className: string;
  children: Fake[];
  parentElement: Fake | null;
  getAttribute(name: string): string | null;
  remove(): void;
}

function el(
  tagName: string,
  props: { id?: string; className?: string; src?: string } = {},
  children: Fake[] = [],
): Fake {
  const node: Fake = {
    tagName: tagName.toUpperCase(),
    id: props.id ?? "",
    className: props.className ?? "",
    children,
    parentElement: null,
    getAttribute: (name) => (name === "src" ? (props.src ?? null) : null),
    remove(): void {
      const parent = node.parentElement;
      if (!parent) return;
      parent.children = parent.children.filter((child) => child !== node);
      node.parentElement = null;
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function documentWith(...children: Fake[]): Document {
  const body = el("body", { id: "body" }, children);
  return { body } as unknown as Document;
}

/** What grecaptcha appends to document.body for the challenge, per render. */
function challengeContainer(): Fake {
  return el("div", {}, [
    el("div", {}),
    el("div", {}, [
      el("iframe", {
        src: "https://www.google.com/recaptcha/api2/bframe?hl=en&v=zqB-6Xpbd3lCIvi7Tr2D0pob&k=6Lc",
      }),
    ]),
  ]);
}

/** What grecaptcha puts inside the container it was given. */
function badge(): Fake {
  return el("div", { className: "grecaptcha-badge" }, [
    el("div", { className: "grecaptcha-logo" }),
    el("textarea", { id: "g-recaptcha-response" }),
  ]);
}

describe("clearRecaptchaArtifacts", () => {
  it("removes the badge and the challenge container, and nothing else", () => {
    const app = el("div", { id: "app" }, [
      el("main", { className: "screen" }, [el("input", { id: "phone" })]),
      el("div", { id: "recaptcha", className: "recaptcha-host" }, [el("div", {}, [badge()])]),
    ]);
    const doc = documentWith(app, challengeContainer());

    expect(clearRecaptchaArtifacts(doc)).toBe(2);

    expect(doc.body.children).toHaveLength(1);
    expect((doc.body.children as unknown as Fake[])[0].id).toBe("app");
    const host = (app.children as Fake[])[1];
    expect((host.children as Fake[])[0].children).toHaveLength(0);
  });

  it("leaves a page with nothing of reCAPTCHA's on it completely alone", () => {
    const ours = el("div", { id: "app" }, [
      el("main", { className: "screen" }, [
        el("form", {}, [el("input", { id: "phone" }), el("button", {})]),
      ]),
      el("div", { id: "recaptcha", className: "recaptcha-host" }),
    ]);
    const doc = documentWith(ours);

    expect(clearRecaptchaArtifacts(doc)).toBe(0);
    expect(doc.body.children).toHaveLength(1);
    expect((ours.children as Fake[])).toHaveLength(2);
  });

  it("returns 0 for a body with no reCAPTCHA in it at all", () => {
    expect(clearRecaptchaArtifacts(documentWith())).toBe(0);
  });

  it("is safe to call twice: the second call finds nothing left", () => {
    const doc = documentWith(el("div", { id: "app" }, [badge()]), challengeContainer());

    expect(clearRecaptchaArtifacts(doc)).toBe(2);
    expect(clearRecaptchaArtifacts(doc)).toBe(0);
    expect(doc.body.children).toHaveLength(1);
  });

  it("removes every challenge container when several renders have piled up", () => {
    const doc = documentWith(
      el("div", { id: "app" }),
      challengeContainer(),
      challengeContainer(),
      challengeContainer(),
    );

    expect(clearRecaptchaArtifacts(doc)).toBe(3);
    expect(doc.body.children).toHaveLength(1);
  });

  it("spares an unnamed body-level div whose iframe is not reCAPTCHA's", () => {
    const ours = el("div", {}, [el("iframe", { src: "https://lailark.in/embed" })]);
    const doc = documentWith(ours, challengeContainer());

    expect(clearRecaptchaArtifacts(doc)).toBe(1);
    expect(doc.body.children).toHaveLength(1);
    expect((doc.body.children as unknown as Fake[])[0]).toBe(ours);
  });

  it("spares an unnamed body-level div that holds no iframe", () => {
    const doc = documentWith(el("div", {}, [el("p", {})]));
    expect(clearRecaptchaArtifacts(doc)).toBe(0);
  });

  it("counts a badge inside a doomed container once, not twice", () => {
    const container = challengeContainer();
    container.children.push(badge());
    (container.children[container.children.length - 1] as Fake).parentElement = container;
    const doc = documentWith(container);

    expect(clearRecaptchaArtifacts(doc)).toBe(1);
    expect(doc.body.children).toHaveLength(0);
  });
});

describe("resetRecaptchaWidget", () => {
  it("resets the widget grecaptcha is holding", () => {
    const seen: (number | undefined)[] = [];
    const win = { grecaptcha: { reset: (id?: number) => seen.push(id) } } as unknown as Window;

    expect(resetRecaptchaWidget(win, 0)).toBe(true);
    expect(seen).toEqual([0]);
  });

  it("does nothing when there is no widget, no grecaptcha, or reset throws", () => {
    const win = { grecaptcha: { reset: () => {} } } as unknown as Window;
    expect(resetRecaptchaWidget(win, null)).toBe(false);
    expect(resetRecaptchaWidget({} as Window, 0)).toBe(false);

    const throwing = {
      grecaptcha: {
        reset: () => {
          throw new Error("widget element is gone");
        },
      },
    } as unknown as Window;
    expect(resetRecaptchaWidget(throwing, 0)).toBe(false);
  });
});
