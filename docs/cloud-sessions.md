# Working on Lailark from a cloud Claude Code session

Written 25 Sep 2026, from a readiness run on the cloud container against `main` at
`c601c87` (end of Milestone 2). It records what works there, what cannot, and how the
orchestration protocol in `CLAUDE.md` §4 runs when the session is not on Shefin's Mac.

Short version: the whole build-and-test loop works. Two things do not, both network
policy rather than code: verifying the live site with curl, and letting Shefin look at
the dev server.

## 1. Every session starts with one command

```
npm run cloud:setup
```

The container is ephemeral and the repo is re-cloned, so nothing persists and this runs
every time. It is idempotent. Five steps, each closing a real gap:

| Step | Why |
|---|---|
| `npm ci` | Ordinary. |
| `firebase-tools`, pinned in `.firebase-tools-version` | It is not a repo dependency, and six workspace scripts call a bare `firebase`. The same pin CI installs; `scripts/test/firebase-tools-pin.test.mjs` fails if the two drift. |
| Prefetch the firestore, storage and ui emulator JARs, 199 MB | They download fine. Each prints `Unable to fetch the CLI MOTD`, which is cosmetic: `firebase-public.firebaseio.com` is blocked and only carries the message of the day. |
| Shim the Chromium revision onto the browser the image ships | `npx playwright install` cannot work: `cdn.playwright.dev` answers 403. The image's Chromium is complete (`ldd` reports zero missing libraries) and only its revision number is wrong for the pinned `@playwright/test`. |
| `libnss3-tools`, then seed the Anthropic CAs into `~/.pki/nssdb` | TLS is re-terminated on the way out and Chromium's NSS store starts empty. The site's home test asserts zero console errors while the page does a real read of `firestore.googleapis.com`; without the CAs that read logs `ERR_CERT_AUTHORITY_INVALID` and the test fails on the console assertion alone, every content assertion passing. |

## 2. Run the suite with the proxy unset

```
npm run test:cloud
```

Not setup: a standing constraint. The functions emulator registers its Firestore and
eventarc triggers by POSTing to `127.0.0.1`, and firebase-tools' `apiv2` attaches an
explicit proxy agent built from `HTTPS_PROXY` without ever consulting `NO_PROXY`. The
agent proxy refuses the loopback request, the plaintext refusal is parsed as JSON, and
what you see is:

```
⚠ Error adding firestore function: FirebaseError: Unable to parse JSON:
  SyntaxError: Unexpected token 'r', "request bl"... is not valid JSON
```

With the proxy unset, `functions test:emulator` goes from crashing to 140 of 140
passing. `rules-tests` is unaffected either way: it runs firestore and storage only,
with no function triggers.

`npm test` on a Mac is unchanged. `test:cloud` is the same command with four variables
removed, so there is one suite, not two.

## 3. What works there

Build, lint, and every stage of the suite: shared, functions unit, functions against the
emulator, site unit and Playwright, admin unit and Playwright e2e, the rules tests, the
scripts tests. All six emulator ports bind and serve, all 12 functions load in
`asia-south1`, the dev server runs, and committing and pushing to a branch works
(credentials are proxy-injected).

That is the whole of `CLAUDE.md` §4.1 — builder subagent, fresh adversarial tester,
fix loop, ledgers, one commit per task — and the whole of §8, including the money,
rules and transaction tests that matter most.

Push the milestone branch after each task. CI then runs the same suite on an
unrestricted network, which is a free second opinion on anything that might have been
the container rather than the code.

## 4. What cannot work there

**The live `/batch/001` check.** `lailark.in` and `lailark.web.app` are not on the
egress allowlist; curl gets a 403 from the CONNECT tunnel, and `npm run
check:batch-001` exits 2 on three network failures that say nothing about the page. In
a cloud session, check the built artifact instead:

```
npm run build --workspace site
npm run emulators            # or: npm run emulators:hosting
npm run check:batch-001 -- --url http://127.0.0.1:5010
```

That still proves *built page equals printed jar*, byte for byte, which is what the
hard rule is protecting. The site Playwright suite asserts the same thing. What the
container cannot prove is *deployed page equals printed jar*, so the live half moved
to `.github/workflows/check-batch-001.yml`, which runs daily on a GitHub runner and
can be dispatched by hand against staging or production. Getting `lailark.in`
allowlisted would close this properly.

**Showing anyone the dev server.** It is localhost-only inside the container: the
`192.0.2.2` address Next advertises is RFC 5737 documentation space, there is no
default route, and no port forward exists for app ports. So the `(Shefin checks)`
tasks in `TASKS.md` — M3.9 and M4.1 are the two left — cannot be checked from a cloud
session. The bridge is a staging deploy: cloud builds, tests, commits and pushes; Shefin
pulls on the Mac and runs

```
npm run deploy -- --target both --project staging
```

then tests on his phone, which is the only place the PWA can honestly be tested anyway.
Batch those checks: run the cloud tasks straight through and sit down once, rather than
stopping the session twice.

**Also not possible, and correctly so:** deploys (`firebase login:list` reports no
authorized accounts, and a deploy is outward-facing), a real Razorpay payment
(`api.razorpay.com` blocked, `functions/.secret.local` absent as it should be),
WhatsApp and Shiprocket (no credentials, endpoints not allowlisted), and anything
iOS or Safari.

**Unaffected:** questions to Shefin. `CLAUDE.md` §4.4 asks a never-assume question the
moment it comes up, and that is chat, not network. It does mean a cloud session must
keep the orchestrator role itself: subagents cannot ask him anything, and neither can
the container.

## 5. Known differences from the Mac

- Chromium 141 headless, not 153. The 153 download is blocked. For this app the tests
  that matter are emulator and rules tests, so this is noise, but it is the one real
  browser-version difference.
- `EAFNOSUPPORT` when the emulators probe `::1`: the container has no IPv6. They bind
  `127.0.0.1` and work.
- The emulator hub falls back from 4400 to 4401 if a previous run is still up.
- `next dev` writes `site/CLAUDE.md` and `site/AGENTS.md`. Both are now gitignored, so
  they no longer dirty `git status` or risk being committed.
- No macOS-isms were found in the repo: no `sed -i ''`, no `pbcopy`, no `stat -f`, no
  `/Users/` or `/opt/homebrew` paths, no case-insensitive filename collisions. The
  `darwin` entries in `package-lock.json` are the normal optional platform binaries.
- Footprint is about 2 GB with `node_modules` and the JARs, against 28 GB available.
