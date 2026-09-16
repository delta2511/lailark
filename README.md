# Lailark

The code and the working record for Lailark Kitchen: an artisan oil-pickle brand from a
home kitchen in Kunnamangalam, Kozhikode. Batches of 15 to 40 jars, sold on
[lailark.in](https://lailark.in), at the door, and on WhatsApp.

## What is in here

| Path | What |
|---|---|
| `CLAUDE.md` | How Claude Code works in this repo: rules, orchestration, git, tests. Read first |
| `TASKS.md` | The build, as five milestones of single tasks |
| `DECISIONS.md` | Every decision made and every assumption logged. Overrides the docs |
| `QUESTIONS.md` | Open questions for Shefin, answered at milestone breaks |
| `docs/strategy/` | The specs: sales flow, admin and billing brief, story and voice, label rules, v0 handoff |
| `docs/business/` | Brand brief, compliance roadmap, costing, nutrition calculator, sodium benchmark |
| `docs/milestones/` | Test notes written at each milestone break |
| `site/` | Customer site, Next.js static export → lailark.in (created in M1.1) |
| `admin/` | Admin PWA, Preact → separate Hosting site (created in M1.6) |
| `functions/` | Cloud Functions, TypeScript, asia-south1 (created in M1.4) |
| `shared/` | Types and helpers shared by all three (created in M1.5) |
| `scripts/deploy.mjs` | `npm run deploy`: customer / admin / both, staging / production, live / preview |
| `lailark-site/` | The live v0 static site, two pages. Moves into `site/` in M1.1 |

## Infrastructure

Everything runs on Firebase, project `lailark` (production) and `lailark-staging`.

- **Hosting.** `https://lailark.in` (custom domain connected 15 Sep 2026) and
  `https://lailark.web.app`. Deploy with `npm run deploy`. Never run `firebase init`.
- **Database.** Cloud Firestore, `(default)`, Native mode, `asia-south1` (Mumbai). Rules
  in `firestore.rules`, deny by default.
- **The QR on every batch 001 jar encodes `https://lailark.in/batch/001`.** That page
  must resolve, unchanged, forever. Every deploy checks it.

## Snapshot (16 Sep 2026)

- Made so far: one batch. Prawns and dates, batch 001, packed 4 Sep 2026, 22 jars of
  200 g. Squid, beef and koorka are the other launch heroes, not yet made.
- Unit economics on batch 001: about ₹160 all-in per jar. MRP ₹649. Open batch ₹599.
- Channels: own site, WhatsApp, the kitchen door. No marketplaces.
- Brand: warm black and paper, following the printed label. Handwritten note in every
  box.

## Working on it

```
npm install
npm run dev        # emulators + site + admin
npm test
npm run deploy
```

Development runs in Claude Code with the protocol in `CLAUDE.md`. Shefin tests at five
milestone breaks; between them the build runs on its own.
