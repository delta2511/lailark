/**
 * Can this actually be read? (M2.21)
 *
 * Every test in this suite asserted that the Undo button was there and could
 * be clicked, and all of them passed while the word "Undo" rendered #17150f
 * on #17150f: present, clickable, and invisible to Shefin for the whole of
 * M2.6 through M2.16. "The element exists" is not the same claim as "a person
 * can see it", and only the second one is what the screen is for.
 *
 * So this reads the colours the browser actually resolved, through
 * `getComputedStyle`, and puts a number on them. A CSS specificity accident
 * cannot hide from it: the losing rule leaves the background `transparent`,
 * this walks up to the surface that is really behind the text, and the ratio
 * comes out 1.
 */
import { expect, type Locator } from "@playwright/test";

/**
 * WCAG 2.1 AA for body-sized text. The admin's own ink on paper is about 16:1,
 * so a real regression falls far below this rather than grazing it: the
 * threshold is here to name what "readable" means, not to be tuned against.
 */
export const MIN_CONTRAST = 4.5;

interface Measured {
  readonly color: string;
  readonly background: string;
  readonly ratio: number;
}

/**
 * The colours as the browser resolved them, plus their contrast ratio.
 *
 * The background is the *effective* one: an element whose own background is
 * transparent (or unset) shows whatever is behind it, so this walks up the
 * ancestors until it finds a surface that actually paints. That walk is the
 * whole point. The bug this guards against is exactly a button that believes
 * it set a background and did not.
 */
export async function measureContrast(target: Locator): Promise<Measured> {
  return target.evaluate((element: Element) => {
    function parse(value: string): [number, number, number, number] | null {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/[,/\s]+/).filter((p) => p !== "");
      const [r, g, b] = parts.slice(0, 3).map(Number);
      const a = parts.length > 3 ? Number(parts[3]) : 1;
      if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
      return [r, g, b, a];
    }

    function luminance([r, g, b]: [number, number, number, number]): number {
      const channel = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    const color = getComputedStyle(element).color;

    // Walk up until something paints. A fully transparent background shows
    // its ancestor, which is what a lost specificity battle leaves behind.
    let background = "rgb(255, 255, 255)";
    let node: Element | null = element;
    while (node) {
      const parsed = parse(getComputedStyle(node).backgroundColor);
      if (parsed && parsed[3] > 0) {
        background = getComputedStyle(node).backgroundColor;
        break;
      }
      node = node.parentElement;
    }

    const fg = parse(color);
    const bg = parse(background);
    if (!fg || !bg) return { color, background, ratio: 0 };

    const lighter = Math.max(luminance(fg), luminance(bg));
    const darker = Math.min(luminance(fg), luminance(bg));
    return { color, background, ratio: (lighter + 0.05) / (darker + 0.05) };
  });
}

/**
 * Fails unless `target`'s text is readable against whatever is actually
 * behind it. The message names both colours and the ratio, because "contrast
 * too low" on its own sends the next person back to the browser to find out
 * which two colours collided.
 */
export async function expectReadable(target: Locator, label: string): Promise<void> {
  const measured = await measureContrast(target);
  expect(
    measured.ratio,
    `${label}: text ${measured.color} on ${measured.background} is ${measured.ratio.toFixed(2)}:1, ` +
      `below the ${MIN_CONTRAST}:1 a person can read. Identical colours give 1.00:1.`,
  ).toBeGreaterThanOrEqual(MIN_CONTRAST);
}
