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

## Deploying

`@lailark/shared` is a private workspace package (no registry entry), so `firebase deploy --only functions` cannot `npm install` it in the cloud build. `firebase.json`'s `functions.predeploy` runs `scripts/pack-shared.mjs`, which builds `shared/`, packs it into `functions/vendor/*.tgz`, and points `functions/package.json`'s `@lailark/shared` dependency at that tarball with a `file:` spec so a deploy from a clean checkout installs standalone. `functions.postdeploy` runs `scripts/pack-shared.mjs --restore` to put the workspace link (`"0.0.0"`) back and delete `functions/vendor/`. Run `npm run pack:shared` / `npm run pack:shared:restore` to do this by hand; both are idempotent. `functions/vendor/` is gitignored and never committed.
