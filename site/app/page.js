import { Footer } from "./ds/PageShell";
import Lark from "./ds/Lark";
import { ProductCount, ProductState } from "./_lib/counts";
import CardAction from "./_home/CardAction";
import CardBatchLine from "./_home/CardBatchLine";
import { inStockPrice, openBatchPrice } from "../lib/money";
import productContent from "../content/products.json";
import batch001 from "../content/batches/001.json";

// The home page, rebuilt to the design Shefin and Claude settled on 8 Oct
// 2026 (M5.12, D77 to D86). `_incoming/home-redesign/home-reference.html` is
// the source of truth for layout, wording, colour, type and motion, and
// `docs/business/Lailark_Landing_Copy.md` is the copy record: nothing a
// customer reads here was written during the build.
//
// Scope, D77: the home page only. `ds/tokens.css.js`, `ds/primitives.css.js`
// and `ds/PageShell.js` are untouched and every other page keeps its output,
// so `/batch/001` still builds byte for byte as it was. Every rule below is a
// descendant of the one `.hp` root, so none of it can reach another page.
// `@font-face` cannot be scoped, but the whole block ships on this page alone
// and a face only costs a download when a rule actually uses the family.
//
// D78: this page carries its own palette and its own four faces, self-hosted
// and subsetted under `public/assets/fonts/` with their licences beside them
// (MANIFEST.json there is build-time documentation and is never referenced
// from the page). So on this page, and nowhere else, "system faces only",
// "rust never lands on a button or a heading" and "there is no fifth colour"
// do not hold.
//
// D79: the jar video is gone, and with it the hero's dark ground, the oil and
// `Settle`. The page has exactly one dark section again, "Two houses". The
// motion is "breath": CSS only, one clock of `--breath: 7s`, every animation
// inside `@media (prefers-reduced-motion: no-preference)`, and the scroll
// reveal behind `@supports (animation-timeline: view())` so it can only ever
// be an enhancement. With JavaScript off, or in a browser with no
// scroll-driven animation, the whole page is there and readable.
//
// Nothing is typed that the site computes (CLAUDE.md §3). The counts, the
// state pills, the bottled date and the prices all come from `/api/counts`
// through `_lib/counts.js`, `inStockPrice()`/`openBatchPrice()` and
// `content/batches/001.json`. The one thing the page cannot show is the batch
// number on a card: the counts endpoint does not publish it. See
// `_home/CardBatchLine.js`.

export const metadata = {
  // D85: the hero paragraph is the h1 and the description carries the same
  // sentences. This is the part of D73 that D85 amends.
  description:
    "Oil pickles from our kitchen in Kozhikode. Sumayya makes them by hand, patiently, with fish from Chaliyam and spices in the right measure. One small batch at a time.",
};

// The three pickles (D81: koorka is off the page and stays in the data). Read
// out of products.json by slug, so a name or a jar size is never typed twice.
// The taste words, the one-line summary and the "How it tastes" paragraph are
// the copy record's section 3, word for word.
const CARDS = [
  {
    slug: "prawns-and-dates",
    taste: ["sour", "sweet", "sea"],
    line: "Sour first, then the dates, then the sea.",
    tastes:
      "It starts with a light sour from the vinegar. Then the sweetness of the dates comes in, and after that you taste the prawn and the sea. The prawns are fried outside and soft inside. The heat does not stay long.",
    // The only jar photograph that exists. It is the prawns jar, and its
    // label plainly reads Prawns with a prawn drawn on it, so it may not
    // stand in for the other two (M5.11, the launch checklist).
    photo: { src: "/assets/home-jar.webp", width: 354, height: 600 },
    ringVariant: "",
  },
  {
    slug: "squid-and-dates",
    taste: ["sharp", "spicy", "calm"],
    line: "Sharp at the start, then mellow. The quiet one.",
    tastes:
      "Squid has very little taste of its own, so in this jar it carries the masala. It begins sharp and spicy, and then it becomes calm. This is our quiet one.",
    photo: null,
    ringVariant: " hp-ring--b",
  },
  {
    slug: "beef-and-dates",
    taste: ["crisp", "tender", "heat"],
    line: "Crisp outside, tender inside, and the most heat.",
    tastes:
      "We choose the tender parts and keep them as pieces. The outside is crisp, and inside it is soft enough that you are not chewing forever. This one has the most heat, and a little of it stays with you.",
    photo: null,
    ringVariant: "",
  },
];

const heroesBySlug = new Map(
  productContent.heroes.map((hero) => [hero.slug, hero])
);

const cards = CARDS.map((card) => ({ ...card, hero: heroesBySlug.get(card.slug) }));

