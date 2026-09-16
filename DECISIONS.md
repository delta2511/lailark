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
| D17 | Kitchen discount rights at the counter | **Yes, a small fixed amount**: Kitchen may discount up to a cap with a reason. **Cap ₹50 at launch** (A: the amount is Claude's assumption, Shefin said "yes" to the small-amount option without a figure) | Cap lives in Settings. Owner unlimited with reason |

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

- A1 (setup, 16 Sep): Kitchen discount cap ₹50. Status: open.
- A2 (setup, 16 Sep): `_incoming/` (raw photos and logo drops) is gitignored; assets
  that ship go into `site/public/assets/` or `admin/public/`. Status: open.
- A3 (setup, 16 Sep): the business docs that were loose in the folder root
  (`Lailark_Master_Brief.md`, compliance roadmap, costing, sodium report, label panel,
  nutrition calculator) move to `docs/business/`. Nothing else changes in them. Status:
  open.
