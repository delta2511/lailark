# @lailark/shared

The vocabulary `site`, `admin` and `functions` all speak. No runtime dependencies,
and deliberately no Firebase SDK: this package is imported by a static site and a
browser bundle as well as by the server.

- `src/states.ts` — every state, method, channel and role, as a string union plus an
  `as const` array of the same values, so rules, admin and functions cannot disagree
  about a spelling.
- `src/money.ts` — `Paise`, the two prices, `formatINR`. Money is integers in paise.
- `src/dates.ts` — `CalDate` calendar dates and integer day-number arithmetic. No
  `Date` maths, so nothing shifts across a DST or UTC boundary. `kolkataDate` is the
  only door from an instant to a date.
- `src/batch.ts` — the 90% cap (brief 7.1), shelf life and sale stop (6.2), holds and
  the last-jar arithmetic (9.3).
- `src/numbers.ts` — a batch's two names (decision D21c: the internal reference
  `b-7f3a2c`, which is its document id for life, and the printed number `001`, a field
  stamped at bottling), document numbers (`LK/26-27/0001`), their Firestore id forms,
  and the financial year.
- `src/messages.ts` — the three customer messages a batch offers the Owner (D24), with
  the Owner's `settings/messages` wording winning over the drafts. Nothing sends.
- `src/types/` — a TypeScript interface for every collection document in brief 18.1.

Timestamps are typed as `{ seconds, nanoseconds }`. Both the admin SDK and the web SDK
`Timestamp` satisfy that structurally, with no cast and no adapter.

## Build

Two `tsc` passes, ESM and CommonJS, because the three consumers want different things:
`functions` is CommonJS on Node 22, `site` is Next.js ESM, `admin` is a Vite bundle.
`package.json` `exports` routes each to its own build; `main` and `types` cover the
node10 resolver that `functions/tsconfig.json` still uses.

```
npm run build --workspace shared   # dist/cjs + dist/esm + the two type markers
npm run test --workspace shared    # vitest
```

`dist/` is gitignored. `npm install` at the repo root rebuilds it through the `prepare`
script, and the root `workspaces` array lists `shared` first so `npm run build` builds
it before `functions` and `site`.
