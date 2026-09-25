import { Header, Footer } from "../../ds/PageShell";
import { ProductBuyBlock, ProductLegalDates, ProductShippingLine } from "./ProductLive";
import { formatINR, unitPricePerGram } from "../../../lib/money";
import { MRP_PAISE } from "@lailark/shared";
import productContent from "../../../content/products.json";

// M3.3: one static page per hero, built from `products.json` at build time
// (M3.2's file, extended here) with the live count, price and shelf-life
// dates fetched client-side from `/api/counts`. Only the four heroes get a
// page at launch (brief section 17.8, sales flow doc section 2); the three
// pipeline products are not active and are not built.
//
// ASSUMED (M3.3): products.json stays hand-written rather than generated
// from the `products` Firestore collection at build time. The four heroes'
// slug, name, jar size and generic name do not change often enough to be
// worth a Firestore read (with credentials) at every `next build`, and
// ST1 already keeps the heavy Firestore SDK off this site entirely
// (brief section 19.2 makes the same call for `/api/counts` itself). If a
// fifth hero or a name change becomes routine, generating this file from
// `functions/scripts/seed-products.mjs`'s own list (or from Firestore) is
// the natural next step, but it is not needed yet and would be a new
// build-time dependency for no present benefit.

const heroBySlug = new Map(productContent.heroes.map((h) => [h.slug, h]));

export function generateStaticParams() {
  return productContent.heroes.map((hero) => ({ slug: hero.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const hero = heroBySlug.get(slug);
  if (!hero) return {};
  return {
    title: `${hero.name}. Lailark`,
    description: `${hero.genericName}, ${hero.jarGrams} g. Lailark Kitchen, Kunnamangalam, Kozhikode.`,
  };
}

const productCss = `
.product-main{ flex:1 0 auto; width:100%; font-family:var(--ds-font-body); line-height:1.65 }
.product-col{ width:100%; max-width:34rem; margin:0 auto; padding:0 var(--ds-space-4) }

.product-hero{ padding:var(--ds-space-6) 0 var(--ds-space-5) }
.product-hero__name{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.9rem; line-height:1.18; margin:0 0 var(--ds-space-2);
}
.product-hero__generic{
  font-family:var(--ds-font-mono); font-size:.85rem; color:var(--ds-grey);
  margin:0 0 var(--ds-space-1);
}
.product-hero__jar{
  font-family:var(--ds-font-mono); font-size:.75rem; color:var(--ds-grey);
  margin:var(--ds-space-1) 0 var(--ds-space-4);
}
.product-hero__note{ font-size:.95rem; margin:0 0 var(--ds-space-4) }

.product-live{ margin-top:var(--ds-space-2) }
.product-live__reading, .product-live__note{
  font-family:var(--ds-font-mono); font-size:.8rem; line-height:1.6;
  color:var(--ds-grey); margin:var(--ds-space-2) 0 0;
}
.product-live__note{ margin-top:0 }
.product-live__price{ color:var(--ds-ink) }
.product-live__promise{
  font-family:var(--ds-font-body); font-size:.92rem; line-height:1.6;
  color:var(--ds-ink); margin:var(--ds-space-4) 0 0; max-width:40ch;
}

/* Rust is a number colour, never a button (CLAUDE.md section 3): the Buy
   control stays ink, and only the price figures above it may take rust
   elsewhere on the site. Kept plain ink and an underline here so nothing
   here reaches for rust as a call-to-action colour. */
.product-buy{
  display:inline-block; margin-top:var(--ds-space-4);
  padding:var(--ds-space-3) var(--ds-space-5);
  background:var(--ds-ink); color:var(--ds-paper); border:none; border-radius:4px;
  font-family:var(--ds-font-body); font-size:1rem; font-weight:600; cursor:pointer;
  /* M3.5 made it a link to /checkout, so it takes the button's own colour
     rather than the page's link colour, and carries no underline. */
  text-decoration:none;
}

.product-shipping{
  font-family:var(--ds-font-mono); font-size:.78rem; color:var(--ds-grey);
  margin:var(--ds-space-2) 0 0;
}

.product-section{ padding:var(--ds-space-6) 0 }
.product-section h2{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.15rem; line-height:1.25; margin:0 0 var(--ds-space-4);
}

.product-legal{ font-family:var(--ds-font-mono); font-size:.82rem; line-height:1.7 }
.product-legal__row{
  display:flex; flex-direction:column; gap:2px;
  padding:var(--ds-space-2) 0; border-bottom:1px solid var(--ds-hairline);
}
.product-legal__row:last-child{ border-bottom:none }
.product-legal__row dt{ color:var(--ds-grey) }
.product-legal__row dd{ margin:0; color:var(--ds-ink) }
`;

export default async function ProductPage({ params }) {
  const { slug } = await params;
  const hero = heroBySlug.get(slug);
  if (!hero) return null;

  const seasonNote =
    hero.slug === "koorka"
      ? // Reused verbatim from the home page (M3.2): the same sentence, not a
        // second draft of it.
        "Koorka only grows for part of the year, so it comes round roughly November to February. The one with no meat in it."
      : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: productCss }} />
      <div className="ds-shell">
        <Header />

        <main className="product-main">
          <section className="product-hero">
            <div className="product-col">
              <h1 className="product-hero__name">{hero.name}</h1>
              <p className="product-hero__generic">{hero.genericName}</p>
              <p className="product-hero__jar">{hero.jarGrams} g jar</p>
              {seasonNote ? <p className="product-hero__note">{seasonNote}</p> : null}

              <ProductBuyBlock slug={hero.slug} />
              <ProductShippingLine />
            </div>
          </section>

          <section className="product-section">
            <div className="product-col">
              <h2>What the label says</h2>
              <dl className="product-legal">
                <div className="product-legal__row">
                  <dt>Generic name</dt>
                  <dd>{hero.genericName}</dd>
                </div>
                <div className="product-legal__row">
                  <dt>Net quantity</dt>
                  <dd>{hero.jarGrams} g</dd>
                </div>
                <div className="product-legal__row">
                  <dt>Country of origin</dt>
                  <dd>Product of India</dd>
                </div>
                <div className="product-legal__row">
                  <dt>MRP</dt>
                  <dd>{formatINR(MRP_PAISE)} (incl. of all taxes)</dd>
                </div>
                <div className="product-legal__row">
                  <dt>Unit sale price</dt>
                  <dd>{unitPricePerGram(MRP_PAISE, hero.jarGrams)}</dd>
                </div>
                <ProductLegalDates slug={hero.slug} />
                <div className="product-legal__row">
                  <dt>Manufactured and packed by</dt>
                  <dd>
                    Lailark Kitchen. Neduvanchalil Veedu, Kunnamangalam, Kozhikode, Kerala, India,
                    PIN 673571.
                  </dd>
                </div>
                <div className="product-legal__row">
                  <dt>Consumer care</dt>
                  <dd>
                    <a href="tel:+918891923827">+91 88919 23827</a>
                  </dd>
                </div>
                <div className="product-legal__row">
                  <dt>FSSAI</dt>
                  <dd>21323244000035</dd>
                </div>
              </dl>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
