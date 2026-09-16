# Lailark.in: Admin, Business Flow and Billing Brief

Working brief, **v2**. Started 15 Sep 2026, revised the same day after Shefin's answers.
Owner: Shefin. Kitchen: Sumayya.
Builds on `lailark-in-site-and-sales-flow.md` (v2). Where the two disagree, this brief
is newer, and every disagreement is named in section 25.

**Build note (16 Sep 2026).** Every item in section 24.2 has since been decided; the
answers are in `../../DECISIONS.md`, which wins over this brief wherever they differ.
Stack decisions that changed after this brief: functions in **TypeScript**, customer site
in **Next.js** (static export), admin in **Preact**, admin sign-in by **phone number**
(Firebase Phone Auth) rather than Google. The admin is served on the second Hosting
site's default `.web.app` URL, not `admin.lailark.in`.

Not legal, tax or financial advice. Every compliance point here is a starting position
to take to a CA and a food consultant, not a conclusion.

Voice for anything a customer reads: kind, human, unhurried, "we", no em dashes.

**What changed in v2 of this brief.** Offline and in-hand sales added, with the admin as
the one POS for every sale (section 7A). Stack reworked for Firebase and Firestore, which
lailark.in is already connected to (section 19). Agent is WhatsApp only. Half-fill
messages wait for the owner. Pre-booking capped at 90%. Cancellations are not advertised
and are handled by a phone call. Launch without GST, GST-ready from day one. In-stock
jars ship the next day. Shipping free, with a switch. Courier costs, packing costs and
RTO rules changed. English only.

---

## 0. How to read this

Sections 1 to 3 set the ground. Sections 4 to 14 are the flows, end to end, in the
order money and jars move, with the counter sale in 7A. Sections 15 to 19 are the agent,
the admin and the machinery under it. Sections 20 to 23 are compliance, edge cases,
security and launch. **Section 24 lists what is decided and what is still open.**

Decided, and applied throughout:

| Item | Decision |
|---|---|
| Owner response time | Same day |
| Home page ground | Plate, on paper. Shefin finishing it with final images and video |
| Point of sale | **lailark.in admin is the master POS for every sale**, online, in hand, phone or WhatsApp |
| Shipping charge | **Free at launch.** A switch turns on a flat fee, or free-on-2-jars, when needed |
| GST | **Launch without GST. System GST-ready from day one**, switched on any time |
| In-stock dispatch | **Next day**, unless a query or delay holds it |
| Agent | **WhatsApp only** in v1. No agent on the website |
| Outside India | A line at the end of the home page. The agent handles whoever messages, the owner reviews |
| Half-fill message | **Owner approves first**, then customers are told |
| Pre-booking cap | **90% of the batch, always.** 10% buffer for a short pot |
| When ₹599 closes | When cooking starts. Unpaid jars go on sale at ₹649 when bottled |
| Yield shortfall | Shortfall falls on the latest payers, owner offers next batch or refund |
| Cancellations and refunds | **Not advertised.** Agent invites a phone call to the owner. Refunds handled in person, SOP written later |
| Courier | **Shiprocket preferred, India Post at the start and as fallback** |
| RTO | **Reship at the customer's cost only.** Returned jar inspected, written off if needed |
| Packaging costs | Box and inserts per batch. Labelling and stickering as extra lines. Default packing cost at shipping, editable per shipment |
| Admin language | English only |
| FSSAI on site | Shown |
| Stack | **Firebase and Firestore** |

---

## 1. What this system has to do, in one paragraph

Take money for jars that exist (in stock) and for jars that do not exist yet (open
batch), whether the customer is on the site, at the kitchen door or on WhatsApp. Record
every sale in one place, give every customer a bill on WhatsApp, and follow up the same
way however they bought. Hold advance money honestly until the pot goes on. Tell the
kitchen what to buy, cook, pack and send, and tell the customer what is happening
without inventing a date. When something goes wrong, raise it to a person and wait. Keep
a record of every rupee per batch. Produce bills, labels and batch pages from the same
records, so nothing drifts. All of it usable by two people on phones in a kitchen.

## 2. Principles that decide the hard cases

1. **The batch is the centre.** Products are templates. Batches are what happened.
2. **One ledger.** Every sale, from any channel, is an order in the same system. There is
   no second notebook, no sale that exists only in someone's UPI history.
3. **Money follows the jar.** Every rupee received is tied to a jar in a batch, or to a
   named custom line. Every rupee returned is tied to the same.
4. **Nothing about money is automatic.** The system proposes, a person decides.
5. **Nothing the customer hears about a batch milestone is automatic either.** The owner
   says yes first.
6. **Never oversell.** A jar is free, held for a few minutes at checkout, paid, or gone.
7. **Say less, never something different.** Site, label, bill and WhatsApp all read from
   the same records.
8. **Every pattern is a promise.** Nothing ships in the customer experience that the
   kitchen cannot keep every single batch.
9. **Build for a bad day.** Batch pages resolve when the database is down. The admin
   works on a weak signal. Undo, not "are you sure".

## 3. Who touches the system

| Actor | Where | Can do |
|---|---|---|
| Customer | Site, kitchen door, phone, WhatsApp | Buy, reserve, ask, change address, ask to cancel |
| The agent | **WhatsApp only** | Answer, inform, collect details, propose. Decides nothing |
| Shefin (Owner) | Admin | Everything. Only role that can answer a Concern, record a refund, discount, change price, approve milestone messages |
| Sumayya (Kitchen) | Admin | Batches, weights, costs, photos, packing, dispatch, **counter sales at list price** |
| Courier | Shiprocket API, or India Post by hand | Pickup, tracking, delivery, returns |
| Razorpay | API and webhooks | Online payments, payment links, UPI QR at the counter |
| Meta WhatsApp Cloud API | API and webhooks | Messages in and out, templates, bills as PDF |
| CA | Monthly export | Bills, refunds, settlement report, state-wise sales |

A third role, **Viewer**, for a CA or a helper, read only. Decided: yes.

---

## 4. The money model

### 4.1 Prices

| Mode | Price per 200 g jar | Per-person limit |
|---|---|---|
| In stock | ₹649 | 2 jars per batch online. Owner may override at the counter, with a reason |
| Open batch | ₹599 | A quarter of the bookable jars, rounded down, minimum 1 |

MRP on the label is ₹649. Selling below MRP is fine. Selling above MRP never is.

### 4.2 Shipping charge: free, with a switch

Launch free across India. **Settings → Shipping** holds one switch with three positions:

| Position | Effect | Shown to the customer |
|---|---|---|
| **Free** (launch) | No shipping line | "Free shipping in India" on every product card |
| Flat fee | One amount per order, editable (₹60 suggested) | "Shipping ₹60" on the card, before checkout |
| Free on 2 jars | Fee on 1-jar orders only, amount editable | "Free shipping on 2 jars, ₹60 on 1" on the card |

Rules for the switch:

- The fee is shown on the product card, not first revealed at payment. A late surprise
  charge is "drip pricing" under the CCPA dark patterns guidelines.
- A change applies to orders started after it, never to a paid order.
- Every change is logged with who flipped it and when.
- Counter sales handed over in person never carry a shipping line.

### 4.3 Payment methods

| Channel | Methods |
|---|---|
| Website | Razorpay Checkout: UPI, cards, netbanking, wallets. Prepaid only |
| Counter, in hand | Cash, UPI through a Razorpay QR for the exact amount, UPI straight to Lailark's account (marked paid by hand) |
| Phone or WhatsApp order | Razorpay payment link sent on WhatsApp |
| Abroad, through WhatsApp | Payment link. International card needs Razorpay's separate activation, so family in India paying by UPI is the likely route at first |

No cash on delivery.

Why a Razorpay QR at the counter rather than the kitchen's own UPI ID: the QR confirms
itself through a webhook, so the sale closes and the bill goes out without anyone
checking a phone. UPI straight to the account is free of gateway fees but must be
confirmed by eye and marked paid. Both are offered; the admin records which.

### 4.4 Unit economics, per jar

Assumptions: making cost ₹160 per jar including box (batch 001 figure), gateway 2% plus
18% GST on the fee (2.36%), courier ₹80 as a cautious single-parcel average. Now that
shipping is free, the courier line is Lailark's.

| | In stock online | Open batch online | In stock, counter, cash |
|---|---:|---:|---:|
| Price | 649.0 | 599.0 | 649.0 |
| Gateway | 15.3 | 14.1 | 0.0 |
| Making, incl. box | 160.0 | 160.0 | 160.0 |
| Courier | 80.0 | 80.0 | 0.0 |
| **Margin** | **393.7** | **344.9** | **489.0** |

Once GST is switched on, 5% sits inside the price: about ₹31 less margin on ₹649 and
₹29 less on ₹599. Razorpay fees are not returned when a payment is refunded.

### 4.5 GST: decided as launch without, ready from day one

**Decision:** launch nationwide without GST registration. The system is built so that
GST can be switched on any day, with nothing to rebuild.

One honest note, said once and then left alone: selling goods from Kerala to another
state usually requires GST registration whatever the turnover, because the small-business
exemption for inter-state sales covers services, not goods. The rate on these pickles
after the September 2025 changes is 5%. Worth a single conversation with a CA about when
to switch it on, and the system makes that switch cheap. Counter sales in Kerala are
intra-state and are not part of this question.

What "GST-ready from day one" means in the build:

- **Every product carries its HSN code** from the start (chapter 16 for prawn, squid and
  beef, chapter 20 for koorka; confirm with the CA).
- **Every order records place of supply**, the customer's state, from the first sale.
  Counter sales record Kerala.
- **A state-wise sales register** runs from the first sale, so if registration is ever
  backdated, the numbers already exist.
- **One setting, `gst.enabled`,** with GSTIN and an effective date. Before the date, bills
  are plain bills that must not show any tax, GSTIN or "tax invoice". From the date,
  tax invoices with CGST and SGST inside Kerala and IGST elsewhere.
