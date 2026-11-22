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

## Honest limits

This is a teaching model, not a measurement: geometric acoustics only, so no
diffraction, scattering, flutter echo or coupled-volume behavior. The diffuse
tail is seeded noise shaped to the modeled decay, not wave acoustics. Material
absorption coefficients are representative mid-band teaching values.

## Privacy and audio policy

- No cookies, no analytics, no CDN, no fonts, no network requests of any kind.
- **No audio plays unless you click.** The Web Audio context is created lazily
  inside a user gesture, never on page load. The three listening buttons (dry
  sweep, impulse response, auralized sweep) are the only places sound exists.
- Exports (WAV PCM16, CSV, JSON) are generated locally and downloaded via blob
  URLs. CSV cells are formula-injection safe (leading `=`, `+`, `-`, `@`, tab
  and CR are prefixed with a quote).

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

The suite (node:test, zero dependencies) covers the closed-form acoustics
against hand-computed values, the image-source lattice, impulse synthesis,
Schroeder fitting recovery, export formats and formula injection, and shipped-
file integrity (CSP, XSS sinks, autoplay policy, WCAG structure, typography
hygiene).

## License

MIT. See `LICENSE`.
