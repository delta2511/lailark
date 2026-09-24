// Layout primitives, the jar-count marks, and the three motions
// (Flow §10). Plain CSS, no framework: the palette has one job per
// colour and there is no fifth, so nothing extra gets invented here.
export const dsPrimitivesCss = `
/* Shell: page-level layout, phone first. */
.ds-shell{
  display:flex; flex-direction:column; min-height:100dvh;
  font-family:var(--ds-font-body); line-height:1.6;
}

/* Header. Sits on the shared measure, so the lark mark starts at the same
   left edge as the page's first heading rather than hugging the window. */
.ds-header{
  display:flex; align-items:center; gap:var(--ds-space-2);
  width:100%; max-width:var(--ds-measure); margin-inline:auto;
  padding:var(--ds-space-5) var(--ds-space-4) var(--ds-space-4);
}
.ds-header__mark{width:28px; height:auto; display:block; color:var(--ds-ink); flex:none}
.ds-header__name{
  font-family:var(--ds-font-heading); font-size:1rem; font-weight:600;
  letter-spacing:.06em; color:var(--ds-ink);
}

/* Main. */
.ds-main{
  flex:1 0 auto; width:100%; max-width:var(--ds-measure); margin:0 auto;
  padding:0 var(--ds-space-4) var(--ds-space-6);
}

/* Footer: the legal line, mono like everything checked against the jar. */
.ds-footer{
  margin-top:auto;
  width:100%; max-width:var(--ds-measure); margin-inline:auto;
  padding:var(--ds-space-4);
  border-top:1px solid var(--ds-hairline);
  font-family:var(--ds-font-mono); font-size:.8rem; line-height:1.8;
  color:var(--ds-grey);
}
.ds-footer p{margin:0 0 var(--ds-space-2)}
.ds-footer p:last-child{margin-bottom:0}
.ds-footer a{color:var(--ds-grey)}

/* Jar-count marks: jars drawn as marks, never written as a number. */
.ds-jarmarks{display:flex; flex-wrap:wrap; align-items:flex-end; gap:4px}
.ds-jarmark{width:10px; height:14px; flex:none}
.ds-jarmark--filled{fill:var(--ds-ink)}
.ds-jarmark--empty{fill:none; stroke:var(--ds-hairline); stroke-width:1}

/* Motion: the count. Marks settle in as they appear. */
.ds-jarmark{
  animation: ds-mark-in 260ms ease-out both;
  animation-delay: calc(var(--ds-mark-index, 0) * 18ms);
}
@keyframes ds-mark-in{
  0%{opacity:0; transform:translateY(3px) scale(.85)}
  100%{opacity:1; transform:translateY(0) scale(1)}
}

/* Motion: settle. Staggered arrival, once per session, on mount. */
.ds-settle{display:contents}
.ds-settle__item{opacity:1; transform:none}
.ds-settle__item--animate{
  animation: ds-settle-in 420ms cubic-bezier(.22,1.4,.36,1) both;
  animation-delay: var(--ds-settle-delay, 0ms);
}
@keyframes ds-settle-in{
  0%{opacity:0; transform:translateY(-10px) rotate(0deg)}
  60%{opacity:1; transform:translateY(2px) rotate(.5deg)}
  100%{opacity:1; transform:translateY(0) rotate(0deg)}
}

/* Motion: the oil. A gradient drifting behind the hero only. */
.ds-oil{
  position:absolute; inset:0; z-index:-1; pointer-events:none;
  background:linear-gradient(120deg, var(--ds-paper), var(--ds-hairline), var(--ds-paper));
  background-size:220% 220%;
  animation: ds-oil-drift var(--ds-oil-cycle, 30s) ease-in-out infinite;
}
@keyframes ds-oil-drift{
  0%{background-position:0% 50%}
  50%{background-position:100% 50%}
  100%{background-position:0% 50%}
}

@media (prefers-reduced-motion:reduce){
  .ds-jarmark{animation:none; opacity:1; transform:none}
  .ds-settle__item--animate{animation:none; opacity:1; transform:none}
  .ds-oil{animation:none; background-position:50% 50%}
}
`;
