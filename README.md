# Room Impulse Lab

A browser-local room acoustics workbench. Describe a rectangular room, place a
source and a listener, pick real surface materials, and the app synthesizes the
impulse response live, measures its decay like a real measurement chain, and
compares it against the three classic reverberation formulas. Everything runs
offline in a single static page with zero dependencies and zero network calls.

**Live demo:** aariv.me/room-impulse-lab/

## Open it

Serve the folder over local HTTP, then open the URL in any modern browser. ES
modules do **not** load over `file://`, so opening `index.html` directly will
not work.

```bash
# From the folder containing this README:
python3 -m http.server 8000
# then open http://localhost:8000/
# If you serve the parent folder instead, open http://localhost:8000/room-impulse-lab/
```

No build step, no install, and the page makes no network requests once served.

## What it computes

- **Sabine RT60** `T = 0.161 V / A`, where `A = sum_i S_i alpha_i + 4 m V` adds
  an air-absorption term that grows steeply with frequency.
- **Eyring RT60** `T = 0.161 V / (-S ln(1 - a_bar))`, the standard correction
  for rooms whose mean absorption is not small.
- **Millington-Sette RT60** `T = 0.161 V / sum_i (-S_i ln(1 - alpha_i))`, which
  uses each surface's own coefficient and survives locally dead surfaces.
- **Image-source model**: every specular reflection unfolds to a mirrored copy
  of the source on an integer lattice. Delay is distance over 343 m/s; pressure
  gain is `1/d` times `sqrt(1 - alpha)` per wall crossed. Reflection order is
  configurable up to 6 (376 image sources, 377 paths counting the direct).
- **Impulse-response synthesis**: fractional-delay impulses for every specular
  path plus a seeded stochastic octave-band tail matched to the Eyring decay.
- **Schroeder analysis**: backward integration of the squared response into an
  energy decay curve, then EDT (0 to -10 dB), T20 (-5 to -25 dB) and T30
  (-5 to -35 dB) least-squares fits extrapolated to the full 60 dB.
- **ISO 3382 clarity suite**: C50 speech clarity and C80 music clarity in dB,
  D50 definition as an early-energy fraction, plus per-band EDT/T20/T30, all
  measured on the synthesized impulse response at every octave band.
- **ANSI S12.60 classroom check**: compares measured octave-band RT60 at
  500/1000/2000 Hz against the 0.6 s (rooms to 283 m3) and 0.7 s (to 566 m3)
  limits, reports PASS/FAIL/SCOPE, and sizes a treatment plan in acoustic
  ceiling panels when the room fails.
- **Interactive ray-bounce plan**: a draggable SVG floorplan drawing the
  direct, first-order and second-order specular paths with bounce points on
  the walls. Moving the source or listener (pointer drag or arrow keys)
  re-runs the whole simulation live: RT60, C50, the Schroeder decay curve and
  the ANSI verdict all update.
- **Real WAV export**: the impulse response downloads as a 16-bit PCM mono
  RIFF/WAVE file, loadable in any DAW or convolution reverb.
- **A/B convolution audition**: toggles a dry sweep against the same sweep
  convolved through the room response, still inside the click-only audio
  policy.
- **SHA-256 fingerprinted report**: a canonical JSON (and CSV) acoustic report
  carrying a pure-JS SHA-256 fingerprint that `verifyReport` re-checks; the
  first 16 hex digits show in the footer.
- **URL-hash bookmarks**: the full room state (dimensions, positions,
  materials, order, seed, duration) encodes into a compact `#r1.` fragment
  that restores on load, with clamped, fail-closed decoding.
- **In-page self-tests**: a "Run self-tests" button executes the same 15-check
  engine audit the Node suite runs, covering Sabine/Eyring monotonicity,
  Schroeder EDC monotonicity, T30 recovery on a synthetic decay, RIFF/WAVE
  header bytes, SHA-256 vectors and report tamper detection.

## Honest limits

This is a teaching model, not a measurement: geometric acoustics only, so no
diffraction, scattering, flutter echo or coupled-volume behavior. The diffuse
tail is seeded noise shaped to the modeled decay, not wave acoustics. Material
absorption coefficients are representative mid-band teaching values.

## Privacy and audio policy

- No cookies, no analytics, no CDN, no fonts, no network requests of any kind.
- **No audio plays unless you click.** The Web Audio context is created lazily
  inside a user gesture, never on page load. The listening buttons (dry
  sweep, impulse response, auralized sweep, A/B compare) are the only places
  sound exists.
- Exports (WAV PCM16, CSV, JSON, fingerprinted report) are generated locally
  and downloaded via blob URLs. CSV cells are formula-injection safe (leading
  `=`, `+`, `-`, `@`, tab and CR are prefixed with a quote).
- The favicon is an inline data URI, so the browser never requests one.

## Accessibility

- Full keyboard operation with visible `:focus-visible` outlines.
- Skip link to a focusable `<main>` landmark; semantic headings, `role="img"`
  canvas charts with labels, `aria-live` status and `role="alert"` errors.
- `prefers-reduced-motion` honored; interactive targets meet the 24px minimum;
  responsive layout down to 390px wide.

## Testing

```
npm test        # node --test
```

The suite (node:test, zero dependencies) holds **332 passing tests** covering
the closed-form acoustics against hand-computed values, the image-source
lattice, impulse synthesis, Schroeder fitting recovery, clarity metrics and
ANSI boundaries, ray-bounce fold geometry, SHA-256 vectors, report
fingerprinting and tamper detection, URL-state round-trips, the in-page self-
test suite, export formats and formula injection, and shipped-file integrity
(CSP, XSS sinks, autoplay policy, WCAG structure, typography hygiene).

A headless-Chromium audit at 1440x900 and 390x844 exercises the ANSI badge,
ray-bounce SVG dragging, self-tests, WAV/CSV/report downloads and URL-hash
restore with zero console errors, zero page errors, zero external requests
and zero horizontal overflow.

## License

MIT. See `LICENSE`.
