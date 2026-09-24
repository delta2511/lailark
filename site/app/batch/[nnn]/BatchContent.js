import { createElement as e, Fragment } from "react";
import { formatIngredients } from "../../../lib/batch.js";

// M3.4: the record page's own content (everything below the shared
// Header/Footer chrome), kept in its own file with no import of anything
// under site/app/ds/ so it can be imported and rendered directly by the
// plain `node --test` runner (site/tests-unit, no bundler, same as
// site/lib/money.js's tests) to prove the template is generic: it renders
// a fixture batch, with ingredient percentages, that is not batch 001 and
// is not a file under site/content/batches/ (see
// tests-unit/batch.test.mjs). Written with React.createElement rather than
// JSX for the same reason; every other file in this route, and the rest of
// the site, keeps ordinary JSX. page.js composes this with the shared
// Header and Footer.
//
// D47: no Legal Metrology block, no price, no buy button here, ever; those
// belong to /pickles/<slug>. D48: the page always ends with one action,
// "See what we make", to "/". D49: story is an array of paragraphs. D50:
// photos is an array that renders nothing when empty.

export const batchCss = `
.batch-main{ flex:1 0 auto; width:100%; font-family:var(--ds-font-body); line-height:1.65 }
.batch-col{ width:100%; max-width:34rem; margin:0 auto; padding:0 var(--ds-space-4) var(--ds-space-6) }

.batch-hero{ margin:var(--ds-space-4) 0 var(--ds-space-6); line-height:1.15 }
.batch-hero__no{
  display:block; font-family:var(--ds-font-mono); font-size:.8rem; font-weight:700;
  letter-spacing:.2em; text-transform:uppercase; color:var(--ds-rust); margin-bottom:.55rem;
}
.batch-hero__name{
  display:block; font-family:var(--ds-font-heading); font-size:2rem; font-weight:600;
  letter-spacing:-.015em;
}

.batch-facts{ list-style:none; margin:0 0 var(--ds-space-5); padding:0; font-family:var(--ds-font-body) }
.batch-facts li{ padding:.28rem 0 }

.batch-main h2{
  margin:var(--ds-space-7) 0 var(--ds-space-2); font-family:var(--ds-font-body);
  font-size:.82rem; font-weight:700; letter-spacing:.16em; text-transform:uppercase;
  color:var(--ds-grey);
}
.batch-main p{ margin:0 0 var(--ds-space-4) }
.batch-story{ font-family:var(--ds-font-mono); font-size:.98rem; line-height:1.8 }
.batch-tight{ margin-bottom:.6rem }

.batch-photos{ margin-top:var(--ds-space-6) }
.batch-photo{ width:100%; height:auto; display:block; border-radius:4px }

.batch-cta-p{ margin:var(--ds-space-7) 0 var(--ds-space-4) }
/* Rust is a number colour, never a button (CLAUDE.md section 3): the D48
   closing action stays ink throughout, underline and all, the same call
   .product-buy on the product page makes for the Buy control. Rust stays
   on .batch-hero__no above, which is a batch number, exactly what the
   token is for. */
.batch-cta{
  display:inline; font-weight:600; font-size:1.05rem; color:var(--ds-ink);
  text-decoration:underline; text-decoration-color:var(--ds-ink);
  text-decoration-thickness:2px; text-underline-offset:.28em;
}
.batch-cta__arrow{ color:var(--ds-ink); padding:0 .1em }
`;

export default function BatchContent({ batch }) {
  const factItems = batch.facts.map((fact) => e("li", { key: fact }, fact));

  const storyParagraphs = batch.story.map((paragraph) =>
    e("p", { className: "batch-story", key: paragraph }, paragraph)
  );

  const photoBlock =
    batch.photos && batch.photos.length > 0
      ? e(
          "div",
          { className: "batch-photos" },
          batch.photos.map((photo) =>
            e("img", {
              key: photo.src,
              className: "batch-photo",
              src: photo.src,
              alt: photo.alt,
              width: photo.width,
              height: photo.height,
              loading: "lazy",
            })
          )
        )
      : null;

  return e(
    Fragment,
    null,
    e("style", { dangerouslySetInnerHTML: { __html: batchCss } }),
    e(
      "main",
      { className: "batch-main" },
      e(
        "div",
        { className: "batch-col" },
        e(
          "h1",
          { className: "batch-hero" },
          e("span", { className: "batch-hero__no" }, `Batch ${batch.number}`),
          e("span", { className: "batch-hero__name" }, batch.name)
        ),
        e("ul", { className: "batch-facts" }, factItems),
        storyParagraphs,
        e("h2", null, "Your jar"),
        e("p", { className: "batch-story" }, batch.yourJar),
        e("h2", null, "What is in it"),
        e("p", null, formatIngredients(batch.ingredients)),
        e("p", null, batch.allergens),
        e("p", null, batch.claims),
        e("h2", null, "How to keep it"),
        e("p", { className: "batch-tight" }, batch.storage),
        e("p", null, batch.bestBefore),
        photoBlock,
        e(
          "p",
          { className: "batch-cta-p" },
          e(
            "a",
            { className: "batch-cta", href: "/" },
            "See what we make ",
            e("span", { className: "batch-cta__arrow", "aria-hidden": "true" }, "→")
          )
        )
      )
    )
  );
}
