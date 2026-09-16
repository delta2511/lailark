# @lailark/functions

Cloud Functions (2nd gen, TypeScript, region `asia-south1`).

- `src/index.ts` — exports every function (currently just `api`).
- `src/api/` — the `api` HTTP function (`index.ts`) and its hand-written router (`router.ts`, no Express).
- `src/lib/` — shared helpers: `options.ts` (region/maxInstances), `project.ts` (project id), `admin.ts` (lazy Admin SDK).

Run the emulator from the repo root:

```
npm run build --workspace functions
firebase emulators:start --only functions,hosting --project lailark
```

Health check: `curl localhost:5001/lailark/asia-south1/api/health` (direct) or `curl localhost:5010/api/health` (via Hosting rewrite).