const homeCss = `
/* ---------------------------------------------------------------------- */
/* The four faces (D78). Self-hosted, subsetted, SIL Open Font Licence.   */
/* Every family, weight, style and unicode-range below is copied from     */
/* public/assets/fonts/MANIFEST.json, which is not served to the browser. */
/* ---------------------------------------------------------------------- */
@font-face{
  font-family:"Manjari"; font-style:normal; font-weight:700; font-display:swap;
  src:url(/assets/fonts/manjari-700-malayalam.woff2) format("woff2");
  unicode-range:U+0307, U+0323, U+0951-0952, U+0964-0965, U+0B83, U+0D00-0D7F, U+1CDA, U+1CF2, U+200C-200D, U+20B9, U+25CC, U+A830-A832;
}
@font-face{
  font-family:"Fraunces"; font-style:normal; font-weight:400; font-display:swap;
  src:url(/assets/fonts/fraunces-400-latin.woff2) format("woff2");
  unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face{
  font-family:"Fraunces"; font-style:italic; font-weight:400; font-display:swap;
  src:url(/assets/fonts/fraunces-400-italic-latin.woff2) format("woff2");
  unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face{
  font-family:"Figtree"; font-style:normal; font-weight:400 600; font-display:swap;
  src:url(/assets/fonts/figtree-variable-latin.woff2) format("woff2");
  unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face{
  font-family:"Figtree"; font-style:normal; font-weight:400 600; font-display:swap;
  src:url(/assets/fonts/figtree-variable-latin-ext.woff2) format("woff2");
  unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face{
  font-family:"IBM Plex Mono"; font-style:normal; font-weight:400; font-display:swap;
  src:url(/assets/fonts/ibm-plex-mono-400-latin.woff2) format("woff2");
  unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face{
  font-family:"IBM Plex Mono"; font-style:normal; font-weight:400; font-display:swap;
  src:url(/assets/fonts/ibm-plex-mono-400-latin-ext.woff2) format("woff2");
  unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}

/* ---------------------------------------------------------------------- */
/* The page's own ground, palette and type (D78). Declared on .hp, so     */
/* every one of these variables dies at the edge of this page.            */
/* ---------------------------------------------------------------------- */
.hp{
  --hp-ink:#2E1A10;
  --hp-paper:#FCEFE3;
  --hp-rust:#A8481F;
  --hp-leaf:#2F5D3A;
  --hp-grey:#6F5646;
  --hp-hair:#EFD8C4;
  --hp-dark:#8C3A1B;
  --hp-on-dark:#FFF6EC;
  --hp-ring:#E09A3A;
  --hp-band:#F9DCC4;
  --hp-mark-off:#DDBFA5;
  --hp-serif:"Fraunces", ui-serif, Georgia, "Times New Roman", serif;
  --hp-sans:"Figtree", system-ui, -apple-system, "Segoe UI", sans-serif;
  --hp-mono:"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --hp-ml:"Manjari", "Malayalam Sangam MN", "Noto Sans Malayalam", sans-serif;
  --breath:7s;

  /* The hero's view timeline, named here so the fixed dock, which is not a
     descendant of the hero, can still reference it. */
  timeline-scope:--hp-hero;

  display:flex; flex-direction:column; min-height:100dvh;
  background:var(--hp-paper); color:var(--hp-ink);
  font-family:var(--hp-sans); line-height:1.65;
  overflow-x:clip;
}
/* The ground runs past the page box too, so an overscroll on a phone does
   not flash the design system's paper. Both selectors are gated on this page
   being present, so neither reaches another route. */
body:has(.hp){ background:#FCEFE3 }
html:has(.hp){ scroll-behavior:smooth }
@media (prefers-reduced-motion:reduce){ html:has(.hp){ scroll-behavior:auto } }

.hp [id]{ scroll-margin-top:84px }
.hp a{ color:var(--hp-ink) }
.hp a:hover{ color:var(--hp-rust) }
.hp a:focus-visible, .hp summary:focus-visible{
  outline:2px solid var(--hp-rust); outline-offset:3px;
}
.hp-main{ flex:1 0 auto; width:100% }
.hp-wrap{ max-width:1120px; margin-inline:auto; padding-inline:24px }
.hp-eyebrow{
  font-family:var(--hp-mono); font-size:12px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--hp-grey);
}
.hp-h2{
  font-family:var(--hp-serif); font-weight:400;
  font-size:clamp(30px,3.4vw,44px); line-height:1.15; margin:0;
}
.hp-body{
  font-family:var(--hp-sans); font-size:17px; line-height:1.7; margin:0;
  max-width:34rem; text-wrap:pretty;
}
.hp-ml{ font-family:var(--hp-ml); font-weight:700 }
.hp-mono{ font-family:var(--hp-mono) }

/* From "Two houses" down the accent turns from terracotta to the oil red. */
.hp-late{ --hp-rust:#B3261E; --hp-dark:#5A140D; --hp-on-dark:#FBF4E6 }

/* Buttons. Outline pill by default; the card's action is a terracotta fill
   and it breathes (D78 suspends "rust is never a button" on this page). */
.hp-btn{
  display:inline-flex; align-items:center; justify-content:center;
  min-height:48px; padding:0 24px;
  border:1px solid var(--hp-ink); border-radius:999px;
  background:transparent; color:var(--hp-ink);
  font-family:var(--hp-sans); font-size:16px; text-decoration:none;
  cursor:pointer; transition:background .25s ease, color .25s ease, transform .25s ease;
}
.hp-btn:hover{ background:var(--hp-ink); color:var(--hp-paper) }
.hp-btn:active{ transform:scale(.97) }
.hp-btn--take{
  background:var(--hp-rust); border-color:var(--hp-rust); color:#FFF6EC;
  position:relative; z-index:1;
}
.hp-btn--take:hover{ background:#8C3A1B; border-color:#8C3A1B; color:#FFF6EC }
.hp-link{
  display:inline-flex; align-items:center; min-height:44px;
  font-family:var(--hp-sans); font-size:16px; text-underline-offset:5px;
}

/* ---------------------------------------------------------------------- */
/* Header. Home-page scoped: PageShell's own header is untouched, and so  */
/* is D70's shape, one anchor around mark and wordmark with the mark      */
/* decorative inside it, so a screen reader hears one link.              */
/* ---------------------------------------------------------------------- */
.hp-header{
  position:sticky; top:0; z-index:10;
  background:color-mix(in srgb, var(--hp-paper) 92%, transparent);
  backdrop-filter:blur(8px);
  border-bottom:1px solid var(--hp-hair);
}
.hp-header__row{
  display:flex; align-items:center; justify-content:space-between;
  gap:24px; min-height:68px;
}
.hp-brand{
  display:inline-flex; align-items:center; gap:12px; min-height:44px;
  text-decoration:none;
}
.hp-brand svg{ width:38px; height:auto; display:block; flex:none }
.hp-brand__name{ font-family:var(--hp-serif); font-size:19px }
.hp-nav{ display:flex; align-items:center; gap:28px }
.hp-nav a{
  display:inline-flex; align-items:center; min-height:44px;
  font-family:var(--hp-sans); font-size:15px; text-decoration:none;
}

/* ---------------------------------------------------------------------- */
/* Hero. Paper, not ink (D79): the jar in a hand, with rings breathing    */
/* behind it. The h1 is the copy record's hero paragraph (D85).           */
/* ---------------------------------------------------------------------- */
.hp-hero{
  display:flex; flex-wrap:wrap; align-items:center; gap:48px;
  padding-top:72px; padding-bottom:96px;
  view-timeline-name:--hp-hero;
}
.hp-hero__words{
  flex:1.15 1 420px; min-width:0;
  display:flex; flex-direction:column; gap:28px;
}
.hp-hero__title{
  font-family:var(--hp-serif); font-weight:400;
  font-size:clamp(27px,3.3vw,44px); line-height:1.24; margin:0;
  text-wrap:pretty;
}
.hp-hero__actions{ display:flex; flex-wrap:wrap; align-items:center; gap:20px }
/* Leaf only ever touches a claim, on this page as everywhere else. */
.hp-claims{
  list-style:none; margin:0; padding:0;
  display:flex; flex-wrap:wrap; gap:8px 24px;
  font-size:14px; color:var(--hp-leaf);
}
.hp-hero__photo{
  flex:1 1 340px; position:relative;
  display:flex; justify-content:center; align-items:center;
}
.hp-hero__img{
  position:relative; display:block; width:min(100%, 426px); height:auto;
}

/* Rings: decoration only, never text. Amber is too faint on peach to read. */
.hp-ring{
  position:absolute; left:50%; top:50%; aspect-ratio:1;
  border:1px solid var(--hp-ring); border-radius:50%;
  transform:translate(-50%,-50%); pointer-events:none;
}
.hp-ring--hero-a{ width:min(92%, 460px) }
.hp-ring--hero-b{ width:min(112%, 560px) }
.hp-ring--band-a{ width:min(70%, 620px) }
.hp-ring--band-b{ width:min(96%, 860px) }
.hp-ring--card{ width:250px }

/* ---------------------------------------------------------------------- */
/* The band.                                                             */
/* ---------------------------------------------------------------------- */
.hp-band{
  position:relative; overflow:hidden; text-align:center;
  background:var(--hp-band);
  border-top:1px solid var(--hp-hair); border-bottom:1px solid var(--hp-hair);
  padding:128px 24px;
}
.hp-band__ml{
  position:relative; margin:0; font-weight:700;
  font-size:clamp(42px,8.4vw,116px); line-height:1.3; color:var(--hp-rust);
}
.hp-band__en{
  position:relative; margin:20px 0 0;
  font-family:var(--hp-serif); font-style:italic;
  font-size:clamp(18px,2vw,24px); color:var(--hp-grey);
}

/* ---------------------------------------------------------------------- */
/* The three pickles.                                                    */
/* ---------------------------------------------------------------------- */
.hp-section{ padding-top:112px; padding-bottom:112px }
.hp-section--rule{ border-top:1px solid var(--hp-hair); padding:120px 0 }
.hp-head{ display:flex; flex-direction:column; gap:12px; margin-bottom:56px }
.hp-head--wide{ gap:16px }
.hp-cards{
  display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));
  gap:56px 40px;
}
/* D71: the whole card is the tap target, and it is still the title's own
   anchor doing it, stretched over the card by a pseudo-element. The card's
   only other anchor is the action, which is lifted above the overlay. */
.hp-card{
  position:relative; background:var(--hp-paper);
  display:flex; flex-direction:column; gap:16px;
}
.hp-card__shelf{
  position:relative; display:flex; justify-content:center; padding:24px 0 8px;
}
.hp-card__jar{
  position:relative; display:block; height:300px; width:auto;
  transition:transform .5s cubic-bezier(.3,.7,.2,1);
}
.hp-card:hover .hp-card__jar{ transform:translateY(-8px) }
.hp-card__name{
  font-family:var(--hp-serif); font-weight:400; font-size:28px;
  line-height:1.15; margin:0;
}
.hp-card__name a{ text-decoration:none }
.hp-card__name a::after{ content:""; position:absolute; inset:0 }
.hp-card:hover .hp-card__name a{ text-decoration:underline; text-underline-offset:.2em }
.hp-card__name a:focus-visible{ outline:none }
.hp-card:has(.hp-card__name a:focus-visible){
  outline:2px solid var(--hp-rust); outline-offset:6px;
}
.hp-card__meta{
  font-family:var(--hp-mono); font-size:12px; letter-spacing:.06em;
  color:var(--hp-grey); margin:0;
}
.hp-card__taste{
  font-family:var(--hp-mono); display:flex; align-items:center; gap:10px;
  font-size:14px; color:var(--hp-grey);
}
.hp-card__line{ font-size:16px }
/* The action row holds its height before the counts land, so the card
   cannot jump when a price and a button arrive. */
.hp-card__action{
  display:flex; align-items:center; justify-content:space-between; gap:16px;
  border-top:1px solid var(--hp-hair); padding-top:16px; margin-top:auto;
  min-height:65px;
}
.hp-card__price{ font-family:var(--hp-mono); font-size:22px }
.hp-cards__note{
  margin:64px auto 0; text-align:center; font-size:15px; color:var(--hp-grey);
}

/* The placeholder slots. Four photographs do not exist yet and every one of
   them blocks the production deploy (M5.11). Each says what it waits for. */
.hp-ph{
  display:flex; align-items:center; justify-content:center;
  padding:24px; text-align:center;
  font-family:var(--hp-mono); font-size:13px; line-height:1.6;
  border:1px dashed var(--hp-grey); color:var(--hp-grey);
}
.hp-ph--jar{ width:177px; height:300px; position:relative; background:#FFFFFF }
.hp-ph--stove{
  aspect-ratio:4 / 5;
  border-color:rgba(250,248,244,.4); color:rgba(250,248,244,.72);
}
.hp-ph--card{ aspect-ratio:4 / 3; transform:rotate(-2.5deg); background:#FFFFFF }

/* ---------------------------------------------------------------------- */
/* The one dark section (D79: the hero is no longer the second one).      */
/* ---------------------------------------------------------------------- */
.hp-dark{ background:var(--hp-dark); color:var(--hp-on-dark); padding:120px 0 }
.hp-dark .hp-eyebrow{ color:rgba(250,248,244,.7) }
.hp-dark a{ color:var(--hp-on-dark) }
.hp-split{ display:flex; flex-wrap:wrap; align-items:center; gap:64px }
.hp-split__narrow{ flex:1 1 300px; min-width:0 }
.hp-split__wide{
  flex:1.35 1 420px; min-width:0;
  display:flex; flex-direction:column; gap:28px;
}
.hp-places{ display:flex; align-items:center; gap:16px; max-width:34rem }
.hp-place{ flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:4px }
.hp-place--right{ text-align:right }
.hp-place__name{
  font-family:var(--hp-mono); font-size:12px; letter-spacing:.12em;
  text-transform:uppercase;
}
.hp-place__what{ font-size:14px; color:rgba(250,248,244,.72) }
.hp-wire{
  position:relative; flex:0 0 96px; height:1px;
  background:rgba(250,248,244,.4);
}
.hp-wire .hp-traveller{
  position:absolute; top:-3px; left:0; width:7px; height:7px;
  margin-left:-3px; border-radius:50%; background:var(--hp-paper);
}

/* ---------------------------------------------------------------------- */
/* പാകം.                                                                 */
/* ---------------------------------------------------------------------- */
.hp-pakam{
  display:flex; flex-wrap:wrap; align-items:center; gap:64px;
  padding-top:128px; padding-bottom:128px;
}
.hp-pakam__art{
  flex:1 1 300px; min-width:0;
  display:flex; flex-direction:column; align-items:center; gap:20px;
}
.hp-pakam__words{
  flex:1.3 1 420px; min-width:0;
  display:flex; flex-direction:column; gap:24px;
}
.hp-pakam__lede{
  font-family:var(--hp-serif); font-size:clamp(22px,2.3vw,30px);
  line-height:1.35; margin:0; max-width:30rem; text-wrap:pretty;
}
/* The word fills to the brim. With no animation it rests full, which is
   also the reduced-motion resting state the handoff asks for. */
.hp-fillword{
  margin:0; font-size:clamp(72px,10vw,150px); line-height:1.25; font-weight:700;
  background-image:linear-gradient(to top, var(--hp-rust) 0 50%, #E7C4AA 50% 100%);
  background-size:100% 200%; background-position:0 100%;
  -webkit-background-clip:text; background-clip:text;
  color:transparent; -webkit-text-fill-color:transparent;
}
.hp-salt{ width:min(100%, 420px); height:auto; margin-top:12px; overflow:visible }
.hp-hand{ transform-origin:246px 54px }
.hp-heap{ transform-origin:173px 181px }
.hp-grain{ opacity:0 }
.hp-gr2{ --dx:4px } .hp-gr3{ --dx:-5px } .hp-gr4{ --dx:2px }
.hp-gr5{ --dx:-3px } .hp-gr6{ --dx:5px }
/* "Just enough." sits under the bowl and again at the end of the paragraph
   beside it (D86). Full strength when nothing is animating. */
.hp-enough{
  margin:0; font-family:var(--hp-serif); font-style:italic;
  font-size:clamp(20px,2vw,24px); color:var(--hp-grey);
}

/* ---------------------------------------------------------------------- */
/* How a jar reaches you (D83: this is where the open batch is explained).*/
/* ---------------------------------------------------------------------- */
.hp-rule{
  position:relative; height:1px; background:var(--hp-hair); margin-bottom:32px;
}
.hp-rule .hp-traveller{
  position:absolute; top:-4px; left:0; width:9px; height:9px;
  margin-left:-4px; border-radius:50%; background:var(--hp-rust);
}
.hp-steps{
  list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));
  gap:40px;
}
.hp-steps li{ display:flex; flex-direction:column; gap:12px }
.hp-step__n{ font-family:var(--hp-mono); font-size:14px; color:var(--hp-rust) }
.hp-step h3{
  font-family:var(--hp-serif); font-weight:400; font-size:26px; margin:0;
}
.hp-asides{
  display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));
  gap:32px 40px; margin-top:64px; padding-top:32px;
  border-top:1px solid var(--hp-hair);
}
.hp-asides p{ font-size:16px; color:var(--hp-grey) }
/* Rust is still a number colour here: the price inside a sentence. */
.hp-price{ font-family:var(--hp-mono) }

/* ---------------------------------------------------------------------- */
/* The number on your jar. The card is read out of content/batches/001.json,
   which is also what /batch/001 reads, so the two can never disagree.     */
/* ---------------------------------------------------------------------- */
.hp-record{
  margin:0; border:1px solid var(--hp-ink); padding:8px 24px;
  font-family:var(--hp-mono); font-size:14px; background:#FFFFFF;
  list-style:none;
}
.hp-record__row{ padding:14px 0; border-bottom:1px solid var(--hp-hair) }
.hp-record__row:last-child{ border-bottom:none }
.hp-record__batch{ color:var(--hp-rust) }

/* ---------------------------------------------------------------------- */
/* The name, the abroad line, the footer.                                */
/* ---------------------------------------------------------------------- */
.hp-note__art{ display:flex; justify-content:center }
.hp-note__frame{ width:min(100%, 340px) }
.hp-name{
  max-width:36rem; margin-inline:auto; padding-inline:24px;
  display:flex; flex-direction:column; align-items:center; gap:28px;
  text-align:center;
}
.hp-creek{ width:100%; height:60px; overflow:visible }
.hp-foot{ border-top:1px solid var(--hp-hair); padding-top:56px }
.hp-abroad p{ font-size:16px; margin:0 }
/* The design system's footer, restyled from here and nowhere else: the legal
   line and the five policy links stay in PageShell so there is one copy of
   them. */
.hp .ds-footer{
  max-width:1120px; margin-inline:auto;
  padding:24px 24px 56px; border-top:none;
  font-family:var(--hp-mono); font-size:12px; line-height:1.8;
  color:var(--hp-grey);
}
.hp .ds-footer p{ max-width:44rem; margin:0 0 24px }
.hp .ds-footer p:last-child{ margin-bottom:0 }
.hp .ds-footer a{ color:var(--hp-grey) }
.hp .ds-footer__links{ gap:4px 24px; font-size:14px }
.hp .ds-footer__links a{
  display:inline-flex; align-items:center; min-height:44px;
  font-family:var(--hp-sans); text-underline-offset:5px;
}

/* ---------------------------------------------------------------------- */
/* The count, the pill and the jar marks, restyled. The class names are   */
/* the ones ProductCount, ProductState and JarMarks already emit: other   */
/* code and the test suite depend on them, so only the look changes.      */
/* ---------------------------------------------------------------------- */
.hp .home-count{ display:flex; flex-direction:column; gap:8px; min-height:3.4rem }
.hp .home-count__reading, .hp .home-count__note{
  font-size:14px; line-height:1.5; color:var(--hp-grey); margin:0;
}
.hp .home-count__price{ font-family:var(--hp-mono); color:var(--hp-ink) }
.hp .home-count__open{
  font-size:14px; line-height:1.5; color:var(--hp-grey); margin:0;
}
.hp .home-jar__stateslot{ margin:0; min-height:26px }
.hp .home-jar__state{
  display:inline-block;
  font-family:var(--hp-mono); font-size:11px; letter-spacing:.08em;
  text-transform:uppercase; color:var(--hp-grey);
  border:1px solid var(--hp-hair); border-radius:999px;
  padding:.2rem .6rem; line-height:1.5;
}
.hp .ds-jarmarks{ gap:5px }
.hp .ds-jarmark{ width:12px; height:17px }
.hp .ds-jarmark--filled{ fill:var(--hp-ink) }
.hp .ds-jarmark--empty{ fill:none; stroke:var(--hp-mark-off); stroke-width:1 }

/* ---------------------------------------------------------------------- */
/* "How it tastes".                                                      */
/* ---------------------------------------------------------------------- */
.hp details{ border-top:1px solid var(--hp-hair) }
.hp summary{
  list-style:none; cursor:pointer; min-height:48px;
  display:flex; align-items:center; justify-content:space-between;
  font-family:var(--hp-sans); font-size:15px;
  position:relative; z-index:1;
}
.hp summary::-webkit-details-marker{ display:none }
.hp summary .hp-plus{
  font-family:var(--hp-mono); font-size:18px; transition:transform .3s ease;
}
.hp details[open] summary .hp-plus{ transform:rotate(45deg) }
.hp details .hp-body{ padding-bottom:16px }

/* ---------------------------------------------------------------------- */
/* Breath. One clock, a slow in and a slower out, the peak at 42%.        */
/* Every animation below lives inside the no-preference block, so the     */
/* resting state above is what a reduced-motion reader gets.              */
/* ---------------------------------------------------------------------- */
@keyframes hp-breathe-ring{
  0%,100%{ transform:translate(-50%,-50%) scale(.93); opacity:.5 }
  42%{ transform:translate(-50%,-50%) scale(1.05); opacity:1 }
}
@keyframes hp-breathe-lift{ 0%,100%{ transform:translateY(0) } 42%{ transform:translateY(-10px) } }
@keyframes hp-breathe-text{
  0%,100%{ opacity:.82; letter-spacing:0 }
  42%{ opacity:1; letter-spacing:.012em }
}
@keyframes hp-breathe-note{
  0%,100%{ color:var(--hp-grey) } 14%,30%{ color:var(--hp-ink) } 44%{ color:var(--hp-grey) }
}
@keyframes hp-travel{
  0%{ left:0; opacity:0 } 8%{ opacity:1 } 92%{ opacity:1 } 100%{ left:100%; opacity:0 }
}
@keyframes hp-flow{ to{ stroke-dashoffset:-240 } }
@keyframes hp-rise{ from{ opacity:0; transform:translateY(26px) } to{ opacity:1; transform:none } }
@keyframes hp-breathe-btn{
  0%,100%{ transform:scale(1); box-shadow:0 0 0 0 rgba(168,72,31,.38) }
  42%{ transform:scale(1.04); box-shadow:0 0 0 10px rgba(168,72,31,0) }
}
@keyframes hp-fill-word{ 0%,100%{ background-position:0 0 } 42%,74%{ background-position:0 100% } }
@keyframes hp-rub{
  0%{ transform:rotate(0deg) } 6%{ transform:rotate(-3deg) } 12%{ transform:rotate(2deg) }
  18%{ transform:rotate(-3deg) } 24%{ transform:rotate(2deg) } 30%{ transform:rotate(-2deg) }
  36%{ transform:rotate(1deg) } 42%,100%{ transform:rotate(0deg) }
}
@keyframes hp-drop{
  0%{ opacity:0; transform:translate(0,0) }
  1.5%{ opacity:1; transform:translate(0,2px) }
  11%{ opacity:1; transform:translate(var(--dx,0px),56px) }
  12.5%,100%{ opacity:0; transform:translate(var(--dx,0px),56px) }
}
@keyframes hp-heap-grow{
  0%{ transform:scale(.1); opacity:0 } 6%{ opacity:1 }
  42%,74%{ transform:scale(1); opacity:1 } 100%{ transform:scale(.1); opacity:0 }
}
@keyframes hp-enough{ 0%,30%{ opacity:.2 } 44%,74%{ opacity:1 } 100%{ opacity:.2 } }
@keyframes hp-mark-breathe{ 0%,100%{ opacity:1 } 42%{ opacity:.5 } }
@keyframes hp-dock-in{
  from{ opacity:0; visibility:hidden }
  to{ opacity:1; visibility:visible }
}

@media (prefers-reduced-motion: no-preference){
  .hp-ring{ animation:hp-breathe-ring var(--breath) cubic-bezier(.45,0,.55,1) infinite }
  .hp-ring--b, .hp-ring--hero-b, .hp-ring--band-b{
    animation-delay:calc(var(--breath) * -.18);
  }
  .hp-float{ animation:hp-breathe-lift var(--breath) cubic-bezier(.45,0,.55,1) infinite; will-change:transform }
  .hp-band__ml{ animation:hp-breathe-text var(--breath) cubic-bezier(.45,0,.55,1) infinite }
  .hp-card__taste span.hp-t{
    animation:hp-breathe-note calc(var(--breath) * 1.2) ease-in-out infinite;
  }
  .hp-card__taste span.hp-t2{ animation-delay:calc(var(--breath) * .4) }
  .hp-card__taste span.hp-t3{ animation-delay:calc(var(--breath) * .8) }
  .hp-traveller{ animation:hp-travel calc(var(--breath) * 2) cubic-bezier(.45,0,.55,1) infinite }
  .hp-creek path{ animation:hp-flow calc(var(--breath) * 2) linear infinite }
  .hp-fillword{ animation:hp-fill-word calc(var(--breath) * 1.2) cubic-bezier(.45,0,.55,1) infinite }
  .hp-hand{ animation:hp-rub calc(var(--breath) * 1.2) ease-in-out infinite }
  .hp-enough{ animation:hp-enough calc(var(--breath) * 1.2) ease-in-out infinite }
  .hp-heap{ animation:hp-heap-grow calc(var(--breath) * 1.2) cubic-bezier(.45,0,.55,1) infinite }
  .hp-grain{ animation:hp-drop calc(var(--breath) * 1.2) cubic-bezier(.5,0,.9,.6) infinite both }
  .hp-gr2{ animation-delay:calc(var(--breath) * .07) }
  .hp-gr3{ animation-delay:calc(var(--breath) * .14) }
  .hp-gr4{ animation-delay:calc(var(--breath) * .21) }
  .hp-gr5{ animation-delay:calc(var(--breath) * .28) }
  .hp-gr6{ animation-delay:calc(var(--breath) * .35) }
  .hp-btn--take{ animation:hp-breathe-btn var(--breath) cubic-bezier(.45,0,.55,1) infinite }
  /* The marks settle in on the design system's own 18 ms stagger, then the
     filled ones pulse in a slow wave. */
  .hp .ds-jarmark--filled{
    animation:
      ds-mark-in 260ms ease-out both,
      hp-mark-breathe var(--breath) cubic-bezier(.45,0,.55,1) infinite;
    animation-delay:
      calc(var(--ds-mark-index, 0) * 18ms),
      calc(400ms + var(--ds-mark-index, 0) * 110ms);
  }
}

/* The scroll reveal is an enhancement and never a gate: with no support for
   it, or under reduced motion, every section is simply already there. */
@supports (animation-timeline: view()){
  @media (prefers-reduced-motion: no-preference){
    .hp-rv{
      animation:hp-rise linear both;
      animation-timeline:view(); animation-range:entry 0% entry 42%;
    }
  }
}

/* ---------------------------------------------------------------------- */
/* Phones.                                                               */
/* ---------------------------------------------------------------------- */
.hp-dock{ display:none }
@media (max-width:760px){
  .hp-nav{ gap:18px }
  .hp-nav a{ font-size:14px; white-space:nowrap }
  .hp-brand__name{ display:none }
  .hp-hero{ padding-top:48px; padding-bottom:64px; gap:24px }
  /* The reference's hero photo column carries a 540 px floor, which opens an
     empty gap between the words and the jar at narrow widths. The photo is
     sized by its width here instead, so the column is exactly as tall as the
     picture. The width and height attributes still hold the ratio, so
     nothing reflows when it loads. */
  .hp-hero__photo{ min-height:0 }
  .hp-band{ padding:88px 24px }
  .hp-section{ padding-top:72px; padding-bottom:72px }
  .hp-section--rule, .hp-dark{ padding:72px 0 }
  .hp-pakam{ padding-top:80px; padding-bottom:80px; gap:40px }
  .hp-split, .hp-pakam{ gap:40px }
  .hp-cards{ gap:48px 24px }
  .hp-dock{
    display:flex; position:fixed; left:12px; right:12px; bottom:12px; z-index:20;
  }
  .hp-dock .hp-btn{
    width:100%; background:var(--hp-paper);
    box-shadow:0 6px 24px rgba(23,21,15,.22);
  }
  .hp-dock .hp-btn:hover{ background:var(--hp-ink) }
  .hp-foot{ padding-bottom:96px }
}
@media (min-width:761px){
  .hp-hero__photo{ min-height:540px }
}
/* The dock earns its place only once the hero's own button has gone past:
   until then the same words are already on screen twice. CSS only, on the
   hero's named view timeline. Where scroll-driven animation is not
   supported, or under reduced motion, the dock simply shows, which is the
   reference's behaviour: a permanently visible dock is a small cost, a dock
   that never appears is a broken button. */
@supports (animation-timeline: view()){
  @media (prefers-reduced-motion: no-preference) and (max-width:760px){
    .hp-dock{
      opacity:0; visibility:hidden;
      animation:hp-dock-in both;
      animation-timeline:--hp-hero;
      animation-range:exit 0% exit 100%;
    }
  }
}
`;

