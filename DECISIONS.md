# Decisions

The ledger. Anything here overrides the docs in `docs/strategy/`. Newest at the bottom
of each section. Every line has a date and who decided: **S** is Shefin, **A** is an
assumption made by Claude during the build (see the last section), waiting for Shefin to
confirm or replace at the next milestone break.

## Stack and repo (16 Sep 2026, S)

| # | Decision | Detail |
|---|---|---|
| ST1 | Customer site in **Next.js**, static export | Shefin's choice. JavaScript is allowed. The v0 100 KB page budget is retired. The site must stay usable on 4G; that is the constraint, not a byte count. No external requests other than Razorpay on the checkout step. System fonts only |
| ST2 | Admin in **Preact** with Vite and TypeScript, installable PWA | Chosen over Svelte because it is the React idiom in 4 KB, so it stays fast on a cheap phone and agents write it fluently |
| ST3 | Functions in **TypeScript**, Cloud Functions 2nd gen, `asia-south1` | Shefin's choice over Python. The Lia OS agent patterns are ported, not reused as code |
| ST4 | Admin sign-in by **phone number** (Firebase Phone Auth), not Google | Allowlist of numbers in `users`, role as a custom claim set by a function. Owner `+91 7736110087`, Kitchen `+91 9446587027`. Each OTP is an SMS; Firebase bills a small amount per message on Blaze after the free allowance. Sessions persist, so this is rare |
| ST5 | Admin URL is the second Hosting site's default `.web.app` address | Not `admin.lailark.in`. A custom domain can be added later without code changes |
| ST6 | Batch record pages published by **GitHub Action** | Admin Publish button commits the batch JSON via the GitHub API; the workflow builds the site and deploys the `customer` target |
| ST7 | GitHub repo `delta2511/lailark`, private | One branch per milestone, one commit per task, merge to `main` with a tag at each break |
| ST8 | Staging project `lailark-staging` | Created by Shefin during M1. Razorpay test keys and the WhatsApp test number point at staging. Local work uses the emulator suite |
| ST9 | Deploy command `npm run deploy` | Asks customer / admin / both, staging / production, live / preview channel. Non-interactive flags for CI |

## Product and flow: the seventeen from the brief §24.2 (16 Sep 2026, S)

| # | Question | Decided | Note |
|---|---|---|---|
| D1 | Cancellation reply wording | Softer draft, **no personal name** in it | "Each batch is cooked for the people who have booked it, so we don't usually take cancellations. If you do need to cancel, please give us a normal call on +91 88919 23827 and we will sort it out with you." |
| D2 | Orders page in the footer | **Yes**, the quiet page as drafted in brief §10.4 | Satisfies the E-Commerce Rules and Razorpay's review without advertising refunds |
| D3 | Batch size shown on the card | **Bookable jars** (90%), not planned | Every number on the card is true. "Full" means full |
| D4 | Stalled-batch review | **Two silent Concerns to the Owner: at 30 days below half, and at 140 days on any held payment in a batch that has not started cooking** | Replaces the single 150-day check. Nothing is sent to customers. 140 gives ten days before the Razorpay 6-month refund wall |
| D5 | Kitchen photo updates | **Owner approves each** before it is sent | Kitchen adds the photo and a line, the agent notifies the Owner, it goes out only on yes. Same `approvals` object as half and full |
| D6 | Agent timing text | **As drafted** in brief §15.3 | Revised with real batch durations as batches accumulate. Stored as a setting, not code |
| D7 | Functions language | **TypeScript** | See ST3 |
| D8 | Batch page publishing | **GitHub Action** | See ST6 |
| D9 | Admin front end | **Preact** | See ST2 |
| D10 | Counter UPI | **Both**: Razorpay QR for the exact amount, and UPI straight to Lailark's account marked paid by hand | Admin records which was used. Day close reconciles the manual ones |
| D11 | Dispatch cut-off and non-working days | **6 pm, Sundays off** (recommendation accepted by silence) | Both are settings |
| D12 | Flat shipping fee if the switch is ever used | **₹60**, editable (recommendation accepted by silence) | Shipping is free at launch |
| D13 | Viewer role | **Yes** | Read-only, sees Money. For a CA or helper |
| D14 | Cash on delivery | **No.** Prepaid only | |
| D15 | Two batches of one product open at once | **Only after the first is cooking** (recommendation accepted by silence) | Enforced with a clear message in admin |
| D16 | Combining shipments across batches | **Within 3 days** of each other, suggested not forced (recommendation accepted by silence) | |
| D17 | Kitchen discount rights at the counter | **Yes**: Kitchen may discount up to a cap, with a reason. **The cap is set by the Owner in the admin Settings screen**, not in code. It ships empty (no kitchen discount) until the Owner sets it | Owner unlimited with reason |

