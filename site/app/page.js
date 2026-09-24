import { Footer, Header } from "./ds/PageShell";
import Oil from "./ds/Oil";
import Settle from "./ds/Settle";
import { ProductCount } from "./_lib/counts";
import { inStockPrice, openBatchPrice } from "../lib/money";
import productContent from "../content/products.json";

// The home page (M3.2). Order fixed by the story doc section 5: hero, what
// is in the kitchen today, the four jars, the dark band with the two
// families and the cooking, the method, how a batch works, the open batch,
// in stock, the batch record, Sumayya's note, the name, footer. The abroad
// line (brief section 11.6) sits at the very end of the page, after the
// name, before the footer.
//
// One dark band, and only one: if a second appears the page is telling two
// stories (story doc section 5). Everything else is paper.
//
// The video is the hero's own background rather than the v0 fixed
// full-page layer, because Flow section 10 puts the atmosphere behind the
// hero and nothing else. The mechanics from the video doc survive as they
// were: autoplay muted loop playsinline, no JavaScript, a paper veil over
// it, and prefers-reduced-motion leaving the still. The video element is
// the last child of the hero, so with CSS blocked the hero's words are
// read before it and the page still runs top to bottom.

// The number of heroes is read off products.json, never typed, so a fifth
// hero cannot leave two sentences on this page saying "four".
const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

const heroCount = productContent.heroes.length;
const heroWord = NUMBER_WORDS[heroCount] ?? String(heroCount);
const heroWordCap = heroWord.charAt(0).toUpperCase() + heroWord.slice(1);

const jarNotes = {
  "prawns-and-dates": "The first one we bottled.",
  koorka: `Koorka only grows for part of the year, so it comes round roughly November to February. The one with no meat in it.`,
};

const homeCss = `
.home-main{ flex:1 0 auto; width:100%; font-family:var(--ds-font-body); line-height:1.65 }
.home-col{ width:100%; max-width:var(--ds-measure); margin:0 auto; padding:0 var(--ds-space-4) }
.home-main a{ color:var(--ds-ink) }

/* Hero. The one place the video and the oil are allowed to live.
   The veil is ink rather than paper (Shefin, 24 Sep 2026): the video shows
   through a dark wash and the words over it are paper. No new colour, the
   two ends of the palette. Note this makes the hero the page's second dark
   surface after the "Two houses" band, which story doc section 5 says should
   be the only one; Shefin overruled that for the hero. */
.home-hero{
  position:relative; isolation:isolate; overflow:hidden;
  background:var(--ds-ink); color:var(--ds-paper);
  display:flex; align-items:flex-end;
  min-height:58dvh; padding:var(--ds-space-8) 0 var(--ds-space-7);
}
.home-hero__media{
  position:absolute; inset:0; z-index:-2;
  background:var(--ds-ink) url(/assets/jars-loop.jpg) center/cover no-repeat;
}
.home-hero__media video{
  position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;
}
.home-hero__media::after{
  content:""; position:absolute; inset:0; background:rgba(23,21,15,.72);
}
/* The oil is a paper-to-hairline gradient, which would glow on an ink
   ground, so it drops to a whisper here rather than being cut. */
.home-hero__oil{ opacity:.12; mix-blend-mode:soft-light }
@media (prefers-reduced-motion:reduce){ .home-hero__media video{ display:none } }

.home-hero__title{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.9rem; line-height:1.18; margin:0 0 var(--ds-space-4); max-width:20ch;
}
.home-hero__lede{ margin:0; font-size:1.05rem; max-width:36ch }
@media (min-width:36rem){ .home-hero__title{ font-size:2.4rem } }

/* Sections on paper. */
.home-section{ padding:var(--ds-space-7) 0 }
.home-section h2{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.35rem; line-height:1.25; margin:0 0 var(--ds-space-4);
}
.home-section p{ margin:0 0 var(--ds-space-4) }
.home-section p:last-child{ margin-bottom:0 }

/* The one dark band. Story on ink, facts and money on paper. */
.home-band{ background:var(--ds-ink); color:var(--ds-paper); padding:var(--ds-space-8) 0 }
.home-band h2, .home-band p{ color:var(--ds-paper) }

/* The four jars. */
.home-jars{ display:grid; grid-template-columns:1fr; gap:var(--ds-space-4) }
@media (min-width:30rem){ .home-jars{ grid-template-columns:1fr 1fr } }
.home-jar{
  display:flex; flex-direction:column; height:100%;
  padding:var(--ds-space-4); border:1px solid var(--ds-hairline); border-radius:4px;
}
.home-jar__name{
  font-family:var(--ds-font-heading); font-weight:600; font-size:1.1rem;
  line-height:1.3; margin:0;
}
.home-jar__name a{ text-decoration:none }
.home-jar__name a:hover{ text-decoration:underline; text-underline-offset:.2em }
.home-jar__size{
  font-family:var(--ds-font-mono); font-size:.75rem; color:var(--ds-grey);
  margin:var(--ds-space-1) 0 var(--ds-space-3);
}
.home-jar__note{ font-size:.92rem; margin:0 0 var(--ds-space-3) }
.home-jar .home-count{ margin-top:auto }

/* The count slot: fixed height, so nothing moves when the counts land. */
.home-count{ min-height:3.2rem }
.home-count__reading, .home-count__note{
  font-family:var(--ds-font-mono); font-size:.75rem; line-height:1.6;
  color:var(--ds-grey); margin:var(--ds-space-2) 0 0;
}
.home-count__note{ margin-top:0 }
.home-count__price{ color:var(--ds-ink) }

/* Rust is a number colour: the batch number is the only one on this page. */
.home-batchno{ font-family:var(--ds-font-mono); color:var(--ds-rust) }
.home-price{ font-family:var(--ds-font-mono) }
.home-link{ text-underline-offset:.2em }

.home-abroad{ padding:var(--ds-space-7) 0 var(--ds-space-8) }
.home-abroad p{ margin:0; max-width:38ch }
`;

