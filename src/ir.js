/* Impulse response synthesis and decay analysis. Pure ES module.
 *
 * The synthesized response has two parts: the specular early field (direct
 * sound plus image-source reflections, rendered as fractional-delay
 * impulses) and a stochastic late field (seeded Gaussian noise shaped to the
 * modeled exponential decay). Schroeder backward integration and standard
 * EDT / T20 / T30 estimators then measure the result the same way a real
 * measurement would.
 */

import { mulberry32, normalSampler } from './prng.js';
import {
  OCTAVE_BANDS, SPEED_OF_SOUND, decaySigma, distance, meanFreePath,
  eyringRT60, safeDiv
} from './acoustics.js';
import { allPaths } from './images.js';

/** Band-center weighting so the broadband IR has a plausible spectrum. */
export function bandWeight(band) {
  return [0.35, 0.55, 0.85, 1.0, 0.9, 0.7][band] ?? 1;
}

/* Octave-band analysis chain: a single Q=0.9 biquad leaks ~0.58 amplitude
 * (about -4.7 dB) into the neighbouring octave, which measurably biased the
 * per-band decay fits. An octave-wide passband corresponds to Q ~ 1.41, and
 * three cascaded sections push adjacent-octave leakage below ~0.1. */
export const BAND_Q = 1.41;
export const BAND_STAGES = 3;

/**
 * Add a unit impulse at a fractional delay. The two nearest samples carry the
 * linear-interpolated energy-normalized split: scaling by
 * 1/sqrt((1-f)^2 + f^2) conserves total impulse energy across the pair, at the
 * cost of a tiny amplitude overshoot for mid-sample delays. Out-of-range
 * indices still clip to the nearest end sample as a defensive fallback; the
 * synthesizer drops such arrivals instead of relying on this.
 */
export function addFractionalImpulse(buf, index, amplitude) {
  if (!buf || !buf.length) return;
  const i = Math.floor(index);
  const frac = index - i;
  const j0 = Math.max(0, Math.min(buf.length - 1, i));
  const j1 = Math.max(0, Math.min(buf.length - 1, i + 1));
  if (j1 === j0) {
    buf[j0] += amplitude;
    return;
  }
  const norm = 1 / Math.sqrt((1 - frac) * (1 - frac) + frac * frac);
  buf[j0] += amplitude * (1 - frac) * norm;
  buf[j1] += amplitude * frac * norm;
}

/** RBJ bandpass biquad coefficients (constant 0 dB peak gain). */
export function bandpassBiquad(fc, q, sampleRate) {
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const f = Math.max(10, Math.min(fc, sr * 0.45));
  const qq = Math.max(0.05, q || 1);
  const w0 = (2 * Math.PI * f) / sr;
  const alpha = Math.sin(w0) / (2 * qq);
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0
  };
}

/** Direct-form I biquad filter over a Float64Array (returns new array). */
export function applyBiquad(coef, samples) {
  const { b0, b1, b2, a1, a2 } = coef;
  const out = new Float64Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Cascade the same biquad `stages` times for real band isolation. */
export function applyBandpass(coef, samples, stages = 1) {
  let out = samples;
  for (let s = 0; s < stages; s++) out = applyBiquad(coef, out);
  return out;
}

/**
 * Exponentially decaying Gaussian noise tail for one octave band, matched to
 * the given RT60: h(t) = n(t) * exp(-sigma t), sigma = ln(1000)/T60. A short
 * build-up ramp keeps the late field from starting before sound can fill the
 * room. Deterministic for a given seed.
 */
export function diffuseTail({ sampleRate = 44100, duration = 1, t60 = 1, seed = 1, buildTime = 0.02, level = 1, startTime = 0 } = {}) {
  const sr = Math.max(8000, Math.floor(sampleRate) || 44100);
  const n = Math.max(1, Math.floor(duration * sr));
  const rand = normalSampler(mulberry32((Number(seed) >>> 0) ^ 0x51ed));
  // t60 <= 0 or NaN is not a physical decay: emit silence. +Infinity decays
  // not at all (sigma 0, a flat tail).
  const sigma = Number.isNaN(t60) || t60 <= 0 ? Infinity : decaySigma(t60);
  const tau = Math.max(1e-4, buildTime);
  const t0 = Math.max(0, Number(startTime) || 0);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const te = i / sr - t0;
    if (te <= 0) continue; // nothing reverberates before the sound arrives
    const build = 1 - Math.exp(-te / tau);
    out[i] = level * rand() * Math.exp(-sigma * te) * build;
  }
  return out;
}

/**
 * Synthesize the full impulse response.
 *  - direct + image-source reflections as fractional-delay impulses, each
 *    weighted by its per-band gain summed with bandWeight.
 *  - late field = sum of per-band diffuse tails, each decaying at that
 *    band's Eyring RT60 and scaled so its steady energy tracks the model.
 * Returns { ir, sampleRate, paths, rendered, tailGain }: `paths` is every
 * computed arrival (the table wants them all); `rendered` is how many fit
 * inside the buffer.
 */
