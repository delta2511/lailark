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

## Answered at the M1 break (17 Sep 2026, S)

| # | Decision | Detail |
|---|---|---|
| D18 | `lailark` is on the **Blaze** plan | Answers Q1. Functions and Storage can deploy to production |
| D19 | Staging is the repurposed project **`tree-quiz-74e04`** (display name lailark-staging), not `lailark-staging` | Answers Q2 and amends ST8. Firestore `(default)` in `asia-south1`, Blaze on, Phone Auth on, budget alert set. Hosting sites `tree-quiz-74e04` (customer) and `tree-quiz-74e04-admin` (admin). Web app "Lailark admin (staging)", `1:168769355731:web:dd82afeb5cff871529f926`. The `.firebaserc` alias stays `staging` |
| D20 | The `setRole` bootstrap secret on staging was set by Shefin, not by Claude Code | Secret Manager writes stay a human step. The value is not recorded anywhere in the repo or this session. `firebase functions:secrets:set SETROLE_BOOTSTRAP_SECRET --project <id>` is the step for production too |
| D21 | `www.lailark.in` redirects to `lailark.in` with its own certificate | Answers Q3. Set up by Shefin in the Firebase console and GoDaddy. Verified 17 Sep: `https://www.lailark.in/batch/001` 301s to `https://lailark.in/batch/001` |
| D22 | **Ingredients and recipes: Owner edits, Kitchen views.** A switch lets the Kitchen edit them later | Answers Q4. Kitchen and Viewer read every ingredient and recipe with all their details. The Owner's switch `settings/permissions.kitchenCanEditRecipes` (off by default, a missing setting is off) lets the Kitchen create and edit both when turned on. Only the Owner flips it, like the discount cap (D17). Deleting stays the Owner's either way. The toggle appears in the admin Settings screen (M5.8) and the Recipes screen honours it (M2.1) |

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
  that ship go into `site/public/assets/` or `admin/public/`. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A3 (setup, 16 Sep): the business docs that were loose in the folder root
  (`Lailark_Master_Brief.md`, compliance roadmap, costing, sodium report, label panel,
  nutrition calculator) move to `docs/business/`. Nothing else changes in them. Status:
  open.
- A4 (M1.1, 16 Sep): `admin/`, `functions/`, `shared/` hold placeholder `package.json`
  files (`@lailark/<x>`, version 0.0.0, no scripts) so the root workspaces list resolves
  before M1.4, M1.5 and M1.6 create the real packages. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A5 (M1.1, 16 Sep): `site/` is plain JavaScript (App Router, `.js`), not TypeScript.
  CLAUDE.md mandates TypeScript for `admin/` and `functions/` only; skipping it here
  avoids extra dependencies. It imports the compiled `shared/` package from M1.5.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A6 (M1.1, 16 Sep): root `npm run dev` runs only the site dev server until the
  emulators (M1.4) and the admin app (M1.6) exist; those tasks extend it to the
  "emulators + site + admin" form in CLAUDE.md §7. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A7 (M1.1, 16 Sep): the home page keeps the v0 inline fetch of `config/site` from
  `firestore.googleapis.com` (the `notifyCtaVisible` switch, CLAUDE.md §9 says keep it
  working) even though ST1 allows no external request other than Razorpay. It is the
  one foreign origin the site tests allow. M3.2 rebuilds the home page and can retire
  it. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A8 (M1.1, 16 Sep): the home page now carries the jar video background described in
  `docs/strategy/home-background-video.md` (veil, poster, reduced-motion fallback),
  because TASKS.md M1.1 asks for "the same HTML and the video background". The v0 page
  as deployed on 15 Sep did not have the video, only the jar photo, which is kept too.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A9 (M1.2, 16 Sep): staging Hosting site ids are assumed as `lailark-staging` (customer)
  and `lailark-staging-admin` (admin) in `.firebaserc`; neither exists until the staging
  project does (Q2). If either id is taken when created, `.firebaserc` needs one edit.
  Status: replaced by D19, the staging sites are `tree-quiz-74e04` and
  `tree-quiz-74e04-admin`.
