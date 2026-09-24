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
| D21c | **Q12 (final): a batch takes its printed number when the jars are bottled** | Replaces D21b. A batch keeps one fixed internal reference for its whole working life, through drafting, booking, sourcing and cooking, so nothing pointing at it (every order included) is ever re-pointed. The global, sequential, zero-padded number is stamped at Cooking to Bottled, beside the label data, so a number always means jars that exist and the sequence can never have a hole. `/batch/<nnn>` appears at bottling and is a record from birth. An open batch is booked and watched on its product page. This overrides two lines of the brief: §8.2 allocating the number at Draft to Open, and §8.4 showing an open batch at `/batch/<nnn>` |
| D27 | **Q9: the Mac has Google application default credentials** | `gcloud` installed and `gcloud auth application-default login` done on 19 Sep, quota project `tree-quiz-74e04`. Seed scripts write straight to staging, and the restore drill before launch (M5.9) can run |
| D23 | **Q13: a batch may be paused from any state that is selling or cooking** | Open, Half reached, Sourcing, Cooking, In stock and Sold out. Draft is not on sale and Archived is closed with its P&L locked, so neither is pausable. Resuming returns the batch to the state it was paused from. Settles the §8.2 against §8.1 contradiction in favour of §8.2 |
| D24 | **Q11: Claude drafts the three missing customer messages, and the Owner can edit them** | Batch open, half reached for a product other than prawns, and back in stock. They live in a Settings document the Owner can change without a deploy, with the drafts as the fallback. Every one still reaches the Owner as an approval to edit and approve; nothing sends by itself |
| D25 | **Q8: Cloud Storage started on both projects** | Buckets exist on `lailark` and `tree-quiz-74e04`, and the Lailark Storage rules are deployed to both (a new bucket starts permissive, so this mattered) |
| D26 | **Q10: HSN codes filled in from public classification, editable, CA to confirm** | Prawns 16052900, squid 16055400, beef 16025000, duck 16023900, rabbit 16029000, koorka and yam 20019000. Each is editable in place on the Products screen. GST is off at launch, so nothing depends on them yet |
| D28 | **Ingredient percentages: the `/batch/001` page shows none; from batch 002 the page and the label show them, on basis B** | Decided by Shefin, 19 Sep 2026. Basis B: the main ingredient's cleaned raw weight over the ingoing total minus the evaporated vinegar, with about 400 g of the 2 kg vinegar taken as retained after the boil (an estimate until weighed; the denominator is 4,433 g on the doc's placeholder weights). Batch 001: the page's ingredient line reads "Prawns, dates, vinegar, ..." with no percentages. The 22 printed jars still read Prawns (59%), Dates (22%); that stays in the handoff as the record of the print, not as the basis. From batch 002 both come from the recipe engine on basis B, and only for lines flagged as main (Prawns 35%, Dates 23% on the placeholder weights). Supersedes the part of A54 that said the batch 001 record page stays as printed, and answers Q7. Still to do: weigh the cleaned prawns and the vinegar residue on the next batch, and get written confirmation of the basis from the FSSAI designated officer or the food consultant |
| D21 | `www.lailark.in` redirects to `lailark.in` with its own certificate | Answers Q3. Set up by Shefin in the Firebase console and GoDaddy. Verified 17 Sep: `https://www.lailark.in/batch/001` 301s to `https://lailark.in/batch/001` |
| D22 | **Ingredients and recipes: Owner edits, Kitchen views.** A switch lets the Kitchen edit them later | Answers Q4. Kitchen and Viewer read every ingredient and recipe with all their details. The Owner's switch `settings/permissions.kitchenCanEditRecipes` (off by default, a missing setting is off) lets the Kitchen create and edit both when turned on. Only the Owner flips it, like the discount cap (D17). Deleting stays the Owner's either way. The toggle appears in the admin Settings screen (M5.8) and the Recipes screen honours it (M2.1) |

## Launch scope cut (23 Sep 2026, S)

