/**
 * Inline line icons, 24px, stroke only. No icon package (CLAUDE.md section
 * 3: no dependencies casually); these are the whole set the shell needs.
 */
import type { JSX } from "preact";

interface IconProps {
  readonly size?: number;
}

function svg(size: number, children: JSX.Element | JSX.Element[]): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width={1.6}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Today: a sun, for the day ahead. */
export function TodayIcon({ size = 24 }: IconProps): JSX.Element {
  return svg(size, [
    <circle key="c" cx="12" cy="12" r="4.2" />,
    <path
      key="r"
      d="M12 2.5v2.4M12 19.1v2.4M4.3 4.3l1.7 1.7M18 18l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.3 19.7l1.7-1.7M18 6l1.7-1.7"
    />,
  ]);
}

/** Sell: a plus, for the sale that starts here. */
export function SellIcon({ size = 24 }: IconProps): JSX.Element {
  return svg(size, [<path key="p" d="M12 5v14M5 12h14" />]);
}

/** Batches: two stacked jars. */
export function BatchesIcon({ size = 24 }: IconProps): JSX.Element {
  return svg(size, [
    <path key="a" d="M8 3.5h4v2.3l1.2 1.5v3.6h-6.4V7.3L8 5.8z" />,
    <path key="b" d="M6.8 11h6.4v9.5a1 1 0 0 1-1 1H7.8a1 1 0 0 1-1-1z" />,
    <path key="c" d="M6.8 15h6.4" />,
  ]);
}

/** Orders: a short list. */
export function OrdersIcon({ size = 24 }: IconProps): JSX.Element {
  return svg(size, [
    <path key="a" d="M5 5.5h11.5" />,
    <path key="b" d="M5 12h14" />,
    <path key="c" d="M5 18.5h9" />,
  ]);
}

/** More: three dots. */
export function MoreIcon({ size = 24 }: IconProps): JSX.Element {
  return svg(size, [
    <circle key="a" cx="6" cy="12" r="1.4" />,
    <circle key="b" cx="12" cy="12" r="1.4" />,
    <circle key="c" cx="18" cy="12" r="1.4" />,
  ]);
}

/** A chevron pointing right, for a row that leads somewhere. */
export function ChevronRightIcon({ size = 18 }: IconProps): JSX.Element {
  return svg(size, [<path key="p" d="M9 5l6 7-6 7" />]);
}

/** A chevron pointing left, for the back affordance. */
export function ChevronLeftIcon({ size = 18 }: IconProps): JSX.Element {
  return svg(size, [<path key="p" d="M15 5l-6 7 6 7" />]);
}