- Prices stay inclusive. ₹649 and ₹599 do not change; the tax is backed out.
- Advances for goods: once registered, GST is not paid when an open-batch reservation is
  paid, only when the bill is issued at dispatch. The bill timing below already follows
  that.
- A running turnover figure for the financial year sits on the Money screen, next to the
  ₹12 lakh FSSAI Basic Registration cap.

---

## 5. Customer identity

**No accounts, no passwords.** A customer is a phone number.

- Online checkout asks for: name, WhatsApp number, delivery address in India, pincode.
  Email optional.
- A counter sale asks for: WhatsApp number first (an existing customer fills in by
  itself), then name. Address only if the jar is being shipped.
- The number is the key for the per-person limit, the share link, the order history and
  the agent's memory. A person who bought at the counter in October and online in
  December is one customer.
- "Where is my order" is answered by the agent on WhatsApp, or by a private order link
  sent with the bill (`lailark.in/o/<long random token>`). No login page.
- Limit enforcement is soft: the same number, or the same normalised address, counts as
  the same person. Visible in admin if someone works around it.
- Consent, in plain words. Online: order updates on WhatsApp (needed to fulfil the order)
  and a separate unticked box for "tell me when a new batch opens". At the counter: the
  person entering the sale ticks "customer is happy to get the bill and updates on
  WhatsApp" after asking, and a second tick for new-batch messages if they said yes.

---

## 6. Flow A: buying a jar in stock online

### 6.1 Steps

| # | Customer sees | System does |
|---|---|---|
| 1 | Product page. Jars left, drawn as marks. ₹649. Shipping line per the switch. **Ships the next day** | Reads the batch's available count |
| 2 | Chooses 1 or 2 jars | Limit checked at step 4 |
| 3 | Checkout: name, number, Indian address, pincode | Pincode checked against serviceable list and the product's shipping rule (beef rule built, off) |
| 4 | Pays | Jars **held** for 15 minutes. Razorpay order created with the order id in notes |
| 5 | Payment succeeds | Webhook confirms. Hold becomes Paid. **Bill** generated. Bill and order link sent on WhatsApp |
| 6 | Payment fails or abandons | Hold lapses at 15 minutes. Jars return to the count |
| 7 | Next day: "Packed, jar 9 of 22 is yours" | Kitchen packs. Jar numbers assigned |
| 8 | "On its way" with tracking | Courier pickup |
| 9 | Delivered | Courier event. Gentle check-in two days later |

The checkout has no country field: addresses are Indian. The outside-India path is a
line on the home page and a WhatsApp conversation (section 11.6).

### 6.2 Rules

- **Next-day dispatch** is the in-stock promise. An order paid by the cut-off hour
  (setting, 6 pm) ships the next working day. Sundays and holidays are a
  setting. If a query or delay holds an order, the agent tells the customer before the
  day passes, with the reason in plain words.
- Shown count = bottled jars minus paid, held and written off. Never typed by hand.
- **Shelf-life stop.** FSSAI expects online food to reach the customer with at least 30%
  of its shelf life or 45 days left. On a 6 month best before that is about 54 days.
  Allowing 7 days in transit, **online in-stock sale stops about 120 days after
  packing.** Batch 001 (packed 4 Sep 2026): last dispatch about **2 January 2027**. The
  system hides the Buy button after it and warns 14 days ahead. Counter sales of an older
  jar are still allowed up to best before, with a warning on screen.

---

## 7. Flow B: reserving a jar in an open batch

### 7.1 The 90% cap

Every open batch is booked to **at most 90% of its planned jars, rounded down**. The
other 10% is the buffer for a pot that yields less. Nobody should pay and then hear there
is no jar.

| Planned jars | Bookable (90%) | Half of bookable | Per-person limit |
|---:|---:|---:|---:|
| 15 | 13 | 7 | 3 |
| 20 | 18 | 9 | 4 |
| 22 | 19 | 10 | 4 |
| 40 | 36 | 18 | 9 |

**What the card shows as the batch size:** the bookable number, not the planned one
(decided). Half is counted on the bookable number, rounded up. Anything the pot gives
beyond the bookable jars goes on sale in stock at ₹649.

### 7.2 Steps

| # | Customer sees | System does |
|---|---|---|
| 1 | Batch card: jars open for booking, jars paid, how many more to reach half. ₹599. No date | Reads the batch counts |
| 2 | The plain promise before paying (7.4). **No cancellation line** (section 10) | Copy from settings |
| 3 | Chooses jars, up to the limit | Limit checked against the number, across all their orders in this batch |
| 4 | Pays ₹599 per jar | Hold, then Paid. **Receipt** (not a bill yet) and share link on WhatsApp |
| 5 | Waits | Nothing is chased. No reminders below half |
| 6 | Batch reaches half | **Owner is asked first** (7.3). Customers hear nothing yet |
| 7 | Owner says yes | Everyone paid: "Half the batch is paid for. We are arranging the prawns now." |
| 8 | Fish bought, pot on | Photo update in Sumayya's voice, after owner approval |
| 9 | Batch fills to 90% | Owner asked first again. On yes: "The batch is full." |
| 10 | Bottled | "Bottled today. Yours is jar 9 of 22." **Bill** generated now |
| 11 | Dispatched | Tracking |
| 12 | Delivered | Check-in two days later |

### 7.3 The half-fill approval

When paid jars reach half of bookable:

1. The batch flips to **Half reached, waiting on you**. Sales continue. The 5-day
   production clock starts, because the commitment is to the kitchen, and the owner sees
   it counting.
2. Owner gets a WhatsApp nudge and a card at the top of Today: "Batch 003 is half paid.
   10 of 19. Start sourcing and tell customers?"
3. Owner answers:
   - **Yes:** batch moves to Sourcing, the drafted message goes to every paid customer.
   - **Not yet, with a reason** ("no prawns this week"): batch stays open, customers hear
     nothing, the card comes back next morning.
   - **Edit message, then yes.**
4. The same pattern applies to **batch full**.

### 7.4 The promise on the batch page, before paying

Draft, for tone:

> This batch is not cooked yet. When you pay, your jar is kept for you. Once half the
> batch is paid for, we buy the prawns and start cooking, and we will send you photos
> from the kitchen as it happens. We do not put a date on it, because the sea does not
> keep one.

### 7.5 When ₹599 closes (decided)

₹599 stays while the batch is Open or Sourcing. **When cooking starts, booking closes.**
The card reads "Being cooked now. Unpaid jars go on sale when bottled" with a notify-me.
At Bottled, every unbooked jar goes on sale in stock at ₹649, and everyone on the
notify-me list is offered a message (owner approves the send).

### 7.6 A batch that never reaches half

Publicly, nothing happens: no closing time, no expiry.

Underneath, one technical wall: **Razorpay refunds fail on payments more than 6 months
old.** The bank refuses them. A reservation from October on a batch still short in April
could only be refunded by hand, by UPI or bank transfer.

Decided (16 Sep): the system raises a silent Concern for the owner at **30 days** on a
batch still below half, and again at **140 days** on any held payment in a batch that
has not started cooking. Nothing is sent to anyone. The owner decides whether to cook
smaller, offer a move to another batch, call people, or wait.

### 7.7 Yield shortfall (decided)

The 90% cap makes this rare. If the pot still comes up short of paid jars:

- The shortfall falls on the **most recently paid** orders.
- A Concern is raised per affected customer with the proposal: a jar from the next batch
  of the same product at ₹599, or a refund.
- The owner answers, usually by calling. The outcome is recorded.

The three-weight yield learning tells you over time whether 10% is more buffer than
needed. The cap stays a setting.

---

## 7A. Flow C: sales entered in the admin (the POS)

Every sale that does not start on the website is entered here: at the kitchen door, at a
stall or event, a phone order from an aunt in Kochi, a WhatsApp order, an order from
abroad that the agent has gathered. The admin is the one POS. What happens after the
sale (bill, WhatsApp, follow-up, stock, P&L) is exactly the same as an online order.

### 7A.1 The New sale screen

One screen, top to bottom, big buttons, done in under a minute at the door.

1. **Customer.** WhatsApp number first. If known, name and last address fill in and
   their history shows in one line ("3 jars before, last in November"). New: name.
2. **What.**
   - Pick a product. The system suggests the batch: oldest in-stock batch first.
   - Or reserve from an open batch at ₹599, counted inside the same 90% cap.
   - Or a **custom line**: a free description and an amount, for anything that is not a
     standard jar (a tasting pot, a gift set, a bulk order at an agreed price). A custom
     line can be tied to a batch so jars still leave the count.
   - Quantity. Price prefilled from the batch.
3. **Amount.** The total shows large. **Kitchen role** sells at list price, and may give a
   discount up to the cap in Settings (₹50 at launch) with a reason. **Owner** can change
   any price or give any discount, with a short reason. A standard jar can never be sold
   above ₹649 MRP.
4. **Fulfilment.** Handed over now · Ship to an address · Collect later.
5. **Payment.**
   - **Cash.** Marked paid on save.
   - **UPI, Razorpay QR.** A QR for the exact amount appears on the phone; the customer
     scans; the sale closes by itself when the webhook arrives.
   - **UPI to Lailark's account.** Seller confirms by eye, taps Paid, optionally types the
     last 4 of the UPI reference.
   - **Payment link.** For phone, WhatsApp and abroad orders. Link sent on WhatsApp.
     Jars held until the link expires (default 24 hours, editable). Order waits as
     Awaiting payment.
   - **Part paid.** Allowed for custom bulk orders only, owner role, balance tracked.
6. **Consent ticks.** "Happy to get the bill and updates on WhatsApp." "Wants to hear when
   a new batch opens."
7. **Save.** Stock is taken in one transaction. If a jar went in the meantime (someone
   bought the last one online), the screen says so before saving.

