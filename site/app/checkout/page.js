import { Header, Footer } from "../ds/PageShell";
import CheckoutForm from "./CheckoutForm";

// M3.5: `/checkout?p=<slug>&q=<jars>`.
//
// Statically exported like every other page on this site, with the product,
// the count, the price and the total all read on the client from
// `/api/counts`: a static page can hold no live number, and CLAUDE.md
// section 3 says every count on the site is computed, never typed.
//
// D51: the path is `/checkout`. Customer-site URLs are permanent and were on
// the never-assume list, and no doc named one; Shefin chose the plain path
// that sits beside `/pickles/<slug>` and `/batch/<nnn>` over `/buy` and over
// nesting it under the product. The page is noindexed and nothing links to
// it from outside, so it is only ever reached from a Buy control.

export const metadata = {
  title: "Checkout. Lailark",
  description: "Buy a jar of Lailark oil pickle, posted anywhere in India.",
  // Nothing here should ever be indexed: it is a form with somebody's
  // address half typed into it, not a page anybody should arrive at cold.
  robots: { index: false, follow: false },
};

const checkoutCss = `
.checkout-main{ flex:1 0 auto; width:100%; font-family:var(--ds-font-body); line-height:1.65 }
.checkout-col{ width:100%; max-width:34rem; margin:0 auto; padding:0 var(--ds-space-4) }

.checkout-head{ padding:var(--ds-space-6) 0 var(--ds-space-2) }
.checkout-head h1{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.9rem; line-height:1.18; margin:0;
}

.checkout, .checkout-waiting, .checkout-done{ padding:var(--ds-space-4) 0 var(--ds-space-8) }
.checkout-waiting{ min-height:6rem }

.checkout section{
  padding:var(--ds-space-5) 0;
  border-bottom:1px solid var(--ds-hairline);
}
.checkout section:last-of-type{ border-bottom:none }
.checkout h2, .checkout-done h2{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.15rem; line-height:1.25; margin:0 0 var(--ds-space-3);
}

.checkout-reading{
  font-family:var(--ds-font-mono); font-size:.8rem; color:var(--ds-grey);
  margin:var(--ds-space-2) 0 var(--ds-space-4);
}

.checkout-field{ display:block; margin:0 0 var(--ds-space-4) }
.checkout-field > span{
  display:block; font-size:.9rem; margin:0 0 var(--ds-space-1);
}
.checkout-field__quiet{ color:var(--ds-grey) }
.checkout-field input, .checkout-field select{
  width:100%; padding:var(--ds-space-3);
  font-family:var(--ds-font-body); font-size:1rem; color:var(--ds-ink);
  background:var(--ds-paper);
  border:1px solid var(--ds-hairline); border-radius:4px;
}
.checkout-field input:focus, .checkout-field select:focus{
  outline:2px solid var(--ds-ink); outline-offset:1px;
}
.checkout-field--qty select{ max-width:12rem }
.checkout-row{ display:flex; gap:var(--ds-space-3) }
.checkout-row .checkout-field{ flex:1 1 0; min-width:0 }

/* Rust is a number colour and nothing else (CLAUDE.md section 3), so it is
   here on the money figures and nowhere near the Pay button. */
.checkout-total{
  font-family:var(--ds-font-mono); font-size:.85rem; margin:var(--ds-space-4) 0 0;
}
.checkout-total > div{
  display:flex; justify-content:space-between; gap:var(--ds-space-4);
  padding:var(--ds-space-2) 0; border-bottom:1px solid var(--ds-hairline);
}
.checkout-total > div:last-child{ border-bottom:none }
.checkout-total dt{ color:var(--ds-grey) }
.checkout-total dd{ margin:0 }
.checkout-figure{ color:var(--ds-rust) }
.checkout-total__sum dt{ color:var(--ds-ink) }

.checkout-tick{
  display:flex; gap:var(--ds-space-3); align-items:flex-start;
  margin:0 0 var(--ds-space-4); font-size:.95rem;
}
.checkout-tick input{ margin-top:.25rem; width:1.1rem; height:1.1rem; flex:none }

.checkout-note{
  font-family:var(--ds-font-mono); font-size:.78rem; line-height:1.6;
  color:var(--ds-grey); margin:var(--ds-space-3) 0 0;
}
.checkout-note--last{ margin-top:var(--ds-space-3) }

.checkout-problem{
  font-size:.95rem; margin:var(--ds-space-4) 0 0;
  padding:var(--ds-space-3); border-left:3px solid var(--ds-ink);
  background:rgba(23,21,15,.04);
}

.checkout-pay{
  display:block; width:100%; margin-top:var(--ds-space-5);
  padding:var(--ds-space-4) var(--ds-space-5);
  background:var(--ds-ink); color:var(--ds-paper); border:none; border-radius:4px;
  font-family:var(--ds-font-body); font-size:1.05rem; font-weight:600; cursor:pointer;
}
.checkout-pay:disabled{ opacity:.6; cursor:default }

.checkout-done p{ margin:0 0 var(--ds-space-4) }
`;

export default function CheckoutPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: checkoutCss }} />
      <div className="ds-shell">
        <Header />
        <main className="checkout-main">
          <div className="checkout-col">
            <div className="checkout-head">
              <h1>Your jar</h1>
            </div>
            <CheckoutForm />
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
