import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Admin PWA build (ST2: Preact + Vite + TypeScript, installable, no app store).
 *
 * Output names matter: firebase.json's `admin` hosting target caches
 * /assets/** forever and /sw.js + /manifest.webmanifest not at all, so those
 * three names are fixed here on purpose (A11).
 */
export default defineConfig({
  base: "/",
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      filename: "sw.js",
      manifestFilename: "manifest.webmanifest",
      includeAssets: ["favicon.svg", "apple-touch-icon-180.png"],
      manifest: {
        name: "Lailark",
        short_name: "Lailark",
        description: "Lailark kitchen admin",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        // Flow section 10 design tokens: Ink on Paper.
        theme_color: "#17150F",
        background_color: "#FAF8F4",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Firebase is most of the bundle (A35) and does not change with the
        // shell; its own chunk lets a browser cache it across shell updates.
        manualChunks(id: string): string | undefined {
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) {
            return "firebase";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5175,
    strictPort: false,
  },
});