### 7A.2 What happens after Save

| Step | Handed over | Ship | Collect later |
|---|---|---|---|
| Bill number issued | Now | Now for in stock, at bottling for an open batch | Now |
| Bill on WhatsApp as a PDF | Now, if consent ticked | Now | Now |
| No consent | Bill shown as a QR on the phone to scan, or printed | Same | Same |
| Order state | Delivered | To pack (next day) | Ready for collection |
| Agent follow-up | "How's the jar?" 3 days later | As online | Reminder if not collected in 3 days |
| Notify list | Added if ticked | Same | Same |

### 7A.3 Day close

At the end of a day with counter sales, a **Day close** card on Today:

- Sales by method: cash, Razorpay QR, UPI to account, links paid.
- Jars out, by batch.
- Cash counted: typed in. Any difference shows, with a note field.
- UPI to account: a list of what was marked paid by hand, to check against the bank app
  once.

### 7A.4 When there is no signal

A counter sale can be started and saved as a **draft on the phone** with no network. The
draft holds the customer, lines and payment method. When the phone is back online the
sale is finalised: stock taken, bill number issued, WhatsApp sent. If stock ran out in
between, the draft is flagged rather than saved. Cash in hand is recorded either way.

### 7A.5 Orders from abroad, through WhatsApp

1. Someone reads "If you are abroad, message us" on the home page and messages.
2. The agent explains, in a few kind lines, that Lailark does not ship outside India yet
   and asks for **an Indian address to send it to**: someone travelling to them, or
   family. It collects: the buyer's name and country, the Indian recipient's name,
   number and full address, jars wanted.
3. The agent creates a **draft sale** with all of it and raises it to the owner.
4. Owner reviews in the New sale screen (already filled), adjusts, and sends a payment
   link.
5. From payment on, it is a normal shipped order. Updates go to the buyer; delivery
   messages also go to the Indian recipient if the buyer agreed.

### 7A.6 Who can do what at the counter

| Action | Owner | Kitchen |
|---|:-:|:-:|
| Counter sale at list price, cash or UPI | ✓ | ✓ |
| Payment link | ✓ | ✓ |
| Custom line | ✓ | ✓, at an amount set by the owner in Products |
| Discount up to the Settings cap (₹50), with reason | ✓ | ✓ |
| Discount beyond the cap, price change, part payment | ✓ | |
| Override the per-person limit | ✓ | |
| Void a sale entered by mistake (same day, before the bill is sent) | ✓ | ✓ |
| Cancel a sale after the bill is sent | ✓, by credit note | |

---

## 8. Batch lifecycle

### 8.1 States

```
Draft → Open → Half reached (waiting on owner) → Sourcing → Cooking → Bottled
      → In stock → Sold out → Archived
Paused ← from Open, Half reached, Sourcing or Cooking (shortage)
```

### 8.2 Transitions

| From → To | Who | Button asks for | System does | Customers hear |
|---|---|---|---|---|
| Draft → Open | Owner | Planned jars, price, limit (prefilled). Bookable computed at 90% | Publishes the card. Allocates the batch number | Opted-in list offered a "batch open" message, owner approves the send |
| Open → Half reached | **Automatic at half of bookable** | Nothing | Starts 5-day clock. Asks owner | Nothing yet |
| Half reached → Sourcing | **Owner says yes** | Optional edit of the message | Sends the half message | "Half paid, arranging the prawns" |
| Sourcing → Cooking | Kitchen | Landed date, source, raw weight, cost | **Closes booking at ₹599.** Starts the batch timeline | Photo update (owner-approved) |
| Cooking → Bottled | Kitchen | Cleaned weight, cooked weight, **actual jar count**, packed-on date | Computes best before, shelf-life stop, surplus. Raises yield Concern if short. Issues bills for open-batch orders. Generates label data and the `/batch/<nnn>` page | "Bottled. Yours is jar N of M" |
| Bottled → In stock | Automatic when surplus > 0 | Nothing | Surplus on sale at ₹649 | Notify-me list offered a message, owner approves |
| In stock → Sold out | Automatic | Nothing | Card flips to the next batch or notify-me | Nobody |
| Sold out → Archived | Automatic, once every order is closed | Nothing | P&L locked. Page stays forever | Nobody |
| Any → Paused | Owner | Reason | Freezes sales. Concern per customer | Nothing until the owner answers |
| Batch full (90% booked) | Automatic flag, then owner yes | Optional edit | 3-day production clock replaces the 5-day | "The batch is full", after yes |

### 8.3 Batch number and URL

Global and sequential across products (001 prawns, 002 squid, 003 beef), because
`/batch/<nnn>` has no product in it. Zero padded, printed on the label, never reused.

### 8.4 The batch page

- **While Open or Sourcing:** `/batch/<nnn>` shows the open batch with live counts.
- **From Bottled:** the provenance record, same shape as batch 001.
- The record version is a **static file on Firebase Hosting**, so it resolves when
  Firestore or the functions are down. Live counts come from one small endpoint, and the
  page reads correctly if the count fails to load. How the static file gets published is
  in section 19.

---

## 9. Order and payment states

### 9.1 Order

| State | Meaning | Next |
|---|---|---|
| Draft | Counter sale saved offline, or agent-built sale from WhatsApp | Held, Awaiting payment, Discarded |
| Held | Online checkout started, jars held 15 minutes | Paid, Expired |
| Awaiting payment | Payment link sent, jars held until it expires | Paid, Expired |
| Expired | Hold or link lapsed | Terminal |
| Paid, waiting | Open batch, not bottled | To pack, Change requested, Paused |
| To pack | Jars exist and are allocated | Packed |
| Ready for collection | Counter sale, collect later | Delivered |
| Packed | Jar numbers written, box sealed | Shipped |
| Shipped | Picked up, tracking live | Delivered, Delivery problem |
| Delivered | Courier confirmed, or handed over | Closed after 14 days, Claim |
| Delivery problem | Undeliverable, RTO, lost | Concern |
| Claim | Broken, leaked, wrong jar | Concern |
| Change requested | Asked to cancel, move or redirect | Concern |
| Paused | Batch paused | Concern |
| Refunded, part or full | Money returned, recorded | Closed |
| Voided | Counter sale entered by mistake, same day, before bill sent | Terminal |
| Closed | Nothing more expected | Terminal |

Every order carries a **channel**: web, counter, phone, WhatsApp, abroad.

### 9.2 Payment

`created → authorized → captured → (refund recorded)` for Razorpay payments. Cash and UPI
to account go straight to `captured` with the person who marked it.

- Razorpay Orders API for the site, Payment Links for phone and WhatsApp, QR Codes for
  the counter. All three confirm by webhook.
- **Webhooks are the source of truth,** not the browser redirect.
- Every webhook is verified by signature and stored by event id, so a repeat does nothing.
- A reconciliation job pulls payments, refunds and settlements daily and flags anything
  that does not match an order.

### 9.3 Holds and the last-jar race

Holds are taken inside a Firestore transaction on the batch document, so two people can
never hold the same last jar. A hold counts only while its expiry is in the future, so a
lapsed hold frees the jar even if the clean-up job is late. The second person sees
"someone is paying for the last jar, check back in 15 minutes" and a notify-me.

The rare case: a payment confirms after its hold lapsed and the jar has gone. Treated as
a technical failure, see 21.1.

---

## 10. Cancellations and refunds (decided)

### 10.1 The decision

- **Nothing on the site talks about cancelling or refunds.** No line on the batch card,
  no "change your mind" copy.
- **Only customers who message about cancelling are addressed,** by the agent, on
  WhatsApp.
- **Refunds are handled in person at first.** A written flow and SOP come later, shaped by
  how real customers react.

### 10.2 What the agent says

Decided wording (16 Sep, softer draft, no name):

> Each batch is cooked for the people who have booked it, so we don't usually take
> cancellations. If you do need to cancel, please give us a normal call on
> +91 88919 23827 and we will sort it out with you.

The agent never promises a refund, never refuses one, and never argues. If the customer
replies with a reason (moving house, a family emergency), the agent thanks them and
repeats the invitation to call. It does not negotiate.

### 10.3 What the system does around the call

1. The agent sends the message and raises a Concern: **"Cancellation, expect a call"**,
   with the order, batch, stage and the customer's words.
2. Owner gets a WhatsApp nudge. The Concern sits on Today.
3. If no call comes within a day, the Concern stays open. The agent does not chase.
4. After the call, the owner opens the Concern and taps the outcome:
   - **Kept.** Nothing changes.
   - **Redirected.** New name and address, before packing.
   - **Moved.** To another batch.
   - **Refunded.** Amount, method (Razorpay refund button, UPI, cash), reference. The
     jar goes back into the count if it was not packed. P&L and bills update.
5. Every outcome is kept, with a free note. After a few batches, these notes are the
   raw material for the SOP.

### 10.4 The Orders page (decided: yes)

Two outside rules expect a published policy page, even if the batch pages say nothing:

- The Consumer Protection (E-Commerce) Rules, 2020 ask sellers to display their refund,
  return and cancellation policy.
- Razorpay's activation review looks for refund and cancellation, shipping, terms,
  privacy and contact pages on the live site.

One quiet **Orders** page linked from the footer, written the same way the agent speaks:

> **Orders**
> Each jar is cooked for the person who ordered it, so we don't usually take
> cancellations or returns. In-stock jars ship the next day. Open batches ship after
> bottling. If something has gone wrong, a jar arrives broken or you need to cancel,
> please call us on +91 88919 23827 and we will sort it out with you.

No cancellation fee is ever charged: the E-Commerce Rules do not allow one unless the
seller carries a similar charge when it cancels.

---

## 11. Shipping and fulfilment

### 11.1 Courier (decided)

