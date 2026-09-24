# Tasks

Three milestones to launch (D29, 23 Sep 2026), each ending in a break where Shefin tests,
then a Fast-follow list that is not started until Shefin says so after launch. The
orchestrator works top to bottom, one task at a time. It stops between tasks only for a
Shefin-checked task or a question (CLAUDE.md §4.4, D34). Model tag in brackets is
the builder model; see `CLAUDE.md` §4. "Brief §n" is
`docs/strategy/lailark-admin-flow-billing-brief.md`; "Flow §n" is
`docs/strategy/lailark-in-site-and-sales-flow.md`.

Tick format: `- [x] M1.3 ... (abc1234)`. Stuck: `- [ ] ⚠ M1.3 ... stuck: <why>`.

Every task's done-when includes: builds clean, lint clean, its tests pass, the tester
subagent reports PASS, `/batch/001` still resolves unchanged on any deploy.

---

## Milestone 1: Foundations

Branch `milestone-1-foundations`. Brief §23 step 1. Shefin's break: both phones sign in
to the admin on staging, `npm run deploy` works, the site still serves v0 exactly.

**Needs from Shefin before the end of M1** (put in QUESTIONS.md if not done):
`lailark` on Blaze, budget alert set, `lailark-staging` created with Firestore in
`asia-south1` and Phone Auth enabled, Firebase CLI logged in on the Mac.

- [x] M1.1 [sonnet] Repo restructure into workspaces. (ed52360) Root `package.json` with
      workspaces `site`, `admin`, `functions`, `shared`. Move `lailark-site/` into
      `site/` as the seed of the Next.js app: the v0 pages become `site/public/batch/001/index.html`
      (byte-identical, served as a static file) and the home page becomes a Next.js page
      that renders the same HTML and the video background. `next.config` with
      `output: 'export'`, `trailingSlash: false`. Move the loose business docs to
      `docs/business/` (DECISIONS A3). Update `firebase.json` `public` to `site/out`.
      Done when: `npm run build` in `site/` produces `out/` and `diff` of
      `out/batch/001/index.html` against the old file is empty; home page renders the
      same copy.
- [x] M1.2 [opus] Firebase config for two hosting sites. (d74c8dc) Create the admin site
      (`firebase hosting:sites:create lailark-admin` on both projects). `firebase.json`
      becomes the array form with targets `customer` (public `site/out`, the existing
      redirects and headers, `/api/**` rewrite to the functions) and `admin` (public
      `admin/dist`, SPA rewrite). `.firebaserc` with project aliases `default`
      (`lailark`) and `staging` (`lailark-staging`) and `targets` for both.
      `firestore`, `storage`, `functions`, `emulators` blocks. Done when: `firebase
      deploy --only hosting:customer --project staging` succeeds and the staging URL
      serves v0; `curl -I https://lailark.in/batch/001` is still 200 on production
      after a production deploy of the same content.
- [x] M1.3 [sonnet] Wire `scripts/deploy.mjs` (already written) into `npm run deploy`. (068933f; staging preview deploy skipped until Q2)
      Test interactive and non-interactive paths, preview channels, and that
      "production" asks for a typed `yes`. Add `npm run check:batch-001`. Done when: a
      preview channel deploy of both targets to staging completes and prints its URLs.
- [x] M1.4 [sonnet] Functions scaffold. (f4ab8ed) TypeScript, `firebase-functions` v2, region
      `asia-south1`, `maxInstances` on every export, ESLint, Vitest. One HTTP function
      `api` mounted at `/api/*` with `/api/health` returning `{ok:true, project}`.
      Emulator runs it. Done when: `curl localhost:5001/.../api/health` and the hosting
      emulator's `/api/health` both return ok.
- [x] M1.5 [opus] Shared package. (31b7bf7) `shared/` with the Firestore document types from brief
      §18.1, the batch and order state enums (brief §8.1, §9.1), money helpers (paise
      integers, `formatINR`), batch maths (`bookable = floor(planned*0.9)`, `half =
      ceil(bookable/2)`, `perPersonLimit = max(1, floor(bookable/4))`, best-before,
      sale-stop date), and the bill number series helpers (`LK/26-27/0001`, resets 1
      April). Unit tests for every helper, including the table in brief §7.1. Done when:
      tests pass and `site`, `admin`, `functions` all import from it.
- [x] M1.6 [opus] Admin auth and roles. (2026fb3; emulator OTP via test helper, see A30) Vite + Preact + TypeScript scaffold in `admin/`,
      `vite-plugin-pwa` with a manifest (name "Lailark", ink and paper colours). Phone
      sign-in with Firebase Phone Auth (reCAPTCHA invisible). `users/{uid}` doc and a
      callable `setRole` that only an existing Owner (or a bootstrap secret on an empty
      `users` collection) can call; role written as a custom claim. Allowlist: the two
      numbers in CLAUDE.md §9 seeded as Owner and Kitchen by a seed script. Sign-in
      denied for any other number with a kind message. Done when: Playwright signs in
      as each number against the emulator (OTP 123456) and sees their role.
