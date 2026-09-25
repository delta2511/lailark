# Lailark: rules for Claude Code in this repo

Read this whole file before doing anything. Then read `TASKS.md` to find the current
task, and `DECISIONS.md` before making any choice that is not spelled out in a task.

## 1. What this is

One repo, three deployables, one Firebase project (`lailark`, plus `lailark-staging`):

| Path | What | Deploys to |
|---|---|---|
| `site/` | Customer site, Next.js static export | Firebase Hosting target `customer` → lailark.in |
| `admin/` | Admin PWA, Vite + Preact + TypeScript | Firebase Hosting target `admin` → `<site>.web.app` (no custom domain) |
| `functions/` | Cloud Functions 2nd gen, TypeScript, region `asia-south1` | Firebase Functions |
| `shared/` | Types, state enums, money helpers, shared by all three | not deployed |
| `docs/strategy/` | The specs. Every question about behaviour is answered here first | |
| `scripts/` | `deploy.mjs` and other repo tooling | |

Firestore `(default)`, Native mode, `asia-south1`. Storage, Auth (phone), Cloud Messaging.

Business context in one line: a home kitchen in Kunnamangalam sells oil pickles in
batches of 15 to 40 jars, online and at the door, and two people run it from their
phones. Owner is Shefin, kitchen is Sumayya.

## 2. Where answers come from, in order

1. `TASKS.md`: the task you are on, its scope, its done-when.
2. `DECISIONS.md`: every decision already made, and every assumption logged so far.
3. `docs/strategy/lailark-admin-flow-billing-brief.md`: the master spec for flows, admin,
   data model, money, agent. Section numbers are cited in tasks as "brief §7A.1".
4. `docs/strategy/lailark-in-site-and-sales-flow.md`: the customer site, products,
   design system, batch lifecycle. Where it disagrees with the brief, the brief wins.
5. `docs/strategy/lailark-story-and-narration.md`: what copy may and may not say.
6. `docs/strategy/lailark-site-v0-handoff.md`: batch 001 facts and the printed label,
   which is the source of truth for anything that appears on both jar and site.
7. The other docs in `docs/strategy/` for label, QR, video, design references.

If the answer is in none of these, see section 5 (assumptions and questions).

## 3. Hard rules. Never break these

- **Never run `firebase init`.** It overwrites files. All config is hand-written.
- **`/batch/001` must keep resolving, with the same content**, on every deploy of the
  customer site, forever. It is printed on 22 jars. Every deploy task verifies it with
  curl before finishing: `npm run check:batch-001` against the deployed site from a Mac
  session, or, from a cloud session where `lailark.in` is not reachable, `npm run
  check:batch-001 -- --url http://127.0.0.1:5010` against the hosting emulator, which
  proves the built page still matches the jar. The live check then runs on a GitHub
  runner (`.github/workflows/check-batch-001.yml`, daily and on demand). See
  `docs/cloud-sessions.md` §4. `/batch/1` and `/batch/01` 301 to it. The one deliberate
  difference from the printed jar: its ingredient line shows no percentages (D28). From
  batch 002 the record pages show them.
- **Money is written only by functions.** Client apps never write `orders.payment`,
  `documents`, `counters`, `refunds`, `settlements`, `webhookEvents`. Rules enforce it.
- **Money is integers in paise.** Never floats, never rupees, anywhere in code or data.
- **Counts change only inside Firestore transactions** on the batch document, in
  functions. Never oversell. A jar is free, held, paid, or gone.
- **Nothing that costs money or messages a customer is automatic** unless the brief
  lists it as an automatic template (bills, receipts, packed, shipped, delivered,
  check-ins). Everything else goes through an `approvals` or `concerns` document and
  waits for the Owner.
- **Batch numbers are global, sequential, zero-padded, never reused.**
- **Webhooks:** verify signature, write `webhookEvents/{source-eventId}` with a
  must-not-exist create, respond 200 fast, do the work off the request path.
