# admin

The Lailark admin PWA: Vite, Preact, TypeScript (ST2). Installable, phone sign-in only.

- Local: `npm run emulators` in one terminal, then `npm run dev -w @lailark/admin`. The dev
  build talks to the emulators (auth 9099, firestore 8080, functions 5001).
- Seed the allowlist once per emulator run: `npm run seed:users -- --emulator`.
- Sign in with Owner `+91 7736110087` (Shefin) or Kitchen `+91 9446587027` (Sumayya). Any
  other number is refused with a plain message.
- Once signed in you land on Today, with Sell, Batches, Orders and More in the bottom bar
  (M1.7). Sign out moved from the landing page to More > Settings.
- The emulator issues a random six digit code, not `123456`: read it from the emulator log
  line "To verify the phone number ... use the code ...", or from the Auth tab at
  <http://127.0.0.1:4000/auth>. The Playwright suite types `123456` and swaps in the issued
  code (see `tests/emulator.ts`).
- Tests: `npm test -w @lailark/admin` (unit, then an emulator build, then Playwright).
- Roles come from the `role` custom claim, set by the `setRole` callable in `functions/`.
