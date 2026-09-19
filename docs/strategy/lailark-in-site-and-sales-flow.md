# Lailark.in: Website and Sales Flow

Working doc, **v2**. Started 10 Sep 2026, revised 14 Sep 2026.
Owner: Shefin. Kitchen: Sumayya.

**Read with `lailark-admin-flow-billing-brief.md` (v2, 15 Sep).** Where the two disagree, the admin brief is newer and wins; section 25 of the brief lists every disagreement. Where the brief and `../../DECISIONS.md` disagree, DECISIONS.md wins.

**What changed in v2.** The drop mechanics were rewritten. Payment is now taken in
advance at entry, there is no draw, there is no closing time and no date is shown to
the customer. The v1 model (free entry, allocation at close, a draw when oversubscribed,
a 24 hour pay window) is retired and should not be built.

Voice: kind, human, unhurried. No em dashes in copy.

---

## 1. What Lailark is

A small kitchen in Kunnamangalam, Kozhikode, that makes oil-based pickles in limited
batches. Three of the four heroes carry dates, which is the signature. The website is
the window into the kitchen, not a shop with shelves. Scarcity is real, not staged: a
batch is 15 to 40 jars.

## 2. Products

**Heroes (launch)**

| Product | Notes |
|---|---|
| Prawns and dates | Batch 001 done, 22 jars of 200 g |
| Squid and dates | First batch estimated ~15 jars |
| Beef and dates | Batch may go to ~40 jars. Shipping caveat parked, see 7 |
| Koorka | Seasonal, roughly Nov to Feb. Only vegetarian hero |

**Pipeline**: duck, yam, rabbit. Rabbit is confirmed permitted and commonly farmed, so
it can appear on the site.

Jar: 200 g. In stock ₹649. On an open batch ₹599. Larger jar (500 g at ~₹1500) parked.

## 3. The two modes on the site

**In stock.** A finished batch. Real count shown, always. Buy, pay, ships in a package
with Sumayya's handwritten note. Limit 2 jars per person per batch. When it is gone the
card flips to the next batch.

**Open batch.** The pickle does not exist yet. A batch is listed with a size and a
price. People pay for a jar and their jar is theirs. There is no closing time, no draw,
and no promised date. The batch simply fills. Limit is a quarter of the batch per
person, rounded down, minimum 1.

The two modes together mean the site never looks empty. A sold-out hero becomes an open
batch, not a blank shelf.

## 4. The batch lifecycle

