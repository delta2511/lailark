import { dsTokensCss } from "./ds/tokens.css";
import { dsPrimitivesCss } from "./ds/primitives.css";

export const metadata = {
  title: "Lailark",
  description:
    "Oil pickles from a house in Kunnamangalam, Kozhikode. Sumayya cooks them in batches of fifteen to forty jars, by hand.",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "32x32" }],
  },
};

// The design system is light only (A146, M3.1): Flow section 10 gives one
// palette and no dark variant, so the theme colour is paper and the
// declared scheme is light. This is the move M3.1's note asked M3.2 to
// make; the retired v0 palette (#faf6ef / #15120f) went with the v0 home
// page.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#FAF8F4",
};

// Global layer: design-system tokens and primitives (Flow section 10).
// Page-level CSS is a scoped <style> in the page itself.
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
