# lailark.in v0: holding page and /batch/001

Build spec and Claude Code handoff. 14 Sep 2026.
Owner: Shefin. Kitchen: Sumayya.

This is the whole website for the next few weeks. Two pages. It exists because
22 jars are about to leave the kitchen with a QR pointing at
`https://lailark.in/batch/001`, and that address currently does not resolve.

---

## 1. Batch 001, final

| Field | Value |
|---|---|
| Product | Oil based prawns pickle (prawns and dates) |
| Prawns from | Chaliyam |
| Landed | 31 August 2026 |
| Cooked | 1 September 2026 |
| Bottled / packed on | 4 September 2026 |
| Best before | 4 March 2027 (six months from packing) |
| Jars | 22 |
| Net weight | 200 g |
| MRP | ₹649 (₹3.25/g) |
| Support number | +91 88919 23827 |

These four (source, landed, made, jar count) are exactly the QR fields the
admin's Batch object must expose later. This page is the first spec for that
object.

**The printed label is the source of truth for anything that appears on both.**
It is already on the jars and cannot be changed. Where the website and the label
say the same thing, the website copies the label word for word. A customer holds
both at once, and any difference between them reads as carelessness.

---

## 2. What the printed label says

Transcribed from the final print file, 14 Sep 2026. Do not paraphrase these.

**Ingredients, in printed order**

> Prawns (59%), Dates (22%), Vinegar, Gingelly (Sesame) Oil, Garlic, Green
> Chilli, Ginger, Salt, Kashmiri Chilli Powder, Red Chilli Powder, Sugar,
> Compounded Asafoetida (Gum Arabic, Wheat Flour, Asafoetida), Mustard, Curry
> Leaves, Fenugreek, Turmeric.

**Allergens**

> Contains: Crustacean (Prawns), Sesame, Wheat (Gluten) and Mustard.

**Claims**

> No added preservatives. Prepared by traditional method.

Note the wording. "No added preservatives" is the claim that was printed, and it
is the claim the website makes. Not "no preservatives", which is a stronger
thing to say.

**Nutrition per 100 g**

Energy 422 kcal. Protein 10.7 g. Carbohydrate 21.8 g (total sugars 15.4 g, added
sugars 0.8 g). Total fat 32.2 g (saturated 4.7 g, trans 0 g). Cholesterol 88 mg.
Sodium 1005 mg.

The website does not repeat the nutrition panel. It is on the jar in the
customer's hand, and reprinting it on a provenance page adds nothing.

**Storage, as printed**

> Cool, dry place away from sunlight; refrigerate after opening; clean dry spoon;
> keep prawns covered in oil.

The website drops the refrigeration line. See the storage rule in section 7.

**Other printed facts**

Bottle Batch № 001. Net wt. 200 g. MRP ₹649/- (₹3.25/g). Packed on 04/09/2026.
Best before 6 months from date of packing. Non-veg mark. FSSAI 21323244000035.
Product of India. Manufactured and distributed by Lailark Kitchen, Kozhikode,
Kerala. Address: Neduvanchalil Veedu, Kunnamangalam, Kozhikode, Kerala, India,
PIN 673571. Customer support +91 88 91 92 38 27. www.lailark.in

**Two things worth noticing, neither of them blocking**

1. The label prints "best before 6 months from date of packing" rather than a
   date. The website computes it: 4 March 2027. That is a small, real service,
   and it is the one place the page usefully knows more than the jar.
2. The Malabar Edit panel uses an em dash. It is printed and it stays. For batch
   002's artwork, a comma or a full stop would sit better with how the rest of
   the brand writes.

---

## 3. Hard constraints

- **No external requests.** No Google Fonts, no CDN, no analytics, no fonts
  loaded over the wire. System font stack. Everything ships from our own origin.
- **No build step, no framework.** Plain HTML and CSS. A folder you can drag.
- **One round trip for the HTML.** CSS is inlined in a `<style>` block in each
  page. Two pages, a little duplication, and that is fine at this size.
