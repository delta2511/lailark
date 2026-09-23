# Milestone 2 test note

Milestone 2 is the kitchen and the counter: ingredients and recipes, products,
the batch state machine, the Batches and Today screens, a timeline with undo,
batch 001 seeded with its real numbers, and a counter sale that produces a
numbered bill PDF. The break, as written in `TASKS.md`: **batch 001 entered
with its real numbers; a cash sale at the door produces a numbered bill PDF.**
Test that first. Everything else is secondary.

M2.10 (offline drafts) and M2.11 (day close) were moved to Fast-follow by D29
and are not part of this milestone.

## 1. What was built

- **M2.1** (732c4b5). Ingredients and recipes screens under Products. The
  recipe engine in `shared/`: ingredient order and percentages under a basis
  switch (A, B, C, default B), allergen line from tags, nutrition per 100 g,
  storage and claims text. Kitchen reads every ingredient and recipe;
  the Owner's switch (`settings/permissions.kitchenCanEditRecipes`, D22) lets
  her edit them too, once turned on. Q7 was asked and answered during the
  task (a rounding fix to the label basis doc), recorded as D28.
- **M2.2** (4e06456). The Products screen: the four heroes and three pipeline
  products, photos to Storage, HSN, prices, jar size, the shipping-fee
  switch, the Koorka season window, custom lines. Every number editable in
  place with an undo toast. Seeded to staging on 19 Sep, with HSN codes
  filled in per D26.
- **M2.3** (d81cf56) and **M2.3a** (0b0dde8). The batch state machine:
  callable `transitionBatch`, who may call each row and what it computes
  (bookable jars, half mark, best before, sale stop, surplus), automatic
  triggers for half-reached, full, in stock and sold out, batch numbers from
  a `counters/batch` transaction. Three questions were asked and answered
  during the task: **Q11** (the three missing customer messages are drafted
  by Claude, the Owner edits, recorded as D24), **Q12** (a batch's number is
  stamped at bottling, not at Draft, recorded as D21c), **Q13** (a batch may
  be paused from any state that is selling or cooking, recorded as D23).
- **M2.4** (04cc083). The Batches screens: list cards with a state chip and
  fill bar, detail with the one big state button, the three weights,
  per-ingredient actuals prefilled from the recipe with a drift warning,
  costs per batch.
- **M2.5** (64c8302). Approvals and Today v1: the `approvals` collection, the
  "Waiting on you" section (Yes / Not yet with reason / Edit then yes), and
  the two clocks (5-day, 3-day).
- **M2.6** (304e66e). Timeline and audit: one `audit` collection every write
  goes through, a timeline component on batch, order and customer, undo that
  reads the `before` value back for 8 seconds. This is where **Q14** came up
  (see section 4), still open.
- **M2.7** (a225139). The seed for batch 001: the prawns-dates product, its
  recipe from the label basis doc's placeholder weights (marked estimated),
  and batch 001 itself, Archived, 22 bottled jars, 0 paid online, every
  number from the v0 handoff. Idempotent, refuses to run twice. Run so far
  only against the emulator: see section 3 for what that means for staging.
- **M2.8** (99979e2). The counter sale: callable `createCounterSale` and
  `voidCounterSale`, and the Sell screen: customer by phone, product or
  open-batch line or custom line, quantity, discount within the role's
  rights (D17), fulfilment, cash, UPI to account or payment link, consent
  ticks, stock moved in one transaction. Same-day void before the bill is
  sent. A tester ran about 175 concurrent sales across nine shapes and never
  oversold once.
- **M2.9** (55edcc6). Documents and numbering: `counters/{series}`
  transactions issuing `LK/26-27/0001` style numbers, a bill issued inside
  the same transaction as a cash or UPI-to-account sale, an A5 PDF drawn in a
  function and stored in Storage behind a short-lived signed URL. A "Bill"
  button on each row of today's sales opens it; the full Orders screen is
  M3.9. Three questions were asked and answered during the task: **D35**
  (Kitchen may open any bill through the callable only), **D36** (a
  payment-link sale is billed at capture, not at save), **D37** (a document
  carries no sentence of its own), **D38** (the door line on a bill is an
  editable settings field).

## 2. Decisions you made this milestone

One line each, so you can see what you have committed to. Full detail is in
`DECISIONS.md`.