## Carried over as decided from the brief §0 and §24.1 (15 Sep 2026, S)

Admin is the master POS for every sale. Shipping free at launch with a switch. Launch
without GST, GST-ready from day one. In-stock ships next day. Agent WhatsApp only. Half
and full messages wait for the Owner. 90% pre-booking cap. ₹599 closes at cooking.
Yield shortfall on latest payers. Cancellations not advertised. Shiprocket preferred,
India Post first. RTO reship at customer's cost. Packaging per batch, packing cost per
shipment. English only. FSSAI shown. Owner response time same day. Home page ground is
Plate on paper. Label percentage basis B (see the label basis doc).

## Assumptions made during the build (A)

The orchestrator appends here. Format: `A<n> (task id, date): what was assumed, and why.
Status: open | confirmed | replaced by <what>`. Shefin reviews these at every milestone
break.

- A1 (setup, 16 Sep): Kitchen discount cap ₹50. Status: replaced by D17, the cap is set in
  admin Settings by the Owner, no default in code.
- A2 (setup, 16 Sep): `_incoming/` (raw photos and logo drops) is gitignored; assets
  that ship go into `site/public/assets/` or `admin/public/`. Status: open.
- A3 (setup, 16 Sep): the business docs that were loose in the folder root
  (`Lailark_Master_Brief.md`, compliance roadmap, costing, sodium report, label panel,
  nutrition calculator) move to `docs/business/`. Nothing else changes in them. Status:
  open.
- A4 (M1.1, 16 Sep): `admin/`, `functions/`, `shared/` hold placeholder `package.json`
  files (`@lailark/<x>`, version 0.0.0, no scripts) so the root workspaces list resolves
  before M1.4, M1.5 and M1.6 create the real packages. Status: open.
- A5 (M1.1, 16 Sep): `site/` is plain JavaScript (App Router, `.js`), not TypeScript.
  CLAUDE.md mandates TypeScript for `admin/` and `functions/` only; skipping it here
  avoids extra dependencies. It imports the compiled `shared/` package from M1.5.
  Status: open.
- A6 (M1.1, 16 Sep): root `npm run dev` runs only the site dev server until the
  emulators (M1.4) and the admin app (M1.6) exist; those tasks extend it to the
  "emulators + site + admin" form in CLAUDE.md §7. Status: open.
- A7 (M1.1, 16 Sep): the home page keeps the v0 inline fetch of `config/site` from
  `firestore.googleapis.com` (the `notifyCtaVisible` switch, CLAUDE.md §9 says keep it
  working) even though ST1 allows no external request other than Razorpay. It is the
  one foreign origin the site tests allow. M3.2 rebuilds the home page and can retire
  it. Status: open.
- A8 (M1.1, 16 Sep): the home page now carries the jar video background described in
  `docs/strategy/home-background-video.md` (veil, poster, reduced-motion fallback),
  because TASKS.md M1.1 asks for "the same HTML and the video background". The v0 page
  as deployed on 15 Sep did not have the video, only the jar photo, which is kept too.
  Status: open.
- A9 (M1.2, 16 Sep): staging Hosting site ids are assumed as `lailark-staging` (customer)
  and `lailark-staging-admin` (admin) in `.firebaserc`; neither exists until the staging
  project does (Q2). If either id is taken when created, `.firebaserc` needs one edit.
  Status: open.
- A10 (M1.2, 16 Sep): the hosting emulator listens on 5010 (customer) and 5015 (admin,
  auto-assigned), not 5000, because macOS AirPlay Receiver holds port 5000 on the Mac
  and functions keep 5001. Firestore 8080, Auth 9099, Storage 9199, UI 4000.
  Status: open.