**States**: Draft → Open → Sourcing → Cooking → Bottled → In stock → Sold out →
Archived. Side state: Paused (shortage). (The admin brief, section 8, inserts "Half
reached, waiting on owner" between Open and Sourcing. Build the brief's version.)

**How a batch actually runs**

1. Admin opens a batch with: size (jars), price, per-person limit (defaults to a quarter
   of the size).
2. The batch page shows the size, how many jars are paid for, and how many more are
   needed to reach half. Nothing else. No countdown, no date.
3. A customer pays at entry. Payment is the entry. Their jar is reserved from that
   moment, so there is nothing to allocate and nothing to draw.
4. **At half paid, sourcing starts.** Production begins within 5 days.
5. **If the batch fills completely, production starts within 3 days.**
6. The 5 and 3 day figures are operating commitments, not published promises. The
   customer is told that half fill starts the cooking, and after that the agent carries
   the updates.
7. Everyone who has paid into an open batch gets a **share link**. Their incentive is
   real and needs no persuasion: filling the batch is what starts the cooking.
8. Jars left unsold when production ends become in-stock stock at ₹649.
9. Dispatch within 3 days of bottling.

**Why payment at entry.** A paid entry is a commitment and a free one is a maybe. At
half fill you know the batch is worth buying prawns for. The cost is that money is held
before the pot goes on, which makes section 5 and the Razorpay refund path load-bearing.

**What a batch never does.** It never closes, never expires, never runs a draw, never
oversells, and never shows a date it might miss.

## 5. Shortage, refunds, and who decides

There is **no automatic refund and no automatic anything**. The agent raises a concern
into the admin panel, the owner answers, and the answer is what reaches the customer.

**A batch that is filling slowly.** Nothing happens. It stays open. Nobody is chased and
nothing is owed, because nothing was promised for a date.

**Raw material shortage after payment.** The agent messages the customer with a choice
attached, never the bad news alone: wait longer, with an expected date if one is known,
or a refund. If the customer goes silent, the agent raises it to the owner rather than
acting. The owner's answer is the decision.

**A customer who changes their mind.** They ask, the agent raises it, the owner approves
or declines. (Superseded by the brief, section 10: cancellations are not advertised, the
agent invites a phone call.)

**Consequence worth naming.** Because nothing is automatic, the owner's response time is
part of the product. Decided: same day.

## 6. Pricing

- In stock: ₹649 per 200 g.
- Open batch: ₹599. Fixed, and not moved again. Large enough to thank someone for
  waiting, small enough that nobody trains themselves to never buy in stock.
- Cost reality: prawns-and-dates batch all-in is roughly ₹160 per jar including box.
  Batch P&L in admin keeps this honest.

## 7. Shipping

**India**: all pickles ship nationwide.

**Beef**: some states restrict possession or sale, and most couriers list meat as
restricted. **Parked at this stage of the business.** The per-product shipping rule and
pincode exclusion list get built anyway, because they cost nothing once the Product
object exists, and stay switched off.

**Outside India**: no direct international shipping yet. (Superseded by the brief,
sections 7A.5 and 11.6: a line at the end of the home page, the WhatsApp agent gathers
the details, the owner reviews and sends a payment link.)

## 8. The agent

(Superseded in part by the brief, section 15: WhatsApp only in v1, no agent on the
website.)

**Duties**

- Production updates once a batch passes half, in Sumayya's voice: squid arriving,
  frying, bottling, boxing. Three or four photos per batch.
- Shortage conversations with a choice attached (5).
- Answering "when will mine arrive" without inventing a date.
- Escalation to a human when asked; the human answers the same number by normal call,
  international customers via Botim.

**Guardrails**

- Offer, never pressure.
- Never break bad news without a choice attached.
- **Decides nothing.** Every refund, delay, exception or goodwill gesture is raised to
  the owner and waits for an answer.
- Mandate: keep sales sustainable, which means keep the customer, not just the order.

**In admin.** Every conversation is readable. The ones waiting on the owner sit at the
top of the Today screen and are the reason that screen exists.

## 9. Sumayya's note

Handwritten, photographed, never a font. On the site it is the last image in every
product's photo set, arriving after the food has done the selling. In the box, the real
thing.

## 10. The design system

Decided 14 Sep 2026. Derived from the printed label, which is the most resolved piece of
Lailark design that exists.

**Palette.** Four colours with one job each, plus two neutrals.

| Colour | Hex | Job |
|---|---|---|
| Ink | #17150F | Type, marks, buttons. A warm black |
| Paper | #FAF8F4 | The ground. Warm, so it sits beside the label without looking cold |
| Rust | #A34A28 | Numbers that count. Batch number, jars paid, jars left, jar number |
| Leaf | #2F5D3A | Claims only. No added preservatives. Prepared by traditional method |
| Grey | #6E665A | Secondary text. Warm-biased, reads as faded ink |
| Hairline | #E4DDD0 | The one divider weight, used rarely |

Rules: rust is a number colour, not a brand colour, and never lands on a button or a
heading. Leaf only ever touches a claim. There is no fifth colour; when something needs
separating the answer is space, then size, then the hairline.

**Type: Editorial.** System faces only, nothing loaded over the wire.

- Names and headings: `ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif`
- Reading text: the system sans stack
- Anything a customer might check against the jar (dates, weights, counts, batch
  numbers): the system mono stack

**Ground: Plate**, on warm paper rather than pure white, photography leading. Decided:
the home page is Plate on paper (brief, section 0). Everything past the home page is
paper.

**Motion**, three pieces, each with one place to live:

- **Settle.** Jars arrive with a small drop and half a degree of overshoot, staggered 70
  ms. Home page, first paint, once per session.
- **The count.** Jars drawn as marks rather than written as a number. Appears wherever a
  jar count appears, which by earlier decision is everywhere a jar appears.
- **The oil.** A gradient moving on a 30 second cycle, behind the hero only. It is the
  only purely atmospheric thing on the site.

All three honour `prefers-reduced-motion`. The orbit is **not** being built. It stays a
named piece of work for after batch 003.

**Rules that survive from v1**

- Light enough for a phone on Kerala 4G.
- Jars left, or jars paid, is always shown, everywhere a jar is shown.
- `/batch/<nnn>` stays static HTML on disk forever. It is a record, printed jars point at
  it, and it must resolve on a day the database is down.

## 11. Admin

(Expanded in full by the brief, sections 17 and 18. The object model here is the seed.)

Built for two people on phones in a kitchen. Inspiration: the Shopify mobile app, plus
the two things Shopify does best: a timeline on every object, and undo instead of
confirm dialogs.

**Principles**

- The Batch is the centre, not the Product.
- Every number is editable in place. No edit screens.
- Every object shows its timeline, including what the agent did.
- Undo toasts, never "are you sure?".
- No analytics module. Jars sold per batch and margin per batch are the only numbers
  that matter, and the batch screen shows both.

**Object model**

- **Ingredient**: label name, allergen tags, nutrition per 100 g (Indian Food Composition
  Tables), unit cost, source.
- **Recipe** (per product): ingoing quantities, expected yield. The label's ingredient
  list, percentages, allergens and nutrition come from here.
- **Batch**: what actually happened. Actual quantities, actual costs, actual yield, jar
  count, source and dates for the QR page. Drift beyond tolerance on a major ingredient
  flags for label review.
- **Order**: line items tied to a batch. State, note for Sumayya, courier, tracking.
- **Customer**: purchases, repeat count, country, share link, notify-me lists.
- **Label**: generated. Recipe fields plus batch fields.
- **Concern**: raised by the agent, waiting on the owner. Subject, customer, what the
  agent proposes, the owner's answer, what was sent.

**Three weights for the main ingredient, per batch**

| Weight | Used for |
|---|---|
| Raw (before cleaning) | Cost. This is what was paid for |
| Cleaned | Ingoing weight at time of manufacture. Label percentage basis. Nutrition input |
| Cooked | What is in the jar. Yield learning |

Over time the ratios become the recipe's yield assumptions, so a planned 20 jars becomes
a confident 22.

**Percentage basis.** Settled in `label-ingredient-percentage-basis-fssai.md`: one
switch in the recipe engine, default basis B (the main ingredient's cleaned raw weight
over the ingoing total minus the evaporated vinegar, about 400 g of the 2 kg taken as
retained). The `/batch/001` page shows no percentages; from batch 002 they are shown
(D28).

**Nutrition.** Total nutrients ingoing, divided by finished weight, accounting for
absorbed frying oil. Calculated values are an accepted basis in India; send the first
recipe of each product for one lab test to calibrate the calculator.

**Batch P&L.** Revenue, cost, margin, margin per jar. Costs must include packaging, the
box, the gateway fee and the courier.

## 12. Label

Three panels. Left black panel, "The Malabar Edit" story. Centre white panel: name, QR,
Bottle Batch №, ingredients with percentages, allergens, no added preservatives line,
nutrition per 100 g, non-veg mark, net wt, MRP and per-gram price, packed on, best before
6 months, storage, support number, www.lailark.in, FSSAI number, product of India,
manufacturer footer. Right black panel: ingredient word list, PICKLE wordmark, "Made in
small batches in kozhikode kerala", lark logo, line-art prawn.

**From recipe**: ingredient list and percentages, allergens, nutrition, veg mark, storage.
**From batch**: batch number, packed on, best before (computed), jar count, jar number.

**QR** points at the batch page.

## 13. Payments and compliance

- Razorpay: proprietorship under personal PAN with FSSAI registration as business proof.
  Brand name set to Lailark Kitchen so that is what shows at checkout.
- **Refunds must be tested before launch, not after.**
- International cards are a separate activation and stricter for individuals. Test an
  overseas card before launch.
- December re-registration (LLP or Pvt Ltd) means a new PAN and a new Razorpay account,
  not a transfer. Keep merchant keys in one config so the swap is an afternoon.
- FSSAI Basic Registration caps turnover at ₹12 lakh/yr. KOB mismatch (should be Petty
  Food Manufacturer) still to fix.
- No GST, no Udyam yet.
- Not legal or financial advice; verify with a CA before launch.

## 14. Decision ledger

| Decision | Status |
|---|---|
| Payment taken in advance at entry | **In**, 14 Sep |
| Draw when oversubscribed | **Dropped.** No draw anywhere |
| Closing time on a batch | **Dropped.** A batch stays open until it reaches half |
| Dates promised to customers | **Dropped.** Progress is shown, dates are not |
| Half fill starts sourcing, production within 5 days | **In** (with owner approval first, per the brief) |
| Full batch, production within 3 days | **In** |
| Share link for everyone who has paid into a batch | **In** |
| ₹599 batch, ₹649 in stock, fixed | **In** |
| Quarter of a batch per person, 2 in stock | **In** (quarter of the bookable 90%) |
| Automatic refunds | **Dropped.** Agent raises, owner decides |
| Production updates to paid customers | **In** |
| QR to batch page with source, dates, jar count | **In** |
| Always show the count | **In** |
| The orbit homepage | **Dropped** for now. Revisit after batch 003 |
| Season pass, batch-day livestream, seasonal named batches, gift flow | **Later** |

Rule: every pattern is a promise. Add one per batch, after the previous one held.

## 15. Still open at v2 (all since closed, see the brief and DECISIONS.md)

1. Percentage basis on the label: settled, basis B.
2. Home page ground: Plate on paper.
3. Owner response time: same day.
4. Change-of-mind wording: not published, quiet Orders page.
5. Stack: Firebase, Firestore, Cloud Functions in TypeScript, Next.js site, Preact admin.