**Shiprocket is the preferred route. India Post is used at the start, while the
Shiprocket account and rates are being set up, and stays as the fallback** for pincodes
Shiprocket cannot serve or when a pickup fails.

The shipment record carries the courier:

| | Shiprocket | India Post |
|---|---|---|
| Booking | From admin, through the API. Label generated | Booked at the counter. Consignment number typed or scanned into admin |
| Cost | From the API, filled in | Typed in from the receipt |
| Tracking to customer | Automatic, webhook events | Tracking link built from the consignment number. Delivered marked by hand, or by a daily check |
| Shiprocket plans | Free for a few orders a month, ₹199 to ₹499 a month as volume grows | |

Admin setting: **default courier**, India Post at launch, switched to Shiprocket when
live.

### 11.2 The parcel

- One or two 200 g glass jars. Lid taped, shrink band, jar in a sealed zip pouch so a
  leak stays inside. Insert. Box.
- Keep the box small: couriers bill the greater of actual and volumetric weight
  (length × breadth × height ÷ 5000 in cm is common). 15 × 10 × 10 cm is 0.3 kg
  volumetric.
- Sumayya's handwritten note. The bill is on WhatsApp; a printed copy is optional.
- "Fragile, glass, keep upright".
- **Drop test before launch:** three packed boxes, dropped from waist height on each face.
  If any jar leaked, packing is not done.

### 11.3 Packing day

1. Kitchen opens Orders, To pack, by batch. In-stock orders from yesterday are at the
   top, because they ship today.
2. **Packing list** for the batch: order, name, city, jars, jar numbers to write, gift
   note. Shareable as an image to WhatsApp.
3. Jar numbers assigned in payment order.
4. Kitchen taps Packed. The **packing cost** is prefilled from the default in settings and
   can be changed right there for this shipment (two jars, extra padding, a bigger box).
5. Courier booked. Pickup or drop-off.
6. Pickup scan, or India Post number entered, moves the order to Shipped and sends
   tracking.

### 11.4 Delivery problems

| Problem | What happens |
|---|---|
| Customer not reachable, address wrong | Agent asks for a correct address. No answer in 48 hours: Concern |
| **RTO, returned to origin** (decided) | Owner offers **a reship at the customer's cost**, through the agent's message and a payment link for the shipping amount. The returned jar is inspected: if the seal is broken or it is past the shelf-life stop, it is written off. A good jar can be the one reshipped, or goes back into stock |
| Lost in transit | Concern. Owner decides. Courier claim logged |
| Broken or leaked on arrival | Customer sends a photo. Concern. Owner decides, usually by calling. Photo kept on the order. Courier claim if insured |
| Delivered but not received | Concern. Courier proof of delivery pulled |

### 11.5 Pincode and product rules

- Serviceable pincodes from Shiprocket, refreshed weekly. India Post covers the rest.
- Product shipping rule (allowed states, excluded pincodes): **built, switched off** for
  beef for now.

### 11.6 Flow D: someone outside India (decided)

No agent on the website. At the end of the home page:

> We ship all over India. Not outside it yet. If you are abroad, message us and we will
> find a way to get one to you.

"Message us" is a `wa.me` link. From there it is section 7A.5: the agent explains, asks
for an Indian address to send it to, gathers the details, and the owner reviews and
sends a payment link.

---

## 12. Concerns and refunds

### 12.1 The Concern object

| Field | Example |
|---|---|
| Type | Cancellation call, shortage, yield short, delivery problem, RTO, damage, abroad order to review, stale batch (30 days), stale reservation (140 days), technical payment issue, call back, other |
| Customer, order, batch | Links |
| What happened | Plain summary written by the agent |
| Agent's proposal | "Offer a jar from batch 004 or a refund" |
| Draft message | Exact words that will be sent if approved, where a message is due |
| Owner's answer | Send as drafted, edit and send, handled by phone, decline with reason |
| Outcome | Kept, redirected, moved, reshipped, refunded, written off |
| Money | Amount, method, reference |
| Clock | Raised at, due end of day, answered at |

### 12.2 Same-day, made real

- The agent may say: "I've passed this to the team. You'll hear back from us today." After
  the evening cut-off: "by tomorrow morning". Cut-off is a setting.
- Today shows every open Concern first, oldest first, with its clock.
- WhatsApp nudge to Shefin when a Concern is raised, and again at 6 pm for anything open.
- Missed clocks are counted on the Concerns screen.

### 12.3 Recording a refund, however it was paid

Refunds are decided and handled in person. The admin records them so the ledger stays
true.

| Original payment | How the refund happens | What admin needs |
|---|---|---|
| Razorpay (site, link, QR) | Owner taps **Refund through Razorpay** in the Concern, or does it in the Razorpay dashboard | Amount. If done in the dashboard, the refund webhook matches it to the order by itself |
| UPI to account | Owner sends by UPI | Amount, UPI reference |
| Cash | Handed back | Amount, note |

Facts the button has to respect:

- A Razorpay normal refund reaches the customer in about 5 to 7 working days. The agent
  says so.
- **Payments over 6 months old cannot be refunded through Razorpay.** The button checks
  the payment date and says "send by UPI instead" rather than failing.
- Refunds come out of the Razorpay balance; too little balance means waiting for the next
  settlement.
- A Razorpay refund cannot be cancelled once created.
- The gateway fee on the original payment is not returned. The P&L records it.
- If a bill was already issued, a refund note (and a credit note once GST is on) is
  created against it.

### 12.4 Chargebacks

A customer can dispute a card payment with their bank. Razorpay notifies with a deadline
for evidence. One tap builds the evidence pack: order, the Orders page as it read on the
day of payment (policy pages are versioned), messages, tracking, proof of delivery.
Concern marked urgent.

---

## 13. Bills and invoicing

### 13.1 Documents, and when each exists

| Document | When | Before GST switch | After GST switch |
|---|---|---|---|
| **Receipt** | Payment into an open batch | Records the advance | Records an advance for goods, no GST on it |
| **Bill** | In stock online: at payment. Counter sale: at save. Open batch: at bottling | Plain bill, no tax, no GSTIN, never titled "tax invoice" | Tax invoice |
| **Refund note** | Refund where no bill exists yet | Against the receipt | Same, no credit note needed |
| **Credit note** | Refund or cancellation after a bill | Reverses the bill | GST credit note, reported in the return |

The bill for an open batch waits for bottling because until then there is no jar, and
once GST is on, a bill is what makes tax due. Bottling to dispatch is at most 3 days, so
the bill is always issued before the jar leaves.

### 13.2 What a bill carries

**Always:** Lailark Kitchen, address, FSSAI number, customer support number. Bill number
and date. Customer name, number, delivery address or "handed over at Kunnamangalam".
Place of supply (state). Lines: product, batch number, jar numbers, quantity, unit price,
amount. Custom lines with their description. Shipping line if any. Total. Payment method
and reference. Channel.

**Added once GST is on:** GSTIN, "Tax invoice", HSN per line, taxable value, CGST 2.5% +
SGST 2.5% inside Kerala or IGST 5% elsewhere, "Price inclusive of GST".

### 13.3 Numbering

- Bills: `LK/26-27/0001`, one series for every channel, resets each 1 April.
- Credit notes: `LKC/26-27/0001`. Receipts: `LKR/26-27/0001`. Refund notes: `LKF/26-27/0001`.
- Numbers are issued by the server inside a transaction on a counter document. **Never
  reused, never deleted, never issued by a phone.** A draft counter sale gets its number
  only when it is finalised online.
- A mistaken bill is cancelled by a credit note, not edited. A counter sale voided the
  same day before its bill was sent keeps its number, marked void.
- A new legal entity in December starts a new series.

### 13.4 Sending the bill

PDF generated at the event and stored against the order. Sent on WhatsApp as a document
with a short message, using an approved utility template. The private order link lists
every document for that order. Email too, if given.

### 13.5 Monthly close, for the CA

One export per month, spreadsheet plus a folder of PDFs:

- Bills and credit notes, **with place of supply and a state-wise total** (the GST-ready
  register from 4.5).
- Receipts, refunds and refund notes, with Razorpay ids or manual references.
- Counter day closes: cash, QR, UPI to account.
- Razorpay settlements reconciled against orders, with fees and GST on fees separated.
- Advances held at month end, per batch: money received for jars not yet bottled. A
  liability, not income.
- Running financial-year turnover against the ₹12 lakh FSSAI cap.

---

## 14. Batch accounting and P&L

### 14.1 Costs recorded against a batch

| Cost | Entered | When |
|---|---|---|
| Main ingredient: raw weight and price | Kitchen | Sourcing to Cooking |
| Every other ingredient: weight and price, or from a price list | Kitchen | Cooking |
| Gas and power: flat per-batch figure | Settings, once | Automatic |
| Glass jars and lids | **Per batch**, entered with the actual price paid for that lot | Bottled |
| **Box and inserts** | **Per batch**, entered for the lot bought for that batch | Bottled |
| **Labelling and stickering** | **Per batch, as its own line**: label print run, stickers, shrink bands | Bottled |
| **Packing cost at shipping** | **Default from settings, editable per shipment** at the moment of packing | Packed |
| Courier | From Shiprocket, or typed in for India Post | Shipped |
| Gateway fee and GST on it | From Razorpay | Captured |
| Refund losses | Recorded refunds and the fee not returned | Refunded |
| Write-offs: broken, past shelf life, RTO rejects, tasting | Kitchen or owner | Any time |
| Labour | Optional, off by default | |

Batch costs for jars, boxes and labels are spread across the jars bottled. Packing and
courier sit on each order, and roll up to the batch the jars came from.

### 14.2 What the batch screen shows

Revenue by channel (web, counter, phone, WhatsApp). Cost to date. Margin. **Margin per
jar.** Jars: planned, bookable, paid, bottled, packed, shipped, delivered, handed over,
written off. Yield against the recipe. Advances still held.

