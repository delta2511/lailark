/**
 * The customer site's own origin, for building a link that leaves the admin:
 * `orderUrl` (`shared/src/links.ts`) wants an absolute base, and the Orders
 * screen's `wa.me` bill link (M3.9, D32) is the first thing in the admin that
 * ever needs one.
 *
 * `VITE_SITE_ORIGIN` is a build-time env var, same shape as the existing
 * `VITE_FIREBASE_PROJECT` / `VITE_USE_EMULATORS` (`firebase.ts`,
 * `firebase-config.ts`): nothing secret, so it may sit in `.env` or be passed
 * on the build command, and it is read once here rather than hard-coded into
 * the screen that needs it, because CLAUDE.md section 5 puts a customer URL
 * on the never-assume list and a build-time switch is what lets staging point
 * at its own site without a code change.
 *
 * Unset, it falls back to the Firebase project actually selected for this
 * build (`VITE_FIREBASE_PROJECT`, same literal comparison `firebase.ts`
 * uses): production is `lailark.in`, and staging is the `tree-quiz-74e04`
 * project's own Hosting URL for the `customer` target, since staging has no
 * custom domain (CLAUDE.md section 1's table is about production only).
 */
export function siteOrigin(): string {
  const configured = import.meta.env.VITE_SITE_ORIGIN;
  if (typeof configured === "string" && configured.trim() !== "") {
    return configured.trim().replace(/\/+$/, "");
  }
  return import.meta.env.VITE_FIREBASE_PROJECT === "tree-quiz-74e04"
    ? "https://tree-quiz-74e04.web.app"
    : "https://lailark.in";
}