- **Secrets never enter the repo.** `.env*` is gitignored. Server secrets live in Secret
  Manager. If you find a secret in a file, stop and say so.
- **No em dashes in any customer-facing text.** Periods, commas, colons. Lailark speaks
  as "we". Warm, sparse, plain. Nothing that sounds like a brand or a bot.
- **Claims and ingredient lines copy the label character for character.** Never
  paraphrase them. The one exception is the `/batch/001` page, which carries the same
  list without the two percentages (D28).
- **No dark patterns.** No countdowns, no fake scarcity, no "12 people looking", no
  surprise charges at payment. Every count on the site is computed, never typed.
- **Rust (#A34A28) is a number colour, never a button or heading. Leaf (#2F5D3A) only
  ever touches a claim.** See the design system, sales flow doc §10.
- Prices: ₹649 in stock, ₹599 open batch. Never above ₹649 MRP.
- Region for everything server-side is `asia-south1`. Every function sets
  `maxInstances`.
- Do not add dependencies casually. Prefer the platform. Every new package gets one
  line in the commit message saying why.

## 4. How work runs: the orchestration protocol

The main Claude Code session is the **orchestrator**. It does not write feature code
itself. It reads the next task in `TASKS.md`, spawns subagents, checks their work,
updates the ledgers, and commits.

### 4.1 Per task

1. **Read** the task in `TASKS.md`, its brief sections, and `DECISIONS.md`.
2. **Build.** Spawn a builder subagent with the model tagged on the task:
   - `[opus]` for anything with design decisions, money, transactions, rules, auth,
     webhooks, the agent, and all customer-facing copy.
   - `[sonnet]` for well-specified build work: screens from a spec, components, wiring,
     tests, scaffolds.
   - `[haiku]` for mechanical work: seeding data, file moves, lint fixes, running checks.
   The builder gets: the task text, the brief sections it cites, the relevant part of
   `DECISIONS.md`, and section 3 of this file. It reports back what it built, what it
   tested, and any `BLOCKED:` or `ASSUMED:` lines.
3. **Test.** Which kind depends on the task (D34):
   - **`[opus]` tasks and any task touching money, rules, transactions, auth or
     webhooks: agent test.** Spawn a **fresh** tester subagent (`[sonnet]`, or `[opus]`
     for money and rules) that has not seen the builder's transcript. It gets the task's
     done-when and tries to break it: runs the build, lint, unit tests, rules tests
     against the emulator, opens pages in headless Chromium and checks console errors,
     and for functions calls them against the emulator. It reports PASS or a list of
     failures. No stop for Shefin; carry on to the next task.
   - **Shefin-checked tasks: Shefin tests instead of a tester subagent.** These are the
     `[sonnet]` tasks whose result is a screen or page he can look at. In the Launch
     milestone: M3.1, M3.3, M3.4, M3.9, M4.1. The orchestrator itself runs `npm run
     build`, lint and `npm test` (no subagent), then **stops** and prints a check note
     of at most ten lines: how to open it (command, URL, which phone number to sign in
     with), what to tap, and what to look for. Shefin replies "ok" or with fixes. Fixes
     go to the builder (step 4). Commit only after his "ok".
4. **Fix loop.** Failures go back to the builder, at most three rounds. If still
   failing, mark the task `⚠ stuck` in `TASKS.md` with the failure, and move on to the
   next task that does not depend on it.
5. **Ledgers.** Every `ASSUMED:` line goes into `DECISIONS.md` under "Assumptions made
   during the build", with the task id. Every `BLOCKED:` line on a never-assume item
   (section 5) is asked straight away (section 4.4), then logged in `QUESTIONS.md` with
   its answer.
6. **Commit** on the milestone branch. One commit per finished task. Message format in
   section 6.
7. Tick the task in `TASKS.md` (`[x]`, with the commit hash). Commit that too.

### 4.2 Per milestone

When every task in a milestone is ticked or marked stuck:

1. Write `docs/milestones/MILESTONE-<n>-TEST.md` for Shefin: what was built, exactly
   how to test it on his phone and laptop (commands, URLs, which phone number to sign in
   with, what to tap), what is known-unfinished, every open question from
   `QUESTIONS.md`, and every assumption from this milestone in one list so he can
   overrule any of them.
2. Commit it. Print the milestone summary and **stop**. Do not start the next
   milestone. Shefin tests, replies with fixes and answers, and says "continue".
3. On "continue": fold his answers into `DECISIONS.md` (mark the assumption as
   confirmed or replaced), fix what he reported (as tasks appended to the milestone),
   then remind him of the merge: print the exact commands to merge the milestone branch
   into `main` and tag it, and the summary line for the tag. Only after he confirms the
   merge, create the next milestone branch and carry on.

Stop between tasks only for a Shefin-checked task (4.1 step 3) or a question (4.4).
Otherwise keep going. Since D29 there are two milestone breaks left before launch: the
end of Milestone 2 and the end of Milestone 3 (Launch). Never start a task from the
Fast-follow section of `TASKS.md` unless Shefin says so.

### 4.4 Shefin in the loop (D34)

- **Questions are asked when they come up, not parked.** When a builder reports
  `BLOCKED:` on a never-assume item, stop and ask Shefin in one message: the question,
  why it matters, the options, and your recommended answer. Record his answer as a new
  `D` entry in `DECISIONS.md` and as answered in `QUESTIONS.md`, then resume the task.
  Only if he says "park it" (or does not reply in the session) fall back to a
  `TODO(Qn)` placeholder as in section 5.
- **Shefin may interrupt at any time** to look at something or give input. Treat what
  he says as a decision (log it as a `D` entry if it changes behaviour), then carry on
  with the current task.
- **Fresh session per stop.** At every stop, end the message with: "Run /clear, then
  say next." On "next" in a fresh session: read this file, find the first unticked task
  in `TASKS.md`, read `DECISIONS.md`, check `git status` and the last commit, and pick
  up where the work left off (a task built but not yet committed is committed after
  Shefin's "ok").

### 4.3 Subagent hygiene

- Subagents cannot ask Shefin anything. They report `BLOCKED:` and stop that thread.
- Give each subagent only what it needs. Do not paste the whole brief.
- One task per subagent. Do not batch tasks.
- Ask the tester to be adversarial and specific: a failure is a command and its output,
  not "seems off".
- The orchestrator reads the diff of every builder before accepting it. If it touches
  files outside the task's stated scope, ask why before accepting.

## 5. Assumptions and questions

Shefin has said: do not assume a lot, but take the freedom of assumption on the low
layers.

**Assume freely (log it, don't ask):** file and folder names, component structure,
library choice inside the decided stack, CSS details within the design system, error
message wording for the admin (not the customer), test structure, index definitions,
function names, default values that are marked as settings in the brief, anything the
brief calls "recommended" that DECISIONS.md has not overridden.

**Never assume (write to `QUESTIONS.md`, work around it, carry on):** anything a
customer reads that is not already drafted in the docs, prices, limits, who may do what
(roles), anything that changes when money moves or is refunded, anything that sends a
message to a customer, the batch lifecycle transitions, URL paths on the customer site
(they are permanent), legal or compliance wording, and anything that contradicts a doc.

When a task is blocked on a question, ask Shefin first (4.4). If he parks it, build the
rest of it with a clearly named placeholder (`TODO(Q7)` referencing the question
number), keep going, and note it in the task's tick.

## 6. Git

- `main` is always deployable. Nothing is committed straight to `main`.
- One branch per milestone: `milestone-1-foundations`, `milestone-2-kitchen-and-counter`,
  `milestone-3-launch` (D29). Fast-follow branches are named when Shefin starts them.
- One commit per finished task, on the milestone branch. Format:

  ```
  M2.7 Counter sale: New sale screen, cash and UPI, hold transaction

  What: ...
  Tested: ...
  Assumed: ... (or "none")
  Blocked: ... (or "none")
  ```

- Ledger updates (`TASKS.md`, `DECISIONS.md`, `QUESTIONS.md`) are committed with the
  task they belong to, not separately.
- Milestone merge: `git checkout main && git merge --no-ff milestone-N-... && git tag
  vN.0 -m "..." && git push origin main --tags`. The orchestrator prints these for
  Shefin; it does not run them without his yes.
- Never force-push. Never rewrite history on `main`.

## 7. Commands

Root `package.json` has workspaces for `site`, `admin`, `functions`, `shared`.

| Command | Does |
|---|---|
| `npm install` | Everything |
| `npm run dev` | Site dev server only (`npm run dev --workspace site`). Run `npm run emulators` and the admin dev server in their own terminals |
| `npm run emulators` | Firebase emulator suite only (Firestore, Auth, Functions, Hosting, Storage) |
| `npm run build` | Builds site, admin, functions |
| `npm test` | Unit tests, rules tests, e2e against the emulator |
| `npm run test:cloud` | The same suite with the proxy variables unset. **Use this, not `npm test`, in a cloud session** |
| `npm run cloud:setup` | Prepares a fresh cloud container: firebase-tools, emulator JARs, the Chromium shim, the CA seeding. Idempotent, needed once per session |
| `npm run deploy` | Interactive: asks customer / admin / both, then staging / production, then live / preview |
| `npm run deploy -- --target both --project staging --preview` | Same, non-interactive |
| `npm run check:batch-001` | Curls `/batch/001` on the deployed site and diffs it against the built record. Takes `--project staging` or `--url <base>` |

Firebase project aliases in `.firebaserc`: `default` → `lailark` (production),
`staging` → `lailark-staging`. Deploys go to staging unless `--project production` is
passed or the interactive prompt is answered "production".

**In a cloud session** (D56): run `npm run cloud:setup` first, then `npm run test:cloud`
rather than `npm test`, because firebase-tools proxies its own `127.0.0.1` calls and the
proxy refuses them. Two things cannot be done there: verifying the live site (see the
`/batch/001` rule in section 3) and showing Shefin a screen, because the dev server has
no ingress, so the `(Shefin checks)` tasks need a staging deploy from his Mac. Deploys
need his credential and are his to run. `docs/cloud-sessions.md` has the whole picture.

## 8. Testing expectations

- Every function has a unit test. Every transaction has a race test (two callers, one
  jar).
- Firestore rules have tests using `@firebase/rules-unit-testing` against the emulator:
  public cannot read, kitchen cannot write money, owner can.
- Every admin screen has at least one Playwright test that signs in with the emulator
  phone auth (test number `+91 7736110087` for Owner, `+91 9446587027` for Kitchen, OTP
  `123456` in the emulator) and exercises the main action.
- The customer site has a Playwright test per page checking: no console errors, no
  request to any domain other than the site itself and Razorpay on the checkout step,
  `/batch/001` content unchanged.
- Tests run headless. Screenshots on failure go to `test-results/` (gitignored).

## 9. Things that are true today (16 Sep 2026)

- v0 is live: `https://lailark.in` and `https://lailark.web.app`, two static pages,
  deployed from `lailark-site/` (to be moved into `site/` in M1.1).
- Firestore has two collections in use: `notify` (write-only from public) and
  `config/site` (public read). Keep both working.
- Batch 001: prawns and dates, 22 jars, packed 4 Sep 2026, best before 4 Mar 2027,
  online sale stop about 2 Jan 2027. All numbers in the v0 handoff §1 and §2.
- Razorpay test keys exist. WhatsApp: a test number for now. Shiprocket: not yet.
- Two admin users at launch: Owner `+91 7736110087`, Kitchen `+91 9446587027`.
- GitHub: `https://github.com/delta2511/lailark`.