- **D21c.** A batch's printed number is stamped when it is bottled, not when
  it opens. Before that it carries a fixed internal reference that never
  changes, so nothing ever has to be repointed.
- **D22.** You edit ingredients and recipes; Sumayya reads all of them; your
  switch lets her edit them too, later.
- **D23.** A batch can be paused from any state that is selling or cooking:
  Open, Half reached, Sourcing, Cooking, In stock, Sold out. Not Draft, not
  Archived.
- **D24.** Claude drafts the three customer messages the brief left blank
  (batch open, half reached for a non-prawns product, back in stock); you
  edit them in Settings; nothing sends itself.
- **D25.** Storage buckets exist on both `lailark` and `tree-quiz-74e04`,
  with the rules deployed.
- **D26.** HSN codes are filled in from public classification, editable on
  the Products screen, for your CA to confirm before GST goes on.
- **D27.** Your laptop has Google application default credentials, so seed
  scripts can write straight to staging.
- **D28.** The `/batch/001` page shows no ingredient percentages, ever. From
  batch 002 on, both the page and the label show them, computed on basis B.
- **D35.** Sumayya can open the bill for any order she needs to, but only
  through a server callable. The books themselves (`documents`, `counters`,
  `refunds`, `settlements`) stay shut to her.
- **D36.** A counter sale paid by a payment link is billed only once
  Razorpay captures it, not when the sale is saved, because the link can
  expire and a bill number is never reused.
- **D37.** A document (bill, receipt, credit note) is structural only:
  seller block, fields, lines, totals, payment. No sentence of its own,
  anywhere.
- **D38.** The "Handed over at Kunnamangalam" line on a bill is an editable
  settings field, not a constant, with that wording as its fallback.

## 3. How to test

Everything below runs against the **local emulator**, the same way Milestone
1's laptop tests did. This matters: `git log` shows M2.2's products were
seeded to staging on 19 Sep, but nothing from M2.3 onward (the state machine,
batch 001, the counter sale, the documents and bill PDF) has a recorded
staging deploy or a staging seed. **The admin PWA on
`tree-quiz-74e04-admin.web.app` is still the Milestone 1 build.** If you want
to try this milestone on your phone rather than a laptop, ask for that as a
follow-up task; the walkthrough below is laptop plus a phone or another
browser tab signed in against your laptop's emulator, same as Milestone 1
section D.

### A. One-time setup

```bash
npm install
```

Terminal 1, leave running:

```bash
npm run emulators
```

Open `http://127.0.0.1:4000` and leave it open in a tab. This is where you
read sign-in codes (see the note on OTPs below) and can look at Firestore
data directly if anything looks wrong.

Terminal 2, once the emulators are up:

```bash
npm run seed:users -- --emulator
```

```bash
npm run seed:products -- --emulator
```

```bash
node functions/scripts/seed-batch-001.mjs --emulator
```

Each of these is idempotent: running them again does nothing on top of what
is already there.

Terminal 3:

```bash
npm run dev --workspace admin
```

Open the Vite URL it prints (this connects to the emulator automatically in
dev mode, the same as Milestone 1).

### B. Sign in

Type the 10-digit number for Owner (`7736110087`) or Kitchen (`9446587027`),
tap Send code. **The emulator does not honour a fixed OTP.** A different
six-digit code is generated every time (A30). Read it from
`http://127.0.0.1:4000/auth`, the Auth tab, or from the emulator log in
Terminal 1, a line like:

```
i  To verify the phone number +917736110087, use the code XXXXXX.
```

Only the automated tests swap this in for themselves. You will do this by
hand every sign-in against the emulator. Real test phone numbers with fixed
codes exist on staging only (set up during Milestone 1).

### C. Batch 001, entered with its real numbers

1. Tap the **Batches** tab.
2. Open the "Prawns and dates" card, batch 001. It should show Archived, 22
   bottled jars, 0 paid online.
3. Check it against the printed jar and the v0 handoff: best before, sale
   stop, the allergen line, the storage line, the claims.
4. The ingredient line on this record reads "Prawns, dates, vinegar, ..."
   with **no percentages** (D28). This is the one deliberate difference from
   the 22 printed jars, which read Prawns 59%, Dates 22%. That is correct:
   do not read it as a bug.
