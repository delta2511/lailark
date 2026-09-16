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