export function synthesizeIR(opts = {}) {
  const sr = Math.max(8000, Math.floor(opts.sampleRate) || 44100);
  const duration = Math.min(8, Math.max(0.1, Number.isFinite(opts.duration) ? opts.duration : 1.5));
  const n = Math.floor(duration * sr);
  const ir = new Float64Array(n);
  const paths = allPaths(opts);

  // Early specular field: every path contributes its band-weighted gain.
  // Arrivals after the IR end are inaudible here: drop them instead of
  // letting the impulse writer clamp them onto the final sample.
  let rendered = 0;
  for (const p of paths) {
    if (p.delay * sr >= n - 1) continue;
    let g = 0;
    for (let b = 0; b < OCTAVE_BANDS.length; b++) g += (p.gains[b] || 0) * bandWeight(b);
    g /= OCTAVE_BANDS.length;
    addFractionalImpulse(ir, p.delay * sr, g);
    rendered++;
  }

  // Late diffuse field: per-band stochastic tails matched to Eyring decay.
  // The build-up is anchored at the first arrival (the direct path): a real
  // IR is silent before the direct sound reaches the listener.
  const seed = (Number(opts.seed) >>> 0) || 1;
  const build = safeDiv(1.5 * meanFreePath(opts.dims), SPEED_OF_SOUND, 0.02);
  const firstDelay = paths.length ? paths[0].delay : 0;
  const tail = new Float64Array(n);
  for (let b = 0; b < OCTAVE_BANDS.length; b++) {
    const t = eyringRT60(opts.dims, opts.materials, b);
    if (!Number.isFinite(t) || t <= 0) continue;
    const band = diffuseTail({
      sampleRate: sr, duration, t60: t, seed: seed + 101 * b,
      buildTime: build, level: 1, startTime: firstDelay
    });
    const shaped = applyBandpass(bandpassBiquad(OCTAVE_BANDS[b], BAND_Q, sr), band, BAND_STAGES);
    // Normalize each band tail to unit variance, then weight it so the
    // relative band energies stay plausible instead of equal.
    let e = 0;
    for (let i = 0; i < n; i++) e += shaped[i] * shaped[i];
    const scale = e > 0 ? bandWeight(b) / Math.sqrt(e / n) : 0;
    for (let i = 0; i < n; i++) tail[i] += shaped[i] * scale;
  }
  // The tail is scaled well below the direct peak; the early field dominates
  // the first milliseconds exactly as measured rooms behave.
  let tailPeak = 0;
  for (let i = 0; i < n; i++) tailPeak = Math.max(tailPeak, Math.abs(tail[i]));
  const direct = distance(opts.source, opts.listener);
  const directGain = direct > 0 ? 1 / direct : 0;
  const tailGain = tailPeak > 0 ? (0.18 * directGain) / tailPeak : 0;
  for (let i = 0; i < n; i++) ir[i] += tail[i] * tailGain;

  return { ir, sampleRate: sr, paths, rendered, tailGain };
}

/** Peak-normalize a buffer to the given ceiling (default 0.98). */
export function normalizePeak(samples, peak = 0.98) {
  let m = 0;
  for (let i = 0; i < samples.length; i++) m = Math.max(m, Math.abs(samples[i]));
  if (!(m > 0)) return { samples, gain: 1 };
  const gain = peak / m;
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return { samples: out, gain };
}

/**
 * Schroeder backward integration: L(t) = 10 log10( E(t) / E(0) ) with
 * E(t) = sum_{k>=t} p[k]^2. Returned in dB, one point per input sample.
 */
export function schroeder(samples) {
  const n = samples ? samples.length : 0;
  const out = new Float64Array(n);
  if (!n) return out;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    tail += samples[i] * samples[i];
    out[i] = tail;
  }
  const total = out[0] > 0 ? out[0] : 1;
  for (let i = 0; i < n; i++) out[i] = 10 * Math.log10(Math.max(out[i], 1e-30) / total);
  return out;
}

/**
 * Least-squares slope fit of the decay curve between two dB levels.
 * Returns { t60, slope (dB/s), r2, points } where t60 = -60/slope.
 */
export function fitDecay(edc, sampleRate, hiDb = -5, loDb = -35) {
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const xs = [];
  const ys = [];
  let started = false;
  for (let i = 0; i < edc.length; i++) {
    const v = edc[i];
    if (!started && v <= hiDb) started = true;
    if (started) {
      if (v < loDb) break;
      xs.push(i / sr);
      ys.push(v);
    }
  }
  if (xs.length < 2) return { t60: NaN, slope: NaN, r2: 0, points: xs.length };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
  }
  const nPts = xs.length;
  const denom = nPts * sxx - sx * sx;
  if (Math.abs(denom) < 1e-18) return { t60: NaN, slope: NaN, r2: 0, points: nPts };
  const slope = (nPts * sxy - sx * sy) / denom;
  const my = sy / nPts;
  let sst = 0, sse = 0;
  const intercept = (sy - slope * sx) / nPts;
  for (let i = 0; i < nPts; i++) {
    const d = ys[i] - my;
    const e = ys[i] - (slope * xs[i] + intercept);
    sst += d * d; sse += e * e;
  }
  const r2 = sst > 0 ? Math.max(0, 1 - sse / sst) : 0;
  return { t60: slope < 0 ? -60 / slope : Infinity, slope, r2, points: nPts, intercept };
}

/**
 * Standard estimators: EDT fits the 0..-10 dB segment, T20 fits -5..-25,
 * T30 fits -5..-35. Each returns the slope-extrapolated 60 dB decay time
 * (-60/slope), which is exactly what the classic multipliers (x6, x3, x2)
 * compute from raw segment spans. All values in seconds.
 */
export function estimateRT60(samples, sampleRate) {
  const edc = schroeder(samples);
  const edt = fitDecay(edc, sampleRate, 0, -10);
  const t20 = fitDecay(edc, sampleRate, -5, -25);
  const t30 = fitDecay(edc, sampleRate, -5, -35);
  return {
    edc,
    edt: edt.t60,
    edtFit: edt,
    t20: t20.t60,
    t20Fit: t20,
    t30: t30.t60,
    t30Fit: t30
  };
}