- A10 (M1.2, 16 Sep): the hosting emulator listens on 5010 (customer) and 5015 (admin,
  auto-assigned), not 5000, because macOS AirPlay Receiver holds port 5000 on the Mac
  and functions keep 5001. Firestore 8080, Auth 9099, Storage 9199, UI 4000.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A11 (M1.2, 16 Sep): admin hosting headers assume Vite's defaults: long immutable cache
  on `/assets/**`, no-cache on `/index.html`, `/sw.js`, `/manifest.webmanifest`. M1.6
  confirms the names when the admin build exists. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A12 (M1.2, 16 Sep): root `npm run emulators:hosting` (hosting, auth, functions) added
  next to the full-suite `npm run emulators`, for local site work without Firestore.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A13 (M1.2, 16 Sep): the production redeploy that M1.2 requires put the M1.1 home page
  live on lailark.in: same copy as v0, now rendered by Next.js with the jar video
  background (A8). `/batch/001` is byte-identical to before, verified by curl and cmp
  before, on a preview channel, and after. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A14 (M1.3, 16 Sep): `deploy.mjs` treats a workspace as deployable when its
  `package.json` has a `build` script, so the placeholder `admin/` is refused with
  "admin/ is not set up yet (M1.6)" until M1.6. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A15 (M1.3, 16 Sep): `LAILARK_DEPLOY_DRY_RUN=1` makes `deploy.mjs` print every command
  (builds included) instead of running it and skips the network check; the script tests
  use it so they never touch Firebase. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A16 (M1.3, 16 Sep): the production live gate accepts only the exact typed `yes`
  (whitespace trimmed, no case folding); a closed or exhausted stdin exits 1 with
  "no answer on stdin, stopped." rather than continuing. `check:batch-001` compares
  bytes against `site/public/batch/001/index.html` and checks the two 301s; `--project
  staging` points at `https://lailark-staging.web.app`. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A17 (M1.4, 16 Sep): `functions/` is CommonJS (no `type: module`, tsc `module: commonjs`),
  the best-trodden path for the Functions emulator and discovery. `engines.node: "22"`
  in `functions/package.json` is what the CLI reads for the runtime; no `runtime` field
  in `firebase.json`. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A18 (M1.4, 16 Sep): TypeScript pinned to 5.9.x (typescript-eslint 8 does not support
  TS 7) and ESLint pinned to 9.39.5 in every workspace to match `site/`
  (eslint-config-next needs 9). Vitest 5 for functions unit tests. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A19 (M1.4, 16 Sep): `DEFAULT_MAX_INSTANCES = 3` in `functions/src/lib/options.ts`,
  used by `api`; later functions pass their own value when a task calls for more.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A20 (M1.4, 16 Sep): the `api` router strips one leading `/api` segment so both the
  Hosting rewrite path (`/api/health`) and the direct function URL work; no Express.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A21 (M1.4, 16 Sep): Firebase Hosting header rules win over headers a function sets on
  rewritten responses, so `firebase.json` carries a `/api/**` rule with `Cache-Control:
  no-store` after the `**` no-cache rule. M3.3's `/api/counts` (15 s CDN cache) needs its
  own rule after that one. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A22 (M1.5, 16 Sep): `@lailark/shared` builds twice (ESM to `dist/esm`, CJS to
  `dist/cjs`) behind an `exports` map, with `main`/`types` on the CJS build for the
  node10 resolver `functions/` uses; a `prepare` script builds it on `npm install`; the
  root workspaces order is `shared, functions, site, admin` so it builds first. Zero
  runtime dependencies. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A23 (M1.5, 16 Sep): `Paise` is a plain `number` alias (a brand buys nothing in the
  JavaScript site); `assertPaise` rejects non-integers at runtime. Timestamps are typed
  structurally (`{seconds, nanoseconds}`, satisfied by both Firebase SDKs, no Firebase
  dependency in shared). Calendar dates are `YYYY-MM-DD` strings; "today" is the
  Asia/Kolkata calendar date. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A24 (M1.5, 16 Sep): `formatINR` prints `₹649`, `₹649.50` only when there are paise,
  Indian grouping (`₹1,00,000`) hand-rolled so output never depends on the machine's
  locale, negatives as `-₹599`. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A25 (M1.5, 16 Sep): payment statuses are `created, authorized, captured,
  partlyRefunded, refunded`; refunds themselves live in `refunds/{id}` with
  `refundedAmount` on `orders.payment`. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A26 (M1.5, 16 Sep): batch numbers pad to at least 3 digits and grow past 999;
  `parseBatchNo` accepts only the canonical spelling. Document serials pad to 4 and grow
  past 9999. `counters/{series}` ids use dashes (`LK-26-27`), document ids
  `LK-26-27-0001`, display `LK/26-27/0001`; prefixes are a parameter with the §13.3
  defaults. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A27 (M1.5, 16 Sep): sale stop is counted back from the printed best before:
  `bestBefore - max(ceil(shelfLifeDays x 0.30), 45) - transitDays`, all four inputs in
  `settings/shelfLife` with defaults 180, 0.30, 45, 7 (brief §6.2). Batch 001: best
  before 4 Mar 2027, sale stop 2 Jan 2027 (120 days after packing), warning 19 Dec
  2026. Best before adds calendar months and clamps to the month end (31 Aug + 6 = 28
  Feb). Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A28 (M1.5, 16 Sep): `bottled -> soldOut` is a legal batch transition for a pot with no
  surplus, next to `bottled -> inStock`. No order transition table is shipped because
  §9.1's "Concern" next-states name a concerns document, not an order state; only the
  terminal, paid and concern-raising sets are exported. `canTransitionBatch` returns
  false, never throws, on unknown strings. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A29 (M1.5, 16 Sep): `/api/health` also reports the shared package version
  (`shared: "0.0.0"`). The site's money entry point is `site/lib/money.js` over
  `formatINR`, tested with `node --test` (`site/tests-unit/`), not yet used by a page
  until M3. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A30 (M1.6, 16 Sep): the Auth emulator (firebase-tools 15.30) ignores fixed test phone
  codes and issues a random OTP every time, so "OTP 123456" in CLAUDE.md §8 holds only
  inside Playwright, where `admin/tests/emulator.ts` swaps in the code the emulator
  issued. By hand against the emulator, read the code in the Emulator UI Auth tab
  (http://127.0.0.1:4000/auth) or the emulator log. Real projects need test phone
  numbers configured in the Firebase console if Shefin wants a fixed OTP on staging.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A31 (M1.6, 16 Sep): an unknown number is refused inside the admin after Firebase Auth
  signs it in (Auth creates a user for any number; the app sees no `role` claim, shows
  "This number is not on the Lailark admin list. If it should be, ask Shefin." and signs
  out). Blocking sign-in before the account exists needs Identity Platform, which is
  paid, so it is not used. Rules deny everything to a token without a role (M1.8).
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A32 (M1.6, 16 Sep): `setRole` authorises on the caller's `role` custom claim alone
  (an Owner claim with no `users` doc still works), refuses to demote the last Owner,
  merges rather than replaces custom claims, and revokes refresh tokens on every role
  change. `onCall` verifies tokens without a revocation check, so a demoted Owner's
  already-issued token keeps power for up to an hour; App Check and stricter checks are
  M5.9. `name` is capped at 80 characters and stored as typed. `active: true` is always
  written; deactivating a user is left to the Settings users screen (M5.8). Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A33 (M1.6, 16 Sep): the admin Playwright run builds an emulator-pointed bundle into
  `admin/dist-test` (gitignored) so `admin/dist` is always the deployable build, starts
  only the auth and firestore emulators, and seeds the two users in its global setup.
  PWA icons are rasterised from `site/public/assets/lark.svg` by Playwright's Chromium
  (`admin/scripts/make-icons.mjs`), ink on paper, no image dependency. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A34 (M1.6, 16 Sep): the production Firebase web config (public by design) is committed
  in `admin/src/firebase-config.ts`; the storage bucket is `lailark.firebasestorage.app`.
  The staging config is a `TODO(Q2)` placeholder. `VITE_FIREBASE_PROJECT` picks the
  project at build time. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A35 (M1.6, 16 Sep): `firestore.rules` gained a self-read rule on `users/{uid}` so the
  signed-in screen can show a name; M1.8 replaces it with the full matrix. The admin
  bundle is one 636 kB chunk (190 kB gzipped), nearly all Firebase SDK; M1.7 may split
  Firestore off the sign-in path. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A36 (M1.6a, 16 Sep): functions deploy packs `shared/` into `functions/vendor/*.tgz`
  with a `file:` dependency via `functions.predeploy` in `firebase.json`, and
  `postdeploy` restores the workspace link; `scripts/deploy.mjs` also restores on exit
  when `--functions` is passed because firebase-tools skips postdeploy after a failed
  deploy. `functions.ignore` uses basename globs (`*.test.ts`, `*.local`, `scripts`)
  because the CLI matcher only does basename matching; `lib/` and `vendor/` upload,
  `.secret.local` never does. No lockfile inside `functions/`, so Cloud Build runs
  `npm install`. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A37 (M1.7, 16 Sep): the admin has one look, paper ground and ink type, with
  `color-scheme: light`; no dark mode (the site honours `prefers-color-scheme`, the
  admin is a tool used in kitchen light). Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A38 (M1.7, 16 Sep): the offline pill answers "can this device reach the network"
  from the browser's `online`/`offline` events, not from Firestore metadata; Firestore's
  persistent cache stays on. Money under More is hidden for Kitchen and a Kitchen deep
  link to `/more/money` lands on `/more`. Unknown admin paths render Today (closed set
  of screens, no 404 page). The router is the admin's own over the History API.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A39 (M1.7, 16 Sep): admin empty-state and More-row wording is the builder's (admin
  wording may be assumed); the Firebase SDK is split into its own chunk (616 kB, 181 kB
  gzipped) so the shell code (27 kB) is cached separately. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A40 (M1.8, 17 Sep): `PROTECTED_BATCH_FIELDS` (14: bestBefore, bookableJars,
  bottledJars, fullApprovedAt, fullReachedAt, halfApprovedAt, halfReachedAt, heldJars,
  paidCount, perPersonLimit, pnl, saleStopOn, state, writtenOff) are written by no client,
  the Owner included. `KITCHEN_BATCH_FIELDS` (10: cookedOn, costs, landedOn, packedOn,
  source, updatedAt, updatedBy, weightCleaned, weightCooked, weightRaw) are the only batch
  fields Kitchen may change. Both lists live in `firestore.rules` and in
  `shared/src/rules.ts`; `rules-tests` parses the rules file and fails on any drift.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A41 (M1.8, 17 Sep): no client writes `orders`, `documents`, `counters`, `refunds`,
  `settlements`, `webhookEvents`, `dayCloses`, `users`, `approvals` (create),
  `conversations` or `shipments/events`, in any role. Money reads (`documents`,
  `refunds`, `settlements`, `dayCloses`) are Owner and Viewer. `counters` and
  `webhookEvents` have no client read at all. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A42 (M1.8, 17 Sep): Kitchen may create a batch photo update without `approvedBy` or
  `sentAt`, and edit only `photoPath`, `kitchenLine` and the stamps on its own update
  while unapproved (D5). Kitchen may not create a Concern (every raiser is a function).
  Both staff roles may create and edit customers, addresses and shipments, including
  `packingCost` and `courierCost` (money out, typed from a receipt, "edit packing cost"
  in §17.12). `audit` entries require `by` = the caller and `at` = the server time and
  can never be edited or removed. The three admin roles may read `notify`. Owner may
  delete products, ingredients, recipes, settings and policy versions, never a batch,
  order, customer, write-off or audit entry. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A43 (M1.8, 17 Sep): Storage has no public path. `documents/**` and `exports/**` read
  Owner and Viewer, `shipments/**` read Owner and Kitchen, all three written only by
  functions; `batches/**` written by Owner and Kitchen and `products/**` by Owner, each
  an image of at most 8 MB. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A44 (M1.8, 17 Sep): `@firebase/rules-unit-testing` is 5.0.2 (4.x needs firebase 11, the
  repo is on 12). The rules suite is its own workspace, `rules-tests`, run inside
  `firebase emulators:exec --only firestore,storage`, one file at a time against one
  emulator. A write that sets a protected field to the value it already has passes,
  because rules compare changed keys. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A45 (M1.8a, 17 Sep): `scripts/deploy.mjs` and `scripts/check-batch-001.mjs` read the
  staging project id from `.firebaserc`; the admin build gets `VITE_FIREBASE_PROJECT`
  for the project it deploys to, and `admin/src/firebase.ts` picks the config with a
  literal comparison so each bundle carries only its own project's web config (a repoint
  touches `.firebaserc` and that one line). The admin shows a user's name from
  `users/{uid}`, then the Auth `displayName`, then the phone number. Functions also call
  `setGlobalOptions({ region: asia-south1, maxInstances: 3 })` before any export loads.
  Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A46 (M1.8a, 17 Sep): on staging the two role claims were set with `firebase auth:import`
  (Shefin `+917736110087` owner, Sumayya `+919446587027` kitchen, each with a
  `displayName`), because `setRole` could not deploy (Q6). No `users/{uid}` documents
  exist on staging yet, so the admin shows the Auth `displayName`. Once `setRole` is
  deployed, run it or the seed script to write the documents. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A47 (M1.8a, 17 Sep): staging has an Artifact Registry cleanup policy in `asia-south1`
  that deletes function container images older than one day (the Firebase CLI default,
  set with `firebase functions:artifacts:setpolicy --force`), so deploys exit cleanly and
  old images do not accrue storage charges. Production needs the same once functions
  deploy there. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A48 (M1.9, 17 Sep): CI (`.github/workflows/ci.yml`) runs on Ubuntu with Node 22, Temurin
  Java 21 and firebase-tools 15.30.1, one named step per workspace test, no secrets. The
  green GitHub run on the pushed branch is the independent test of this task, in place of
  a tester subagent: https://github.com/delta2511/lailark/actions/runs/35195571480. Status: confirmed at the M1 break (17 Sep, S: no overrule).
- A49 (M1.11, 17 Sep): one switch, `settings/permissions.kitchenCanEditRecipes`, covers
  both ingredients and recipes; only a literal boolean `true` turns it on, in the rules
  and in `kitchenCanEditRecipes()` in shared. Kitchen never deletes an ingredient or
  recipe, even with the switch on, because batch lines and history point at them. With
  the switch on there are no field limits on what the Kitchen edits. The seed script
  writes the switch as `false` only when the document is missing. Status: confirmed at the M1 break (17 Sep, S: no overrule).