- [x] M1.6a [sonnet] Functions deploy packaging. (0e395a5; staging deploy skipped until Q1, Q2) Added by the orchestrator on 16 Sep
      after M1.5: `@lailark/shared` is a private workspace package, so `firebase deploy
      --only functions` cannot `npm install` it in the cloud build. Add a functions
      predeploy (in `firebase.json` or `scripts/deploy.mjs`) that builds `shared/` and
      packs it into `functions/` (for example `npm pack` into `functions/vendor/` with a
      `file:` dependency, restored after deploy) so a deploy from a clean checkout works
      while the emulator, tests and CI keep resolving the workspace link. Done when: a
      temp copy of the packaged `functions/` installs with `npm ci --omit=dev` and loads
      `lib/index.js`; `firebase deploy --only functions --project staging` succeeds once
      staging exists (Q1, Q2), else recorded as skipped.
- [x] M1.7 [sonnet] Admin shell. (70afdcf; installability proven locally, staging URL pending Q2) Bottom bar Today, Sell, Batches, Orders, More (brief
      §17.1). Empty states for each, "More" lists Concerns, Products, Customers, Agent,
      Money, Settings. Design tokens from Flow §10 as CSS variables. Large tap targets.
      Offline-ready: Firestore persistence enabled, an "offline" pill when the network
      is gone. Done when: installable on iPhone Safari and Android Chrome from the
      staging URL, all five tabs render.
- [x] M1.8 [opus] Firestore rules skeleton and tests. (21c69e5; TODO(Q4) ingredients and recipes Owner-only) Deny by default. Keep `notify`
      (create only, same field rules as today) and `config/site` (public read). Role
      helpers reading `request.auth.token.role`. Owner read/write everywhere except the
      money collections (server only). Kitchen: read everything except `documents`,
      `refunds`, `settlements`, `dayCloses`; write only kitchen fields on batches (list
      the fields), and `orders` create for counter sales via a callable (so direct
      client writes to orders are denied). Viewer: read all including Money. Storage
      rules: authenticated admin only. Tests with `@firebase/rules-unit-testing` for
      every row of brief §17.12. Done when: the test matrix passes.
