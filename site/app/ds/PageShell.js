import { POLICY_PAGES } from "@lailark/shared";

import Lark from "./Lark";

// Header with the lark mark (Flow §10). Referencing Lark keeps the
// mark's path data in one place for the design system rather than a
// second hand copy here.
export function Header({ className }) {
  return (
    <header className={["ds-header", className].filter(Boolean).join(" ")}>
      <Lark size={28} className="ds-header__mark" />
      <span className="ds-header__name">Lailark</span>
    </header>
  );
}

// Footer: the legal line, character for character as the v0 footer
// carries it, plus the five policy pages (D2, D45, D66).
//
// The links are read from `POLICY_PAGES` rather than typed here, so a page
// cannot be published without a link to it and a link cannot point at a page
// that does not exist. `site/tests/policies.spec.js` opens every one of them.
export function Footer() {
  return (
    <footer className="ds-footer">
      <p>
        Lailark Kitchen. Neduvanchalil Veedu, Kunnamangalam, Kozhikode,
        Kerala, India, PIN 673571. Customer support{" "}
        <a href="tel:+918891923827">+91 88919 23827</a>. FSSAI
        21323244000035.
      </p>
      <p className="ds-footer__links">
        {POLICY_PAGES.map((page) => (
          <a href={page.path} key={page.path}>
            {page.footerLabel}
          </a>
        ))}
      </p>
    </footer>
  );
}

// The page shell: header, main, footer, on the paper ground.
export function Shell({ children, className }) {
  return (
    <div className={["ds-shell", className].filter(Boolean).join(" ")}>
      <Header />
      <main className="ds-main">{children}</main>
      <Footer />
    </div>
  );
}
