# Milestone 1 test note

Milestone 1 is the foundation: the repo split into three deployables (customer site,
admin PWA, functions), a shared code package, phone sign-in with roles, Firestore
rules, a staging project to test against, and CI on GitHub. No kitchen or sales
features yet. The one thing to test first: **both phones signing in to the admin on
staging.** Everything else is secondary.

## 1. What was built

- **M1.1** (ed52360). Split the repo into workspaces: `site`, `admin`, `functions`,
  `shared`. Moved the old `lailark-site/` into `site/` as a Next.js app. `/batch/001`
  moved unchanged into `site/public/batch/001/index.html`. The home page is now
  rendered by Next.js with the same copy as before, plus a jar video background.
- **M1.2** (d74c8dc). Set up two Firebase Hosting sites: `customer` (lailark.in) and
  `admin` (its own `.web.app` address, no custom domain). Rewrote `firebase.json` and
  `.firebaserc` for both. Redeployed production once with the new Next.js home page.
- **M1.3** (068933f). Wired up `npm run deploy`, both interactive and with flags, with
  preview channels and a typed "yes" gate before any live production deploy. Added
  `npm run check:batch-001` to verify the printed jar page never changes.
- **M1.4** (f4ab8ed). Scaffolded the functions project: TypeScript, region
  `asia-south1`, one function `api` with `/api/health`.
- **M1.5** (31b7bf7). Built the shared code package: Firestore document types, batch
  and order state names, money helpers (always integer paise), batch maths (bookable
  count, half mark, per-person limit), and the bill numbering scheme. Used by all
  three apps.
- **M1.6** (2026fb3). Built the admin app: Preact, Vite, installable PWA. Phone
  sign-in with Firebase Phone Auth. A `setRole` function that sets Owner, Kitchen or
  Viewer as a claim on the account. Any number not on the list is refused with a plain message.
- **M1.6a** (0e395a5). Fixed a packaging problem: functions cannot install the shared
  package straight from the repo when deploying, so the deploy step now packs it into
  a small bundled copy first, then puts the normal setup back afterwards.
- **M1.7** (70afdcf). Built the admin's five-tab shell: Today, Sell, Batches, Orders,
  More, with empty placeholder screens for each, an offline indicator, and the ink and
  paper look.
- **M1.8** (21c69e5). Wrote the Firestore and Storage security rules: nothing is
  allowed by default, then opened up by role (Owner, Kitchen, Viewer) exactly as the
  brief specifies, with a full test suite.
- **M1.8a** (2a8a45f). Stood up the staging project on `tree-quiz-74e04` (the project
  Shefin repurposed), deployed both sites, the functions, and the rules, and set
  Shefin and Sumayya's roles there.
- **M1.9** (00816bb). Added GitHub Actions: every push and pull request on a milestone
  branch runs install, lint, build, and every test suite.

## 2. Where things live now

| URL | Project | What it shows |
|---|---|---|
| `https://lailark.in` | production (`lailark`) | Customer site, live |
| `https://lailark.web.app` | production (`lailark`) | Same customer site, alternate address |
| `https://lailark-admin.web.app` | production (`lailark`) | Admin hosting site exists, nothing deployed to it yet |
| `https://tree-quiz-74e04.web.app` | staging | Customer site, a copy for testing |
| `https://tree-quiz-74e04-admin.web.app` | staging | Admin PWA, live, sign-in ready for your phone test |

Not deployed anywhere yet: production functions, production admin, production
Firebase Authentication (not turned on). Staging has no Storage bucket yet.

## 3. How to test

### A. Both phones, on the staging admin (do this first)