| # | Decision | Detail |
|---|---|---|
| D29 | **Scope cut to go live sooner.** The old Milestones 3, 4 and 5 become one Milestone 3: Launch with 13 tasks. The rest moves to a Fast-follow list in `TASKS.md`, not started until Shefin says so after launch | Reason: Claude usage on the Pro plan. Kept: M3.1 to M3.6, M3.8, M3.9, M4.1, M4.5, M5.7, M5.9, M5.11. Trimmed: M3.6 (settlement pull out, M3.6b), M4.5 (see D31), M5.9 (restore drill out, M5.9b). M3.2 home page stays full opus with its copy review: it is what customers see. Moved to Fast-follow: M2.10, M2.11, M3.7, M4.2, M4.3, M4.4, M4.6 to M4.10, M5.1 to M5.6, M5.8, M5.10. M3.10 and M4.11 fold into M5.11. Branch `milestone-3-launch`. Breaks left before launch: end of M2, end of Launch |
| D30 | **Batch 002 sells in stock after bottling. Batch 003 is the first pre-order batch, and pre-order must work at launch** | So M3.8 (open batch mechanics) stays in the launch scope |
| D31 | **Refunds at launch are recorded, not started, from the admin** | Refund in the Razorpay dashboard, by UPI or in cash, then record it on the order (M4.5 trimmed). Refund or credit note issued, jar back to the count. API refunds and the 6-month guard are fast-follow (M4.5b) |
| D32 | **Customer messages at launch are sent by hand** | The WhatsApp layer and agent (M5.1 to M5.3) are fast-follow. Where the admin would send, it shows the drafted text from the brief or Settings with a prefilled `wa.me` link per recipient, and the sender ticks it sent (mechanism proposed by Claude, 23 Sep, open to Shefin's overrule at the M3 break). The hard rule that nothing is automatic still holds. Shefin and Sumayya answer customer WhatsApp themselves |
| D33 | **Manual workarounds until Fast-follow lands** | Listed per task in the Fast-follow section of `TASKS.md`. Notable: counter UPI goes to Lailark's account only, the Razorpay QR half of D10 waits (M3.7); batch record pages are published by adding the JSON and running `npm run deploy`, the ST6 Publish button waits (M5.6); India Post only; books kept by hand while GST is off |
| D34 | **Shefin in the loop between tasks** | Sonnet tasks that produce a screen or page (M3.1, M3.3, M3.4, M3.9, M4.1) are checked by Shefin instead of a tester subagent; the orchestrator runs build, lint and tests itself, then stops with a short check note. Opus tasks and anything touching money, rules, transactions, auth or webhooks keep the fresh automated tester and do not stop. Never-assume questions are asked the moment they come up, not parked in `QUESTIONS.md`. Every stop ends with /clear and a fresh session. Reason: fewer tokens per task and less rework. CLAUDE.md §4.1 and §4.4 |
| D35 | **Kitchen may open the bill for any order, through a server callable only** | Asked and answered 23 Sep 2026 during M2.9. The money collections stay shut to Kitchen: `documents`, `counters`, `refunds`, `settlements` and `documents/**` in Storage keep `seesMoney()` in the rules, so Kitchen cannot browse the books or read a bill straight from Firestore or the bucket. A callable takes one order id, checks the caller is Owner, Kitchen or Viewer, and returns a short-lived link to that order's bill. Reason: Sumayya rings up the counter sale, so she is the one handing the bill over, and a bill is one sale the customer is standing there for, not the books. This is the one named exception to the "See Money" row of brief §17.12 |
| D36 | **A counter sale paid by payment link is billed at capture, not at save** | Asked and answered 23 Sep 2026 during M2.9. Settles the two readings of brief §13.1: "Counter sale: at save" and, one row above, "In stock online: at payment". Cash and UPI to account are paid at save, so their bill is issued in the same transaction as the sale. A payment link is not paid at save: the jars are held and the link may expire, so no number is spent until Razorpay captures, which is M3.6's webhook calling the same code. Reason: a bill number is permanent, never reused and never deleted, so issuing one for a hold that may expire puts an unpaid non-sale in the register the CA reads |
| D37 | **A document carries no sentence of its own. It is structural** | Asked and answered 23 Sep 2026 during M2.9. Seller block, labelled fields, lines, totals, payment, and nothing else. No footer, no thank-you, no line explaining in words what a credit note does. A bill is a record, not a note. It is one string in `functions/src/money/copy.ts` if Shefin ever wants one |
| D38 | **The door line on a bill is an editable field, not a constant** | Asked and answered 23 Sep 2026 during M2.9. "Handed over at Kunnamangalam" stands as the wording, capitalised and without a full stop, where an address would sit. Shefin asked for it to be kept editable with a note saying so, so it lives in the seller settings document with that string as the fallback, and changing it is a settings change rather than a deploy. Same shape as the rest of `settings/seller` (A102) |
| D39 | **`audit` is the only history. `orders/{id}/events` is dropped** | Answers Q14, asked at the M2 break, decided 23 Sep 2026. Two histories for one order drift, and the one that drifts is the one nobody is looking at: `audit` is written by the wrapper every client and function write goes through, the timeline screens read it, and undo reads the old value out of it, while `orders/{id}/events` has rules, types and seed coverage but nothing writing to it and nothing reading it. Removed before M3 builds order writes on top of it, along with its rules, its type, its rules tests and its seed coverage |
| D40 | **Price in stock, price for an open batch and the limit per person are editable on every batch, in any state, with no lock** | Asked at the M2 break, decided 23 Sep 2026. Shefin was shown the risk (a price changed after people have booked and paid at the old one) and the two safer options (lock once money is in, or lock at Open) and chose full flexibility on every batch, batch 001 and archived batches included. Two things the build must hold to: an order already placed keeps the price it was actually charged, always, so nothing is repriced retrospectively; and editing a price on an Archived batch moves that batch's P&L, which is flagged on the screen rather than prevented. Prices still cannot go above the ₹649 MRP |
| D41 | **Sourcing to Cooking asks for a weight and a cost per main ingredient, each named** | Asked and answered 23 Sep 2026, surfaced while fixing M2.13. Brief §14.1 says "the main ingredient's" raw weight and cost, which assumes one; batch 001 has two, prawns and dates, and the form silently recorded only the first, so the dates bought for the batch were never costed at that step. The form now asks once per main line and names the ingredient it is asking about. Reason: the main ingredients are the two costs that most move the batch P&L, and dates are not cheap. Built in M2.19 |
| D42 | **The per-ingredient actuals are value checked in `firestore.rules`, not only on the screen** | Asked and answered 23 Sep 2026, surfaced by the M2.14 tester. `batches/{ref}/lines/{lineId}` allows create and update on `isStaff()` alone and never looks at the number, so `qtyActual` and `costActual` are guarded by the screen only: anything writing outside it (a seeding script, a function with a bug, a signed-in staff account talking to Firestore directly) can put a negative, a fractional paise or an absurd cost straight in. A84 already checks the batch's own costs and a product's two prices this way; the line documents were missed. Shefin was told the risk is low today, since every write does go through the screen, and chose to close it now rather than at launch: these are the two numbers that most move a batch P&L. Also fixes `rupeesToPaise` silently rounding, so `12.345` is refused rather than saved as `1235`. Built in M2.20 |
| D43 | **One undo toast for the whole Cooking actuals section, not one per ingredient row** | Asked and answered 23 Sep 2026, confirming A112 from M2.14. A second cost typed inside the 8 seconds replaces the first toast, so only the second edit stays undoable. Shefin was shown the alternative (a toast and its own 8 seconds per row) and kept the single toast: nothing is lost either way, both edits are in the timeline and the old number can be retyped, and several stacked bars at the bottom of a phone at a busy counter is worse than the thing it fixes |
| D44 | **The limit per person is an editable field with the computed quarter as its placeholder and its default** | Asked and answered 23 Sep 2026 during M2.16, following D40. `perPersonLimit` was a protected, server-computed field (a quarter of the bookable jars, minimum 1). It is now a number the Owner may type on any batch in any state. Left blank it falls back to the computed quarter, which is what the box shows as its placeholder, so a batch nobody has touched behaves exactly as it does today and a planned-jar change still moves the limit. Once the Owner types a number it stands, through later planned-jar changes, until it is cleared back to blank. Reason: Shefin wanted the freedom without losing the automatic number underneath it |

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
- A50 (M1.12, 18 Sep): signing out returns to Today (`/`) rather than the screen the
  sign out was tapped on; an error boundary replaces a dead screen with a line and a
  Reload button; `unhandledrejection` and `error` listeners log in every build, not only
  dev; the reCAPTCHA host stays 0 by 0 and visible so Google's badge still shows;
  `clearRecaptchaArtifacts` removes only the badge and unnamed body-level containers
  whose every iframe is a reCAPTCHA iframe; "Use another number" keeps the typed number
  for correction. Status: open.
- A51 (M1.12, 18 Sep): testers default to `[sonnet]`, and `[opus]` is kept for money,
  rules, auth, webhooks, the agent and customer-facing copy, per CLAUDE.md §4.2 and
  Shefin's note on 18 Sep to be mindful of model choice. Status: open.
- A52 (M2.1, 18 Sep): the engine rounds half up, one decimal in the working table and a
  whole number on the label; ordering follows whichever basis is switched on (under B
  vinegar sits fourth, under A and C it leads), with ties on the recorded line order;
  allergens are listed in recorded line order so the allergen line never moves when the
  basis is flipped; a percentage is printed only for a line flagged as a main ingredient
  (batch 001: prawns and dates). Status: open.
- A53 (M2.1, 18 Sep): three optional fields were added to the brief §18.1 shapes because
  the worked example needs them: `Ingredient.densityGPerMl`, `RecipeLine.residueG` and
  `Recipe.finishedWeightG`. The engine refuses a volume line with no density and basis C
  with no finished weight rather than guessing. A missing nutrition figure is reported by
  ingredient name, never counted as zero. Status: open.
- A54 (M2.1, 18 Sep): **the label the engine generates for batch 001 reads Prawns 35% and
  Dates 23%, where the 22 printed jars read Prawns 59% and Dates 22%.** That is the
  decided change of basis (basis B on cleaned raw weight, against the printed label's
  basis C on market weight), not a fault: the batch 001 page shows no ingredient
  percentages (D28), and the new figures apply from batch 002. The verifier pins the
  difference to 14 known cells so a fifteenth fails the build. Status: settled by D28.
- A55 (M2.2, 18 Sep): pipeline products are named plainly (Duck, Yam, Rabbit) and seeded
  inactive; every product launches at the same price and jar size because nothing in the
  docs varies them; beef carries `shippingRule: flatFee` built and off, while the global
  off switch is a Settings field (§17.11), not a product field; a season window with only
  one end set means no restriction. Status: open.
- A56 (M2.2, 18 Sep): product photos live in Cloud Storage under `products/{slug}/`, with
  their order and which one is the note photo held in the object's own metadata rather
  than a Firestore field, because the brief's `products/{slug}` shape has no photos field.
  The note photo always sorts last. Status: open.
- A57 (M2.2, 18 Sep): Storage `delete` is now its own clause on `products/**` and
  `batches/**` and belongs to the Owner alone. The old single `write` rule could never
  permit a delete, because the image and size check has nothing to look at when a file is
  being removed. Uploads still require an image of at most 8 MB. Status: open.
- A58 (M2.2, 18 Sep): a product price must be a whole number of paise from 1 up to the
  ₹649 MRP; a custom line amount must be a whole number of 0 or more, with no MRP bound
  because a custom line is not a jar. Both are refused on screen with a plain line.
  Status: open.
- A59 (M2.3, 19 Sep): `transitionBatch` keeps the §8.2 table in a pure module with no
  Firebase in it, so every row (who may call it, what it asks for, what it computes, what
  it flags) is unit-testable. The Owner may also call the rows §8.2 gives to Kitchen,
  since §17.12 gives the Owner every right. Resuming from Paused names its target state.
  Status: open.
- A60 (M2.3, 19 Sep): `heldJars` entries carry `customerPhone` beside `qty` and
  `expiresAt`, extending the §18.1 shape, because the transaction cannot otherwise tell
  whose live holds it is counting and the per-person limit could be beaten by taking
  several holds. Batches are admin-read-only, so no customer number is exposed. The limit
  counts a customer's live holds plus their paid jars across every order in the batch, is
  checked inside the same transaction that moves the count, and is checked before the
  last-jar check so a customer over their cap hears about the cap. It applies to in-stock
  purchases as well as open-batch bookings. Status: open.
- A61 (M2.3, 19 Sep): the 3-day production clock lives on the full approval, and raising
  the full flag clears the half approval's `dueAt` with `dueAtSupersededBy`, so exactly
  one clock is ever live (§8.2 "replaces"). The half hop is always evaluated before the
  full flag, so a batch that fills in one payment cannot start a 5-day clock after the
  3-day one. Status: open.
- A62 (M2.3, 19 Sep): answering the full approval is its own callable `approveBatchFull`
  rather than a row of the transition table, because the full flag moves no state. Owner
  only, stamps `fullApprovedAt`, marks the approval approved or edited, never sets
  `sentAt`, and a second yes writes nothing. Status: open.
- A63 (M2.3, 19 Sep): a paused batch blocks a second batch of the same product (D15 lets
  a second open once the first is cooking, and paused is not cooking). Approvals and
  concerns use deterministic ids so an at-least-once trigger cannot duplicate them; every
  automatic step makes its own precondition false, so a trigger's own write stops the
  chain. Status: open.
- A64 (M2.3a, 19 Sep): the batch document id is an internal reference that never changes
  (`b-` and six characters); `batchNo` is a field, absent until bottling. Anything reading
  a batch by number resolves it through that field. Status: open.
- A65 (M2.4, 19 Sep): the per-ingredient drift warning fires above 15% away from the
  recipe's own quantity, reduced to grams on both sides so a line written in litres
  compares honestly. Named as `INGREDIENT_ACTUAL_DRIFT_THRESHOLD_PERCENT` so it moves in
  one place. The brief asks for the warning and names no number. Status: open.
- A66 (M2.4, 19 Sep): on the batch screens an empty box is "not given", never a zero. An
  in-place weight or cost box that is cleared leaves the stored value alone and puts it
  back, because a person retyping a weight or interrupted mid-edit has no reason to
  expect that clearing a box is how you say "this is gone". A deliberate 0 still saves.
  Status: open.
- A67 (M2.4, 19 Sep): each box of the per-ingredient actuals writes only its own field.
  The weight box cannot carry a cost and the cost box cannot carry a weight, so neither
  can overwrite the other with a value it read from a snapshot that had not caught up.
  Status: open.
- A68 (M2.4, 19 Sep): Fill and Price are read-only on the batch detail after the batch
  exists, although brief §17.4 says planned is editable while Open. §8.2 has no
  transition row after Draft -> Open that changes `plannedJars`, and a raw write would
  leave `bookableJars` (server-computed, protected) stale. Deferred rather than built
  unsafely; it needs a row of its own. Status: open, and the one piece of §17.4 M2.4
  does not deliver.
- A69 (M2.4, 19 Sep): the batch screens hold a trimmed, presentation-only copy of the
  transition table (`admin/src/batches/transitionRows.ts`) to decide what the one big
  state button offers. Every submit still goes through the real table on the server, so a
  copy that drifted fails safe: no button, or a plain refusal, never a wrong write.
  Moving the whole state machine into `shared` is the better end state. Status: open.
- A70 (M2.4, 19 Sep): a typed amount finer than a paisa rounds to the nearest paise
  rather than being refused (₹12.345 is ₹12.35), which is what `rupeesToPaise` has done
  for every price box since M2.2. Money is still only ever an integer. Status: open.
- A71 (M2.5, 20 Sep): a card put off with "not yet" comes back at 07:00 Asia/Kolkata the
  next morning. Brief §7.3 says next morning and names no hour. Status: open.
- A72 (M2.5, 20 Sep): the Clocks section covers batches in Open, Half reached and
  Sourcing only. Once the kitchen is cooking the promise the clock stands for has been
  kept, so the old `dueAt` stops counting at the Owner. A paused batch is off the list
  too: its customers are on a Concern, which is a card of its own. Status: open.
- A73 (M2.5, 20 Sep): the reason given with a "not yet" stays on the approval after a
  later yes, as the record of why it waited. A second "not yet" overwrites it and pushes
  the reminder. Status: open.
- A74 (M2.5, 20 Sep): saying yes to a kitchen photo update writes the approved wording
  onto the update document as well as the approval, so the two cannot disagree about
  what was approved. Status: open.
- A75 (M2.5, 20 Sep): the ask lines, buttons and clock labels on Today are the build's
  own wording, kept in `admin/src/copy.ts`. Admin copy, not customer copy (CLAUDE.md
  section 5). Status: open.
- A76 (M2.5, 20 Sep): the no-long-dash rule is enforced on every customer sentence the
  Owner can type, and it catches the en dash and the horizontal bar as well as the em
  dash CLAUDE.md names, because those are what a phone keyboard and a paste from a web
  page actually produce. A hyphen is untouched. `firestore.rules` also stops any client
  writing `sentAt`, `kind`, `batchRef`, `updateId` or `dueAt` on an approval: the
  callables never do, and from M5 `sentAt` is the record that a customer was really
  messaged. Status: open.
- A77 (M2.6, 21 Sep): an audit entry carries `fields`, `undoes` and `source` beyond the
  brief's six, so an undo of an undo can be read back and a client write told from a
  function write. Status: open.
- A78 (M2.6, 21 Sep): the 8 second undo window is the toast's own timer. Nothing on the
  server re-checks how old an entry is, so somebody working outside the app could undo
  an old entry of their own. It can only ever restore a value a role-permitted write
  already set, and the race guard still applies, so "for 8 seconds" is a promise the
  screen makes rather than one the system enforces. Status: open.
- A79 (M2.6, 21 Sep): the per-ingredient actuals are audited but offer no undo. That
  screen never had one, and adding it needs its own race analysis against the one field
  per box guarantee. Status: superseded by M2.14 (23 Sep). Shefin hit exactly this at the
  M2 break: he edited a cost, saw it reach the timeline, and looked for an undo that had
  never been built. Those boxes now offer the same 8 second undo as every other in-place
  field, reusing `undoAuditEntry`'s existing race guard rather than a second one, and the
  race analysis this line asked for is in `saveBatchLine`'s comment: a commit touches
  only the one field typed into, so an undo can collide only with a later write to that
  same field on that same line, never with the row's other box. See A112 to A116.
- A80 (M2.6, 21 Sep): the timeline is read-only. Undo lives on the write's own toast,
  not as a standing control on history. Status: open.
- A81 (M2.6, 21 Sep): a timeline entry shows the actor's name from `users/{uid}`, and
  the raw uid when there is no readable record. Status: open.
- A82 (M2.6, 21 Sep): `firestore.indexes.json` gained `audit: object asc, at desc`. The
  emulator does not enforce indexes, so no test would have caught its absence and the
  timeline would have been empty only once deployed. Status: open.
- A83 (M2.6, 21 Sep): an audit entry is refused unless the change it describes is
  really happening in the same commit, checked by reading the target document's
  `updatedAt` as it will be after the write. Without it a signed-in staff account could
  append history that never happened, and a trail that can be written to freely answers
  what somebody typed rather than what happened. Status: open.
- A84 (M2.6, 21 Sep): a product's two prices and every custom line amount are now
  checked by value in `firestore.rules`, whole paise and never above the ₹649 MRP, the
  way a batch's costs already were. They are typed into a box and written straight to
  Firestore with no callable in the way. The custom line list is capped at eight,
  because rules cannot walk a longer one. Status: open.
- A85 (M2.6, 21 Sep): ingredient and recipe writes, product creation, and the product
  fields that are not money (name, HSN, type, veg, season, shipping rule, active, a
  custom line's description) still write directly and are not audited. Only the writes
  that offer undo go through the wrapper today. Status: open.
- A86 (M2.7, 21 Sep): batch 001's recipe is seeded from the label basis doc's own
  placeholder weights, so its percentages (basis B: prawns 35%, dates 23%) do not and
  cannot match the printed jar's (basis C: prawns 59%, dates 22%), which came from the
  actual cook. Every seeded line carries `estimated: true`, a new optional field on a
  recipe line, and the admin prints "estimated" beside such a quantity. The allergen
  line, the claims and the storage text do match the jar character for character,
  checked with the engine's own `verifyAgainstPrintedLabel`. The ingredient line will
  match only once the real weights are recorded. D28 keeps this off the customer's
  page: `/batch/001` shows no percentages at all. Status: open.
- A87 (M2.7, 21 Sep): no ingredient carries nutrition figures. Handoff §2's panel
  belongs to the finished jar, not to any one ingredient, and nothing in the repo gives
  per-ingredient nutrition. An earlier draft of the seed put the jar's protein figure,
  10.7 g, onto raw prawns, where the real value is nearer 20. Empty is read as "not
  known" rather than as zero by `nutritionPer100g`. Filling these needs a cited source
  per ingredient and is its own task. Status: open.
- A88 (M2.7, 21 Sep): batch 001's document id is `b-001001` and its `batchNo` is
  "001". The seed refuses to run, loudly, if something else is already at that id, and
  never writes a second batch numbered 001. Its two shelf-life dates are computed by
  the shared helpers and checked against what is printed on the 22 jars; if the rule
  ever moves, the seed stops rather than contradicting the labels. Status: open.
- A89 (M2.8, 21 Sep): "same day" for voiding a counter sale is the business day, 05:00
  to 05:00 Asia/Kolkata, so a jar sold at 23:50 is still voidable at 00:10 while the
  counter is being tidied. Read as the calendar date it would break in exactly the
  twenty minutes it exists for. Status: open.
- A90 (M2.8, 21 Sep): an order is named by a short unguessable reference (`o-7f3a2c`),
  like a batch before bottling (D21c). The number that must be sequential and unbroken
  is the bill number, a different series, issued in M2.9. Status: open.
- A91 (M2.8, 21 Sep): a single custom line is capped at ₹1,00,000 as a typing guard,
  not a business rule: a custom line has no list price to check an extra zero against.
  Status: open.
- A92 (M2.8, 21 Sep): a counter sale carries no policy version, because nobody at the
  door was shown a web policy page. An unticked consent box on somebody who already
  agreed changes nothing: silence at a busy counter is "we did not ask this time", not
  "they withdrew". The marketing tick starts off; the bill and updates tick starts on.
  Status: open.
- A93 (M2.8, 21 Sep): one line per counter sale. Brief 7A.1 step 2 is singular
  throughout, and a cart belongs to the web checkout in M3. Status: open.
- A94 (M2.8, 21 Sep): every attempt at one sale carries a `clientRef` the screen mints
  once, and the order's document id is derived from it, so the same sale arriving twice
  writes one order and charges once. A disabled button only catches a human double tap;
  a tap delivered twice, a reply lost on a slow connection after the write had already
  landed, and M2.10 finalising an offline draft again all come back through this same
  door. Status: open.
- A95 (M2.8, 21 Sep): a jar is a jar wherever it is counted. A custom line tied to a
  batch takes jars off the batch and puts them on the customer's history, and its void
  gives back exactly what the sale took. Previously the sale counted nothing and the
  void took the lot, which quietly lowered the "3 jars before" line the seller reads
  before greeting somebody. Status: open.
- A96 (M2.8, 21 Sep): a callable's refusal reaches the screen without the HTTP status
  the Firebase client appends to it. These sentences are read at the counter with a
  customer waiting, and "[409]" is for a log. Only a bracketed 100 to 599 is removed,
  so "batch [001]" keeps its number. Status: open.
- A97 (M2.9, 23 Sep): the PDF is drawn with `pdf-lib` (one new dependency, `functions`).
  Pure JavaScript, no native build, no transitive dependency and no headless browser: a
  hundred megabytes and several seconds of Chromium for one A5 page on a cold
  `asia-south1` instance is the wrong trade, and a font file is a binary asset with a
  licence to track. Status: open.
- A98 (M2.9, 23 Sep): the rupee sign is drawn as vector paths rather than embedded as a
  font or replaced with "Rs.". U+20B9 is not in WinAnsi, so a PDF core font cannot print
  it and throws if handed one. Drawing it keeps the mark on the bill identical to the
  mark on the screen with no binary asset. There is a test asserting a core font really
  does throw, so nobody can "fix" it back into a broken state. Status: open.
- A99 (M2.9, 23 Sep): a discount is not a bill line. It comes off under the subtotal,
  once, with its reason beside it. The first draft put it in both places, which shows
  the same fifty rupees twice to somebody checking a bill by hand. Status: open.
- A100 (M2.9, 23 Sep): `DocumentRecord` stores a frozen snapshot of the seller, the
  customer, the delivery line, the payment and the money breakdown rather than joining
  onto `orders` and `customers`. A bill is a record of one moment: a customer who later
  corrects the spelling of their name has not changed the bill they were given, and
  re-rendering it in three years must give the same page. Status: open.
- A101 (M2.9, 23 Sep): against the Storage emulator the bill link is an ordinary
  download URL with a fixed token and the callable's result says `signed: false`. The
  emulator has no service account and no `signBlob`, so a signed URL cannot work there.
  Saying so in the response rather than hiding it is what stops an unsigned link ever
  shipping quietly. Production is a V4 signed URL expiring in ten minutes. Status: open.
- A102 (M2.9, 23 Sep): `settings/seller` overrides `DEFAULT_SELLER` field by field, with
  `gstin` the one field having no fallback. A new address or a renewed FSSAI licence
  should be a settings change, not a deploy; a GSTIN is never invented. D38 puts the
  door line in this same block. Status: open.
- A103 (M2.9, 23 Sep): `splitGst` throws when `settings/gst.enabled` is true rather than
  returning zeros, and `createCounterSale` checks the switch before it reads or writes
  anything and refuses with a plain sentence. GST arithmetic is out of M2.9's scope, and
  a switch that silently issues zero-tax tax invoices is worse than one that refuses.
  Status: open.
- A104 (M2.9, 23 Sep): `ensureDocumentPdf` returns null for a missing or malformed
  document instead of throwing. Trigger delivery is at-least-once and out of band, so a
  firing can arrive after the document has gone or before it is whole; throwing kills
  the function instance, which took concurrent counter sales down with it twice during
  this task. Status: open.
- A105 (M2.9, 23 Sep): the PDF's creation and modification dates are the issue date, not
  the render time, so a re-render is byte-identical rather than a page claiming to have
  been made today. Status: open.
- A106 (M2.9, 23 Sep): a void that cannot mark its bill still voids the sale and returns
  the jar, and raises an urgent `concerns` document of type `technicalFailure` for the
  Owner, in the same commit. Refusing the whole void would leave the count wrong as well
  as the books, which is worse; and a live bill for a sale that did not happen is money,
  so it may not end as a silent branch. Nothing is drafted and nothing reaches a
  customer. Status: open.
- A107 (M2.9, 23 Sep): that concern's id is derived from the order
  (`bill-not-voided-{orderId}`), so a retried transaction or a repeated attempt raises
  one concern rather than a pile. Status: open.
- A108 (M2.9, 23 Sep): `renderDocumentPdf` fills a blank for any missing field instead
  of throwing, behind `isRenderable`'s stronger refusal. A blank on a page nobody will
  ever be given is a thing to notice; a dead function instance takes concurrent counter
  sales down with it. Status: open.
- A109 (M2.9, 23 Sep): nothing on a bill is truncated. A word wider than its column is
  broken character by character, and a long label wraps and keeps its amount level with
  its last line. A customer's name, their email and the reason they were given a
  discount are not things to cut short on a bill. Status: open.
- A110 (M2.9, 23 Sep): a `documents/{id}` is created in exactly one place, `writeDocument`,
  by a `tx.create` on the number-as-id, which is what makes "never reused" true rather
  than likely. Every other writer uses `update`, which fails on a missing document where
  a merging `set` would create a headless row at an already-issued number and wedge the
  series for good. Two separate paths had this bug and both are now shaped so the
  mistake cannot be made. Status: open.
- A111 (M2.9, 23 Sep): a customer name that a core font cannot print falls back to the
  phone number, and the phone line beneath it is then suppressed so the number is not
  printed twice. The test is on the flattened name, not the typed one: Kunnamangalam is
  in Kerala, so a Malayalam name at the counter is ordinary, and it used to leave
  "Billed to" blank. Status: open.
- A112 (M2.14, 23 Sep): the Cooking actuals section carries one undo toast for the whole
  section, not one per row, matching what `BatchDetail` already does for the batch's own
  fields. Only one box is ever being typed into at a time. The consequence, confirmed
  under test rather than assumed: a second edit inside the 8 seconds replaces the first
  toast, so the first write stops being undoable and only the second one can be taken
  back. Status: confirmed by Shefin 23 Sep, D43.
- A113 (M2.14, 23 Sep): that toast's message names the ingredient as well as the field
  ("M214 Prawns, Actual cost changed to ..."), since several rows share the one toast and
  the field name alone would not say which row moved. Status: open.
- A114 (M2.14, 23 Sep): the batch timeline's second query matches everything under the
  batch path at any depth, not only `lines/{id}`, so a future audited write under
  `updates/{id}` or `writeOffs/{id}` appears on the batch's timeline without another
  change here. Brief §11 says every object shows its timeline; a write to a row the batch
  owns is a thing that happened to the batch. Status: open.
- A115 (M2.14, 23 Sep): neither timeline query carries a `limit`. One batch's whole
  history is a few dozen entries at this size. If one ever grows long, the fix is
  `limit(n)` on both and a "load more"; the client-side merge does not change. Status: open.
- A116 (M2.14, 23 Sep): an entry whose `at` has not yet resolved (the window between a
  write landing locally and the server echoing its `serverTimestamp()` back, which the
  SDK delivers as `null`) sorts newest, reproducing what Firestore's own
  `orderBy("at", "desc")` does server side. Sorting it last put the edit someone had just
  made at the bottom of the list for the round trip, then made it jump. Status: open.
- A117 (M2.16, 23 Sep): the in-place limit box refuses a cap above the bookable jars,
  matching the ceiling `planOpen` already puts on the Draft -> Open row, so the two paths
  give the same answer. D44 names no ceiling. `firestore.rules` checks only "whole number,
  one or more", because on a create there is no `bookableJars` yet to compare against, so
  an override above the bookable count is accepted server side and refused by the screen.
  The M2.16 tester raised the asymmetry and it was left deliberately: a cap above the
  bookable jars is a cap on nothing and cannot oversell. Status: open.
- A118 (M2.16, 23 Sep): a blank price box changes nothing, like every other box on this
  screen, rather than clearing the price to null. A batch with no price is refused by name
  at the counter, which is better than a jar priced at zero. Status: open.
- A119 (M2.16, 23 Sep): `planOpen`'s existing `limitPerPerson` input writes
  `perPersonLimitOverride` rather than overwriting the computed `perPersonLimit`, and
  accepts null to clear it. D44 fixes the behaviour, not the mechanism; without this the
  placeholder would show a number that is not the computed quarter. Status: open.
- A120 (M2.16, 23 Sep): the wording of `priceHelp`, `priceArchivedNote`, `priceTooLow`,
  `limitPerPersonHelp`, `limitPerPersonAuto`, `limitPerPersonInvalid`,
  `limitPerPersonOverBookable` and `limitPerPersonCleared`. Admin-facing, so assumable per
  CLAUDE.md §5. The archived line states the consequence and blocks nothing: "This batch is
  archived. Changing a price here moves its P&L." Status: open.
- A121 (M2.16, 23 Sep): the price and the limit each get their own undo toast, per the
  per-field pattern the batch's own fields already use, not D43's one-toast-per-section
  shape. No collision, because each commit touches exactly one field, which is what makes
  `undoAuditEntry`'s race guard safe. Status: open.
- A122 (M2.16, 24 Sep): `effectivePerPersonLimit` treats a zero, a negative or a
  fractional override as no override and falls back to the computed quarter. The field is
  validated where it is written (the rules, the screen and `planOpen`), so this is the belt
  to that braces: a bad value that somehow lands can never become a cap nobody meant.
  Status: open.
- A123 (M2.21, 24 Sep): WCAG AA 4.5:1 is the readable threshold the contrast helper
  enforces. The admin's own ink on paper is about 16:1, so a real regression falls far
  below it rather than grazing it: the number names what "readable" means, it is not a
  figure to tune against. Status: open.
- A124 (M2.21, 24 Sep): the focus ring on the undo toast is paper, set on that one
  surface. The alternative, making `--focus-ring` context aware everywhere, is a design
  system change well outside a bug fix. Status: open.
- A125 (M2.21, 24 Sep): `data-testid="undo-toast-message"` added to `UndoToast.tsx` so the
  message can be asserted as well as the button. Status: open.
- A126 (M2.21, 24 Sep): the focus test forces `:focus-visible` over CDP. A programmatic
  `.focus()` does not match it in Chromium, and `outlineColor` then reports `currentColor`,
  so the test would measure a ring that is never drawn. Status: open.
- A127 (M2.22, 24 Sep): "all four tab states" in the done-when is built as the superset,
  every one of the five tabs active in turn with all five bottom-bar labels checked each
  time. That is what actually proves the fix, and it matches how M2.21's sweep works.
  Status: open.
- A128 (M2.22, 24 Sep): the element measured is the `<span>` inside each bottom-bar
  button, not the button itself. The span is the surface the words are painted on, which
  is the thing the bug was about. Status: open.
- A129 (M2.17, 24 Sep): the two `TODO(Q14)` comments in `createCounterSale.ts` and
  `voidCounterSale.ts` are deleted outright rather than reworded to point at D39. D39 is a
  closed decision, not a parked one: nothing is deferred, so there is nothing left for a
  TODO to point at. Status: open.
- A130 (M2.17, 24 Sep): the functions test asserting a counter sale writes nothing to
  `orders/{id}/events` is deleted rather than kept as a guard. Once the path has no rules
  and no type, "a sale does not spontaneously write to an arbitrary untyped path" asserts
  nothing. Status: open.
- A131 (M2.17, 24 Sep): the brief's `orders/{id}/events` bullet is struck through with a
  note naming D39 and M2.17, rather than deleted. Deleting it loses the record that the
  design once said otherwise; leaving it plain invites somebody to rebuild the
  subcollection from the spec, which is the drift D39 exists to prevent. `DECISIONS.md`
  outranks the brief in CLAUDE.md §2, and D28 set the precedent for correcting a doc.
  `docs/milestones/MILESTONE-2-TEST.md` is left untouched: it is a dated snapshot Shefin
  has already read and acted on, so editing it would rewrite history rather than record
  it. Status: open.
- A132 (M2.18, 24 Sep): `check:batch-001` exits 0 when the site matches the record, 1 when
  the only difference is D28's ingredient line and a deploy is owed, and 2 for any other
  difference or a failed redirect. Two kinds of difference deserve two answers: one says
  push the site you already have, the other says the page printed on 22 jars has drifted
  from the record and somebody should look before deploying. Documented in the script's own
  header, where anyone wiring it into CI will find it. Status: open.
- A133 (M2.18, 24 Sep): D28 is detected by stripping percentage annotations from the live
  line with a regex and comparing what is left with the repo line, not by matching batch
  001's ingredient words. The first draft hardcoded "Prawns, dates, vinegar", which would
  have stopped matching on a single reworded comma and sent the script back to crying wolf
  about the one page that is printed on jars. Stripping percentages is what D28 actually
  says, so it keeps working for batch 002 on, where the percentages do appear. Status: open.
- A134 (M2.19, 24 Sep): the batch's own `weightRaw` is the sum of the main ingredients'
  raw weights. Brief §14.1 wrote one raw weight because it assumed one main ingredient;
  with two, the figure that belongs beside the cleaned and cooked weights is the total
  that went into the pot. A one-main recipe gets exactly the number it got before.
  Status: open, and worth Shefin's eye at the M2 break.
- A135 (M2.19, 24 Sep): the line-id scheme moved out of `admin/src/batches/lineIds.ts`
  into `shared/src/batchLines.ts`, so the server derives the same ids the screen reads.
  Two implementations of that rule would be the bug: an id the server writes and an id the
  screen reads have to be the same string, or the money sits in a document nobody edits.
  The screen keeps only what is screen-only, the legacy `lines/main` adoption and the
  orphan report. Status: open.
- A136 (M2.19, 24 Sep): the flat `weightRaw`/`costRaw` pair is still accepted for a recipe
  with one main ingredient or none, and refused for two or more. That shape is exactly what
  lost the dates, so it is refused where it would lose money and kept where it cannot.
  Status: open.
- A137 (M2.19, 24 Sep): the server checks the ingredient names the client sent against the
  recipe it reads inside the transaction, and writes to ids it derives itself, so a stale
  client cannot put a cost on the wrong ingredient. Status: open.
- A138 (M2.19, 24 Sep): `recipeLoading` is threaded from `Batches.tsx` through
  `BatchDetail.tsx`, because a recipe still loading is not the same as a recipe with no
  main ingredient. The form waits rather than sending the wrong shape. Status: open.
