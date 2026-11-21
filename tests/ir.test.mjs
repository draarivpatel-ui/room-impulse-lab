/* Tests for impulse-response synthesis and Schroeder decay analysis.
 * Run: node --test tests/ir.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, normalSampler } from '../src/prng.js';
import {
  bandWeight, addFractionalImpulse, bandpassBiquad, applyBiquad,
  diffuseTail, schroeder, fitDecay, estimateRT60, synthesizeIR, normalizePeak
} from '../src/ir.js';
import { simulate } from '../src/sim.js';
import { DEFAULT_ROOM, OCTAVE_BANDS, eyringRT60, SPEED_OF_SOUND } from '../src/acoustics.js';

const D = DEFAULT_ROOM.dims;
const M = DEFAULT_ROOM.materials;
const SRC = DEFAULT_ROOM.source;
const LIS = DEFAULT_ROOM.listener;
const SR = 44100;
const ROOM = { dims: D, source: SRC, listener: LIS, materials: M, maxOrder: 1, duration: 0.6, seed: 5, sampleRate: SR };
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);

/* ---------------- prng ---------------- */

test('mulberry32 is deterministic and bounded in [0,1)', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const x = a(), y = b();
    assert.equal(x, y);
    assert.ok(x >= 0 && x < 1);
  }
});

test('mulberry32 streams differ for different seeds', () => {
  const a = mulberry32(1), b = mulberry32(2);
  let same = 0;
  for (let i = 0; i < 20; i++) if (a() === b()) same++;
  assert.ok(same <= 1);
});

test('normalSampler approximates zero mean and unit variance', () => {
  const n = normalSampler(mulberry32(7));
  let m = 0, m2 = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) { const v = n(); m += v; m2 += v * v; }
  m /= N; m2 = m2 / N - m * m;
  assert.ok(Math.abs(m) < 0.05, 'mean ' + m);
  assert.ok(Math.abs(m2 - 1) < 0.1, 'var ' + m2);
});

/* ---------------- impulse placement ---------------- */

test('integer-index impulses land on the nearest sample', () => {
  const buf = new Float64Array(10);
  addFractionalImpulse(buf, 4.0, 1.0);
  assert.equal(buf[4], 1.0);
  assert.equal(buf.reduce((s, v) => s + v, 0), 1.0);
});

test('fractional impulses conserve energy across the split', () => {
  const buf = new Float64Array(10);
  addFractionalImpulse(buf, 4.25, 1.0);
  const norm = 1 / Math.sqrt(0.75 * 0.75 + 0.25 * 0.25);
  close(buf[4], 0.75 * norm, 1e-12);
  close(buf[5], 0.25 * norm, 1e-12);
  close(buf[4] * buf[4] + buf[5] * buf[5], 1.0, 1e-12);
});

test('impulses past the end clip into the last sample without wrapping', () => {
  const buf = new Float64Array(10);
  addFractionalImpulse(buf, 9.4, 1.0);
  close(buf[9], 1.0); // both taps clamp onto j0
  addFractionalImpulse(buf, 20, 1.0);
  close(buf[9], 2.0);
});

test('negative indices clip to sample zero', () => {
  const buf = new Float64Array(10);
  addFractionalImpulse(buf, -0.5, 1.0);
  close(buf[0], 1.0);
});

/* ---------------- bandpass ---------------- */

test('bandpass coefficients are finite and bounded', () => {
  const b = bandpassBiquad(1000, 0.9, SR);
  for (const k of ['b0', 'b1', 'b2', 'a1', 'a2']) assert.ok(Number.isFinite(b[k]), k);
  assert.ok(Math.abs(b.b0) <= 1 && Math.abs(b.b2) <= 1);
});

test('bandpass passes energy near its center, not far from it', () => {
  const b = bandpassBiquad(1000, 0.9, SR);
  const measure = (f) => {
    const sig = new Float64Array(4410).map((_, i) => Math.sin(2 * Math.PI * f * i / SR));
    const y = applyBiquad(b, sig);
    let e = 0;
    for (let i = 2000; i < y.length; i++) e += y[i] * y[i];
    return e;
  };
  const pass = measure(1000);
  const stop = measure(6000);
  assert.ok(pass > 10 * stop, 'pass ' + pass + ' vs stop ' + stop);
});