export default function HomePage() {
  return (
    <>
      {/* The hero still is the page's largest paint, and it arrives as a
          CSS background, which the browser cannot give a priority hint of
          its own. React hoists this into <head>, so the still is fetched
          at high priority ahead of the 485 KB video behind it. */}
      <link
        rel="preload"
        as="image"
        href="/assets/jars-loop.jpg"
        fetchPriority="high"
      />
      <style dangerouslySetInnerHTML={{ __html: homeCss }} />
      <div className="ds-shell">
        <Header />

        <main className="home-main">
          <section className="home-hero">
            <div className="home-col">
              <h1 className="home-hero__title">
                Oil pickles from a house in Kunnamangalam
              </h1>
              <p className="home-hero__lede">
                Sumayya cooks them in batches of fifteen to forty jars, by
                hand.
              </p>
            </div>

            <Oil className="home-hero__oil" />

            <div className="home-hero__media" aria-hidden="true">
              <video autoPlay muted loop playsInline poster="/assets/jars-loop.jpg">
                <source src="/assets/jars-loop.mp4" type="video/mp4" />
              </video>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <h2>What is in the kitchen today</h2>
              <p>
                {heroWordCap} pickles. Three of the {heroWord} have dates in
                them.
                Some are bottled already, with jars ready to send. The others
                are open batches, where the pot has not gone on yet and a jar
                is paid for before it exists. Each one below says which it is.
              </p>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <div className="home-jars">
                <Settle>
                  {productContent.heroes.map((hero) => (
                    <article className="home-jar" key={hero.slug}>
                      <h3 className="home-jar__name">
                        <a href={`/pickles/${hero.slug}`}>{hero.name}</a>
                      </h3>
                      <p className="home-jar__size">{hero.jarGrams} g jar</p>
                      {jarNotes[hero.slug] ? (
                        <p className="home-jar__note">{jarNotes[hero.slug]}</p>
                      ) : null}
                      <ProductCount slug={hero.slug} />
                    </article>
                  ))}
                </Settle>
              </div>
            </div>
          </section>

          <section className="home-section home-band">
            <div className="home-col">
              <h2>Two houses</h2>
              <p>
                The family is Mappila. One side is from Chaliyam, where the
                river meets the sea. The other is from Kunnamangalam, at the
                foot of Wayanad, on the old malancharakku road that carried
                hill produce and spice down to the Kozhikode port. One side
                knew fish, the other knew spice.
              </p>
              <p>
                Sumayya grew up cooking in both. She learned at her own
                mother&apos;s side in Chaliyam and has been at it for decades,
                all by hand. None of it was ever written down, and no
                restaurant ever bothered to hold on to it.
              </p>
              <p>Sumayya is Shefin&apos;s mother.</p>
              <p>
                The fish still comes from Chaliyam, because that is where she
                is from.
              </p>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <h2>The method</h2>
              <p>
                Pickles like these have been getting quicker and cheaper for
                years. Lighter oils, a few shortcuts, a shorter spice list,
                until a lot of it stopped tasting the way it should. We keep
                the original method and the whole list, and that is what it
                costs to make properly.
              </p>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <h2>How a batch works</h2>
              <p>
                A batch is fifteen to forty jars. Nothing is cooked to sit in
                storage, so when the jars from one batch are gone, the next
                batch starts.
              </p>
              <p>
                Every bottled batch carries a number, and that number is
                printed on the jar. It points at a page here that records what
                went into the batch, when it was bottled and how many jars it
                gave.
              </p>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <h2>An open batch</h2>
              <p>
                An open batch has not been cooked yet. The jars are listed, you
                pay <span className="home-price">{openBatchPrice()}</span> for
                one, and your jar is kept for you. Once half the batch is paid
                for we buy what the batch needs and start cooking, and we will
                send you photos from the kitchen as it happens. We do not put a
                date on it, because the sea does not keep one.
              </p>
              <p>
                There is no closing time and no draw. The batch fills, and
                there is a limit of a quarter of it per person, so nobody takes
                the whole pot.
              </p>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <h2>In stock</h2>
              <p>
                There is no stock here, only leftovers. Anything listed as in
                stock is what was left over from the previous batch of that
                pickle, at <span className="home-price">{inStockPrice()}</span>{" "}
                a jar, two jars per person.
              </p>
              <p>
                It goes out the next day, anywhere in India, and shipping is
                free. Sumayya&apos;s note goes in the box with it.
              </p>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <h2>The batch record</h2>
              <p>
                The page a jar points at does not change once it is up. It is
                the record of that batch and it stays where it is, so a jar
                bought today still leads somewhere years from now. Batch{" "}
                <span className="home-batchno">001</span> is up.
              </p>
              <p>
                <a className="home-link" href="/batch/001">
                  Read the batch 001 record
                </a>
              </p>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <h2>The note in the box</h2>
              <p>
                Sumayya writes a note by hand for every box that goes out. Not
                a printed one.
              </p>
            </div>
          </section>

          <section className="home-section">
            <div className="home-col">
              <h2>The name</h2>
              <p>
                Neduvanchalil is the house, and it is printed on every jar as
                the maker. Nedu is long, chal is channel. The land was a creek
                once, water coming off the hills to the east and finding its
                way west towards Kunnamangalam town. The house was built in the
                water&apos;s path and took the land&apos;s name instead of
                giving it one.
              </p>
            </div>
          </section>

          <section className="home-abroad">
            <div className="home-col">
              <p>
                We ship all over India. Not outside it yet. If you are abroad,{" "}
                <a
                  className="home-link"
                  href="https://wa.me/918891923827?text=I%20am%20abroad%2C%20can%20I%20get%20a%20jar%3F"
                >
                  message us
                </a>{" "}
                and we will find a way to get one to you.
              </p>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
