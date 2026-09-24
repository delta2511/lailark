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
// carries it, plus the quiet Orders link (D2, D45).
export function Footer() {
  return (
    <footer className="ds-footer">
      <p>
        Lailark Kitchen. Neduvanchalil Veedu, Kunnamangalam, Kozhikode,
        Kerala, India, PIN 673571. Customer support{" "}
        <a href="tel:+918891923827">+91 88919 23827</a>. FSSAI
        21323244000035.
      </p>
      <p>
        <a href="/orders">Orders</a>
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