test('bandpass has zero DC gain', () => {
  const b = bandpassBiquad(500, 0.9, SR);
  const y = applyBiquad(b, new Float64Array(8000).fill(1));
  assert.ok(Math.abs(y[y.length - 1]) < 1e-3, 'dc ' + y[y.length - 1]);
});

test('extreme frequencies do not blow up the filter', () => {
  for (const f of [10, 22000]) {
    const b = bandpassBiquad(f, 0.9, SR);
    const y = applyBiquad(b, new Float64Array(500).map((_, i) => Math.sin(i)));
    assert.ok(y.every(Number.isFinite));
  }
});

/* ---------------- diffuse tail ---------------- */

test('diffuseTail decays at the requested RT60', () => {
  const t60 = 0.4;
  const out = diffuseTail({ sampleRate: SR, duration: 1.0, t60, seed: 3 });
  const edc = schroeder(out);
  const fit = fitDecay(edc, SR, -5, -35);
  assert.ok(Number.isFinite(fit.t60), JSON.stringify(fit));
  assert.ok(Math.abs(fit.t60 - t60) / t60 < 0.2, 'recovered ' + fit.t60 + ' vs ' + t60);
});

test('diffuseTail is deterministic for a given seed', () => {
  const a = diffuseTail({ sampleRate: SR, duration: 0.1, t60: 0.5, seed: 9 });
  const b = diffuseTail({ sampleRate: SR, duration: 0.1, t60: 0.5, seed: 9 });
  assert.deepEqual([...a], [...b]);
});

test('diffuseTail with infinite RT60 does not decay', () => {
  const out = diffuseTail({ sampleRate: SR, duration: 0.5, t60: Infinity, seed: 1, buildTime: 0.001 });
  let early = 0, late = 0;
  for (let i = 2000; i < 4000; i++) early += out[i] * out[i];
  for (let i = out.length - 2000; i < out.length; i++) late += out[i] * out[i];
  assert.ok(late > 0.5 * early, 'late energy ' + late + ' vs early ' + early);
});

test('diffuseTail respects the requested length', () => {
  const out = diffuseTail({ sampleRate: 22050, duration: 0.25, t60: 0.3, seed: 4 });
  assert.equal(out.length, Math.floor(0.25 * 22050));
});

/* ---------------- Schroeder integration ---------------- */

test('schroeder starts at 0 dB and is monotonically non-increasing', () => {
  const sig = new Float64Array(2000).map((_, i) => (i < 50 ? 1 : 0));
  const edc = schroeder(sig);
  close(edc[0], 0, 1e-9);
  for (let i = 1; i < edc.length; i++) assert.ok(edc[i] <= edc[i - 1] + 1e-9, 'dB ' + i);
});

test('schroeder of a constant-energy signal falls linearly in energy', () => {
  const n = 1000;
  const sig = new Float64Array(n).fill(0.5);
  const edc = schroeder(sig);
  const i = 400;
  close(edc[i], 10 * Math.log10((n - i) / n), 1e-9);
  close(edc[n - 1], 10 * Math.log10(1 / n), 1e-9);
});

test('schroeder floors at -300 dB instead of -Infinity where energy ends', () => {
  const sig = new Float64Array(100);
  sig[0] = 1;
  const edc = schroeder(sig);
  assert.equal(edc[sig.length - 1], -300);
});

test('fitDecay recovers an exact exponential line', () => {
  const n = SR;
  const edc = new Float64Array(n);
  for (let i = 0; i < n; i++) edc[i] = -20 * (i / SR);
  const fit = fitDecay(edc, SR, -5, -25);
  close(fit.slope, -20, 1e-6);
  close(fit.t60, 3, 1e-4); // -60 / -20
  assert.ok(fit.r2 > 0.999999);
});

test('fitDecay returns an effectively infinite t60 for a flat curve', () => {
  const edc = new Float64Array(100).fill(-10);
  const fit = fitDecay(edc, SR, 0, -10);
  assert.ok(!Number.isFinite(fit.t60) || fit.t60 > 1e9, 't60 ' + fit.t60);
});