- [x] M1.8a [sonnet] Staging on `tree-quiz-74e04`. (2a8a45f, deployed 17 Sep; sign-in on phones is Shefin's break test)
      after Shefin repurposed a project for staging (D19). Repoint `.firebaserc`, the
      deploy and check scripts and the admin web config to it; build the admin for the
      project it deploys to; cap functions globally; deploy both sites, functions and
      Firestore rules to staging; set the Owner and Kitchen role claims there. Done
      when: both staging URLs serve, `/batch/001` on staging matches the record,
      `/api/health` on staging reports the project, and both numbers carry their role.
- [x] M1.9 [haiku] CI. (00816bb; green on GitHub, run 35195571480) GitHub Actions workflow on pull requests and pushes to
      milestone branches: install, lint, build all three, unit tests, rules tests
      against the emulator. Done when: green on the milestone branch.
- [x] M1.10 [sonnet] Milestone 1 test note (1793ce6) (`docs/milestones/MILESTONE-1-TEST.md`) per
      CLAUDE.md §4.2, then stop.

- [x] M1.11 [opus] Kitchen recipe-edit switch (D22). (9cfd246; rules live on staging) Added on 17 Sep from Shefin's Q4
      answer. Ingredients and recipes readable by all three roles; Owner creates, edits,
      deletes; Kitchen creates and edits only while `settings/permissions.kitchenCanEditRecipes`
      is `true` (Owner-only switch, off by default); nobody but the Owner deletes. Shared
      constant and helper, rules tests for every switch state, seed writes the switch off
      if missing, rules deployed to staging. Done when: the rules tests pass for every
      switch state and staging has the new rules.
- [x] M1.12 [opus] Sign-out left the phone box unusable. Found by Shefin on his phone on
      18 Sep: after signing out, the phone input took no characters until the page was
      reloaded. Cause: for one render the app was signed out but still on the signed-in
      step, fell through to the sign-in screen and drew the code form, so Preact reused
      the same input and left `maxlength="0"` on it. Fixed with keyed forms, a blank
      screen for that in-between render, state reset before any cleanup that can throw,
      a reCAPTCHA anchor per verifier with its leftovers removed, and an error boundary.
---

## Milestone 2: Kitchen and counter

Branch `milestone-2-kitchen-and-counter`. Brief §23 steps 2 and 3. Shefin's break:
batch 001 entered with its real numbers; a cash sale at the door produces a numbered
bill PDF.

M2.10 and M2.11 moved to Fast-follow (D29, 23 Sep 2026).

- [x] M2.1 [opus] Ingredients and recipes. (732c4b5; Q7 answered 19 Sep, doc corrected) Admin screens under Products for
      `ingredients` and `recipes` (brief §18.1). Recipe engine in `shared/`: ingredient
      order and percentages under the basis switch (A, B, C from the label basis doc,
      default B), allergen line from tags, nutrition per 100 g from ingoing nutrients
      divided by finished weight, storage and claims text. Tests reproduce the worked
      example table in the label basis doc §4. Kitchen sees every ingredient and recipe read-only, and gets
      the edit inputs only when the Owner's switch is on (D22).
      Done when: the batch 001 recipe produces
      Prawns 35%, Dates 23% on basis B.
- [x] M2.2 [sonnet] Products screen. (4e06456; staging seeded 19 Sep, HSN codes filled per D26) Heroes and pipeline (Flow §2), photos to Storage
      (note photo last), HSN, prices, jar size, shipping rule (built, off), Koorka
      season window, custom lines with set amounts (brief §17.8). Every number editable
      in place with an undo toast (brief §17.1). Done when: the four heroes and three
      pipeline products exist on staging.
- [x] M2.3 [opus] Batch state machine. (d81cf56; TODO(Q11), TODO(Q12), TODO(Q13)) Callable `transitionBatch` implementing brief
      §8.2 exactly: who may call each transition, what it asks for, what it computes
      (bookable, half, limits, best before, sale stop, surplus), what it flags. Batch
      number allocation from a `counters/batch` transaction, global, zero-padded.
      Automatic transitions (half reached, full, in stock, sold out, archived) as
      Firestore triggers. Enforces D15 (one open batch per product). Race and
      permission tests. Done when: a scripted batch walks Draft → Archived on the
      emulator with every side effect asserted.
- [x] M2.3a [opus] Shefin's answers folded in (0b0dde8): the printed number stamped at
      bottling with a fixed internal reference before it (D21c), pausing from every
      selling or cooking state (D23), and the three customer messages drafted and
      editable in settings (D24).
- [x] M2.4 [sonnet] Batches screens. (04cc083) List cards with state chip, fill bar with the half
      mark, clock, approval badge. Detail per brief §17.4 with the one big state button,
      the three weights, per-ingredient actuals prefilled from the recipe with drift
      warning, costs per batch, P&L placeholder. Done when: Playwright walks a batch
      through the kitchen transitions as Kitchen and the owner transitions as Owner.
- [x] M2.5 [opus] Approvals and Today v1. (64c8302) `approvals` collection (brief §18.1),
      created by the half and full triggers and by kitchen photo updates (D5). Today
      screen "Waiting on you" section with Yes / Not yet with reason / Edit then yes.
      Clocks section (5-day and 3-day). Done when: a half-reached batch shows on Today
      and "yes" moves it to Sourcing with the message recorded as sent-pending (actual
      sending arrives in M5).
- [x] M2.6 [sonnet] Timeline and audit. (304e66e) `audit` collection written by a wrapper every
      client write and every function write goes through. Timeline component on batch,
      order, customer. Undo reads the `before` from audit for 8 seconds. Done when:
      editing a batch field, undoing it, and seeing both in the timeline works.
- [x] M2.7 [haiku] Seed batch 001. (a225139) Script that writes the prawns-dates product, its
      recipe from the label basis doc placeholders (marked estimated), and batch 001
      with every real number from the v0 handoff §1 and §2 as an Archived batch with
      22 bottled jars, 0 paid online. Runs against the emulator and staging. Done when:
      the batch 001 screen shows the printed facts.
- [x] M2.8 [opus] Counter sale (POS). (99979e2) Callable `createCounterSale` implementing brief
      §7A.1 and §7A.6: customer by phone (creates `customers/{phone}` if new), product
      or open-batch line or custom line, quantity, price prefilled, discount within the
      role's rights (D17, cap in Settings), fulfilment, payment method cash / UPI to
      account / payment link (link itself arrives in M3, here it creates an Awaiting
      payment order), consent ticks, stock taken in one transaction with a clear
      "someone just bought the last one" failure. Void same day before bill sent. Sell
      screen in admin, one tap from the bottom bar. Done when: Playwright sells a jar
      for cash as Kitchen and the order, customer, batch count and audit all update.
- [x] M2.9 [opus] Documents and numbering. (55edcc6; D35, D36, D37, D38 asked and answered during the task) `counters/{series}` transaction issuing
      `LK/26-27/0001` style numbers (brief §13.3), `documents/{number}` with the
      GST-ready fields at zero, PDF generation in a function (brief §13.2 content, the
      design tokens, A5), stored in Storage, short-lived signed URL. Receipt for
      open-batch payments, bill for in-stock and counter sales, refund and credit note
      shapes ready but unused. Series reset on 1 April tested with a fake clock. Done
      when: a counter sale produces a bill PDF viewable from the order screen.
- [x] M2.12 [sonnet] Milestone 2 test note, then stop. (db3b68c)

**Fixes from Shefin's Milestone 2 test, 23 Sep 2026.** Appended to the milestone per
CLAUDE.md §4.2 step 3. These are built before the merge to `main`.

- [x] M2.13 [opus] The two-main-ingredient cost collision. (fd8852e; Q16 raised) `lineIdFor` in
      `admin/src/batches/CookingActuals.tsx:47` returns the literal `"main"` for every
      line flagged `isMain`, so a recipe with two main ingredients stores both under one
      id: batch 001 flags prawns and dates (D28), and typing a cost on one overwrites
      the other. Found by Shefin at the break. Give every line its own id, keep whatever
      `isMain` is really for, and work out what happens to actuals already written under
      `"main"` (a migration, or a read that falls back, decided and justified). Costs
      feed the batch P&L, so this is money. Done when: a recipe with two main lines
      takes two independent weights and two independent costs, a test covers exactly
      that shape, and any existing `"main"` line is accounted for rather than orphaned.
- [x] M2.14 [sonnet] The undo toast. (4d5dad5; A79 superseded) Shefin edited a batch cost, saw the change reach
      the timeline, and never saw an undo button. M2.6's done-when says editing a field,
      undoing it and seeing both in the timeline works, and its tests pass, so either
      the toast is not firing on these fields or it is firing somewhere he was not
      looking. Reproduce first, then fix. Done when: editing a cost on the batch detail
      screen shows the undo toast for its 8 seconds, tapping it restores the old value,
      and both the edit and the undo are in the timeline.
- [x] M2.15 [sonnet] (Shefin checks) A required field that blocks saving must be (5e881e4; Shefin checked on his phone 23 Sep)
      findable. Shefin could not complete a counter sale because the confirm-new-customer
      control had not been tapped, and nothing on the screen made that obvious. Brief
      §17.1. This is read at a busy counter with a customer waiting, so it is worth
      doing properly: the blocked control says what is missing, and the thing that is
      missing is visibly marked. No red-on-white alarm; follow the design system. Done
      when: saving a sale with anything outstanding points at the outstanding thing.
- [x] M2.16 [opus] (Shefin checks) Price in stock, price for an open batch and the limit (c928e82; D44 asked and answered during the task; Shefin checked on his laptop 24 Sep)
      per person editable in place on every batch detail screen, in any state, with no
      lock (D40). Two things this must hold to: an order already placed keeps the price
      it was actually charged, so nothing is ever repriced retrospectively; and editing
      a price on an Archived batch moves that batch's P&L, which is said plainly on the
      screen rather than prevented. Prices still cannot exceed the ₹649 MRP. Undo toast
      and timeline like every other in-place edit. Done when: all three are editable on
      batch 001, a paid order's recorded price is provably unchanged by editing the
      batch, and the MRP ceiling is tested.
- [x] M2.17 [sonnet] Drop `orders/{id}/events` (D39). `audit` becomes the only history.
      Remove the subcollection's rules, its `OrderEvent` type, its rules tests and its
      seed coverage, and check nothing reads it. Done when: the rules tests pass without
      it and no reference to it survives outside `DECISIONS.md`.
- [x] M2.18 [haiku] `npm run check:batch-001` says which side is ahead. It currently
      reports "body differs" with two byte counts, which reads like a regression when
      the truth is usually that the repo is ahead of the live site and a deploy is
      owed: that is exactly what it said at the M2 break, where the only difference was
      D28's ingredient line. Print the differing lines and name which side carries each.
      Done when: running it today says the repo is ahead and names D28's line.
- [x] M2.19 [opus] Sourcing to Cooking asks for every main ingredient (D41). Brief §14.1
      assumes one main ingredient; batch 001 has two and only the first was recorded, so
      the dates were never costed at that step. One row per main line, each naming its
      ingredient, weights and costs in paise, written to the same per-ingredient line
      documents M2.13 established. Done when: batch 001's sourcing step asks for prawns
      and for dates by name, both land on their own line documents, and a recipe with one
      main ingredient behaves exactly as it does today.
- [x] M2.21 [sonnet] The Undo button on every toast is invisible. (7ad125a; a second dark-surface button found, M2.22) Found by Shefin on
      24 Sep while checking M2.16. `button.quiet` (`admin/src/styles/app.css:97`, element
      plus class) outscores `.undo-toast-button` (line 542, class only), so the button
      keeps `background: transparent` and `color: var(--ink)` on a toast whose background
      is also `var(--ink)`: #17150f on #17150f, contrast 1:1. The word "Undo" has been
      unreadable on every undo toast in the admin since M2.6 built it, so this is not an
      M2.16 regression. The button is still there and still works, which is why no test
      caught it: nothing asserts it can be seen. Done when: the label is legible on the
      toast, the fix does not reach for `!important`, and a test fails if the button's
      colour ever matches its background again.

- [x] M2.22 [sonnet] The Sell button's label is invisible while you are on the Sell tab.
      Found by M2.21's sweep on 24 Sep, with the contrast helper that task built, and
      confirmed by reading the rules. `.bottom-bar-item-sell` (`app.css:247`, one class)
      sets `color: var(--paper)` on `background: var(--ink)`; `.bottom-bar-item.active`
      (line 240, two classes) then overrides the colour to `var(--ink)`, so the word
      "Sell" renders #17150f on #17150f, contrast 1:1, exactly while that tab is the one
      you are on. `.bottom-bar-item-sell.active` (line 256) already exists, ties on
      specificity and sits later, but sets only `text-decoration` and `outline`, never
      colour. This is the button Sumayya taps most, at the counter. Done when: the label
      is legible on the Sell tab and on every other tab, the contrast test covers the
      bottom bar in all four tab states, and no `!important` is used.

- [x] M2.20 [opus] Value checks on the per-ingredient actuals (D42). Added by the
      orchestrator on 23 Sep from the M2.14 tester's finding. `batches/{ref}/lines/{lineId}`
      allows create and update on `isStaff()` alone and never looks at the number, so
      `qtyActual` and `costActual` are guarded by the screen only: a seeding script, a
      function with a bug or a signed-in staff account writing straight to Firestore can
      store a negative, a fractional paise or an absurd cost. A84 already checks the
      batch's own costs and a product's two prices in rules this way; the line documents
      were missed. Also: `rupeesToPaise` silently rounds, so `12.345` saves as `1235`
      rather than being refused. These two numbers are the largest inputs to the batch
      P&L, so this is money. Done when: rules tests prove a negative, a fractional and an
      over-ceiling cost are all refused server side, `12.345` is refused rather than
      rounded, every value the screen legitimately writes today still passes, and the
      existing actuals tests still pass.

- [x] M2.23 [sonnet] The server can still write an over-ceiling actual. Found by M2.20's
      builder, 24 Sep. M2.20 closed the client path: `firestore.rules` now caps
      `costActual` at ₹1,00,000 and `qtyActual` at 100 kg on `batches/{ref}/lines/{id}`.
      But `transitionBatch`'s Sourcing to Cooking step writes those same two fields through
      the Admin SDK, which bypasses rules entirely, and its own validators
      (`positiveNumber`, `paise` in `functions/src/batches/transitions.ts`) have no upper
      bound at all. Nothing it writes today breaks the ceilings, so this is defence in
      depth rather than a live bug, but it is the last unguarded path into the two numbers
      that most move a batch P&L, and M2.19 just made that path write one document per main
      ingredient. Use the same two constants from `shared/src/batchLines.ts` that the rules
      restate, so there is one statement of each ceiling. Done when: the callable refuses a
      cost above the ceiling and a weight above it, with a message naming the ingredient,
      proven by a functions test; every value it legitimately writes today still passes;
      and the ceilings are not restated by hand a third time.

---

## Milestone 3: Launch

Branch `milestone-3-launch`. Replaces the old Milestones 3, 4 and 5 for launch (D29, 23
Sep 2026). Brief §23 steps 4, 5, 6 and 12, cut to what going live needs. Batch 002 sells
in stock after bottling; batch 003 is the first pre-order batch, so pre-order ships at
launch (D30). Shefin's break: buy an in-stock jar on staging with a Razorpay test card
and see the bill on the order link; book a jar in an open batch and watch the half-fill
approval land on Today; pack and ship an order by India Post entry; record a refund;
read the policy pages; walk a batch by hand from the script in the test note. Then
production.

Customer messages at launch are sent by hand (D32). Wherever a task below says a message
is sent, it means: the drafted text is shown with a prefilled `wa.me` link per
recipient, and the Owner or Kitchen ticks it sent. Nothing is sent by the system.

**Needs from Shefin:** Razorpay test keys in Secret Manager on staging (the task prints
the exact commands), Razorpay webhook URL registered in the test dashboard. Live keys
and the live webhook before the production deploy.

- [x] M3.1 [sonnet] (Shefin checks) Site design system in Next.js. (1a0d4ba; D45 asked and answered during the task; Shefin checked 24 Sep) Tokens from Flow §10, the three
      motions with `prefers-reduced-motion`, the jar-count marks component, layout,
      header with the lark mark, footer with the legal line and the Orders link. Done
      when: a Storybook-free demo route renders every primitive and Playwright checks no
      external requests.
- [ ] M3.2 [opus] Home page. Order and copy from the story doc §5 and the flow doc,
      video hero as in the video doc, the abroad line (brief §11.6) with a `wa.me` link,
      the "no stock, only leftovers" sentence. Copy written by the builder, reviewed by
      a second opus subagent against the story doc §3 (held-back list) and §4 (voice).
      Done when: the review passes and Lighthouse mobile performance is above 85 on a
      throttled 4G profile.
- [ ] M3.3 [sonnet] (Shefin checks) `/api/counts` function (brief §19.2): per product and per open
      batch, cached 15 s at the CDN. Product pages `/pickles/<slug>` built from
      `products` at build time (exported JSON) with live counts fetched client-side,
      in-stock and open-batch cards per Flow §3, Legal Metrology fields (brief §20.3),
      shipping line per the switch, shelf-life stop hides Buy. Done when: the four hero
      pages render with counts from the emulator and degrade to "count unavailable"
      when the API is down.
- [ ] M3.4 [sonnet] (Shefin checks) Batch pages. **D21c changes this task**: `/batch/<nnn>` exists only from bottling and is always a record, so there is no open-batch view here. An open batch is booked and watched on its product page (M3.3), which carries the live counts, the promise from brief §7.4 and the share link. `/batch/[nnn]` from `site/content/batches/<nnn>.json`
      (the record) with the v0 batch 001 page as the template for the record view, and
      an open-batch view (bookable, paid, to half, ₹599, the promise from brief §7.4,
      no cancellation line). `001.json` seeded from the handoff. Done when: the built
      `/batch/001` HTML is equivalent to v0 (same copy and facts, passes the v0
      acceptance checklist, and its ingredient line carries no percentages: D28) and
      `/batch/002` renders an open batch. Record pages show ingredient percentages from
      batch 002 on (D28).
- [ ] M3.5 [opus] Checkout. Callable `createCheckout`: validates lines against the
      per-person limit across the customer's orders in the batch, pincode against the
      serviceable list and the product's shipping rule, takes a 15-minute hold in a
      transaction, creates the Razorpay order with the order id in notes, returns the
      checkout payload. Checkout page on the site (name, WhatsApp number, Indian
      address, pincode, email optional, consent ticks per brief §5), Razorpay Checkout
      script loaded only here. Done when: race test (two checkouts, one jar) and the
      hold expiry sweep pass; a test payment completes on staging.
- [ ] M3.6 [opus] Razorpay webhook and reconciliation, trimmed for launch (D29). HTTP
      function verifying the signature, `webhookEvents` dedupe, `payment.captured` → hold
      becomes Paid, bill or receipt issued (M2.9), order events written;
      `refund.processed` matched to an order (M4.5 records it); scheduled 15-minute
      reconciliation for pending orders. Brief §9.2, §21.1. The daily settlement pull is
      fast-follow (M3.6b). Done when: replaying the same webhook twice changes nothing the
      second time, and a payment with no webhook is recovered by the reconciliation job.
- [ ] M3.8 [opus] Open batch mechanics end to end. Brief §7: 90% cap, per-person limit
      in the transaction, half-reached and full triggers to approvals (M2.5), 5-day and
      3-day clocks, booking closes at Cooking, surplus to in-stock at Bottled, share
      link `?s=<shareCode>` recorded on orders, private order link `/o/<token>` page on
      the site listing the order and its documents. Done when: a seeded staging batch
      fills through the site and every customer-facing message is a pending approval,
      none sent.
      Manual sending (D32): on "yes" in Today, the approval shows the drafted message
      and one prefilled `wa.me` link per booked customer, each ticked when sent. The
      approval closes when all are ticked or the Owner closes it.
- [ ] M3.9 [sonnet] (Shefin checks) Orders screen in admin. Brief §17.5 groups, filters, search, order
      detail with lines, jar numbers, payment, documents, kitchen note, timeline.
      Actions that exist so far. Done when: every order created in M2 and M3 is
      findable and readable.
      Each order shows a prefilled `wa.me` link that sends the customer their private
      order link with the bill (D32).
- [ ] M4.1 [sonnet] (Shefin checks) Packing and India Post. To pack list by batch, jar numbers assigned
      in payment order, Packed with editable packing cost (default from Settings),
      India Post consignment number entry → Shipped, tracking link built from it,
      Delivered by hand. `shipments` collection. Brief §11.1, §11.3. Done when: an order
      walks To pack → Delivered as Kitchen.
      Packing cost default is read from the settings document (the Settings screen is
      fast-follow). On Shipped, the order shows the shipped message from brief §15.7
      with a prefilled `wa.me` link for the Kitchen to send by hand (D32).
- [ ] M4.5 [opus] Refund recording, trimmed for launch (D31). Brief §12.3, done from the
      order screen (Concerns are fast-follow): record a refund made in the Razorpay
      dashboard (matched from the `refund.processed` webhook in M3.6), by UPI with its
      reference, or in cash with a note. Refund note or credit note document issued
      (M2.9); jar returns to the count if not packed; the unreturned gateway fee is
      recorded on the order for the batch P&L later. Hold-to-confirm on the record
      button. No refund is started from the admin through the Razorpay API, and there is
      no 6-month guard at launch (M4.5b). Done when: three refunds (dashboard, UPI, cash)
      are recorded on staging and the documents exist.
- [ ] M5.7 [opus] Policy pages: Orders (D2 wording), shipping, terms, privacy, contact
      with grievance officer, each versioned in `policyVersions` and the version
      recorded on every order. Copy reviewed against the story doc voice rules. Brief
      §10.4, §20.4, §20.6. Done when: the pages are live on staging and linked from
      the footer.
- [ ] M5.9 [opus] Hardening, trimmed for launch (D29). App Check on callables and
      Firestore, rate limits on checkout and counts, `maxInstances` audit, Firestore
      scheduled backups and PITR enabled on production, uptime checks on `/`,
      `/batch/001`, `/api/counts` alerting to Shefin's phone, budget alert doc. Brief
      §22. The restore drill is fast-follow (M5.9b). Done when: the site and admin e2e
      pass on staging with App Check enforced, backups and PITR show as on, and a test
      uptime alert is configured to fire (Shefin confirms it arrived at the break).
- [ ] M5.11 [sonnet] Launch checklist and Milestone 3 test note, then stop.
      `docs/milestones/LAUNCH.md` from brief §23: what the build has ticked and what only
      Shefin can tick (live Razorpay keys and webhook, production deploy, the first real
      batch). `docs/milestones/MILESTONE-3-TEST.md` per CLAUDE.md §4.2, including a
      step-by-step manual walkthrough on staging that stands in for the fast-follow
      Playwright e2e (open a batch, sell at the counter, buy online, fill to half,
      approve and send by hand, cook, bottle, pack, ship, deliver, refund one), and the
      manual workarounds from D33. Print the production deploy commands; do not run
      them. Then stop.

---

## Fast-follow: after launch

Not in the launch scope (D29). **Do not start any task here until Shefin says so after
launch.** They are grouped into milestones then. Each task keeps its original text;
"Until then" is what Shefin and Sumayya do by hand (D33). The old M3.10 and M4.11 test
notes are folded into M5.11.

- [ ] M2.10 [sonnet] Offline counter drafts. Brief §7A.4: a sale started with no
      network saves as a local draft (IndexedDB), finalises through
      `createCounterSale` when back online, flags if stock ran out. Done when: Playwright
      with network off saves a draft and it finalises when the network returns.
      Until then: sell when there is signal, or note the sale on paper and enter it later.
- [ ] M2.11 [sonnet] Day close. Brief §7A.3: card on Today on any day with counter
      sales, totals by method, jars by batch, cash counted, difference, the UPI-to-account
      list. `dayCloses/{date}`. Done when: a day with two cash sales closes correctly.
      Until then: count the cash against the Orders screen at the end of the day.
- [ ] M3.6b [sonnet] Daily settlement pull to `settlements` (brief §9.2, §21.1), split
      out of M3.6. Until then: check settlements in the Razorpay dashboard.
- [ ] M3.7 [sonnet] Razorpay QR at the counter and Payment Links. QR for the exact
      amount shown in the Sell screen, closes the sale on webhook. Payment Link created
      from the Sell screen for phone / WhatsApp / abroad orders, expiry from Settings
      (24 h), jars held until expiry, order Awaiting payment. Done when: both routes
      move a jar free → paid on staging and expiry releases it.
      Until then: the counter takes cash or UPI to Lailark's account (M2.8); phone,
      WhatsApp and abroad customers are sent to the site. The Razorpay QR half of D10 waits.
- [ ] M4.2 [opus] Shiprocket. Booking from the order screen through the API, label to
      Storage, cost filled in, tracking webhook → shipment events → order state,
      weekly serviceable pincode refresh into `settings/pincodes`. Default courier
      setting. Keys in Secret Manager. Done when: a mocked Shiprocket walks an order
      Packed → Delivered; the real API is exercised once on staging when keys exist
      (else marked pending in the test note).
      Until then: India Post only (M4.1).
- [ ] M4.3 [sonnet] Packing list per batch as a shareable image and printable page.
      Done when: the image for batch 001 downloads from the batch screen.
      Until then: read the packing list off the Orders screen.
- [ ] M4.4 [opus] Concerns. `concerns` collection and screen per brief §12.1, §17.6:
      every type, clock, due end of day, 6 pm second nudge (push, since WhatsApp
      arrives in M5), outcomes with money. Raised by: yield shortfall (M2.3), technical
      payment cases (M3.6), delivery problems (M4.1, M4.2), the 30-day and 140-day
      checks (D4), RTO. Missed clocks counted. Done when: each raiser creates the right
      Concern on the emulator and Today shows them oldest first.
      Until then: problems are handled on WhatsApp by hand; reconciliation flags
      payment problems on the order; the D4 30-day and 140-day checks are done by eye on
      the batch list.
- [ ] M4.5b [opus] Refund through the Razorpay API from the order screen, with the
      6-month guard ("send by UPI instead") and hold-to-confirm, split out of M4.5.
      Until then: refund in the Razorpay dashboard and record it (M4.5).
- [ ] M4.6 [sonnet] RTO reship at customer's cost: Concern outcome "reship" creates a
      payment link for the shipping amount and a new shipment on payment; returned jar
      inspection result recorded, write-off if needed. Brief §11.4. Done when: the
      flow completes on the emulator.
      Until then: each RTO is handled by hand.
- [ ] M4.7 [sonnet] Scheduled checks: hold sweep, shelf-life stop warning at 14 days,
      in-stock order not packed by noon of dispatch day, production clock at one day
      left, 30-day and 140-day batch checks, day close reminder. Brief §16. Off switch
      for scheduled jobs in Settings. Done when: each job is unit tested with a fake
      clock.
      Until then: a short daily look at Today and Orders. The hold sweep already ships
      in M3.5.
- [ ] M4.8 [sonnet] Batch P&L. Trigger keeping `batches/{nnn}.pnl` current from
      orders, refunds, shipments and batch costs (brief §14.1, §14.2); batch screen P&L
      section; the all-batches one-line-each view. Done when: the batch 001 P&L matches
      a hand calculation in the test.
      Until then: a spreadsheet per batch.
- [ ] M4.9 [opus] Money screen and monthly export. Brief §13.5, §17.10: bills, credit
      notes, receipts, refunds, day closes, advances per batch, settlements with
      reconciliation flags, state-wise register, financial-year turnover against ₹12
      lakh. Monthly export as an xlsx plus a zip of PDFs, produced by a function into
      Storage. Owner and Viewer only. Done when: a sample month exports and opens.
      Until then: a manual ledger while GST is off and turnover is under ₹12 lakh.
- [ ] M4.10 [sonnet] Customers screen. Brief §17.7 including consent history, share
      link performance, remove from marketing, export and delete data (bills retained).
      Done when: a customer is exported and deleted on the emulator with bills kept.
      Until then: data export or delete requests are handled in the Firebase console.
- [ ] M5.1 [opus] WhatsApp Cloud API layer. Webhook function (verify token, signature,
      `webhookEvents` dedupe, store inbound in `conversations/{phone}/messages`, 200
      fast, enqueue a task). Send helpers for text, template with parameters, document
      with a signed URL, image. The 18 templates from brief §15.7 defined as code with
      their parameters, plus a script that prints them for submission to Meta. PII
      redaction in logs. Done when: a mocked inbound message round-trips and a template
      send is asserted.
      Until then: Shefin and Sumayya answer customers on WhatsApp Business themselves.
- [ ] M5.2 [opus] Agent worker. Task-queue function running the agent on each inbound
      message: model call through OpenRouter, tools (look up the customer's orders and
      batches, tell the batch stage in words using the timing text setting, change
      address before packing, give the cancellation reply and raise a Concern, gather an
      abroad order into a draft sale, raise call-back, hand off), guardrails from brief
      §15.2 as hard checks not prompt hopes, conversation memory summary. Never
      promises a date, never mentions refunds unprompted, never claims to be a person.
      Eval set of 30 conversations with expected behaviour, run in CI. Done when: the
      eval passes.
      Until then: same as M5.1.
- [ ] M5.3 [sonnet] Approval-gated sends. Approvals (half, full, batch open, back in
      stock, kitchen photo updates, delay/shortage) send their template on "yes";
      automatic templates (receipt, bill, packed, shipped, delivered, check-ins, ready
      for collection, address needed, refund recorded) fire from their events. Brief
      §15.4, §16. Done when: every row of the notifications matrix is covered by a
      test.
      Until then: approve on Today, then send by hand (D32).
- [ ] M5.4 [sonnet] Follow-ups and check-ins per brief §15.5, once each, gentle opt-in
      ask once. Done when: scheduled tests pass.
      Until then: none.
- [ ] M5.5 [sonnet] Push to admin phones through Cloud Messaging for every Owner and
      Kitchen row of the matrix. Done when: a push arrives on the installed PWA on
      staging.
      Until then: check Today.
- [ ] M5.6 [opus] Batch page publishing (ST6). Admin Publish button → function commits
      `site/content/batches/<nnn>.json` via the GitHub API → workflow `publish-batch.yml`
      builds `site/` and deploys `hosting:customer` to production → function polls the
      run and shows the result in the batch screen. Label data for the printer
      generated from the same record. Done when: `/batch/002` from a staging record
      matches its label data character for character, percentages included (D28: batch
      001's page has none, batch 002 onward has them).
      Until then: add the batch record JSON to `site/content/batches/` and deploy with
      `npm run deploy` (Claude Code can do this as a small task on request).
- [ ] M5.8 [sonnet] Settings screen complete per brief §17.11: GST switch with GSTIN
      and effective date (bills switch format from that date, tested), shipping switch
      with the card text changing, discount cap, default courier, packing cost, cut-off
      and non-working days, hold minutes, link expiry, shelf-life rule, gas and power,
      key status (never the keys), bill prefixes, users and roles, scheduled jobs off
      switch. The Owner's "Kitchen may edit ingredients and recipes" switch (D22).
      Every change audited. Done when: flipping GST on produces a correct tax
      invoice on the emulator and flipping it off produces a plain bill.
      Until then: defaults in the settings document, GST off.
- [ ] M5.9b [opus] Restore drill run once on staging and documented with its output
      (brief §22), split out of M5.9. Until then: backups and PITR are on, untested.
- [ ] M5.10 [sonnet] Full staging walkthrough as a Playwright e2e: open a batch, sell
      at the counter, buy online, fill to half, approve, cook, bottle, pack, ship,
      deliver, refund one, close the month. Brief §23 step 12. Done when: it passes on
      staging.
      Until then: Shefin walks a batch by hand from the Milestone 3 test note.
