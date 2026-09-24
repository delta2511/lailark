// Design-system tokens for the Lailark customer site.
// Source: docs/strategy/lailark-in-site-and-sales-flow.md, section 10.
// One job per colour, system faces only, nothing loaded over the wire.
//
// Everything here is prefixed "--ds-" so a page can add its own scoped
// CSS without colliding with the tokens. The v0 home page's local
// --bg/--fg/--accent variables went with the v0 page in M3.2.
export const dsTokensCss = `
:root{
  /* Palette: one job each, plus two neutrals. No fifth colour. */
  --ds-ink:#17150F;       /* type, marks, buttons: a warm black */
  --ds-paper:#FAF8F4;     /* the ground */
  --ds-rust:#A34A28;      /* numbers that count only: batch, jars, jar number */
  --ds-leaf:#2F5D3A;      /* claims only */
  --ds-grey:#6E665A;      /* secondary text */
  --ds-hairline:#E4DDD0;  /* the one divider weight, used rarely */

  /* Type: editorial. System faces only. */
  --ds-font-heading: ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif;
  --ds-font-body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --ds-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;

  /* The one column measure. The header's mark, every page's content and the
     footer's legal line all sit on it, so the page has a single left edge
     from the top of the screen to the bottom. */
  --ds-measure: 34rem;

  /* Spacing scale. */
  --ds-space-1: 0.25rem;
  --ds-space-2: 0.5rem;
  --ds-space-3: 0.75rem;
  --ds-space-4: 1rem;
  --ds-space-5: 1.5rem;
  --ds-space-6: 2rem;
  --ds-space-7: 3rem;
  --ds-space-8: 4rem;

  /* Motion timings, named after the three pieces in Flow §10. */
  --ds-settle-stagger: 70ms;
  --ds-oil-cycle: 30s;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0; background:var(--ds-paper); color:var(--ds-ink)}
`;