// The three steps of "How a jar reaches you" (D83). The prices are read, not
// typed: ₹599 is what a jar is booked for and ₹649 is what a leftover costs.
const STEPS = [
  {
    n: "01",
    title: "You book a jar",
    body: <>You book your jar first, for {openBatchPrice()}.</>,
  },
  {
    n: "02",
    title: "She cooks",
    body: (
      <>
        When half the batch is booked, we buy what is needed and she starts
        cooking, and we send you photos from the kitchen.
      </>
    ),
  },
  {
    n: "03",
    title: "It comes home",
    body: (
      <>
        When it is ready, your jar is numbered by hand and sent home to you.
        Shipping is free anywhere in India.
      </>
    ),
  },
];

export default function HomePage() {
  return (
    <>
      {/* The hero photograph is the page's largest paint. React hoists these
          into <head>. Only the two faces the first screen needs are
          preloaded: the other five would compete with the picture. */}
      <link
        rel="preload"
        as="image"
        href="/assets/home-jar-in-hand.webp"
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="font"
        type="font/woff2"
        href="/assets/fonts/fraunces-400-latin.woff2"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        as="font"
        type="font/woff2"
        href="/assets/fonts/figtree-variable-latin.woff2"
        crossOrigin="anonymous"
      />
      <style dangerouslySetInnerHTML={{ __html: homeCss }} />

      <div className="hp">
        <header className="hp-header">
          <div className="hp-wrap hp-header__row">
            {/* D70: one anchor around mark and wordmark, the mark decorative
                inside it, so a screen reader hears one link. */}
            <a className="hp-brand" href="/" aria-label="Lailark Kitchen, home">
              <Lark size={38} title={null} />
              <span className="hp-brand__name">Lailark Kitchen</span>
            </a>
            <nav className="hp-nav" aria-label="Main">
              <a href="#story">Our story</a>
              <a href="#how">How it works</a>
            </nav>
          </div>
        </header>

        <main className="hp-main">
          <section id="top" className="hp-wrap hp-hero">
            <div className="hp-hero__words">
              <div className="hp-eyebrow">Kunnamangalam, Kozhikode</div>
              <h1 className="hp-hero__title">
                Oil pickles from our kitchen in Kozhikode. Sumayya makes them
                by hand, patiently, with fish from Chaliyam and spices in the
                right measure. One small batch at a time.
              </h1>
              <div className="hp-hero__actions">
                <a className="hp-btn" href="#pickles">
                  See what is in the kitchen
                </a>
                <a className="hp-link" href="#story">
                  Read the story
                </a>
              </div>
              <ul className="hp-claims">
                <li>Made in a halal kitchen</li>
                <li>No added preservatives</li>
                <li>Free shipping anywhere in India</li>
              </ul>
            </div>
            <div className="hp-hero__photo">
              <div className="hp-ring hp-ring--hero-a" aria-hidden="true" />
              <div className="hp-ring hp-ring--hero-b hp-ring--b" aria-hidden="true" />
              <img
                className="hp-hero__img hp-float"
                src="/assets/home-jar-in-hand.webp"
                alt="A hand holding a jar of Lailark prawns pickle"
                width={426}
                height={518}
                fetchPriority="high"
                decoding="async"
              />
            </div>
          </section>

          <section className="hp-band">
            <div className="hp-ring hp-ring--band-a" aria-hidden="true" />
            <div className="hp-ring hp-ring--band-b hp-ring--b" aria-hidden="true" />
            <h2 className="hp-ml hp-band__ml" lang="ml">
              പാകത്തിന് സ്നേഹം
            </h2>
            <p className="hp-band__en">Love, in the right measure.</p>
          </section>

          <section id="pickles" className="hp-wrap hp-section">
            <div className="hp-head hp-rv">
              <div className="hp-eyebrow">In the kitchen now</div>
              <h2 className="hp-h2">Three pickles</h2>
            </div>

            <div className="hp-cards">
              {cards.map((card) => (
                <article className="hp-card hp-rv" key={card.slug}>
                  <div className="hp-card__shelf">
                    <div
                      className={`hp-ring hp-ring--card${card.ringVariant}`}
                      aria-hidden="true"
                    />
                    {card.photo ? (
                      <img
                        className="hp-card__jar"
                        src={card.photo.src}
                        alt={`A jar of ${card.hero.name.toLowerCase()} pickle`}
                        width={card.photo.width}
                        height={card.photo.height}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="hp-ph hp-ph--jar">
                        [Photo: a jar of {card.hero.name.toLowerCase()} pickle]
                      </div>
                    )}
                  </div>

                  {/* D75 and D83: the pill, the marks and the reading are all
                      derived from /api/counts, never typed. */}
                  <ProductState slug={card.slug} />
                  <ProductCount slug={card.slug} />
                  <CardBatchLine slug={card.slug} jarGrams={card.hero.jarGrams} />

                  <h3 className="hp-card__name">
                    <a href={`/pickles/${card.slug}`}>{card.hero.name}</a>
                  </h3>
                  <div className="hp-card__taste" aria-hidden="true">
                    <span className="hp-t">{card.taste[0]}</span>
                    <span>&rarr;</span>
                    <span className="hp-t hp-t2">{card.taste[1]}</span>
                    <span>&rarr;</span>
                    <span className="hp-t hp-t3">{card.taste[2]}</span>
                  </div>
                  <p className="hp-body hp-card__line">{card.line}</p>
                  <details>
                    <summary>
                      How it tastes
                      <span className="hp-plus" aria-hidden="true">
                        +
                      </span>
                    </summary>
                    <p className="hp-body">{card.tastes}</p>
                  </details>

                  <CardAction slug={card.slug} />
                </article>
              ))}
            </div>

            <p className="hp-body hp-rv hp-cards__note">
              Every jar is 200 g, made in a halal kitchen with no added
              preservatives. Some are bottled and ready to send. Others are
              open batches that Sumayya has not cooked yet, and each card tells
              you which.
            </p>
          </section>

          {/* From here down the accent is the oil red (D78). */}
          <div className="hp-late">
            <section id="story" className="hp-dark">
              <div className="hp-wrap hp-split">
                <div className="hp-split__narrow hp-rv">
                  <div className="hp-ph hp-ph--stove">
                    [Photo: Sumayya at the stove]
                  </div>
                </div>
                <div className="hp-split__wide hp-rv">
                  <div className="hp-eyebrow">Where the food comes from</div>
                  <h2 className="hp-h2">Two houses</h2>

                  <div className="hp-places">
                    <div className="hp-place">
                      <div className="hp-place__name">Chaliyam</div>
                      <div className="hp-place__what">
                        River meets the sea. Fish.
                      </div>
                    </div>
                    <div className="hp-wire" aria-hidden="true">
                      <div className="hp-traveller" />
                    </div>
                    <div className="hp-place hp-place--right">
                      <div className="hp-place__name">Kunnamangalam</div>
                      <div className="hp-place__what">
                        The old hill road. Spice.
                      </div>
                    </div>
                  </div>

                  <p className="hp-body">
                    Our family is Mappila, and our food comes from two houses.
                    One is in Chaliyam, where the river meets the sea, and
                    there they knew fish. The other is in Kunnamangalam, on the
                    old road that brought spice down from the hills to the
                    Kozhikode port, and here they knew spice.
                  </p>
                  <p className="hp-body">
                    Sumayya comes from the first house and married into the
                    second. She learned at her mother&apos;s side, has cooked
                    by hand for decades, and never wrote any of it down. The
                    fish still comes from Chaliyam, a taste from the house she
                    grew up in.
                  </p>
                </div>
              </div>
            </section>

            <section id="pakam" className="hp-wrap hp-pakam">
              <div className="hp-pakam__art hp-rv">
                <h2 className="hp-ml hp-fillword" lang="ml">
                  പാകം
                </h2>
                {/* The hand is three paths, copied from the reference. */}
                <svg
                  className="hp-salt"
                  viewBox="13 0 320 210"
                  aria-hidden="true"
                >
                  <g className="hp-hand">
                    <path
                      d="M164 72 C152 84 146 102 151 113 C154 120 162 119 166 111"
                      fill="var(--hp-paper)"
                      stroke="var(--hp-ink)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M333 44.4 L246 33 C234 31 222 30 210 28 C202 26 194 27 188 32 C180 39 173 50 168 62 C164 72 159 82 158 92 C157 99 158 104 161 108 C163 111 167 111 169 108 C170 112 174 115 179 113 C185 110 191 104 197 99 C203 95 208 95 214 93 C221 91 226 92 232 88 C238 84 241 78 246 74 L333 92.6"
                      fill="var(--hp-paper)"
                      stroke="var(--hp-ink)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M169 106 C169 96 173 85 179 77 C185 69 194 63 203 63 C198 69 189 80 185 89 C182 96 179 102 176 107"
                      fill="none"
                      stroke="var(--hp-ink)"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                  <circle className="hp-grain" cx="174" cy="118" r="2.2" fill="var(--hp-rust)" />
                  <circle className="hp-grain hp-gr2" cx="177" cy="118" r="2.2" fill="var(--hp-rust)" />
                  <circle className="hp-grain hp-gr3" cx="172" cy="118" r="2.2" fill="var(--hp-rust)" />
                  <circle className="hp-grain hp-gr4" cx="176" cy="118" r="2.2" fill="var(--hp-rust)" />
                  <circle className="hp-grain hp-gr5" cx="173" cy="118" r="2.2" fill="var(--hp-rust)" />
                  <circle className="hp-grain hp-gr6" cx="175" cy="118" r="2.2" fill="var(--hp-rust)" />
                  <path
                    d="M138 182 H208 M140 182 Q173 208 206 182"
                    fill="none"
                    stroke="var(--hp-ink)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <g className="hp-heap">
                    <circle cx="165" cy="178" r="3" fill="var(--hp-rust)" />
                    <circle cx="173" cy="178" r="3" fill="var(--hp-rust)" />
                    <circle cx="181" cy="178" r="3" fill="var(--hp-rust)" />
                    <circle cx="169" cy="173" r="3" fill="var(--hp-rust)" />
                    <circle cx="177" cy="173" r="3" fill="var(--hp-rust)" />
                  </g>
                </svg>
                {/* D86: here, and again at the end of the paragraph beside it. */}
                <p className="hp-enough">Just enough.</p>
              </div>
              <div className="hp-pakam__words hp-rv">
                <p className="hp-pakam__lede">
                  People say the secret of home food is love. We would say it a
                  little differently.{" "}
                  <span className="hp-ml" lang="ml">
                    പാകത്തിന്.
                  </span>{" "}
                  Just enough.
                </p>
                <p className="hp-body">
                  Sumayya puts in just enough vinegar, just enough salt, just
                  enough chilli, and nothing is allowed to become more than it
                  should be. So when you eat it, you can taste each thing.
                  First one, then the next.
                </p>
                <p className="hp-body">
                  Many pickles today are made faster and cheaper, with lighter
                  oil and fewer spices. We still make it the old way, with
                  everything in it. It takes longer, and it costs more to make.
                </p>
              </div>
            </section>

            <section id="how" className="hp-section--rule">
              <div className="hp-wrap">
                <div className="hp-head hp-head--wide hp-rv">
                  <div className="hp-eyebrow">How it works</div>
                  <h2 className="hp-h2">How a jar reaches you</h2>
                  <p className="hp-body">
                    We do not keep jars on a shelf. Sumayya cooks a batch only
                    when people have asked for it.
                  </p>
                </div>

                <div className="hp-rule hp-rv" aria-hidden="true">
                  <div className="hp-traveller" />
                </div>

                <ol className="hp-steps">
                  {STEPS.map((step) => (
                    <li className="hp-step hp-rv" key={step.n}>
                      <div className="hp-step__n hp-mono">{step.n}</div>
                      <h3>{step.title}</h3>
                      <p className="hp-body hp-card__line">{step.body}</p>
                    </li>
                  ))}
                </ol>

                <div className="hp-asides hp-rv">
                  <p className="hp-body">
                    We cannot tell you the day, because the fish comes when the
                    sea gives it. But we buy and cook as early as we can, and
                    send your jar as soon as it is ready.
                  </p>
                  <p className="hp-body">
                    The jars you see in stock are the ones left over from
                    batches people booked. Those are{" "}
                    <span className="hp-price">{inStockPrice()}</span>, and
                    they leave the next day.
                  </p>
                </div>
              </div>
            </section>

            <section id="record" className="hp-section--rule">
              <div className="hp-wrap hp-split">
                <div className="hp-split__wide hp-rv">
                  <div className="hp-eyebrow">The batch record</div>
                  <h2 className="hp-h2">The number on your jar</h2>
                  <p className="hp-body">
                    Every jar has a number and a QR code on its label. Scan the
                    code and it brings you to that batch&apos;s own page here.
                    The page tells you where the fish came from, the day it was
                    cooked and bottled, and everything that went into the pot.
                    We never change the page later.
                  </p>
                  <p>
                    <a className="hp-link" href="/batch/001">
                      Read the batch {batch001.number} record
                    </a>
                  </p>
                </div>
                {/* Read out of content/batches/001.json, the same file
                    /batch/<nnn> reads, so the card and the record cannot
                    disagree and nothing here is re-typed. */}
                <div className="hp-split__narrow hp-rv">
                  <ul className="hp-record">
                    <li className="hp-record__row">
                      Batch{" "}
                      <span className="hp-record__batch">
                        {batch001.number}
                      </span>
                    </li>
                    {batch001.facts.map((fact) => (
                      <li className="hp-record__row" key={fact}>
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {/* D82: back on the page, five days after D74 took it off. */}
            <section id="note" className="hp-section--rule">
              <div className="hp-wrap hp-split">
                <div className="hp-split__narrow hp-rv hp-note__art">
                  <div className="hp-float hp-note__frame">
                    <div className="hp-ph hp-ph--card">
                      [Photo: one real card in Sumayya&apos;s hand]
                    </div>
                  </div>
                </div>
                <div className="hp-split__wide hp-rv">
                  <div className="hp-eyebrow">In every box</div>
                  <h2 className="hp-h2">A note from Sumayya</h2>
                  <p className="hp-body">
                    When you open the box, there is a card on top. Sumayya
                    writes it herself, with a pen, for you. It tells you which
                    jar is yours and when she cooked it.
                  </p>
                  <p className="hp-body">
                    At the end she asks for one small thing. After you taste
                    it, send her a voice note on WhatsApp and tell her honestly
                    how it was. She listens to every one, and that is what
                    makes her want to cook the next pot.
                  </p>
                </div>
              </div>
            </section>

            <section id="name" className="hp-section--rule">
              <div className="hp-name hp-rv">
                <svg className="hp-creek" viewBox="0 0 600 60" aria-hidden="true">
                  <path
                    d="M600 14 C 500 2, 440 46, 340 30 S 180 8, 100 34 S 30 50, 0 44"
                    fill="none"
                    stroke="var(--hp-rust)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeDasharray="10 14"
                  />
                </svg>
                <h2 className="hp-h2">The name</h2>
                <p className="hp-body">
                  One last thing, about the name on the jar. Neduvanchalil is
                  our house. Nedu means long and chal means channel. This land
                  was once a creek, with water coming down from the hills in
                  the east and flowing west. The house was built where the
                  water used to pass, and it took the name of the land.
                </p>
                <a className="hp-btn" href="#pickles">
                  See what is in the kitchen
                </a>
              </div>
            </section>
          </div>
        </main>

        <div className="hp-foot">
          {/* Brief §11.6. The wa.me href is the one the page has carried
              since M3.2, character for character. */}
          <section className="hp-wrap hp-abroad home-abroad">
            <p className="hp-body">
              We ship all over India. Not outside it yet. If you are abroad,{" "}
              <a href="https://wa.me/918891923827?text=I%20am%20abroad%2C%20can%20I%20get%20a%20jar%3F">
                message us
              </a>{" "}
              and we will find a way to get one to you.
            </p>
          </section>
          {/* The design system's own footer, so the legal line and the five
              policy links live in one place (M5.7). Only its look changes. */}
          <Footer />
        </div>

        <div className="hp-dock">
          <a className="hp-btn" href="#pickles">
            See the pickles
          </a>
        </div>
      </div>
    </>
  );
}