5. A quantity in the recipe may say "estimated" beside it (A86): the actual
   batch has not been weighed yet, so the figures come from the label basis
   doc's placeholder weights, not a real weighing.

### D. A cash sale at the door produces a numbered bill PDF

Batch 001 is Archived, which is a closed record, not a thing you can sell
from, so an archived batch is never offered on the Sell screen. To test the
money path itself without first walking a fresh batch through several states,
sell a **custom line**. It is the same transaction, the same numbering and the
same bill.

**Sign in as Owner for this.** Only the Owner may type a custom line's wording
and amount (D17). The Kitchen may sell one, but only picking from the lines
you have already set on that product in Products, and if you have set none she
is told so and cannot.

1. Tap the **Sell** tab.
2. Type a phone number, for example `9876543210`. If it is new, you will be
   asked for a name and to confirm the customer is new. Give a name.
3. Pick a product from the dropdown, for example "Prawns and dates". The line
   choice only appears once a product is picked.
4. Two chips appear: **A jar** and **Something else**. Tap **Something else**.
5. Fill in **What was sold**, for example "Test jar", and **Amount**, `649`.
6. Leave quantity at 1.
7. Under payment, pick **Cash**.
8. Tick the consent boxes as you would at the door.
9. Save the sale.
10. You land back on Sell with the sale at the top of today's sales, showing
    what was sold, the phone number, "Cash", and **₹649**. Amounts never print
    trailing zero paise, so ₹649 is right and ₹649.00 would be the bug.
11. On that same row, underneath, you should see a bill number in the shape
    **`LK/26-27/0001`** and a **Bill** button beside it. No tapping into the
    row: the number and the button are on the row itself.
12. Tap **Bill**. A new tab opens the PDF. Check it carries: Lailark Kitchen
    with the Kunnamangalam address, the FSSAI number and the support number,
    all matching the printed jar; the bill number and the date; the customer's
    name and number; "Handed over at Kunnamangalam"; the line you sold; ₹649;
    "Cash"; and a total. It must never say "Tax invoice", must carry no GSTIN,
    and must have no em dash anywhere on it.
13. If your phone or browser blocks the new tab, the row says so and asks you
    to allow pop-ups. That is the browser, not a fault in the bill.
14. Sell a second one. Its bill must be **`LK/26-27/0002`**. Numbers are never
    reused and never skip.

If you want to see a real jar counted off a batch rather than a custom line,
create a small test batch first (Batches tab, new batch, pick "Prawns and
dates" since it already has a recipe, fill in the planned jars and both
prices, save as Draft, then use the state button to move it to Open). An open
batch's jars are then offered under **A jar**. This is a longer path and is
not needed to prove the break: the custom line above already exercises the
same transaction, the same numbering and the same PDF.

### E. Void, and the number stands

1. On today's sales list, find the sale you just made.
2. Tap **Void**, give a reason, confirm.
3. The row shows a voided chip, and tells you how many jars went back to the
   batch. A custom line with no batch behind it returns none, which is right.
4. The bill number **stays on the row**, and beside the Bill button it now
   reads "This bill is marked void." Tap **Bill** again: the PDF still opens,
   now marked void across the page.
5. Sell again. The next bill is the **next** number, not the voided one. A
   voided sale keeps its number for good (brief 13.3): a number is never
   reused, never deleted, and never has a hole in it, because that register is
   what the CA reads.
6. Void only works the same business day, 05:00 to 05:00 Asia/Kolkata (A89).
   Outside that the Void button is replaced by "The bill has gone, so this is
   Shefin's to cancel with a credit note." That is expected, not a bug.
   Credit notes themselves are built but not yet wired up; they arrive with
   refunds in M4.5.

### F. The rest of the milestone, briefly