One more view: a single line per batch, all batches, for comparing margin per jar and
yield.

### 14.3 Ingredient and label link

Recipe drives ingredient order, percentages, allergens, nutrition and storage; Batch
supplies the batch number, dates and counts. Percentage basis: see
`label-ingredient-percentage-basis-fssai.md`. One switch in the recipe engine.

---

## 15. The agent

### 15.1 One door in v1: WhatsApp

- **No agent on the website.** The site has `wa.me` links where a conversation helps.
- The agent works on Lailark's WhatsApp number through the Meta Cloud API, the Lia OS
  pattern: own webhook, model routing, webhook deduplication, PII redaction in logs.
- One conversation record per customer number. It knows every order they have, from any
  channel.

### 15.2 What it may do, what it may not

| May | May not |
|---|---|
| Answer from the product, batch and order records | Promise a date |
| Tell a customer the stage of their batch in words | Refund, discount, reship, waive anything, or talk about refunds unprompted |
| Change a delivery address before packing, and confirm | Change an address after packing without a Concern |
| Send approved messages and bills | Send a batch milestone message the owner has not approved |
| Gather an order from abroad into a draft sale | Take payment or quote a special price |
| Give the cancellation reply (10.2) and raise the Concern | Argue, persuade or chase |
| Raise a Concern with a proposal | Break bad news without a choice attached |
| Hand to a human when asked | Pretend to be Sumayya or a person |

Kitchen updates are written in Sumayya's voice and signed from the kitchen when she took
the photo and the words are approved. A chat reply never claims to be her. If someone
asks "am I talking to a person?", the answer is truthful.

### 15.3 What it may say about timing

Owner-controlled setting. Starting text (decided: as drafted, revise with real batch
data):

- In stock: "It ships tomorrow, and we'll send you the tracking as soon as it's picked up."
- Open, below half: "The batch starts when half the jars are paid for. It's at 9 of 19
  now. We don't put a date on it, but we'll message you the moment it starts."
- Open, after half: "It's started. Most batches are bottled within about a week of
  starting and sent within three days after that. We'll send photos as it goes."
- After dispatch: the courier's estimate, called an estimate.

### 15.4 Messages that need the owner's yes

| Message | Approval |
|---|---|
| Half reached | **Owner yes** |
| Batch full | **Owner yes** |
| Batch open, to the notify list | Owner yes |
| Back in stock, to the notify list | Owner yes |
| Anything about a delay, shortage or problem | Owner yes, always |
| Kitchen photo updates | **Owner approves each** (decided 16 Sep). The kitchen adds the photo and line, the agent notifies the owner, it sends only after approval |
| Receipts, bills, packed, shipped, delivered, check-ins | Automatic, fixed templates |

### 15.5 Follow-up after a sale, any channel

- Handed over at the counter: "How's the jar?" three days later, once.
- Delivered: check-in two days after delivery, once.
- Each asks nothing more than how it is. A reply goes to the owner if it is a complaint,
  and is saved as a real review only if the customer says it can be shared.
- If they have not opted in to new-batch messages, the check-in may ask once, gently,
  whether they would like to hear when the next batch opens. Never asked twice.

### 15.6 Escalation to a human

"Talk to a person" → the agent says someone will call, raises a Concern of type "call
back". Owner calls from the same number (Botim for international). Closed with a one-line
note.

### 15.7 WhatsApp costs and templates

Meta charges per template message. Current India rates plus 18% GST on Meta's fee:
marketing about ₹0.86, utility about ₹0.12. Replies within 24 hours of a customer's
message are free, and utility templates inside that window are free. About ₹1 per order
even if every message falls outside the window. A batch-open broadcast to 500 opted-in
people costs about ₹500. Template approval by Meta is the real lead time: submit early.

Templates (utility unless marked):

1. Bill, with PDF document header (online in stock, counter, bottled open batch)
2. Receipt, open batch, with share link
3. Payment link, for phone, WhatsApp, abroad and RTO reship orders
4. Half reached
5. Batch full
6. Kitchen update, with image header
7. Bottled, with jar number
8. Packed, ships today
9. Dispatched, with tracking link
10. Delivered check-in
11. Counter check-in
12. Ready for collection reminder
13. Address needed
14. Delay or shortage, with a choice (always owner-approved text)
15. Refund recorded
16. **Marketing:** batch open, to opted-in list
17. **Marketing:** back in stock, to opted-in list
18. Abroad: message to the Indian recipient, with the buyer's consent

### 15.8 Logs

Every conversation readable in admin, with the agent's actions (looked up an order,
raised a Concern, built a draft sale) in the timeline.

---

## 16. Notifications matrix

| Event | Customer | Owner | Kitchen |
|---|---|---|---|
| Online payment captured | Bill or receipt | Orders | Orders |
| Counter sale saved | Bill, if consent | Day close | Day close |
| Payment link paid | Bill or receipt | Orders | Orders |
| Batch reaches half | **Nothing until owner yes** | WhatsApp nudge + Today card | Today |
| Batch full | **Nothing until owner yes** | WhatsApp nudge + Today card | Today |
| Kitchen photo update added | **Nothing until owner yes** | Nudge + Today card | Nothing |
| Concern raised | Holding reply where relevant | WhatsApp nudge + Today | Today, read only |
| Cancellation message | Cancellation reply (10.2) | Nudge: "expect a call" | Nothing |
| Abroad draft sale ready | "We'll get back to you today" | Nudge + Today | Nothing |
| Concern open at 6 pm | Nothing | Second nudge | Nothing |
| In-stock order not packed by noon of dispatch day | Nothing | Today | Today, red |
| Production clock at 1 day left | Nothing | Today, red | Today, red |
| Shelf-life stop in 14 days | Nothing | Today | Today |
| Batch below half at 30 days | Nothing | Concern | Nothing |
| Held payment at 140 days | Nothing | Concern | Nothing |
| RTO | Reship offer, owner-approved | Concern | Today |
| Chargeback | Nothing | Concern, urgent | Nothing |
| Day with counter sales ends | Nothing | Day close card | Day close card |
| Meta template rejected, webhook failures, budget alert | Nothing | Settings warning + push | Nothing |

---

## 17. Admin panel

### 17.1 Shape

- A **phone-first web app on Firebase Hosting**, installable to the home screen (PWA). No
  app store. English only.
- Bottom bar: **Today, Sell, Batches, Orders, More** (Concerns, Products, Customers,
  Agent, Money, Settings under More; Concerns also sit at the top of Today).
- **Sell** is the big middle button: the New sale screen (7A.1), one tap from anywhere.
- Every object has a **timeline**: who did what, including the agent and webhooks.
- Numbers editable in place, with **undo** on a toast for 8 seconds. No "are you sure"
  dialogs, except for actions that leave the system: sending a Razorpay refund and sending
  a broadcast. Those use hold-to-confirm.
- Weak signal: reads come from Firestore's offline cache, edits queue and sync, counter
  sales save as drafts (7A.4). Money actions that must reach the server (bill numbers,
  refunds, payment links) show "waiting for signal" rather than pretending.
- Push notifications to both phones through Firebase Cloud Messaging, alongside the
  WhatsApp nudges to the owner.
- Large tap targets, readable with flour on your hands.

### 17.2 Today

Top to bottom. An empty screen means the day is done.

1. **Waiting on you:** half-reached and full approvals, photo update approvals, Concerns,
   abroad draft sales, oldest first, each with its clock and one-tap answer.
2. **Ships today:** in-stock orders paid before yesterday's cut-off, with a Pack button.
3. **Clocks:** batches in their 5-day or 3-day production window.
4. **To pack** for bottled batches.
5. **Ready for collection** not yet collected.
6. **Warnings:** shelf-life stop within 14 days, held payments near 140 days, template or
   webhook errors, budget alert.
7. **Day close** card on a day with counter sales.
8. One line of money for the week: received by channel, refunded, advances held.

### 17.3 Sell

The New sale screen (7A.1), plus the list of today's counter sales and drafts waiting for
signal.

### 17.4 Batches

List: cards with product, batch number, state chip, fill bar (paid of bookable, half mark
drawn), clock if any, approval badge if waiting.

Inside a batch:

- **Header:** state, the one big state button (8.2), batch number, product.
- **Fill:** planned jars, bookable (90%), paid, held now, limit per person. Planned is
  editable while Open; bookable can never drop below paid.
- **Price:** ₹599 open, ₹649 in stock. Owner only.
- **Sourcing:** source, landed date, raw weight, price paid, receipt photo.
- **Cooking:** cooked date, cleaned weight, each ingredient's actual weight and cost
  (prefilled from the recipe), drift warning for label review.
- **Bottling:** packed-on date, cooked weight, jar count, best before, shelf-life stop,
  surplus, **jar and lid cost, box and insert cost, labelling and stickering cost** for
  this batch.
- **Updates:** photos and lines sent, and Add update (goes to the owner for approval).
- **Orders:** everyone in the batch, by channel, state, jar numbers.
- **Label:** generated label data for the printer.
- **Page:** preview and publish `/batch/<nnn>`.
- **P&L:** as 14.2.
- **Timeline.**

### 17.5 Orders

Grouped: **Awaiting payment, Paid waiting, Ships today, To pack, Packed, Shipped, Ready for
collection, Problem, Delivered, Refunded, Closed.** Filter by batch and channel. Search by
name, number, bill number, pincode.

Inside an order: customer and delivery contact, channel, lines with batch and jar numbers,
payment and method, documents, shipment (courier, number, cost, packing cost), tracking,
kitchen note, Concerns, timeline.

Actions: pack (with editable packing cost), book courier or enter India Post number,
change address before packing, send payment link again, raise a Concern, record outcome,
void (same day counter sale, before the bill is sent).

**Packing list per batch** as an image or printable page.

### 17.6 Concerns

