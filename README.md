# Lailark Kitchen — Project Log

This folder is the working record for Lailark Kitchen (artisan oil-based pickle brand, Kunnamangalam, Kozhikode).

## Contents
- **Lailark_Master_Brief.md** — full brand, product, pricing, competitive and go-to-market reference. The consolidated strategy.
- **Lailark_Compliance_Roadmap.md** — FSSAI licence assessment and the licence/registration path by phase (domestic, scale, export).
- **Lailark_PrawnsDates_Pickle_Costing.md** — batch 009 recipe, measured yield, costing and pricing.
- **Lailark_Nutrition_Calculator.xlsx** — ingredient database, per-100 g calculation and label panel. Batch 009 is loaded.
- **Sodium_Benchmark_Report_Indian_Pickles.md** — where Lailark sits against Indian and Kerala pickle sodium levels, and the coming FSSAI front-of-pack rules.
- **Label_Detail_Panel_PrawnsDates_Pickle.md** — print-ready label copy for the 200 g jar.
- **lailark-site/** — the live website. Two static pages, no build step.
- **lailark-site-v0-handoff.md** — build spec for the site: copy, routing, hard constraints.
- **lailark-design-research.md** — reference sites and design direction.
- **firebase.json / .firebaserc / firestore.rules** — hosting and database config.

## Snapshot
- Product: artisan oil-based pickles, made from home, FSSAI registered.
- **Made so far: one batch. Prawns & Dates Pickle, batch 009, 04/09/2026, 4,600 g finished, 23 jars.** Beef, squid, konjac and a plain prawns pickle are planned SKUs, not made.
- Unit economics on batch 009: ₹159 all-in per 200 g jar (~₹795/kg). MRP ₹649, introductory ₹499.
- Channels: own website + WhatsApp + Instagram. No marketplaces. Storefront platform still undecided; the site today is a holding page, not a shop.
- Target buyer: Gulf / NRI premium. Start market: UAE / Gulf, Aramex shipping.
- Brand: kraft + black primary, black + gold for gifting. Handwritten note in every order.

## Infrastructure

Everything runs on **Firebase, project `lailark`**. There is no other host and no other
database.

- **Hosting:** live at https://lailark.web.app since 2026-09-15. Deploy with
  `firebase deploy --only hosting` from this folder. Never run `firebase init`, which
  overwrites `lailark-site/index.html` with a placeholder.
- **Database:** Cloud Firestore, `(default)`, Native mode, region `asia-south1` (Mumbai).
  The region is permanent. Rules are in `firestore.rules` and are deny-by-default, so every
  new collection needs an explicit `match` block or it is unreachable.
- **Domain:** `lailark.in` is **not yet connected**. The QR on every jar encodes
  `https://lailark.in/batch/001`, so until the custom domain is added in Firebase and the
  parked `A @` record at GoDaddy is replaced, a scan fails. No jars get printed until the
  certificate reads Active and the URL loads on a phone over mobile data.

Last updated: 2026-09-15.