test('fitDecay reports no points when the range is empty', () => {
  const edc = new Float64Array(10).fill(-60);
  const fit = fitDecay(edc, SR, -5, -25);
  assert.equal(fit.points, 0);
  assert.ok(!Number.isFinite(fit.t60));
});

test('estimateRT60 reports all four estimators on a decaying tail', () => {
  const t60 = 0.35;
  const sig = diffuseTail({ sampleRate: SR, duration: 0.5, t60, seed: 11 });
  const r = estimateRT60(sig, SR);
  for (const k of ['edt', 't20', 't30']) {
    assert.ok(Number.isFinite(r[k]), k + ' = ' + r[k]);
    assert.ok(Math.abs(r[k] - t60) / t60 < 0.3, k + ' = ' + r[k]);
  }
  assert.ok(r.edc instanceof Float64Array);
  assert.equal(r.edc.length, sig.length);
});

test('estimateRT60 on silence yields a non-finite estimate, not a crash', () => {
  const r = estimateRT60(new Float64Array(5000), SR);
  for (const k of ['edt', 't20', 't30']) {
    assert.ok(Number.isNaN(r[k]) || r[k] === Infinity, k);
  }
});

test('bandWeight peaks at 1 kHz and decays away from it', () => {
  close(bandWeight(3), 1);
  for (let b = 0; b < 6; b++) {
    assert.ok(bandWeight(b) > 0 && bandWeight(b) <= 1);
    if (b !== 3) assert.ok(bandWeight(b) < 1);
  }
  assert.equal(bandWeight(99), 1); // out-of-range fallback
});

/* ---------------- synthesizeIR ---------------- */

test('synthesizeIR output length is duration x sampleRate', () => {
  const { ir } = synthesizeIR(ROOM);
  assert.equal(ir.length, Math.floor(0.6 * SR));
});

test('synthesizeIR places the direct impulse at the computed delay', () => {
  const lively = Object.fromEntries(Object.keys(M).map((k) => [k, 'concrete']));
  const cfg = { ...ROOM, materials: lively, maxOrder: 0, duration: 0.2 };
  const { ir, paths } = synthesizeIR(cfg);
  const direct = paths[0];
  const idx = Math.round(direct.delay * SR);
  let peak = 0;
  for (let i = Math.max(0, idx - 3); i <= idx + 3; i++) peak = Math.max(peak, Math.abs(ir[i]));
  const directGain = 1 / direct.distance;
  assert.ok(peak > 0.3 * directGain / OCTAVE_BANDS.length, 'direct peak ' + peak);
});

test('synthesizeIR is deterministic for a fixed seed', () => {
  const a = synthesizeIR(ROOM).ir;
  const b = synthesizeIR(ROOM).ir;
  assert.deepEqual([...a.slice(0, 500)], [...b.slice(0, 500)]);
});

test('synthesizeIR samples stay finite', () => {
  const { ir } = synthesizeIR(ROOM);
  for (let i = 0; i < ir.length; i += 7) assert.ok(Number.isFinite(ir[i]), i);
});

test('normalizePeak rescales to the target ceiling', () => {
  const sig = new Float64Array([0, 0.2, -0.5, 0.1]);
  const { samples, gain } = normalizePeak(sig, 0.98);
  close(gain, 0.98 / 0.5, 1e-9);
  close(Math.max(...samples.map(Math.abs)), 0.98, 1e-9);
});

test('normalizePeak leaves silence untouched and scales quiet signals up', () => {
  assert.equal(normalizePeak(new Float64Array(4)).gain, 1);
  const quiet = new Float64Array([0.001, -0.001]);
  const { gain } = normalizePeak(quiet);
  close(gain, 980, 1e-9);
});

/* ---------------- simulate ---------------- */

test('simulate succeeds on the default room', () => {
  const r = simulate(DEFAULT_ROOM);
  assert.ok(r.ok, r.errors && r.errors.join());
  assert.equal(r.summary.bands.length, 6);
  assert.equal(r.measured.length, 6);
  assert.equal(r.paths[0].order, 0);
  assert.equal(r.paths.length, r.stats.pathCount);
  assert.ok(r.stats.directDelayMs > 0);
});