- A11 (M1.2, 16 Sep): admin hosting headers assume Vite's defaults: long immutable cache
  on `/assets/**`, no-cache on `/index.html`, `/sw.js`, `/manifest.webmanifest`. M1.6
  confirms the names when the admin build exists. Status: open.
- A12 (M1.2, 16 Sep): root `npm run emulators:hosting` (hosting, auth, functions) added
  next to the full-suite `npm run emulators`, for local site work without Firestore.
  Status: open.
- A13 (M1.2, 16 Sep): the production redeploy that M1.2 requires put the M1.1 home page
  live on lailark.in: same copy as v0, now rendered by Next.js with the jar video
  background (A8). `/batch/001` is byte-identical to before, verified by curl and cmp
  before, on a preview channel, and after. Status: open.
- A14 (M1.3, 16 Sep): `deploy.mjs` treats a workspace as deployable when its
  `package.json` has a `build` script, so the placeholder `admin/` is refused with
  "admin/ is not set up yet (M1.6)" until M1.6. Status: open.
- A15 (M1.3, 16 Sep): `LAILARK_DEPLOY_DRY_RUN=1` makes `deploy.mjs` print every command
  (builds included) instead of running it and skips the network check; the script tests
  use it so they never touch Firebase. Status: open.
- A16 (M1.3, 16 Sep): the production live gate accepts only the exact typed `yes`
  (whitespace trimmed, no case folding); a closed or exhausted stdin exits 1 with
  "no answer on stdin, stopped." rather than continuing. `check:batch-001` compares
  bytes against `site/public/batch/001/index.html` and checks the two 301s; `--project
  staging` points at `https://lailark-staging.web.app`. Status: open.
- A17 (M1.4, 16 Sep): `functions/` is CommonJS (no `type: module`, tsc `module: commonjs`),
  the best-trodden path for the Functions emulator and discovery. `engines.node: "22"`
  in `functions/package.json` is what the CLI reads for the runtime; no `runtime` field
  in `firebase.json`. Status: open.
- A18 (M1.4, 16 Sep): TypeScript pinned to 5.9.x (typescript-eslint 8 does not support
  TS 7) and ESLint pinned to 9.39.5 in every workspace to match `site/`
  (eslint-config-next needs 9). Vitest 5 for functions unit tests. Status: open.
- A19 (M1.4, 16 Sep): `DEFAULT_MAX_INSTANCES = 3` in `functions/src/lib/options.ts`,
  used by `api`; later functions pass their own value when a task calls for more.
  Status: open.
- A20 (M1.4, 16 Sep): the `api` router strips one leading `/api` segment so both the
  Hosting rewrite path (`/api/health`) and the direct function URL work; no Express.
  Status: open.
- A21 (M1.4, 16 Sep): Firebase Hosting header rules win over headers a function sets on
  rewritten responses, so `firebase.json` carries a `/api/**` rule with `Cache-Control:
  no-store` after the `**` no-cache rule. M3.3's `/api/counts` (15 s CDN cache) needs its
  own rule after that one. Status: open.
- A22 (M1.5, 16 Sep): `@lailark/shared` builds twice (ESM to `dist/esm`, CJS to
  `dist/cjs`) behind an `exports` map, with `main`/`types` on the CJS build for the
  node10 resolver `functions/` uses; a `prepare` script builds it on `npm install`; the
  root workspaces order is `shared, functions, site, admin` so it builds first. Zero
  runtime dependencies. Status: open.
- A23 (M1.5, 16 Sep): `Paise` is a plain `number` alias (a brand buys nothing in the
  JavaScript site); `assertPaise` rejects non-integers at runtime. Timestamps are typed
  structurally (`{seconds, nanoseconds}`, satisfied by both Firebase SDKs, no Firebase
  dependency in shared). Calendar dates are `YYYY-MM-DD` strings; "today" is the
  Asia/Kolkata calendar date. Status: open.
- A24 (M1.5, 16 Sep): `formatINR` prints `₹649`, `₹649.50` only when there are paise,
  Indian grouping (`₹1,00,000`) hand-rolled so output never depends on the machine's
  locale, negatives as `-₹599`. Status: open.
- A25 (M1.5, 16 Sep): payment statuses are `created, authorized, captured,
  partlyRefunded, refunded`; refunds themselves live in `refunds/{id}` with
  `refundedAmount` on `orders.payment`. Status: open.
