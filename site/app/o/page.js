import { Header, Footer } from "../ds/PageShell";
import OrderView from "./OrderView";
import { ORDER_PAGE_COPY } from "../../lib/orderCopy";

// M3.8: `/o/<token>`, the private order page of brief §5.
//
// One static file serves every token. Next's static export cannot prerender
// a page per token (there is no list of them, and there must never be one on
// disk), so this file is published as `/o.html` and `firebase.json` rewrites
// `/o/**` onto it. The token is read from the path in the browser and the
// order arrives from `/api/order/<token>`, which is `no-store` end to end.
//
// Nothing private is in this HTML. The file is the same for everybody and is
// safe to cache; the order is not, and is never cached anywhere.

export const metadata = {
  title: "Your order. Lailark",
  // Never indexed, and never followed: the link is private and the page
  // holds somebody's address.
  robots: { index: false, follow: false },
};

const orderCss = `
.order-main{ flex:1 0 auto; width:100%; font-family:var(--ds-font-body); line-height:1.65 }
.order-col{ width:100%; max-width:34rem; margin:0 auto; padding:0 var(--ds-space-4) }

.order-head{ padding:var(--ds-space-6) 0 var(--ds-space-2) }
.order-head h1{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.9rem; line-height:1.18; margin:0;
}

.order-live{ min-height:8rem; padding:var(--ds-space-4) 0 var(--ds-space-8) }
.order-live h2{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.15rem; line-height:1.25; margin:var(--ds-space-6) 0 var(--ds-space-3);
}

.order-note{ margin:0 0 var(--ds-space-4) }

/* Rust is a number colour and nothing else (CLAUDE.md section 3): it is on
   the figures and the references here, and on no heading and no control. */
.order-figure, .order-ref{ font-family:var(--ds-font-mono); color:var(--ds-rust) }

.order-facts, .order-total{ margin:0; font-family:var(--ds-font-mono); font-size:.85rem }
.order-facts > div, .order-total > div{
  display:flex; justify-content:space-between; gap:var(--ds-space-4);
  padding:var(--ds-space-2) 0; border-bottom:1px solid var(--ds-hairline);
}
.order-facts dt, .order-total dt{ color:var(--ds-grey) }
.order-facts dd, .order-total dd{ margin:0 }
.order-total__sum dt{ color:var(--ds-ink) }

.order-lines{ list-style:none; margin:var(--ds-space-5) 0; padding:0 }
.order-lines li{
  display:flex; flex-wrap:wrap; gap:var(--ds-space-3); align-items:baseline;
  padding:var(--ds-space-3) 0; border-bottom:1px solid var(--ds-hairline);
}
.order-line__what{ flex:1 1 10rem }
.order-line__jars, .order-line__batch{
  font-family:var(--ds-font-mono); font-size:.8rem; color:var(--ds-grey);
}

.order-jars{ font-size:.95rem; margin:var(--ds-space-4) 0 0 }

.order-address address{ font-style:normal }
.order-address address span{ display:block }

.order-documents ul{ list-style:none; margin:0; padding:0 }
.order-documents li{
  display:flex; flex-wrap:wrap; gap:var(--ds-space-3); align-items:baseline;
  padding:var(--ds-space-3) 0; border-bottom:1px solid var(--ds-hairline);
  font-size:.95rem;
}
.order-doc__kind{ flex:1 1 8rem }
`;

export default function OrderPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: orderCss }} />
      <div className="ds-shell">
        <Header />
        <main className="order-main">
          <div className="order-col">
            <div className="order-head">
              <h1>{ORDER_PAGE_COPY.heading}</h1>
            </div>
            <OrderView />
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