Open, answered today, all. Each as in 12.1. Buttons: **Send as drafted, Edit, Handled by
phone, Decline with reason,** and the outcome with any money recorded in the same screen.

### 17.7 Customers

Name, number, country, channels bought through, orders, repeat count, share link with
clicks and orders it brought, notify lists, consent ticks with dates and who ticked them,
conversation link. Actions: remove from marketing, export or delete their data on request.

### 17.8 Products

Heroes and pipeline. Photos (note photo last), description, recipe (ingredients,
quantities, expected yield, percentage basis switch), allergens, claims, storage text,
**HSN**, prices, jar sizes, shipping rule (built, off for beef), Koorka season window,
notify-me list. **Custom lines** the kitchen may sell at the counter, with their set
amount.

### 17.9 Agent

Conversations, searchable. Concerns and outcomes. Settings: timing text, the cancellation
reply (10.2), abroad script, delay templates, cut-off hour, after-hours reply. Template
status from Meta.

### 17.10 Money

Receipts, bills, refunds, credit notes, day closes, advances per batch, Razorpay
settlements and reconciliation flags, state-wise sales register, turnover against ₹12 lakh,
monthly export. Owner and Viewer only.

### 17.11 Settings

Business details (legal name, address, FSSAI). **GST switch** with GSTIN and effective
date. **Shipping switch** (Free, Flat fee, Free on 2 jars) with amounts. Default courier.
Default packing cost. Kitchen discount cap. Dispatch cut-off hour and non-working days.
Pre-booking cap (90%). Hold minutes, payment link expiry. Shelf-life rule (30% or 45 days,
transit days). Gas and power per batch. Razorpay keys (live and test, swappable for the
December entity). Shiprocket keys. Bill prefixes. Policy pages with versions. Users and
roles. Backup and budget status.

### 17.12 Roles

| Action | Owner | Kitchen | Viewer |
|---|:-:|:-:|:-:|
| See everything except Money | ✓ | ✓ | ✓ |
| See Money | ✓ | | ✓ |
| Create and open a batch, set prices | ✓ | | |
| Approve half, full, photo update and broadcast messages | ✓ | | |
| Move a batch through Sourcing, Cooking, Bottled | ✓ | ✓ | |
| Weights, costs, photos, updates | ✓ | ✓ | |
| Counter sale at list price, payment link | ✓ | ✓ | |
| Discount up to the Settings cap, with reason | ✓ | ✓ | |
| Discount beyond cap, custom price, part payment, limit override | ✓ | | |
| Pack, book courier, edit packing cost, change address before packing | ✓ | ✓ | |
| Answer a Concern, record a refund | ✓ | | |
| Pause a batch, send a broadcast | ✓ | | |
| Settings, users, keys, GST and shipping switches | ✓ | | |

---

## 18. Data model, in Firestore

Firestore is a document database: collections of documents, no joins, no enforced
foreign keys. The design below puts the counts that must never be wrong on single
documents changed inside transactions, and keeps money writes on the server only.

Every document has `createdAt`, `updatedAt`, `createdBy`. Money amounts are stored as
**integers in paise**, never as decimals.

### 18.1 Collections

**Catalogue**

- `products/{slug}`: name, type (hero, pipeline), veg, hsn, priceInStock, priceOpen,
  jarGrams, shippingRule, seasonStart, seasonEnd, active, customLines[]
- `ingredients/{id}`: labelName, allergenTags[], nutritionPer100g{}, unitCost, unit, source
- `recipes/{id}`: productSlug, version, percentageBasis, expectedYieldJars, yieldRatios{},
  storageText, claimsText, lines[] (ingredientId, qty, unit, isMain, evaporates, compoundOf)

**Kitchen**

- `batches/{nnn}`: document id is the batch number. productSlug, recipeId, state,
  plannedJars, bookableJars, perPersonLimit, priceOpen, priceInStock, **paidCount,
  heldJars{orderId: {qty, expiresAt}}**, bottledJars, writtenOff, source, landedOn,
  cookedOn, packedOn, bestBefore, saleStopOn, weightRaw, weightCleaned, weightCooked,
  halfReachedAt, halfApprovedAt, fullReachedAt, fullApprovedAt, pausedReason,
  costs{jarsLids, boxInserts, labelling, gasPower}, pnl{} (kept current by a trigger)
- `batches/{nnn}/lines/{id}`: ingredientId, qtyActual, costActual
- `batches/{nnn}/updates/{id}`: photoPath, kitchenLine, messageText, approvedBy, sentAt
- `batches/{nnn}/writeOffs/{id}`: qty, reason, by

**Customers and orders**

- `customers/{phoneE164}`: document id is the number, which makes "one customer per
  number" true by construction. name, email, country, consents{updates, marketing} with
  at and by, shareCode, stats{orders, jars, lastOrderAt}
- `customers/{phone}/addresses/{id}`: name, phone, lines, city, state, pincode, hash
- `orders/{id}`: number (human), channel (web, counter, phone, whatsapp, abroad),
  customerPhone, deliveryContact{}, placeOfSupply, state, lines[] (productSlug, batchNo,
  qty, unitPrice, customDescription, jarNumbers[]), shippingFee, discount{amount, reason, by},
  total, fulfilment (ship, handedOver, collect), payment{method, status, razorpayIds{},
  markedPaidBy, upiRef}, shareCodeUsed, policyVersion, kitchenNote, draft (bool), soldBy
- `orders/{id}/events/{id}`: the timeline for the order

**Money**

- `documents/{series-number}`: document id is the number itself (for example
  `LK-26-27-0001`), so a number can never be used twice. kind (receipt, bill,
  refundNote, creditNote), orderId, issuedAt, lines, taxable, cgst, sgst, igst (all zero
  until GST is on), pdfPath, voids, cancelledBy
- `counters/{series}`: next number. Changed only inside the server transaction that
  creates a document
- `refunds/{id}`: orderId, concernId, amount, method (razorpay, upi, cash),
  razorpayRefundId, reference, status, recordedBy
- `dayCloses/{date}`: totals by method, jarsByBatch, cashCounted, difference, note
- `settlements/{razorpayId}`: amount, fees, tax, utr, settledAt
- `webhookEvents/{source-eventId}`: document id is the event id, created with a
  "must not exist" write, so a repeated webhook fails harmlessly

**Shipping**

- `shipments/{id}`: orderId, courier (shiprocket, indiaPost), awb, labelPath, packingCost,
  courierCost, status, pickupAt, deliveredAt, rto, claimRef
- `shipments/{id}/events/{id}`: status, location, at
- `settings/pincodes`: serviceable list, refreshed weekly (or a `pincodes` collection)

**Agent**

- `conversations/{phoneE164}`: lastMessageAt, windowExpiresAt, summary, memory{}
- `conversations/{phone}/messages/{id}`: direction, templateName, body, mediaPath,
  metaMessageId, status, category, at
- `concerns/{id}`: type, customerPhone, orderId, batchNo, summary, proposal, draftMessage,
  answer, outcome, money{}, raisedAt, dueAt, answeredAt, sentAt, urgent
- `approvals/{id}`: kind (halfReached, full, broadcast, photoUpdate), batchNo, draft,
  status, answeredBy, at
- `notify/{id}`: phone, productSlug or country, source, consentAt, unsubscribedAt

**System**

- `users/{uid}`: name, phone, role. Role is also set as a **custom claim** on the Firebase
  Auth user, which is what the security rules check
- `policyVersions/{id}`: kind, text, publishedAt
- `settings/{name}`: gst, shipping, dispatch, holds, shelfLife, courier, prefixes, discountCap
- `audit/{id}`: object, action, before, after, by, at. Undo reads from here

### 18.2 Rules the database enforces

- **Client apps never write money.** Security rules deny client writes to `orders`
  payment fields, `documents`, `counters`, `refunds`, `settlements`, `webhookEvents`. Those
  are written only by Cloud Functions, which run with admin rights.
- **Holds and paid counts change only in a transaction** on the batch document, run by a
  function, which checks `paid + live holds + requested ≤ bookable` (or ≤ available in
  stock) before writing.
- **Kitchen role field limits:** rules allow the kitchen to change only kitchen fields on
  a batch (weights, dates, costs, updates), checked by comparing which keys changed.
- **Public reads:** nothing in Firestore is readable by the public. The site gets counts
  from one small function endpoint. (Exception carried over from v0: `config/site` is
  public read-only.)

### 18.3 What Firestore is not good at, and how this design copes

| Weakness | Answer here |
|---|---|
| No joins, weak aggregation | Counts and P&L kept current on the batch document by triggers. Monthly export built by a scheduled function |
| Reporting across many months | Optional later: the Firestore to BigQuery export extension |
| Sequential numbers are not native | `counters` document inside a transaction |
| Uniqueness is not enforced | Document ids that are the unique thing (phone, bill number, webhook event id) |
| One document should not take more than about one sustained write per second | A 40-jar batch never comes close |

---

## 19. Stack: Firebase and Firestore (decided)

### 19.1 The shape

```
                        lailark.in (Firebase Hosting, CDN)
     ┌───────────────────────────┼─────────────────────────────┐
  static pages             /api/* rewrites                <site>.web.app (admin)
  /  /batch/nnn            to Cloud Functions             (second Hosting site)
  products, Orders page    counts, checkout               PWA: Auth, Firestore,
  (Next.js static export)  (asia-south1)                  Storage, Messaging
                                  │                              │
                     ┌────────────┴───────────┐                  │
               Cloud Functions (2nd gen, asia-south1) ◄──────────┘ callable functions
               webhooks · triggers · schedules · agent worker
                     │           │            │
                 Firestore   Cloud Storage   Secret Manager
                (asia-south1) photos, PDFs    Razorpay, Meta, Shiprocket, LLM keys
                     │
     Razorpay ◄──────┼──────► Meta WhatsApp Cloud API ◄──────► LLM via OpenRouter
     Shiprocket ◄────┘
```