- A26 (M1.5, 16 Sep): batch numbers pad to at least 3 digits and grow past 999;
  `parseBatchNo` accepts only the canonical spelling. Document serials pad to 4 and grow
  past 9999. `counters/{series}` ids use dashes (`LK-26-27`), document ids
  `LK-26-27-0001`, display `LK/26-27/0001`; prefixes are a parameter with the §13.3
  defaults. Status: open.
- A27 (M1.5, 16 Sep): sale stop is counted back from the printed best before:
  `bestBefore - max(ceil(shelfLifeDays x 0.30), 45) - transitDays`, all four inputs in
  `settings/shelfLife` with defaults 180, 0.30, 45, 7 (brief §6.2). Batch 001: best
  before 4 Mar 2027, sale stop 2 Jan 2027 (120 days after packing), warning 19 Dec
  2026. Best before adds calendar months and clamps to the month end (31 Aug + 6 = 28
  Feb). Status: open.
- A28 (M1.5, 16 Sep): `bottled -> soldOut` is a legal batch transition for a pot with no
  surplus, next to `bottled -> inStock`. No order transition table is shipped because
  §9.1's "Concern" next-states name a concerns document, not an order state; only the
  terminal, paid and concern-raising sets are exported. `canTransitionBatch` returns
  false, never throws, on unknown strings. Status: open.
- A29 (M1.5, 16 Sep): `/api/health` also reports the shared package version
  (`shared: "0.0.0"`). The site's money entry point is `site/lib/money.js` over
  `formatINR`, tested with `node --test` (`site/tests-unit/`), not yet used by a page
  until M3. Status: open.
- A30 (M1.6, 16 Sep): the Auth emulator (firebase-tools 15.30) ignores fixed test phone
  codes and issues a random OTP every time, so "OTP 123456" in CLAUDE.md §8 holds only
  inside Playwright, where `admin/tests/emulator.ts` swaps in the code the emulator
  issued. By hand against the emulator, read the code in the Emulator UI Auth tab
  (http://127.0.0.1:4000/auth) or the emulator log. Real projects need test phone
  numbers configured in the Firebase console if Shefin wants a fixed OTP on staging.
  Status: open.
- A31 (M1.6, 16 Sep): an unknown number is refused inside the admin after Firebase Auth
  signs it in (Auth creates a user for any number; the app sees no `role` claim, shows
  "This number is not on the Lailark admin list. If it should be, ask Shefin." and signs
  out). Blocking sign-in before the account exists needs Identity Platform, which is
  paid, so it is not used. Rules deny everything to a token without a role (M1.8).
  Status: open.
- A32 (M1.6, 16 Sep): `setRole` authorises on the caller's `role` custom claim alone
  (an Owner claim with no `users` doc still works), refuses to demote the last Owner,
  merges rather than replaces custom claims, and revokes refresh tokens on every role
  change. `onCall` verifies tokens without a revocation check, so a demoted Owner's
  already-issued token keeps power for up to an hour; App Check and stricter checks are
  M5.9. `name` is capped at 80 characters and stored as typed. `active: true` is always
  written; deactivating a user is left to the Settings users screen (M5.8). Status: open.
- A33 (M1.6, 16 Sep): the admin Playwright run builds an emulator-pointed bundle into
  `admin/dist-test` (gitignored) so `admin/dist` is always the deployable build, starts
  only the auth and firestore emulators, and seeds the two users in its global setup.
  PWA icons are rasterised from `site/public/assets/lark.svg` by Playwright's Chromium
  (`admin/scripts/make-icons.mjs`), ink on paper, no image dependency. Status: open.
- A34 (M1.6, 16 Sep): the production Firebase web config (public by design) is committed
  in `admin/src/firebase-config.ts`; the storage bucket is `lailark.firebasestorage.app`.
  The staging config is a `TODO(Q2)` placeholder. `VITE_FIREBASE_PROJECT` picks the
  project at build time. Status: open.
- A35 (M1.6, 16 Sep): `firestore.rules` gained a self-read rule on `users/{uid}` so the
  signed-in screen can show a name; M1.8 replaces it with the full matrix. The admin
  bundle is one 636 kB chunk (190 kB gzipped), nearly all Firebase SDK; M1.7 may split
  Firestore off the sign-in path. Status: open.