For each phone (yours and Sumayya's):

1. Open `https://tree-quiz-74e04-admin.web.app` in Safari on iPhone, or Chrome on
   Android.
2. Type the 10-digit number.
3. Tap Send code.
4. Enter the code: the code you set for that test number in the console, or the SMS
   code if that number is not a test number.
5. Expect the Today screen with "Nothing waiting on you."
6. Tap each of the five bottom tabs: Today, Sell, Batches, Orders, More.
7. Tap More. Shefin should see six rows, including Money. Sumayya should see five
   rows, with no Money.
8. Tap Settings. Check the name, phone number, and role shown (Owner or Kitchen).
9. Install to the home screen. On iPhone: Share, then Add to Home Screen. On Android:
   the browser menu, then Install app.
10. Reopen the app from its home screen icon.
11. Turn on flight mode. Expect an "Offline" pill to appear.
12. Turn off flight mode. Expect the pill to go away.
13. From More, tap Settings, then sign out.

Also test a number that is not on the list (a friend's number, or a third test
number). Expect: "This number is not on the Lailark admin list. If it should be, ask
Shefin." and the app signs that number back out. Firebase still creates an empty
account for that number on staging (see A31); you can delete it in the console under
Authentication, Users.

### B. Laptop: the customer site never changed

```bash
npm run check:batch-001
```

```bash
npm run check:batch-001 -- --project staging
```

Open `https://lailark.in/batch/001` and compare it to a printed jar by eye.

Open `https://www.lailark.in`. Expect a certificate warning in the browser. This is
known and not fixed yet (see Q3 below).

### C. Laptop: the deploy command

```bash
npm run deploy
```

Answer the prompts: `customer` (or `both`), then `staging`, then `preview`, then press
enter at the channel name prompt to accept the default. Open the preview URLs it
prints.

```bash
npm run deploy -- --target customer --project production --live
```

When it asks you to type `yes`, type anything else. Expect it to stop without
deploying.

A real production deploy is not part of this test. Do not type `yes` unless you mean
to put something live on `lailark.in`.

### D. Laptop: everything running locally

```bash
npm install
```

```bash
npm test
```

This takes about a minute and a half.

```bash
npm run emulators
```

Open `http://127.0.0.1:4000` in a browser and leave the emulators running.

In a second terminal:

```bash
npm run seed:users -- --emulator
```

```bash
npm run dev --workspace admin
```

Open the Vite URL it prints. Sign in with the Owner number. For the code, open
`http://127.0.0.1:4000/auth` in another tab and read the six-digit code shown for that
sign-in there.

### E. GitHub

Open `https://github.com/delta2511/lailark/actions/runs/35195571480` and check every
step is green.

## 4. Known unfinished

- The production admin cannot sign in yet. Four things are needed first:
  Authentication is not turned on for the `lailark` project; `lailark-admin.web.app`
  is not yet an authorised domain; the admin app itself is not deployed to production;
  and the functions are not deployed to production, which first needs the `setRole`
  bootstrap secret set there and the same artifact cleanup policy staging has.
- Staging has no Storage bucket yet, so nothing that uploads a photo or a document
  will work there.
- Staging has no `users/{uid}` documents yet. The admin shows Shefin and Sumayya's
  names from their Auth accounts instead.
- `www.lailark.in` still shows a certificate warning (Q3, not fixed, needs a console
  step from Shefin).
- The root `npm run dev` command only runs the site's dev server for now, not the
  emulators and admin together (A6).
- The admin's JavaScript bundle is 616 KB before compression (181 KB gzipped), almost
  all of it the Firebase SDK.
- There is no App Check and no rate limiting yet. That is Milestone 5 (M5.9).
- If an Owner is demoted to another role, their phone can keep acting as Owner for up
  to an hour, because the check does not look at revoked tokens on every request
  (A32).

## 5. Open questions

- **Q3.** The label prints `www.lailark.in`, but that address has no valid
  certificate: DNS points at Firebase, but the certificate does not cover the `www`
  name, so browsers show a security warning. The only fix is in the Firebase console
  (Hosting, site `lailark`, Add custom domain, `www.lailark.in`, choose redirect to
  `lailark.in`), then two DNS records at GoDaddy. Nothing in the repo can fix this.
  Meanwhile the address is left as is.
- **Q4.** May Kitchen edit ingredients and recipes? The roles table in the brief has no
  row for this. Meanwhile both are Owner-only in the rules, marked `TODO(Q4)`, because
  a recipe change moves batch costs and the ingredient line printed on the jars.

## 6. Answered during this milestone

- **Q1.** `lailark` is on the Blaze plan. (D18)
- **Q2.** Staging is the repurposed project `tree-quiz-74e04`, not a new
  `lailark-staging` project. (D19)
- **Q5.** `tree-quiz-74e04-admin.web.app` is now an authorised domain on staging.
  Production still needs Authentication turned on and `lailark-admin.web.app`
  authorised before its admin can sign in.
- **Q6.** The `setRole` bootstrap secret is set on staging, so `api` and `setRole` are
  deployed there. (D20)

## 7. Every assumption from this milestone

One line each. Reply with the id and what to do instead if you want to overrule one;
otherwise they stand.

- A1: kitchen discount cap of ₹50. Replaced by D17: the cap is set by the Owner in
  Settings, no default in code.
- A2: raw photo and logo drops sit in a gitignored `_incoming/` folder; shipped assets
  live in `site/public/assets/` or `admin/public/`. Open.
- A3: loose business docs moved into `docs/business/`, nothing else in them changed.
  Open.
- A4: `admin/`, `functions/`, `shared/` started with placeholder `package.json` files
  so the workspaces resolved before each was built out. Open.
- A5: `site/` is plain JavaScript, not TypeScript, to avoid extra dependencies for a
  static export. Open.
- A6: root `npm run dev` runs only the site for now. Open (see Known unfinished).
- A7: the home page still fetches `config/site` directly from Firestore's API, the one
  exception to "no external requests but Razorpay." M3.2 can retire it. Open.
- A8 **(check this)**: the home page now has a jar video background, because the task
  wording asked for "the same HTML and the video background," though the live v0 page
  on 15 Sep had only a still photo, which is kept too.
- A9: replaced by D19, the staging site ids are `tree-quiz-74e04` and
  `tree-quiz-74e04-admin`, not `lailark-staging`.
- A10: local emulator ports are hosting 5010 (customer) and 5015 (admin), not 5000,
  because macOS holds port 5000 for AirPlay. Open.
- A11: admin hosting cache headers assume Vite's own defaults. Open.
- A12: added `npm run emulators:hosting` for site work without Firestore. Open.
- A13 **(check this)**: the production redeploy in M1.2 put the new Next.js home page
  live on `lailark.in`, same copy as v0 plus the jar video. `/batch/001` was checked
  byte-for-byte unchanged before and after.
- A14: `deploy.mjs` treats a workspace as deployable once it has a `build` script.
  Open.
- A15: `LAILARK_DEPLOY_DRY_RUN=1` makes the deploy script print commands instead of
  running them, for its own tests. Open.
- A16: the production live gate accepts only the exact typed word `yes`. Open.
- A17: `functions/` uses CommonJS, the most reliable path for the emulator. Open.
- A18: TypeScript pinned to 5.9.x and ESLint to 9.39.5 across every workspace for
  compatibility. Open.
- A19: functions default to a maximum of 3 instances unless a task asks for more.
  Open.
- A20: the `api` function strips one leading `/api` from the path itself, no Express.
  Open.
- A21: Hosting's own header rules win over anything a function sets on a rewritten
  response; a specific rule was added for `/api/**`. Open.
- A22: the shared package builds twice, once for each module system it needs to
  support. Open.
- A23: money amounts are a plain number type at compile time, checked at runtime;
  dates are plain strings. Open.
- A24: `formatINR` prints Indian-style digit grouping regardless of the machine's own
  locale settings. Open.
- A25: payment statuses are created, authorized, captured, partlyRefunded, refunded;
  refunds are their own documents. Open.
- A26: batch numbers pad to 3 digits and can grow past 999; document numbers pad to 4.
  Open.
- A27: the sale-stop date is worked backward from the best-before date by a formula
  with settings for shelf life, the buffer percentage, and transit days. Open.
- A28: a batch with no surplus can go straight from bottled to sold out, skipping "in
  stock." Open.
- A29: `/api/health` also reports which version of the shared package it is running.
  Open.
- A30 **(check this)**: the emulator does not honour a fixed test OTP; the code is
  different every time and must be read from the Emulator UI's Auth tab or the
  emulator log. Only the automated tests swap the code in themselves. Real test phone
  numbers with fixed codes need to be set up in each project's own console. Shefin
  added test numbers on staging.
- A31 **(check this)**: an unknown phone number is let into Firebase's own sign-in
  step (any number can create an account there) but is then refused inside the admin
  app itself once it has no role, shown a message, and signed back out. Blocking it
  earlier needs a paid Firebase feature, so this is the design for now.
- A32 **(check this)**: `setRole` trusts the caller's own Owner claim, never lets the
  last Owner be demoted, and revokes sessions on every role change, but a token already
  issued before a demotion can still act as Owner for up to an hour. Stricter checking
  is Milestone 5.
- A33: the admin's automated test run builds its own separate copy of the app so the
  real deployable build is never touched by test settings. Open.
- A34: the production Firebase web app keys are committed in the admin source, which
  is normal for Firebase (they are public identifiers, not secrets). Open.
- A35: M1.6 added a narrow rule so a signed-in admin can read their own `users`
  document (for the name on screen); M1.8 kept it. The admin bundle was one large
  chunk until M1.7 split the Firebase SDK out. Open.
- A36: the functions deploy step packs the shared package into a small bundled copy,
  deploys, then restores the normal development setup afterwards, every time,
  including after a failed deploy. Open.
- A37 **(check this)**: the admin app has one visual theme, paper background and dark
  text, and does not follow the phone's dark mode setting. The customer site does
  follow it; the admin, being a work tool, does not.
- A38: the "offline" pill reads the browser's own network state, not whether Firestore
  can actually reach the server; unknown paths inside the admin fall back to Today
  rather than showing an error page. Open.
- A39: wording on the admin's empty screens and the More menu was written by the
  builder, not drawn from a spec; the Firebase SDK was split into its own cacheable
  chunk. Open.
- A40: a fixed list of batch fields (like state, counts, approval timestamps) can never
  be written by any client, Owner included; a separate fixed list is the only batch
  fields Kitchen may touch. Both lists are checked against each other by a test so they
  cannot drift apart. Open.
- A41: a fixed set of collections, including orders, documents, counters, refunds,
  settlements, and users, can never be written directly by any client, in any role.
  Open.
- A42 **(check this)**: Kitchen can create a batch photo update but not approve it
  themselves; Kitchen cannot raise a Concern directly (only functions can); both staff
  roles can create and edit customers, addresses, and shipment records including their
  costs; audit log entries can never be edited or deleted once written.
- A43: Storage has no public path at all; documents and financial exports are readable
  only by Owner and Viewer, shipment files by Owner and Kitchen, and the two paths
  staff can upload to (batch photos, product images) accept only images up to 8 MB. Open.
- A44: the rules test suite runs as its own workspace against the emulator, one file at
  a time; a write that sets a field to the value it already had is allowed, since rules
  only look at what actually changed. Open.
- A45: the deploy and check scripts read which project they are pointing at from
  `.firebaserc` rather than anything hard-coded, so repointing staging in the future is
  `.firebaserc` plus one line in `admin/src/firebase.ts`; the admin shows a user's stored name, then their Auth display
  name, then their phone number, in that order. Open.
- A46 **(check this)**: on staging, Shefin and Sumayya's roles were set directly
  through a Firebase import command rather than through the `setRole` function
  (because that function could not deploy until the secret existed), so there are no
  `users/{uid}` documents yet, only Auth accounts with role claims and display names.
- A47: staging has an automatic cleanup policy that deletes old function build images
  after one day, so deploys do not quietly build up storage charges. Production will
  need the same policy set once functions deploy there. Open.
- A48: the CI workflow runs on Ubuntu with Node 22 and Java 21, one step per workspace,
  with no secrets configured; the green run on GitHub stood in for a tester subagent
  on this task. Open.

## 8. What to reply with

Bugs you found, your answers to Q3 and Q4, any assumption you want to overrule (by its
id, for example "A31: no, do X"), then the word `continue`.

After that, here is the merge that follows, for you to run when you are ready (not
something to run now):

```bash
git checkout main && git merge --no-ff milestone-1-foundations && git tag v1.0 -m "Milestone 1: foundations" && git push origin main --tags
```
