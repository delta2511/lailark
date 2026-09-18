# site

Next.js customer site, static export. `npm run build` writes `out/`, deployed as
Firebase Hosting's `customer` target.

- `app/` - the home page (`/`), rendered by Next.
- `public/` - copied into `out/` unchanged. `public/batch/001/index.html` is the
  printed-jar record: 22 jars carry this URL and its content must never change.
- `public/assets/` - images and the home background video.
- `scripts/serve-out.mjs` - static file server for `out/`, used by Playwright tests.
