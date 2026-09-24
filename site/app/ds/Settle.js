"use client";

import { useEffect, useState } from "react";

// The "settle" motion (Flow §10): jars arrive with a small drop and
// half a degree of overshoot, staggered 70ms, once per session. Built
// here as a primitive for M3.2 to use on the home page's first paint.
//
// "Once per session" is read as sessionStorage, not a server flag:
// there is nothing here that costs money or messages anyone, so this
// is a plain client-side convenience, not state that needs to persist
// across devices or be readable by the server.
const SESSION_KEY = "lailark:settled";

export default function Settle({ children, className }) {
  const items = Array.isArray(children) ? children : [children];
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    try {
      if (!window.sessionStorage.getItem(SESSION_KEY)) {
        // A one-time read of sessionStorage on mount, only knowable
        // client side (static export has no window at build time), so
        // this necessarily costs one extra render rather than being
        // derivable during render itself.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAnimate(true);
        window.sessionStorage.setItem(SESSION_KEY, "1");
      }
    } catch {
      // Storage unavailable (private mode, etc.): render without the
      // entrance animation rather than throw.
    }
  }, []);

  return (
    <div className={["ds-settle", className].filter(Boolean).join(" ")}>
      {items.map((child, i) => (
        <div
          key={i}
          className={animate ? "ds-settle__item ds-settle__item--animate" : "ds-settle__item"}
          style={{ "--ds-settle-delay": `${i * 70}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