- **Total page weight under 100 KB**, including the note photo. Target under 1
  second to first paint on a throttled 4G connection.
- **No JavaScript unless a form needs it.** If the WhatsApp capture is a `wa.me`
  link, the site ships with zero JS. Prefer that.
- **Every image has explicit `width` and `height`** so nothing shifts while it
  loads. Zero layout shift is a hard pass or fail.
- **Works with images blocked and with CSS blocked.** Read the HTML source top
  to bottom: it should still make sense as a document.
- **No em dashes in any copy.** Periods, commas and colons.

---

## 4. File tree

```
lailark-site/
  index.html              root holding page
  batch/
    001/
      index.html          batch 001 provenance page
  assets/
    note-001.jpg          Sumayya's handwritten note, photographed
    lark.svg              the lark mark, inline in the HTML if under 2 KB
  robots.txt
  favicon.ico
```

Redirects, cache headers and clean URLs are configured in `firebase.json` at the
project root, not in a file inside the site folder.

No shared stylesheet file. No `/about`, no `/shop`, no `/products`. Every URL
we invent now is one we have to keep alive forever, so we invent nothing.

---

## 5. Routing

Fixed in print and permanent:

```
/                     holding page
/batch/001            batch 001
/batch/<nnn>          every future batch, three digits, zero padded
```

The `redirects` block in `firebase.json` handles the ways a person types it by hand:

```
/batch/1     /batch/001   301
/batch/01    /batch/001   301
/batch       /            302
```

`firebase.json` sets `"trailingSlash": false`, so `/batch/001` is the canonical 200
with no redirect chain, which is the exact string the QR encodes. `/batch/001/`
301s to it. One canonical URL, verified by curl, not assumed.

`www.lailark.in` is printed on the label, so `www` must resolve. Redirect it to
the apex, or the apex to it. Pick one and make the other a 301.

`robots.txt`: allow everything. There is nothing to hide and the batch pages are
good things to have indexed.

---

## 6. Page A: `/` holding page

One screen on a phone. A little below the fold for the curious, nothing
essential down there.

### Structure, in order

1. Lark mark, small, and the word Lailark.
2. What this is, in one sentence.
3. The honest note. This is the reason the page exists.
4. One thing to do: a WhatsApp link.
5. A quiet link to `/batch/001` for someone holding a jar who typed the domain.
6. Footer.

### Copy, verbatim

> **Lailark**
>
> A small kitchen in Kunnamangalam, Kozhikode. We make oil pickles in batches of
> fifteen to forty jars. When a batch is gone it is gone, and the next one
> starts.
>
> The site is still being built. This address will not change, so anything
> printed on a jar will keep working.
>
> **Tell me when a batch opens** → [WhatsApp]
>
> Holding a jar? [See batch 001.](/batch/001)
>
> ---
> Lailark Kitchen. Neduvanchalil Veedu, Kunnamangalam, Kozhikode, Kerala, India,
> PIN 673571. Customer support +91 88919 23827. FSSAI 21323244000035.

### Rules

- No product photos. No prices. No countdown. No launch date we might miss.
- The WhatsApp action is a plain `wa.me` deep link:
  `https://wa.me/918891923827?text=Tell%20me%20when%20a%20batch%20opens`
  That is a zero-JS, zero-backend notify list, and every reply lands where
  Sumayya can see it. A form can replace it later without changing the page's
  shape.
- Do not write "coming soon". Write what is true.

---

## 7. Page B: `/batch/001`

The person is holding the jar in their kitchen, on 4G, having just scanned. They
want to know what is in their hand. They are not shopping. They already bought.

### Structure, in order

1. **Batch 001. Prawns and dates.** First thing on screen, no scroll needed to
   confirm they got the right page.
