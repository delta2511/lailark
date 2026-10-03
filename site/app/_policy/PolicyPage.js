import { Header, Footer } from "../ds/PageShell";
import { policyLinkTargets, policyPage } from "@lailark/shared";

// The one renderer behind `/orders`, `/shipping`, `/terms`, `/privacy` and
// `/contact` (M5.7, D66).
//
// The words are not here. They are in `@lailark/shared`'s `policies.ts`,
// which is also what `publish-policies.mjs` writes into `policyVersions` and
// what `createCheckout` derives an order's `policyVersion` from. This file
// draws them and nothing else, so there is no second copy of a sentence to
// drift from the version recorded against somebody's order.
//
// Five near-identical pages could have been one route with a parameter. They
// are five files on purpose: the paths are permanent (D66), and a static
// export of five known pages is five files on disk that a curl can check,
// with no rewrite in `firebase.json` standing between the URL and the HTML.

/** Phone and email, plus the one cross-link. Never part of a page's text. */
const LINKS = [
  ...policyLinkTargets,
  // The terms point at the Orders page by name. The link is the site's
  // business: the sentence reads the same without it.
  { match: "Orders page", href: "/orders" },
];

/**
 * Splits a paragraph on the strings above and returns text and links in
 * order. Longest match first, so an address that contains a shorter one
 * cannot be cut in half.
 */
function linkify(text) {
  let parts = [text];
  for (const { match, href } of [...LINKS].sort((a, b) => b.match.length - a.match.length)) {
    const next = [];
    for (const part of parts) {
      if (typeof part !== "string" || !part.includes(match)) {
        next.push(part);
        continue;
      }
      const pieces = part.split(match);
      pieces.forEach((piece, i) => {
        if (piece !== "") next.push(piece);
        if (i < pieces.length - 1) next.push({ text: match, href });
      });
    }
    parts = next;
  }
  return parts;
}

function Text({ value }) {
  return linkify(value).map((part, i) =>
    typeof part === "string" ? (
      part
    ) : (
      <a key={i} href={part.href}>
        {part.text}
      </a>
    ),
  );
}

const policyCss = `
.policy-main{ flex:1 0 auto; width:100%; max-width:var(--ds-measure); margin:0 auto;
  padding:0 var(--ds-space-4) var(--ds-space-8); font-family:var(--ds-font-body); line-height:1.7 }

.policy-main h1{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.9rem; line-height:1.18; margin:var(--ds-space-5) 0 var(--ds-space-5);
}
.policy-main h2{
  font-family:var(--ds-font-heading); font-weight:600;
  font-size:1.1rem; line-height:1.3; margin:var(--ds-space-6) 0 var(--ds-space-2);
}
.policy-main p{ margin:0 0 var(--ds-space-4); max-width:32rem }

/* An address or a set of contact details: mono, like everything on the page
   that is checked against the jar. Rust is a number colour and Leaf only
   ever touches a claim, so neither is here: a policy page makes no claim and
   counts nothing. */
.policy-lines{
  margin:0 0 var(--ds-space-5); padding:0; list-style:none;
  font-family:var(--ds-font-mono); font-size:.85rem; line-height:1.9; color:var(--ds-grey);
}
.policy-main a{ color:var(--ds-ink) }
`;

/** The `<title>` for one page, from its own data. */
export function policyMetadata(kind) {
  return { title: policyPage(kind).title };
}

/** Draws one policy page, given its kind. */
export default function PolicyPageView({ kind }) {
  const page = policyPage(kind);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: policyCss }} />
      <div className="ds-shell">
        <Header />
        <main className="policy-main">
          <h1>{page.heading}</h1>
          {page.blocks.map((block, i) => {
            if (block.type === "heading") return <h2 key={i}>{block.text}</h2>;
            if (block.type === "lines") {
              return (
                <ul className="policy-lines" key={i}>
                  {block.lines.map((line, j) => (
                    <li key={j}>
                      <Text value={line} />
                    </li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={i}>
                <Text value={block.text} />
              </p>
            );
          })}
        </main>
        <Footer />
      </div>
    </>
  );
}