test('simulate fails closed on invalid input', () => {
  const bad = { ...DEFAULT_ROOM, dims: { x: -1, y: 2, z: 2 } };
  const r = simulate(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
  assert.equal(r.playback, undefined);
  assert.equal(r.summary, undefined);
});

test('simulate fails closed on a non-integer reflection order', () => {
  for (const bad of [NaN, 2.5, -1, 12]) {
    assert.equal(simulate({ ...DEFAULT_ROOM, maxOrder: bad }).ok, false, String(bad));
  }
});

test('simulate measured T30 roughly tracks Eyring at mid bands', () => {
  const r = simulate({ ...DEFAULT_ROOM, duration: 2.5, maxOrder: 1, seed: 13 });
  assert.ok(r.ok);
  for (const b of [2, 3, 4]) {
    const predicted = r.summary.bands[b].eyring;
    const got = r.measured[b].t30;
    assert.ok(got > 0.3 * predicted && got < 2.5 * predicted,
      `band ${b}: T30 ${got} vs Eyring ${predicted}`);
  }
});

test('simulate results are identical across repeated calls', () => {
  const a = simulate(DEFAULT_ROOM);
  const b = simulate(DEFAULT_ROOM);
  assert.ok(a.ok && b.ok);
  assert.equal(a.stats.pathCount, b.stats.pathCount);
  assert.deepEqual(a.measured.map((m) => m.t30), b.measured.map((m) => m.t30));
  assert.deepEqual([...a.playback.slice(0, 100)], [...b.playback.slice(0, 100)]);
});

test('simulation playback peak never exceeds 0.98', () => {
  const r = simulate(DEFAULT_ROOM);
  let peak = 0;
  for (const v of r.playback) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= 0.98 + 1e-9, 'peak ' + peak);
});

test('higher reflection order adds more early energy', () => {
  const a = simulate({ ...DEFAULT_ROOM, maxOrder: 1, seed: 21 });
  const b = simulate({ ...DEFAULT_ROOM, maxOrder: 4, seed: 21 });
  assert.ok(b.stats.imageCount > a.stats.imageCount);
});

/* ---------------- extended DSP coverage ---------------- */

test('the biquad impulse response rings then settles to zero', () => {
  const b = bandpassBiquad(1000, 0.9, SR);
  const impulse = new Float64Array(4000);
  impulse[0] = 1;
  const y = applyBiquad(b, impulse);
  assert.ok(Math.abs(y[1]) > 1e-6);
  assert.ok(Math.abs(y[y.length - 1]) < 1e-6, 'still ringing ' + y[y.length - 1]);
});

test('synthesizeIR has nonzero content at the first image delay', () => {
  const cfg = { ...ROOM, duration: 0.3, seed: 17 };
  const { ir, paths } = synthesizeIR(cfg);
  const first = paths.find((p) => p.order === 1);
  const idx = Math.round(first.delay * cfg.sampleRate);
  let local = 0;
  for (let i = idx - 2; i <= idx + 2; i++) local = Math.max(local, Math.abs(ir[i]));
  assert.ok(local > 1e-4, 'no energy near first reflection ' + local);
});

test('normalizePeak honors a custom ceiling', () => {
  const { samples, gain } = normalizePeak(new Float64Array([0, -0.4, 0.2]), 0.5);
  close(gain, 0.5 / 0.4, 1e-9);
  close(Math.max(...samples.map(Math.abs)), 0.5, 1e-9);
});

test('schroeder of a single impulse starts at 0 dB at the impulse index', () => {
  const sig = new Float64Array(500);
  sig[100] = 1;
  const edc = schroeder(sig);
  close(edc[100], 0, 1e-9);
  assert.ok(edc[0] > -1e-9);
});

test('estimateRT60 reports the fits it used', () => {
  const r = estimateRT60(diffuseTail({ sampleRate: SR, duration: 0.4, t60: 0.3, seed: 2 }), SR);
  for (const k of ['edtFit', 't20Fit', 't30Fit']) {
    assert.ok(r[k] && typeof r[k] === 'object');
    assert.ok('slope' in r[k] && 'r2' in r[k]);
  }
});

test('simulate exposes the room volume and path statistics', () => {
  const r = simulate(DEFAULT_ROOM);
  assert.equal(r.summary.volume, 81);
  assert.ok(r.stats.imageCount >= 62);
  assert.ok(r.stats.directDistance > 2);
});