2. **The four facts**, as a plain list, not a table with borders.
3. **A sentence of context** about Chaliyam.
4. **Your jar**, explaining the handwritten number.
5. **What is in it**, matching the label exactly.
6. **How to keep it**, matching the label, plus the computed date.
7. **Sumayya's note**, the photograph. It arrives last, after the facts have
   done their work.
8. **What next**, softly. Same WhatsApp link.
9. Footer, same as the root.

### Copy, verbatim

> **Batch 001**
> **Prawns and dates**
>
> Prawns from Chaliyam, landed 31 August 2026.
> Cooked 1 September 2026.
> Bottled 4 September 2026.
> 22 jars, 200 g each.
>
> Almost all our prawns come in at Chaliyam, where the Chaliyar meets the sea, a
> short drive from the kitchen. These ones were cooked the morning after they
> landed.
>
> **Your jar**
> The jar number is written by hand on the label. Jar 9 of 22 means yours was the
> ninth out of this pot.
>
> **What is in it**
> Prawns (59%), dates (22%), vinegar, gingelly (sesame) oil, garlic, green
> chilli, ginger, salt, Kashmiri chilli powder, red chilli powder, sugar,
> compounded asafoetida (gum arabic, wheat flour, asafoetida), mustard, curry
> leaves, fenugreek, turmeric.
>
> Contains crustacean (prawns), sesame, wheat (gluten) and mustard.
>
> No added preservatives. Prepared by traditional method.
>
> **How to keep it**
> A cool, dry place away from sunlight. Always a clean dry spoon, and keep the
> prawns covered in oil.
>
> Best before six months from packing, so until 4 March 2027.
>
> [photograph of the handwritten note]
> Sumayya writes one of these for every box.
>
> There is no shop yet. When batch 002 opens we will send you a message.
>
> **Tell me when batch 002 opens** → [WhatsApp]
>
> ---
> Lailark Kitchen. Neduvanchalil Veedu, Kunnamangalam, Kozhikode, Kerala, India,
> PIN 673571. Customer support +91 88919 23827. FSSAI 21323244000035.

### Rules

- **No price, no buy button, no cart.** They already own it. A buy button on a
  page reached by scanning a jar they paid for turns provenance into a shop, and
  the whole reason to scan is provenance.
- **The ingredient list, the allergen line and the claims are copied from the
  label character for character**, in the label's order. If a word differs, the
  website is wrong, not the label.
- **Storage is the one deliberate exception.** The label carries "refrigerate
  after opening" because that line is standard on a printed food label. The page
  leaves it out: an oil pickle at this salt and acidity does not need a fridge,
  and a fridge thickens the gingelly oil so the first spoon out is a solid
  block. The page says less than the label, never something different, and that
  is the only direction this exception may ever go.
- The facts are hardcoded. No template engine, no JSON. Batch 002 is a new
  folder, copied and edited. That stays true until the admin can generate these.
- This page never changes and never expires. When the batch sells out, nothing
  here changes. It is a record.
- The note photo: max 1200 px wide, compressed hard, `loading="lazy"`,
  `width` and `height` set. If it cannot get under about 60 KB at a quality that
  keeps the handwriting readable, it is too big and the crop is too wide.

---

## 8. Look

Black and warm off-white, following the label. The label's three panels are
black, white, black, with one rust accent on the batch number and a green used
only for the claims. That is already a palette: black, paper white, rust, and
the green left alone.

The batch page should read like a card that came with the jar, not like a
product page. Generous line height, a comfortable measure (around 60 to 70
characters), real hierarchy through size and space rather than boxes and rules.
Type does all the work. There is no design system to build here and building one
would be the wrong instinct at two pages.

The label pairs a monospaced face for the story panel with a humanist sans for
the data panel. Worth echoing, but only with fonts already on the device, since
no font may load over the wire.

Dark mode: honour `prefers-color-scheme`, or deliberately do not and pick one
look. Either is defensible. Do not half do it.

---

## 9. Deploy

