export const metadata = {
  title: "Lailark",
  description:
    "A small kitchen in Kunnamangalam, Kozhikode. We make oil pickles in batches of fifteen to forty jars.",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "32x32" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6ef" },
    { media: "(prefers-color-scheme: dark)", color: "#15120f" },
  ],
};

const css = `
:root{
  --bg:#faf6ef; --fg:#191510; --muted:#635a4e; --accent:#9a4620; --rule:#ddd3c4;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme:dark){
  :root{ --bg:#15120f; --fg:#ece4d8; --muted:#9d9488; --accent:#d78551; --rule:#332c25; }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; color:var(--fg);
  font-family:var(--sans); font-size:17px; line-height:1.65;
  padding:2.5rem 1.35rem 3rem;
}
main{max-width:33rem; margin:0 auto}
.mark{display:flex; align-items:center; gap:.55rem; margin-bottom:2.4rem}
.mark svg{width:38px; height:auto; display:block; color:var(--fg); flex:none}
h1{
  font-size:1.05rem; font-weight:600; letter-spacing:.14em; text-transform:uppercase;
  margin:0; line-height:1;
}
p{margin:0 0 1.35rem}
.lede{font-family:var(--mono); font-size:1.0rem; line-height:1.75; max-width:31rem}
.note{color:var(--muted); font-family:var(--mono); font-size:.95rem; line-height:1.75}
figure{margin:2.6rem 0 0}
figure img{display:block; width:100%; height:auto; background:var(--rule); border-radius:2px}
figcaption{margin-top:.8rem; font-family:var(--mono); font-size:.85rem; line-height:1.7; color:var(--muted)}
.cta-p{margin:1.9rem 0 2.1rem}
.cta{
  display:inline; font-weight:600; font-size:1.05rem; color:var(--fg);
  text-decoration:underline; text-decoration-color:var(--accent);
  text-decoration-thickness:2px; text-underline-offset:.28em;
}
.cta .arrow{color:var(--accent); padding:0 .1em}
.cta .wa{color:var(--accent)}
.cta:hover{color:var(--accent)}
a{color:var(--fg); text-underline-offset:.18em}
footer{
  margin-top:3rem; padding-top:1.3rem; border-top:1px solid var(--rule);
  font-family:var(--mono); font-size:.8rem; line-height:1.8; color:var(--muted);
}
footer a{color:var(--muted)}
@media (min-width:40rem){ body{padding:4.5rem 2rem 4rem} }

.bg{position:fixed; inset:0; z-index:-2; background:var(--bg) url(/assets/jars-loop.jpg) center/cover no-repeat}
.bg video{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block}
@media (prefers-reduced-motion:reduce){ .bg video{display:none} }
.bg::after{content:""; position:fixed; inset:0; z-index:-1; background:rgba(250,246,239,.84)}
@media (prefers-color-scheme:dark){ .bg::after{background:rgba(21,18,15,.82)} }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
