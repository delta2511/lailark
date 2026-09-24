# Milestone 2 test note, round two

24 September 2026. Branch `milestone-2-kitchen-and-counter`.

The first note, `MILESTONE-2-TEST.md`, covered M2.1 to M2.12 and is left exactly as it
was: a dated snapshot you already read and acted on. This one covers everything since,
M2.13 to M2.23, which is the round of work your answers at that break set off, plus three
bugs found along the way.

Milestone 2 has no unticked tasks left.

---

## 1. What was built

**Your four answers from the break, built.**

- **M2.13, M2.19 (D41).** The Sourcing to Cooking step used to ask for "the main
  ingredient's" weight and cost, because the brief assumed there was one. Batch 001 has
  two. The form silently recorded the prawns and dropped the dates, so the dates bought
  for that batch were never costed. It now asks once per main ingredient, each row naming
  the ingredient it is asking about, and each writes its own line document. The dates are
  costed.
- **M2.14 (D43).** The Cooking actuals offer the same 8 second undo as every other field,
  on one toast for the whole section.
- **M2.16 (D40, D44).** Both prices and the per-person limit are editable in place on
  every batch, in any state, archived included, with no lock.
- **M2.20, M2.23 (D42).** The two ingredient actuals are checked by value on the server,
  not just by the screen.

**Three bugs found while building, two of them by you.**

- **M2.15.** A blocked save now says what is missing and takes you to it.
- **M2.21.** The word "Undo" on every toast in the admin was invisible: ink on ink,
  contrast 1:1. It had been that way since M2.6 built the toast. You spotted it.
- **M2.22.** The word "Sell" in the bottom bar was invisible exactly while you were on
  the Sell tab, the same class of bug, found by a sweep M2.21 made possible.

**Two pieces of housekeeping.**

- **M2.17 (D39).** `orders/{id}/events` is gone. `audit` is the only history.
- **M2.18.** `npm run check:batch-001` now names the differing line and says which side
  is ahead, instead of printing two byte counts that read like a regression.

---

## 2. The one thing that needs doing, outside the code

**A deploy of the customer site is owed.** `npm run check:batch-001` confirms it: the live
`/batch/001` still carries the ingredient percentages, and the repo has D28's line without
them. Nothing is broken; the site simply has not been pushed since that change. The script
now says so in those words and exits 1 rather than looking like a fault.

---

## 3. How to test it

Three terminals. The OTP is **not** `123456` by hand: the emulator issues a random code
each time, and only Playwright substitutes the fixed one. Read the real code with the
curl below.

```bash
npm run emulators
```

```bash
node functions/scripts/seed-users.mjs --emulator && node functions/scripts/seed-products.mjs --emulator && node functions/scripts/seed-batch-001.mjs --emulator
```

```bash
npm run dev --workspace admin
```

Open `http://localhost:5173`, sign in as `+91 7736110087`, and get the code with:

```bash
curl -s http://127.0.0.1:9099/emulator/v1/projects/lailark/verificationCodes
```

**Batch 001, the prices and the limit (M2.16).**

1. Batches, batch 001. Type `575` into the price for an open batch and save. The undo bar
   appears; tap Undo and the old number comes back. Check the timeline shows both.
2. Type `650` into either price. It should refuse in plain words and save nothing.
3. The limit per person should sit blank with `4` as a grey placeholder. Type `2`, save,
   reopen. Clear it and it should go back to automatic.
4. Archive a batch and open it. The line about the P&L should be there, and the boxes
   should still be editable. Nothing should stop you.

**The two invisible labels (M2.21, M2.22).**

5. Make any edit that raises a toast. You should be able to read the word **Undo** now.
6. Tap **Sell** in the bottom bar. You should be able to read the word **Sell** while you
   are on that tab. It was invisible before.

**Sourcing asks for both ingredients (M2.19).**

7. Take a batch from Sourcing to Cooking. It should ask for a weight and a cost for
   **prawns** and again for **dates**, each named. Fill both.
8. Open the Cooking actuals. Both should be there, on their own rows, with their own money.

**The ceilings (M2.20, M2.23).**

9. In the Cooking actuals, type an absurd cost, something above ₹1,00,000 for one
   ingredient. It should refuse in words, not with a permission error.
10. Type `12.345` into a rupee box. It should refuse rather than quietly saving `12.35`.

---

## 4. What is known-unfinished

- **Q16 is still open**, deliberately. If a recipe names no main ingredient at all,
  Sourcing to Cooking still goes through and the money lands on a placeholder line shown
  as "Recorded against something this recipe does not list". Refusing the transition
  instead would change the batch lifecycle, which is yours to decide, not mine. Nothing in
  this round touched that behaviour and it is covered by tests so it cannot drift.
- **The customer site deploy** above.
- Everything in the Fast-follow list of `TASKS.md`, untouched and not started.

---

## 5. Two assumptions worth your eye

Twenty-nine assumptions were logged this round, A117 to A145 in `DECISIONS.md`. Most are
low-layer and not worth your time. These two change a number:

- **A134 (M2.19).** With two main ingredients, the batch's own `weightRaw` is now the
  **sum** of their raw weights. The brief wrote one raw weight because it assumed one
  ingredient. A recipe with one main ingredient gets exactly the number it always got. Say
  if you would rather it were something else.
- **A139 (M2.20).** One ingredient line is capped at **₹1,00,000** and **100 kg**. Neither
  comes from the ₹649 MRP, which is what a jar sells for and no guide to what ingredients
  cost. Both are argued from the batch: 40 jars at ₹649 grosses about ₹26,000, so a single
  ingredient above a lakh is four times a whole batch's revenue, which is a typo rather
  than prawns. Move either if they feel wrong for how you actually buy.

The full list is in `DECISIONS.md` under "Assumptions made during the build". Overrule any
of them.

---

## 6. Tests

Full run, everything green, exit 0 throughout.

| Suite | Tests |
|---|---|
| shared | 303 |
| functions, unit | 334 |
| functions, emulator | 140 |
| site | 2 |
| admin, unit | 125 |
| admin, Playwright | 81 |
| rules | 208 |
| scripts | 18 |

Two notes on getting there. An earlier full run reported six failures that all passed in
isolation in seconds: the Mac was starved, `searchpartyd` having sat at 49% for three
days, and the disk was down to 2 GiB, which killed one run outright with `ENOSPC`. You
cleared the disk and the orphaned emulator, and the suite now finishes in under three
minutes. Nothing was wrong with the code.

---

## 7. What to reply with

- "ok" on the ten steps above, or what is wrong with any of them.
- Your call on A134 and A139.
- Anything on Q16, or leave it open.

Then I will print the commands to merge this branch into `main` and tag it, and on your
word start Milestone 3, Launch.