**Firebase Hosting**, project `lailark`. This is the only host. Live since
2026-09-15 at `https://lailark.web.app`.

1. **Deploy.** `firebase deploy --only hosting` from the project root. Config is
   `firebase.json` and `.firebaserc`. Never run `firebase init`: its wizard
   overwrites `lailark-site/index.html` with a placeholder.
2. **DNS.** GoDaddy nameservers (`ns37`/`ns38.domaincontrol.com`) are already
   live, so delegation is done. What remains is replacing the parked `A @` record
   with the two A records Firebase gives you when you add `lailark.in` as a custom
   domain, and adding `www.lailark.in` as a second domain that redirects to the
   apex. `www` is printed on the label, so it must resolve.
3. **HTTPS.** Firebase issues the certificate automatically once DNS is live. The
   QR encodes `https://`, so a certificate still provisioning means every jar
   shows a browser warning. Do not print until the certificate reads Active and
   you have loaded the URL on a phone over mobile data, not wifi.

---

## 10. Acceptance checklist

Before the jars go out:

- [ ] **Scan the QR on an actual printed label with three phones.** Confirm it
      opens `https://lailark.in/batch/001` and nothing else. This is the only
      check that cannot be replaced by reading a file.
- [ ] Scan it on a jar, so the code takes the curve of the glass.
- [ ] `https://lailark.in/batch/001` loads over HTTPS on mobile data, not wifi.
- [ ] `https://www.lailark.in` resolves and redirects correctly.
- [ ] `/batch/1` and `/batch/01` both land on `/batch/001`.
- [ ] The ingredient list, allergen line and claims on the page match the printed
      label word for word, including the order.
- [ ] The storage line on the page says nothing the label contradicts. It is
      allowed to be shorter. It is not allowed to disagree.
- [ ] The support number on the page matches the label: +91 88919 23827.
- [ ] Total transferred bytes under 100 KB on the batch page, cache off.
- [ ] No requests to any domain other than lailark.in.
- [ ] Cumulative layout shift is zero.
- [ ] Page is readable with images blocked.
- [ ] Read both pages out loud. If a sentence sounds like a brand, rewrite it.

---

## 11. Suggested model split in Claude Code

Not a rule, just where the effort is actually hard.

| Task | Model | Why |
|---|---|---|
| Copy, tone, the judgement calls in this doc | Opus | This is the part that is hard to undo. Wrong copy on a page 22 printed jars point at is expensive |
| DNS, Firebase Hosting, redirects, the HTTPS and QR failure modes | Opus | Reasoning about how it breaks, not typing |
| Writing the HTML and CSS for two pages | Sonnet | Well specified, low ambiguity, fast |
| Image compression, file size checks, robots, favicon | Haiku | Mechanical |
| Batch 002 onward, copying the folder and swapping facts | Haiku | Once the first one is right |

A reasonable way to run it: use Opus to turn this doc into a concrete plan and
the final copy, hand the build to Sonnet in the same session, then come back to
Opus for the deploy and the acceptance pass.

---

## 12. Out of scope, deliberately

The orbit homepage, the product pages, the drop mechanics, the draw, the
24-hour payment window, the agent, the admin, Razorpay. All of it is designed in
`lailark-in-site-and-sales-flow.md` and none of it is built here. v0 is two
static pages whose only job is to make sure no printed jar ever dies.

## 13. What carries forward

- `/batch/<nnn>` is now permanent and cannot be renamed.
- The four facts on the batch page are the Batch object's QR fields.
- The label and the batch page share an ingredient list, an allergen line, a
  claims line and a storage line. When the admin generates labels, it should
  generate both from the same recipe record, so they cannot drift.
- Whatever collects the "tell me when a batch opens" replies today is the first
  notify list. Make sure it is somewhere readable in three months.
- When the real site replaces this, `/batch/001` must keep resolving. That is a
  launch checklist item, not an afterthought.
