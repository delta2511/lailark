# lailark.in home: jar video background

15 Sep 2026. Change to the v0 holding page. `/batch/001` is untouched.

## What was added

- `assets/jars-loop.mp4`: the batch 001 video (hand lifting a jar from the 22), played forward then backward so the loop has no jump. 12 s, 480x852, H.264, no audio track, 485 KB, faststart.
- `assets/jars-loop.jpg`: first frame, 27 KB. Shown as the poster and as the CSS background, so first paint never waits on the video.
- A fixed full-screen `.bg` layer behind the page, `object-fit: cover`, with a paper veil over it so the video shows through but the text stays readable. Veil: `rgba(250,246,239,.84)` light, `rgba(21,18,15,.82)` dark. Lower the alpha to show more video, raise it for more contrast.
- Zero JavaScript. `autoplay muted loop playsinline` is what lets it play on iPhone without a tap.
- `prefers-reduced-motion: reduce` hides the video and leaves the still.
- The `<video>` sits after `</main>`, so with CSS blocked the document still reads top to bottom.
- `mp4` is in the 30-day immutable cache rule in `firebase.json`. Firebase Hosting serves byte ranges, which Safari needs.

## Trade-off, accepted knowingly

The v0 spec set a 100 KB page budget. The home page is now about 580 KB in total. The text and the still paint as before; the video streams in after. The batch page, which the QR points at, stays under budget.

iPhone Low Power Mode blocks autoplay, so those visitors see the still. That is fine.

## Filenames

If the video is ever re-cut, give it a new filename (`jars-loop-2.mp4`) rather than overwriting, because assets are cached as immutable for 30 days.
