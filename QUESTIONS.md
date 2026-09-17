# Questions for Shefin

Written by the orchestrator when a task hits something the docs and `DECISIONS.md` do
not answer and CLAUDE.md §5 says not to assume. Work carries on around each one with a
`TODO(Qn)` placeholder. Shefin answers at the milestone break; the answer moves to
`DECISIONS.md` and the question is struck through here.

Format: `Q<n> (task, date): the question. Options if any. What was done meanwhile.`

## Open

- Q2 (M1, 16 Sep): Please create the `lailark-staging` project (Firestore in
  `asia-south1`, Phone Auth enabled, Blaze) or say if you would rather M1 run on
  emulators only and staging is set up at the M1 break. Meanwhile: `.firebaserc` will
  carry the `staging` alias and every staging deploy is skipped with a note until it
  exists.
- Q3 (M1.2, 16 Sep): `www.lailark.in` is printed on the label but has no certificate:
  DNS points at Firebase, plain HTTP redirects to `https://www.lailark.in/`, and HTTPS
  fails with a certificate name mismatch, so a browser shows a security warning. Fix is
  in the Firebase console only (Hosting, site `lailark`, Add custom domain,
  `www.lailark.in`, choose redirect to `lailark.in`), then the two DNS records it asks
  for at GoDaddy. Nothing in the repo can do this. Meanwhile: unchanged.
- Q4 (M1.8, 17 Sep): May Kitchen edit ingredients and recipes? The roles table in brief
  §17.12 has no row for it. Meanwhile both are Owner-only (`TODO(Q4)` in
  `firestore.rules` and the rules tests), because a recipe change moves batch costs and
  the label's ingredient line, which is printed on the jars.

## Answered

- ~~Q1 (M1, 16 Sep): Is the `lailark` Firebase project on the Blaze plan yet? Functions and Storage will not deploy without it. Meanwhile: everything runs on the emulator.~~ Answered 17 Sep: Blaze is on for `lailark`. Recorded as D18 in DECISIONS.md.
