import { Shell } from "../../ds/PageShell";
import JarMarks from "../../ds/JarMarks";
import Settle from "../../ds/Settle";
import Oil from "../../ds/Oil";
import Lark from "../../ds/Lark";

// Internal, build-time demo of every design-system primitive
// (M3.1). Not a customer route: kept out of the sitemap and out of
// robots.txt indexing (see public/robots.txt), and marked noindex
// below as a second line of defence. Wording on this page is not
// customer copy, so it is demo-only and clearly marked as such, but
// it still keeps the no-em-dash house style.

export const metadata = {
  title: "Design system demo, internal",
  robots: { index: false, follow: false },
};

const tokenSwatches = [
  { name: "Ink", varName: "--ds-ink", hex: "#17150F", job: "Type, marks, buttons. A warm black." },
  { name: "Paper", varName: "--ds-paper", hex: "#FAF8F4", job: "The ground." },
  { name: "Rust", varName: "--ds-rust", hex: "#A34A28", job: "Numbers that count only. Never a button or a heading." },
  { name: "Leaf", varName: "--ds-leaf", hex: "#2F5D3A", job: "Claims only." },
  { name: "Grey", varName: "--ds-grey", hex: "#6E665A", job: "Secondary text." },
  { name: "Hairline", varName: "--ds-hairline", hex: "#E4DDD0", job: "The one divider weight, used rarely." },
];

const demoCss = `
.demo-section{ padding:var(--ds-space-6) 0; border-top:1px solid var(--ds-hairline) }
.demo-section:first-of-type{ border-top:none; padding-top:0 }
.demo-heading{
  font-family:var(--ds-font-heading); font-size:1.1rem; font-weight:600;
  margin:0 0 var(--ds-space-4);
}
.demo-swatches{ display:grid; grid-template-columns:repeat(auto-fill,minmax(9rem,1fr)); gap:var(--ds-space-4) }
.demo-swatch{ font-family:var(--ds-font-body); font-size:.85rem }
.demo-chip{
  width:100%; height:3.5rem; border-radius:4px; border:1px solid var(--ds-hairline);
  margin-bottom:var(--ds-space-2);
}
.demo-swatch code{ font-family:var(--ds-font-mono); font-size:.75rem; color:var(--ds-grey) }
.demo-type-row{ margin-bottom:var(--ds-space-4) }
.demo-type-row p{ margin:0 }
.demo-type-heading{ font-family:var(--ds-font-heading); font-size:1.6rem; margin:0 0 var(--ds-space-1) }
.demo-type-body{ font-family:var(--ds-font-body); font-size:1rem }
.demo-type-mono{ font-family:var(--ds-font-mono); font-size:.95rem; color:var(--ds-rust) }
.demo-claim{ font-family:var(--ds-font-body); color:var(--ds-leaf) }
.demo-marks-row{ display:flex; flex-direction:column; gap:var(--ds-space-4); margin-bottom:var(--ds-space-4) }
.demo-marks-caption{ font-family:var(--ds-font-mono); font-size:.8rem; color:var(--ds-grey); margin-top:var(--ds-space-2) }
.demo-jar-grid{ display:flex; gap:var(--ds-space-3); flex-wrap:wrap }
.demo-jar-tile{
  width:3rem; height:3rem; border:1px solid var(--ds-hairline); border-radius:4px;
  display:flex; align-items:center; justify-content:center; color:var(--ds-ink);
}
.demo-oil-panel{
  position:relative; height:8rem; border:1px solid var(--ds-hairline); border-radius:4px;
  overflow:hidden;
}
.demo-oil-panel__label{
  position:relative; z-index:1; display:flex; align-items:center; justify-content:center;
  height:100%; font-family:var(--ds-font-mono); font-size:.8rem; color:var(--ds-grey);
}
.demo-frame{ border:1px dashed var(--ds-hairline); border-radius:4px; overflow:hidden }
`;

export default function DesignSystemDemoPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: demoCss }} />
      <div className="ds-shell">
        <header className="ds-header">
          <Lark size={28} className="ds-header__mark" />
          <span className="ds-header__name">Design system, internal demo</span>
        </header>

        <main className="ds-main">
          <p>
            Every primitive on this page is demo content for layout only.
            None of it is customer copy, and nothing here is a real batch,
            price, or claim.
          </p>

          <section className="demo-section">
            <h2 className="demo-heading">Tokens: colour</h2>
            <div className="demo-swatches">
              {tokenSwatches.map((swatch) => (
                <div className="demo-swatch" key={swatch.name}>
                  <div
                    className="demo-chip"
                    style={{ background: `var(${swatch.varName})` }}
                  />
                  <div>{swatch.name}</div>
                  <code>
                    {swatch.varName} {swatch.hex}
                  </code>
                  <div>{swatch.job}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="demo-section">
            <h2 className="demo-heading">Type: two scales, plus the mono check stack</h2>
            <div className="demo-type-row">
              <p className="demo-type-heading">Sample heading, editorial serif</p>
              <p className="demo-type-body">
                Sample reading text in the system sans stack. This is
                placeholder copy for layout only, not a real product
                description.
              </p>
              <p className="demo-type-mono">Batch 007. 27 jars. ₹649. 24 Sep 2026.</p>
              <p className="demo-claim">Sample claim line, for layout only.</p>
            </div>
          </section>

          <section className="demo-section">
            <h2 className="demo-heading">The jar-count marks, both readings</h2>
            <div className="demo-marks-row">
              <div>
                <JarMarks count={0} reading="left" />
                <p className="demo-marks-caption">Zero jars left, no ceiling given.</p>
              </div>
              <div>
                <JarMarks count={1} total={40} reading="left" />
                <p className="demo-marks-caption">
                  One jar left. The count reads as one jar, not one jars.
                </p>
              </div>
              <div>
                <JarMarks count={12} total={40} reading="left" />
                <p className="demo-marks-caption">12 jars left of a 40-jar batch.</p>
              </div>
              <div>
                <JarMarks count={27} total={30} reading="paid" />
                <p className="demo-marks-caption">27 jars paid of a 30-jar open batch.</p>
              </div>
              <div>
                <JarMarks count={40} total={40} reading="left" />
                <p className="demo-marks-caption">
                  A full 40-jar batch, legibility check on a phone.
                </p>
              </div>
            </div>
          </section>

          <section className="demo-section">
            <h2 className="demo-heading">Motion: settle</h2>
            <p className="demo-marks-caption">
              Reload this page in a new session (or clear sessionStorage) to
              see the staggered drop. It plays once per session, honours
              prefers-reduced-motion, and is meant for the home page.
            </p>
            <Settle className="demo-jar-grid">
              <div className="demo-jar-tile">1</div>
              <div className="demo-jar-tile">2</div>
              <div className="demo-jar-tile">3</div>
              <div className="demo-jar-tile">4</div>
              <div className="demo-jar-tile">5</div>
            </Settle>
          </section>

          <section className="demo-section">
            <h2 className="demo-heading">Motion: the oil</h2>
            <div className="demo-oil-panel">
              <Oil />
              <div className="demo-oil-panel__label">Hero background sample</div>
            </div>
          </section>

          <section className="demo-section">
            <h2 className="demo-heading">Header and footer, as built</h2>
            <div className="demo-frame">
              <Shell>
                <p>Sample page content, inside the shell.</p>
              </Shell>
            </div>
          </section>
        </main>

        <footer className="ds-footer">
          <p>Internal demo route. Not linked from the customer site.</p>
        </footer>
      </div>
    </>
  );
}