### 19.2 Each piece, and the choice made

| Need | Firebase answer | Notes |
|---|---|---|
| Home, batch records, product pages, Orders and policy pages | **Firebase Hosting, Next.js static export** | Batch record pages built from JSON in the repo |
| `/batch/1` and `/batch/01` to `/batch/001`, `www` to apex | `firebase.json` redirects, type 301. Both domains on Hosting, `www` redirects | |
| Home page video | Hosting, long cache headers for `mp4` | Test on an iPhone that the loop plays and seeks, since Safari needs byte-range support |
| Live counts on batch and product cards | **One function behind `/api/counts`**, cached at the CDN for 15 seconds | Keeps the heavy Firestore SDK off public pages. Checkout re-checks the real count anyway |
| Checkout | Callable or HTTP function: validates, takes the hold in a transaction, creates the Razorpay order | Razorpay's checkout script is the one outside script on the site, loaded only on the checkout step |
| Admin | **Separate Hosting site**, default `.web.app` URL | Admin code never touches public pages. Firebase JS SDK: Auth, Firestore with offline cache, Storage, Cloud Messaging |
| Admin sign-in | **Firebase Phone Auth**, only for allowlisted numbers, role as a custom claim | Two numbers at launch: Owner and Kitchen |
| Server logic | **Cloud Functions for Firebase, 2nd gen, TypeScript, region asia-south1 (Mumbai)** | Needs the Blaze plan |
| Webhooks: Razorpay, Meta, Shiprocket | HTTP functions called directly at their function URLs, not through Hosting | Verify signature, write `webhookEvents/{id}`, reply 200 at once, do the work in a queued task |
| Agent | **Webhook function stores the message and queues a task. A worker function runs the agent** | Meta expects a fast reply to the webhook. The model call happens off that path |
| Scheduled work | Scheduled functions | Hold sweep, 15-minute payment reconciliation for pending orders, daily reconciliation, 30 and 140-day checks, shelf-life warnings, 6 pm Concern nudge, day close reminder, weekly pincode refresh |
| Counts, P&L, stats | Firestore triggers on orders and batches | Keep the batch document current |
| Photos, bill PDFs, labels | **Cloud Storage for Firebase** | Needs Blaze. Bills sent to WhatsApp through a short-lived signed link |
| Keys | Secret Manager, read by functions | Razorpay keys swap in one place for the December entity |
| Push to admin phones | Firebase Cloud Messaging | Home-screen web apps on iPhone can receive web push |
| Backups | Firestore scheduled backups and point-in-time recovery, plus a weekly export to Storage | Restore once before launch |
| Staging | **A second Firebase project, `lailark-staging`**, with Razorpay test keys and a test WhatsApp number | Plus the Firebase Emulator Suite for local work |

### 19.3 Three things to check in the existing Firebase project

1. **Firestore location.** It is fixed forever once chosen. It should be **asia-south1
   (Mumbai)**. README says it is; verify in the console.
2. **Plan.** Cloud Functions and Cloud Storage both need **Blaze** (pay as you go). The
   no-cost allowances still apply on Blaze.
3. **Budget alert.** Blaze has no hard spending cap. Set a Google Cloud budget with alerts
   (for example at ₹500 and ₹1,500 a month) on day one, and cap each function's maximum
   instances, so a bug that loops cannot run up a bill quietly.

### 19.4 Stack decisions (closed)

- **Functions language:** TypeScript.
- **Batch page publishing:** GitHub Action. The Publish button in admin writes the batch
  JSON to the repo through the GitHub API, a workflow builds the Next.js export and runs
  `firebase deploy --only hosting:customer`.
- **Admin front end:** Preact with Vite and TypeScript, installable PWA.
- **Customer site:** Next.js with static export. JavaScript allowed. Must stay usable on
  4G; the 100 KB budget from v0 is retired.

### 19.5 Firebase for Lailark, honestly

| Pros | Cons |
|---|---|
| No server to patch or restart | Tied to Google's APIs. Moving later means rewriting the data layer and functions |
| Already connected, v0 live | Firestore needs the design discipline in 18: transactions, counters, server-only money writes |
| Offline cache, live listeners and push make the phone admin feel instant, even on a weak signal | Blaze has no hard cap. Budget alerts and instance limits are required, not optional |
| Auth, Storage, Messaging and Hosting in one console | Reporting across months is awkward without BigQuery |
| At Lailark's volume the no-cost allowances will likely cover almost everything | Cold starts on functions can add a second or two to the first request after a quiet spell, which matters most on the webhook and checkout paths |
| Mumbai region keeps data in India and close to customers | Hosting has a 60 second limit on requests passed to functions. Fine here, but nothing slow should sit behind `/api` |

---

## 20. Compliance checklist

Take this to a CA and a food consultant. Every line is a question to confirm.

### 20.1 GST (held, switch built)
- [ ] HSN on every product from day one.
- [ ] Place of supply and state-wise register from the first sale.
- [ ] Bills never show tax or "tax invoice" before the switch.
- [ ] One conversation with the CA about when to switch on (4.5).

### 20.2 FSSAI
- [x] FSSAI number shown on the site: footer and every product page.
- [ ] KOB corrected to Petty Food Manufacturer.
- [ ] Claims on the site match the label word for word.
- [ ] Shelf-life at delivery rule built (6.2).
- [ ] Turnover against the ₹12 lakh Basic Registration cap shown in Money.

### 20.3 Legal Metrology, online listings
Listings must show what the label shows: manufacturer or packer name and address, country
of origin, generic name, net quantity, date of manufacture or packing, best before, MRP,
unit sale price, consumer care contact.
- [ ] Every product page generates these from product and batch.
- [ ] Open batches: "Packed on: printed on the jar when bottled. Best before six months
      from packing." Confirm the wording.
- [ ] Ask whether a packer registration with Kerala Legal Metrology is needed.

### 20.4 Consumer Protection (E-Commerce) Rules, 2020
- [ ] Legal name, address, contact and a named grievance officer on the site.
- [ ] Complaints acknowledged within 48 hours, resolved within a month. The same-day
      Concern clock covers this.
- [ ] The quiet **Orders** page (10.4) and shipping, terms and privacy pages published.
- [ ] Total price, with shipping when the switch is on, shown before payment.
- [ ] No cancellation fee.
- [ ] No fake reviews. Any review shown is a real customer's, shared with consent.

### 20.5 Dark patterns (CCPA guidelines)
- [ ] Every count real and computed. No timers, no "12 people looking".
- [ ] Shipping fee on the card whenever the switch is on.
- [ ] Nothing added to an order that the customer did not choose.
- [ ] No shaming buttons.
- [ ] WhatsApp marketing consent never required to buy.
- [ ] No reminders about unfilled batches.

### 20.6 Data protection (DPDP Act and Rules)
- [ ] Plain consent at checkout and at the counter, separate for updates and marketing,
      with who ticked and when.
- [ ] Privacy page: what is collected, why, for how long, how to ask for deletion.
- [ ] Export and delete a customer's data from admin.
- [ ] Data stored in India (Mumbai region).
- [ ] Breach plan: who is told, how fast.

### 20.7 Razorpay
- [ ] Separate account for Lailark, brand name Lailark Kitchen.
- [ ] Orders, shipping, terms, privacy and contact pages live before activation review.
- [ ] Business description mentions made-to-order batches shipped after bottling.
- [ ] Payment Links and QR Codes enabled on the account.
- [ ] Live refund tested, overseas card tested.
- [ ] December entity change: old account kept open and funded until everything paid into
      it has shipped. Each payment records which account it came in on.

### 20.8 WhatsApp
- [ ] Dedicated Lailark number on the Cloud API, display name approved.
- [ ] Templates submitted early (15.7).
- [ ] Counter customers asked before their number is messaged; the tick records it.
- [ ] "Stop" removes a person from marketing at once.

---

## 21. Edge cases

### 21.1 Payments
| Case | Handling |
|---|---|
| Payment confirms after the hold lapsed and the jar has gone | Technical, not a sale. Concern marked technical. Owner refunds or allocates a surplus jar |
| Paid twice for one order | Detected by order id. Concern marked technical |
| Webhook never arrives | Reconciliation every 15 minutes for pending orders asks Razorpay directly |
| Browser closed before the redirect | Webhook completes the order. Bill still sent |
| Payment link expires unpaid | Jars released. Agent may send one gentle "the link has expired, shall we send a new one?", only if the customer started the conversation |
| QR scanned, customer paid a different amount | QR codes are made for the exact amount. If a mismatch still appears, Concern |
| UPI to account marked paid, money never arrived | Day close check catches it. Concern |
| Cash counted short | Difference on the day close, with a note |
| Refund on a payment over 6 months old | Button says to send by UPI (12.3) |
| Chargeback | 12.4 |

### 21.2 Batches
| Case | Handling |
|---|---|
| Bottled fewer jars than paid, despite the cap | 7.7 |
| Bottled more than bookable | Surplus in stock at ₹649 |
| Fish short or poor on landing day | Owner pauses. Never cook with bad fish to keep a clock |
| Owner has not approved half reached | Card returns each morning. Sales carry on |
| Batch stalled below half | 30-day and 140-day Concerns (7.6) |
| Sumayya unwell or away | Owner pauses batches in Sourcing. Clocks stop |
| Kitchen mistake, batch spoiled | Batch marked failed. Concern per paid customer. Costs written off |
| Two batches of one product open at once | The second opens only once the first is cooking (decided) |
| Customer in two batches | Two orders. Ship together if bottled within 3 days of each other (decided) |
| Price change | Only batches opened after the change |
| Recipe change | New recipe version, label review flag |

