# Batch 001 QR: what was decided and what to do

11 Sep 2026. Written while the first prawns and dates labels were about to go to print.

## The principle

A printed QR cannot be changed. So the only thing that has to be right before
the print run is the **address**, not the page behind it. Because lailark.in is
registered and under our control, the address is permanent by construction: the
page at the end of it can be a holding page today and the real batch page in a
month, at the same URL, and every jar already in the market keeps working.

**Never** use a shortener or a "dynamic QR" service on a printed label. bit.ly,
qr-code-generator.com and the rest own the address, not us. If they expire the
link, move it behind a paywall, or shut down, every printed jar dies and there
is nothing we can do. Our own domain is the whole insurance policy.

## The QR as printed on batch 001

| | |
|---|---|
| Encodes | `https://lailark.in/batch/001` |
| Symbol | QR Model 2, version 4, 33 x 33 modules |
| Error correction | Level H (30 percent recoverable) |
| Quiet zone | 4 modules, white, part of the artwork |
| Printed size | 20 mm code, 24.6 mm including the quiet zone |
| Artwork | vector SVG, black on white |

Level H was chosen over the usual M because this label lives on an oil jar in a
kitchen. Fingerprints, a smear of gingelly oil and the curve of the glass all
eat into readability, and H buys back the margin.

One QR for the whole batch, not one per jar. The jar number is written by hand.
Per jar codes mean 22 label variants at the printer and careful sorting during
bottling, which is not worth it for a first run. Revisit when the admin can
generate a label sheet.

## Rules for the artwork

- Vector only. Never scale a PNG up; never let a designer redraw it by eye.
- Black on white. Do not invert, do not tint, do not put it on the black panels.
- The white margin is part of the code. Nothing may encroach on it.
- 20 mm is the target. 18 mm is the floor. Below that, module size drops under
  half a millimetre and cheap label printing starts to close up the gaps.
- Place it on the flattest part of the centre panel. A QR wrapped around the
  shoulder of the jar reads at a bad angle.

## Carried into the site build

- Batch page URLs are `lailark.in/batch/<3 digit number>`, zero padded. This is
  now fixed in print and cannot be renamed later.
- The admin's Batch object must expose the QR fields named in the site doc
  (source, landing date, made date, jar count) because they are what this page
  renders.
- When the real site replaces this, `/batch/001` must keep resolving. Add it to
  the launch checklist as a redirect test, not an afterthought.