- **Approvals and Today.** Take a fresh Draft batch through Open, and add
  enough holds (or use a small `plannedJars`) to cross the half mark. A
  "Waiting on you" card should appear on Today with Yes / Not yet with
  reason / Edit then yes. Saying yes should move the batch on and record the
  drafted message as sent-pending (nothing is actually sent yet; that is
  Milestone 3's D32 manual-send path).
- **Timeline and undo.** Edit any batch field (a weight or a cost on the
  Batches detail screen), then look for the undo toast and tap it within 8
  seconds. Open the batch's timeline and confirm both the edit and the undo
  show up.
- **Ingredients and recipes.** Under Products, More, open an ingredient or a
  recipe as Kitchen: you should be able to read every field but not edit
  any, until you turn `kitchenCanEditRecipes` on (Firebase console only for
  now; the Settings screen toggle is M5.8).

### G. Laptop: build, lint, test

```bash
npm run build
```

```bash
npm run lint
```

```bash
npm test
```

This runs the full suite against the emulator (shared, functions unit and
emulator, site, admin unit and e2e, rules) and takes several minutes, longer
than Milestone 1's minute and a half, because there is far more here now.

**One known flake, worth a line.** `npm test` occasionally exits with code 2
after every suite has already printed as passed, with `Error: An unexpected
error has occurred.` at the very end. That is firebase-tools failing to shut
the emulators down cleanly, not a test failing. If you hit it, scroll up and
check the per-suite pass counts (shared, functions, site, admin, rules) each
say every test passed; re-running the command usually exits cleanly the
second time.

### H. Batch 001 on the customer site: unchanged

```bash
npm run check:batch-001
```

Nothing in this milestone touched the customer site, so this should still
pass exactly as it did at the Milestone 1 break.

## 4. The one open question

- **Q14** (raised in M2.6, still open). Brief §18.1 names two places history
  could live: the `audit` collection this milestone actually built and wired
  everywhere, and `orders/{id}/events`, which has rules and seed coverage
  from Milestone 1 but nothing writing to it. Two timelines for the same
  order would drift apart, and the one that drifts is the one nobody is
  looking at. **The question: should `audit` be the only history, and
  `orders/{id}/events` dropped before Milestone 3 builds more order
  writes?** If you do nothing, `audit` stays the only thing written,
  `orders/{id}/events` stays untouched and empty, and Milestone 3 carries on
  building against `audit` alone, which is the de facto answer already in
  the code.

## 5. What is known-unfinished

Not broken, not built yet:

- **The Orders screen itself.** Today the only way to reach a bill is the
  "Bill" button on Sell's today's-sales list (M2.9). Browsing, filtering and
  searching every order, with its lines, jar numbers, payment, documents,
  kitchen note and timeline, is **M3.9**.
- **The customer site and checkout.** Nobody can buy a jar online yet. That
  is all of **Milestone 3**: the design system (M3.1), home page (M3.2),
  product pages (M3.3), batch record pages (M3.4), checkout (M3.5), the
  Razorpay webhook (M3.6), open-batch mechanics end to end (M3.8).
- **Refunds.** Recording a refund made in the Razorpay dashboard, by UPI or
  in cash is **M4.5**.
- **Sending anything to a customer by WhatsApp.** Every message this
  milestone drafts (D24) stops at an approval waiting for you. Nothing goes
  out. At launch, sending stays a manual step: a prefilled `wa.me` link you
  or Sumayya tick as sent (**D32**), not something the system does.
- **Packing and shipping.** Assigning jar numbers, a packing cost, an India
  Post consignment number, marking Delivered, is **M4.1**.
- **Moved to Fast-follow by D29, not started until you say so:**
  - **M2.10**, offline counter drafts: a sale started with no signal saves
    locally and finalises when the network returns. Until then: sell when
    there is signal, or note a sale on paper and enter it later.
  - **M2.11**, day close: a Today card totalling a day's counter sales by
    method, jars by batch, cash counted against the till. Until then: add
    up the day's sales by eye from the today's-sales list.
- **This milestone's own admin code has not been deployed to staging.**
  Section 3 above explains why the whole walkthrough runs on the emulator
  for now. Deploying it is a `npm run deploy` you can run whenever you are
  ready; it is not part of this test note.

## 6. Every assumption from this milestone

One line each, plain English, grouped by task. Reply with the id and what to
do instead ("A61: no, do X") to overrule any of them; otherwise they stand.
Full detail for each is in `DECISIONS.md`.

**M2.1, ingredients and recipes**

- A52: rounding and ordering rules for the recipe engine (half up, ties keep
  the recorded order, a percentage only prints on a line flagged as main).
- A53: three fields were added to the ingredient and recipe shapes
  (density, residue weight, finished weight) because the worked example
  needed them; the engine refuses to guess rather than compute silently
  wrong numbers.

**M2.2, products**

- A55: the three pipeline products (Duck, Yam, Rabbit) are named plainly and
  start switched off; every product launches at the same price and jar
  size, since nothing in the docs says otherwise.
- A56: which product photo is the "note" photo, and their order, live in the
  Storage object's own metadata, not a Firestore field.
- A57: deleting a product or batch photo is its own rule clause, Owner only.
- A58: a product price must be a whole number of paise from 1 up to ₹649; a
  custom line can be any whole number of paise, since it has no list price
  to check against.

**M2.3, the batch state machine**

- A59: the transition table lives in a plain module with no Firebase in it,
  so every row is unit-testable on its own; the Owner can call anything
  Kitchen can.
- A60: a held jar records which customer it belongs to, so the per-person
  limit can be enforced honestly, both for open-batch bookings and in-stock
  purchases.
- A61: exactly one clock (5-day or 3-day) is ever live on a batch at once.
- A62: answering the "full" flag is its own callable, separate from a state
  change, since reaching full does not move the batch's state.
- A63: a paused batch still blocks a second batch of the same product from
  opening (only a cooking batch releases that block, per D15).

**M2.3a, folding in your answers**

- A64: a batch's document id is a permanent internal reference; its printed
  number is a separate field that only exists from bottling on.

**M2.4, batches screens**

- A65: the per-ingredient drift warning fires above 15% away from the
  recipe's own quantity.
- A66: clearing a weight or cost box on the batch screen leaves the stored
  value alone rather than treating a blank as zero; a deliberate 0 still
  saves.
- A67: each actuals box (weight, cost) writes only its own field, so one can
  never silently overwrite the other.
- A68: planned jars and price stay read-only once a batch exists past Draft;
  the brief implies they are editable while Open, but nothing in the
  transition table supports that yet, so it was left undone rather than
  built unsafely.
- A69: the batch screens hold their own small, read-only copy of the
  transition table just to decide what button to show; the server's own
  copy is what actually enforces anything, so a stale screen copy fails
  safe.
- A70: a typed rupee amount finer than a paisa rounds to the nearest paisa
  rather than being refused.

**M2.5, approvals and Today**

- A71: a card put off with "not yet" comes back at 07:00 Asia/Kolkata the
  next morning.
- A72: the Clocks section only shows batches in Open, Half reached or
  Sourcing; once cooking starts the clock's promise has been kept.
- A73: a "not yet" reason stays visible on the approval after a later yes,
  as the record of why it waited.
- A74: saying yes to a kitchen photo update writes the approved wording onto
  the update itself, not just the approval, so the two can never disagree.
- A75: the wording on Today's ask lines and buttons is the build's own,
  admin-facing copy, not customer copy.
- A76: the no-em-dash rule is enforced on every customer sentence you can
  type, and also catches the en dash and a plain horizontal bar, since those
  are what a phone keyboard actually produces.

**M2.6, timeline and audit**

- A77: an audit entry also records which fields changed, what it undoes,
  and whether a person or a function wrote it.
- A78: the 8-second undo window is only the toast's own timer; nothing on
  the server re-checks how old an entry is before allowing an undo.
- A79: the per-ingredient actuals boxes are recorded in the trail but have
  no undo button of their own yet.
- A80: the timeline itself is read-only; undo only ever lives on the
  write's own toast.
- A81: a timeline entry shows the person's stored name, falling back to
  their raw account id if there is no readable record.
- A82: a new Firestore index was added for the timeline query; the emulator
  does not enforce indexes, so nothing would have caught its absence before
  a real deploy.
- A83: an audit entry is refused unless the change it describes is really
  happening in the same write, so nobody can append fake history.
- A84: a product's prices and every custom line amount are now checked by
  value in the security rules themselves, the same way batch costs already
  were.
- A85: not every write is audited yet. Ingredient and recipe writes, new
  products, and non-money product fields still write directly with no
  timeline entry and no undo.

**M2.7, seeding batch 001**

- A86: batch 001's seeded recipe uses the label basis doc's placeholder
  weights, so its computed percentages (35% / 23%) will not match the
  printed jar's (59% / 22%) until the real batch is weighed. Every seeded
  quantity is marked "estimated" on screen so it can never be mistaken for
  a measured figure. The allergen, claims and storage lines do match the
  jar exactly.
- A87: no ingredient in the seed carries nutrition figures; an earlier draft
  put the finished jar's own protein number onto raw prawns, which was
  wrong, so this was removed rather than left wrong. An empty figure reads
  as "not known," never as zero.
- A88: batch 001's internal id is fixed (`b-001001`) and the seed refuses to
  run a second time at that id, so there is no way to accidentally create a
  second "batch 001."

**M2.8, the counter sale**

- A89: "same day" for voiding a sale is the business day, 05:00 to 05:00
  Asia/Kolkata, not the calendar date.
- A90: an order's own id is a short unguessable reference, not a sequential
  number; the sequential, unbroken number is the bill number from M2.9,
  which is a separate series.
- A91: a single custom line is capped at ₹1,00,000 as a typing guard only,
  since a custom line has no list price to sanity-check against.
- A92: a counter sale carries no policy-version stamp, since nobody at the
  door was shown a web policy page; the marketing-consent tick starts off,
  the bill-and-updates tick starts on.
- A93: one line per counter sale. A cart with several lines is the web
  checkout's job, arriving in Milestone 3.
- A94: every sale attempt carries a key the screen mints once, so the same
  tap delivered twice (a slow connection, a retry) writes one order and
  charges once, not twice.
- A95: a custom line tied to a batch takes a jar off that batch's count and
  adds one to the customer's own history, the same as an ordinary line; its
  void gives back exactly what the sale took.
- A96: a refusal shown at the counter has its HTTP status code stripped off
  the end, since that is for a log, not for Sumayya to read to a waiting
  customer.

**M2.9, documents and numbering**

- A97: the bill PDF is drawn with `pdf-lib`, the one new dependency in
  `functions`, chosen over rendering a page through a headless Chromium
  browser, which is far heavier for one A5 page.
- A98: the rupee sign is drawn as vector paths on the PDF rather than typed
  through a font, because the standard PDF fonts cannot print it at all.
- A99: a discount is not printed as its own line item; it comes off under
  the subtotal, once, with its reason beside it, so the same amount is
  never shown twice.
- A100: a document is a frozen snapshot of the seller, customer, delivery
  line and money at the moment it was issued, not something that changes if
  the customer's name is corrected later.
- A101: against the emulator, the bill link is an ordinary fixed-token
  download URL and says so in the response (`signed: false`), because the
  emulator cannot produce a real signed URL. Production uses a real
  10-minute signed link.
- A102: `settings/seller` overrides the seller's printed details field by
  field, so a new address or a renewed FSSAI licence is a settings change,
  not a deploy. The GSTIN field has no fallback: it is never invented.
- A103: if GST is ever switched on, the money-splitting code refuses to run
  rather than silently issuing zero-tax invoices, since that arithmetic is
  out of this milestone's scope.
- A104: a Storage trigger that cannot find or make sense of a document skips
  it quietly instead of throwing, because throwing was found to bring down
  concurrent counter sales along with it.
- A105: a bill PDF's embedded creation date is the issue date, not the
  moment it happens to be re-rendered, so re-rendering the same bill later
  produces a byte-identical file.
- A106: if a void cannot mark its own bill as voided, the void still goes
  through (the jar comes back, the sale is voided) and an urgent Concern is
  raised for you, rather than blocking the whole void and leaving the count
  wrong.
- A107: that Concern's id is derived from the order, so a retry raises one
  Concern, not a pile of duplicates.
- A108: the PDF renderer leaves a blank for any single missing field rather
  than throwing and taking the function down.
- A109: nothing on a bill is ever truncated; long text wraps or is broken
  character by character rather than cut short.
- A110: a `documents/{id}` row can only ever be created in one place in the
  code, using a Firestore create (which fails if the id already exists)
  rather than a set (which would silently overwrite), so a bill number
  genuinely cannot be reused by accident.
- A111: a customer name with characters a PDF font cannot print (ordinary in
  Kunnamangalam, which is in Kerala) falls back to printing their phone
  number instead, once, not blank and not twice.

## 7. What to reply with

Bugs you found, any assumption you want to overrule (by its id, for example
"A89: no, do X instead"), your answer to Q14, then the word `continue`.

After that, here is the merge that follows, for you to run when you are
ready (not something to run now):

```bash
git checkout main && git merge --no-ff milestone-2-kitchen-and-counter && git tag v2.0 -m "Milestone 2: kitchen and counter" && git push origin main --tags
```

Run `/clear`, then say next.
