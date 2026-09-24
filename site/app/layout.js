import { dsTokensCss } from "./ds/tokens.css";
import { dsPrimitivesCss } from "./ds/primitives.css";

// ASSUMED (M3.1): metadata and viewport below are untouched from v0.
// They still describe the v0 home page's own palette (#faf6ef /
// #15120f) because that page is unchanged until M3.2 replaces it. The
// new design system (app/ds/) does not define its own dark palette or
// theme-color meta yet; see the dark-mode note in app/page.js.
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

// Global layer: design-system tokens and primitives (Flow §10). The
// v0 home page's own styles live in app/page.js, scoped under .v0, so
// they cannot collide with these.
const css = dsTokensCss + dsPrimitivesCss;

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