### 21.3 Counter sales
| Case | Handling |
|---|---|
| Last jar sold at the counter while an online checkout holds it | The hold wins. Counter screen says "held online for 12 more minutes" |
| Offline draft finalised after stock ran out | Draft flagged, not saved. Seller offers the next batch |
| Wrong item or amount entered | Void the same day before the bill is sent. After that, credit note and a new sale |
| Customer declines WhatsApp | Bill shown as a QR to scan, or printed |
| Bulk order at an agreed price, part paid | Owner only, balance tracked, bill when fully paid or at hand-over |
| Jar sold at the counter past the online shelf-life stop | Allowed until best before, with a warning |

### 21.4 Delivery
| Case | Handling |
|---|---|
| Address change after packing | Concern. Courier redirect if possible |
| In-stock order cannot ship next day | Agent tells the customer the same day, with the reason |
| Gift to someone else | Delivery contact differs from payer |
| Pincode not served by Shiprocket | India Post |
| RTO | Reship at the customer's cost (11.4) |
| Broken or leaked | Photo, Concern, owner decides |
| Abroad order: Indian recipient unreachable | Agent tells the buyer and asks them to reach the recipient. Concern after 48 hours |

### 21.5 People and messages
| Case | Handling |
|---|---|
| Customer asks to cancel | 10.2 and 10.3 |
| Customer asks about refunds before buying | Agent answers from the Orders page in the same words, and offers a call |
| Limit bypass with a second number | Visible by address match. Owner decides |
| Abusive messages | Agent stays polite, raises a Concern, never argues |
| Allergy or health question | Agent quotes the allergen line and the label, suggests asking a doctor |
| Customer asks for a date | Timing text. Never a date |
| "Stop" | Marketing consent removed at once |
| Data deletion request | Admin action. Bills kept as the law requires |
| WhatsApp quality rating drops | Settings warning. Keep marketing messages rare |

### 21.6 System
| Case | Handling |
|---|---|
| Functions or Firestore down | Static pages and batch records still load. Checkout shows a kind "back shortly". Webhook senders retry |
| Bug that loops and bills | Budget alert, instance caps, and an off switch for scheduled jobs in settings |
| Data loss or bad write | Point-in-time recovery or last backup |
| Timezones | Stored in UTC, shown in IST |
| 1 April | Bill series resets by itself |
| December entity change | New keys, new series, old Razorpay account kept for refunds |

---

## 22. Security and operations, on Firebase

- **Admin sign-in:** Phone Auth for allowlisted numbers only, role as a custom claim
  set by a function.
- **Security rules** written and tested with the emulator before launch: public reads
  denied, money collections server-only, kitchen field limits.
- **App Check** on callable functions and Firestore, so only the real site and admin can
  call them.
- **Secrets** in Secret Manager, never in the repository or the admin bundle.
- **Webhooks** verified by signature, deduplicated by event id.
- **Limits:** maximum instances per function, rate limits on checkout and counts.
- **Budget alerts** on the Google Cloud billing account from day one.
- **Backups:** Firestore scheduled backups and point-in-time recovery, weekly export,
  **restore tested before launch.**
- **Logs:** personal data redacted, as Lia OS.
- **Monitoring:** uptime checks on `/`, `/batch/001` and `/api/counts`, with an alert to
  Shefin's phone.
- **Staging project** with Razorpay test keys and a test WhatsApp number. Nothing is tried
  first in production.
- **Audit:** every money action carries who pressed it and when.

---

## 23. Build order and launch

The full build ships everything, admin included. This is the order to **build** it in,
so each piece is tested on the one before. `../../TASKS.md` maps these twelve steps onto
five milestones.

| Step | What | Done when |
|---|---|---|
| 1 | Firebase projects (staging and production), Firestore in Mumbai, Blaze, budget alerts, Auth, roles, security rules skeleton, repository and deploy | Both phones signed in to admin on staging |
| 2 | Products, recipes, batches, the state button, approvals | Batch 001 entered as a real, archived batch with its real numbers |
| 3 | **Counter sale (POS)**, cash and UPI to account, bills and numbering, WhatsApp bill template | A cash sale at the kitchen door produces a numbered bill on WhatsApp |
| 4 | Online checkout, holds, Razorpay orders, webhooks, Razorpay QR, payment links | Each payment route moves a jar from free to paid, and back on expiry |
| 5 | Open batch: 90% cap, half and full approvals, clocks, share links, booking close at cooking | A seeded staging batch fills and every message waits for the owner |
| 6 | Shipping: India Post entry, Shiprocket booking, packing cost, packing list, tracking | A real parcel sent by each courier to your own address |
| 7 | Concerns, cancellation reply, refund recording, RTO reship link | A test refund recorded three ways: Razorpay, UPI, cash |
| 8 | Money: receipts, credit notes, day close, state register, monthly export | The CA has seen a sample month |
| 9 | Agent on WhatsApp: templates approved, abroad draft sales, check-ins, timing text | Every template approved. Abroad flow walked with a friend overseas |
| 10 | Batch page generation and GitHub publish | `/batch/002` from the record matches the label character for character |
| 11 | Orders and policy pages, consent, data export and delete, shipping and GST switches | Checklist 20 ticked |
| 12 | Backup restore, uptime checks, App Check, full staging walkthrough | A whole batch walked in staging, open to archive, with counter and online sales mixed |

### Launch checklist, before the first real rupee

- [ ] Firestore location is Mumbai. Budget alert set.
- [ ] Razorpay live with Payment Links and QR, refund tested live.
- [ ] Meta templates approved, including the bill with a PDF.
- [ ] India Post routine agreed. Shiprocket account ready or in progress. Drop test passed.
- [ ] `/batch/001` resolves over HTTPS from a jar, on Firebase Hosting.
- [ ] Orders, shipping, terms, privacy and contact pages published and versioned.
- [ ] Backup restored once.
- [ ] Both of you have done, on your own phones: a counter sale, an online order, a
      payment link, a pack and ship, a recorded refund.
- [ ] Every customer message read aloud. Anything that sounds like a brand is rewritten.

---

## 24. Decided

### 24.1 Decided on 15 Sep 2026

| Decision | Where it lives |
|---|---|
| Admin is the master POS for every sale, any channel | 7A |
| Shipping free at launch, switch for flat fee or free-on-2 | 4.2 |
| Launch without GST, GST-ready from day one, switch any time | 4.5, 13 |
| In-stock ships next day | 6.2 |
| Agent WhatsApp only. Home page line for abroad. Agent gathers, owner reviews | 7A.5, 11.6 |
| Half-fill and full messages wait for the owner's yes | 7.3 |
| Pre-booking capped at 90% | 7.1 |
| ₹599 closes at cooking, unpaid jars at ₹649 when bottled | 7.5 |
| Yield shortfall on latest payers, owner offers next batch or refund | 7.7 |
| Cancellations not advertised. Agent invites a call. Refunds in person, SOP later | 10 |
| Shiprocket preferred, India Post at start and as fallback | 11.1 |
| RTO: reship at customer's cost only | 11.4 |
| Box and inserts per batch, labelling as extra lines, packing cost editable at shipping | 14.1 |
| English only | 17.1 |
| FSSAI shown | 20.2 |
| Firebase and Firestore | 19 |

### 24.2 Decided on 16 Sep 2026

All seventeen items are closed. The answers, with the reasoning, are in
`../../DECISIONS.md`. The text of this brief has been updated in place to match.

Waiting on other threads (not build blockers):

- Label percentage basis: settled as basis B in `label-ingredient-percentage-basis-fssai.md`; the batch 002 artwork still needs the recorded weights.
- FSSAI KOB fix.
- Entity choice for December.

---

## 25. What this brief changes in the sales flow doc (v2)

| v2 said | Now |
|---|---|
| Owner response time open | Same day |
| Home page ground open | Plate, on paper |
| Change-of-mind wording open | Not published. Agent invites a call. Quiet Orders page for the legal minimum |
| Stack open, static pages plus own API | Firebase Hosting, Firestore, Cloud Functions in TypeScript, Next.js site, Preact admin |
| Sales only online | Every channel through the admin POS |
| Agent in browser and WhatsApp | WhatsApp only |
| Half fill starts sourcing | Half fill asks the owner. Sourcing starts on yes |
| Limit a quarter of the batch | A quarter of the bookable 90% |
| Nothing happens to a slow batch | Still true publicly. Internal 30-day and 140-day Concerns because of the 6 month refund limit |
| Overseas relay offered by the agent at checkout | Home page line, WhatsApp conversation, owner review |
| Dispatch within 3 days | Next day for in stock. Within 3 days of bottling for open batches |
| No GST | Still none at launch. GST-ready build with a switch |
| No shelf-life rule for in-stock sales | Online sale stops about 120 days after packing |
| Invoice not specified | Receipt for open-batch payments, bill at payment or bottling, credit notes after a bill |
| Box ₹50 per order | Box, inserts, jars and labelling per batch. Packing cost per shipment, editable |
| v0 deploy on Cloudflare Pages or nginx | Firebase Hosting, with redirects in `firebase.json` |

---

## Sources

- GST on inter-state supply and registration thresholds: StartupPortal, IndiaFilings
- GST rate on prepared fish, meat and pickles after September 2025: DisyTax, Pocketful
- No GST on advances for goods: TaxGuru
- Razorpay fees, refunds (6 month limit), Payment Links, QR Codes: razorpay.com/docs
- WhatsApp pricing in India: Whautomate rate card
- FSSAI shelf life at delivery: ChemLinked, FSSAI advisory Dec 2024
- Legal Metrology for e-commerce: S.S. Rana
- Consumer Protection (E-Commerce) Rules, 2020: PSL Chambers, IndiaFilings
- Dark patterns: AZB Partners on CCPA enforcement
- DPDP Rules timeline: Macksofy
- Shiprocket plans: shiprocket.in/pricing
- Firebase: pricing and no-cost quotas, Cloud Storage needs Blaze, Hosting configuration and redirects, Hosting with Cloud Functions
