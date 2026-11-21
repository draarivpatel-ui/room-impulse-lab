/* Adversarial-audit regression tests (wave 5). Each test reproduces a defect
 * found by hostile review and now fixed. Run: node --test tests/wave5-regression.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addFractionalImpulse, bandpassBiquad, applyBiquad, applyBandpass,
  diffuseTail, synthesizeIR, schroeder, BAND_Q, BAND_STAGES
} from '../src/ir.js';
import { directPath, allPaths } from '../src/images.js';
import { simulate } from '../src/sim.js';
import { DEFAULT_ROOM, OCTAVE_BANDS, SPEED_OF_SOUND, eyringRT60 } from '../src/acoustics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const SR = 44100;

/* F1: out-of-range reflections must not pile into the last IR sample. */
test('giant-room late arrivals are dropped, not clamped onto the last sample', () => {
  const cfg = {
    dims: { x: 60, y: 60, z: 20 },
    source: { x: 1, y: 1, z: 1 },
    listener: { x: 59, y: 59, z: 19 },
    materials: DEFAULT_ROOM.materials,
    maxOrder: 6, duration: 0.3, seed: 5, sampleRate: SR
  };
  const { ir, paths, rendered } = synthesizeIR(cfg);
  const n = ir.length;
  // Most paths arrive after 300 ms in this room: they must be skipped.
  const late = paths.filter((p) => p.delay * SR >= n - 1).length;
  assert.ok(late > 100, 'expected many late arrivals, got ' + late);
  assert.equal(rendered + late, paths.length);
  // The peak must sit at the direct path, not at the buffer end.
  let peakIdx = 0, peak = 0;
  for (let i = 0; i < n; i++) if (Math.abs(ir[i]) > peak) { peak = Math.abs(ir[i]); peakIdx = i; }
  assert.ok(peakIdx < n - 100, 'peak sits at index ' + peakIdx + ' of ' + n);
  assert.ok(Math.abs(ir[n - 1]) < 0.1 * peak, 'last sample ' + ir[n - 1] + ' vs peak ' + peak);
});

test('simulation of the giant room produces a sane normalized playback', () => {
  const cfg = {
    dims: { x: 60, y: 60, z: 20 },
    source: { x: 1, y: 1, z: 1 },
    listener: { x: 59, y: 59, z: 19 },
    materials: DEFAULT_ROOM.materials,
    maxOrder: 6, duration: 0.3, seed: 5
  };
  const r = simulate(cfg);
  assert.ok(r.ok);
  let peakIdx = 0, peak = 0;
  for (let i = 0; i < r.playback.length; i++) if (Math.abs(r.playback[i]) > peak) { peak = Math.abs(r.playback[i]); peakIdx = i; }
  // The peak must belong to the early specular field (a rendered path),
  // never a sample clamped at the buffer end.
  assert.ok(peakIdx < r.playback.length - 100, 'peak at ' + peakIdx + ' of ' + r.playback.length);
  const near = r.paths.some((p) => Math.abs(Math.round(p.delay * r.sampleRate) - peakIdx) < 3);
  assert.ok(near, 'peak at ' + peakIdx + ' matches no specular path');
});

/* F2: the diffuse tail must not start before the direct arrival. */
test('the IR is silent before the direct sound arrives', () => {
  const r = simulate(DEFAULT_ROOM);
  const directIdx = Math.floor(r.direct.delay * r.sampleRate);
  assert.ok(directIdx > 100);
  let pre = 0, total = 0;
  for (let i = 0; i < r.ir.length; i++) {
    total += r.ir[i] * r.ir[i];
    if (i < directIdx - 4) pre += r.ir[i] * r.ir[i];
  }
  assert.ok(pre / total < 0.001, 'pre-direct energy fraction ' + (pre / total));
});

test('the early field still begins at the direct arrival', () => {
  const r = simulate(DEFAULT_ROOM);
  const idx = Math.round(r.direct.delay * r.sampleRate);
  let local = 0;
  for (let i = Math.max(0, idx - 3); i <= idx + 3; i++) local = Math.max(local, Math.abs(r.ir[i]));
  assert.ok(local > 0.05, 'no direct impulse at ' + idx + ' (' + local + ')');
});

/* F3: cascaded octave-band filters isolate neighbouring bands. */
function bandLeak(fc, probe, q = BAND_Q, stages = BAND_STAGES) {
  const coef = bandpassBiquad(fc, q, SR);
  const sig = new Float64Array(8192).map((_, i) => Math.sin(2 * Math.PI * probe * i / SR));
  const y = applyBandpass(coef, sig, stages);
  let e = 0;
  for (let i = 4000; i < y.length; i++) e += y[i] * y[i];
  return Math.sqrt(e / (y.length - 4000));
}

test('adjacent-octave leakage is far below the old single-biquad level', () => {
  const pass = bandLeak(1000, 1000);
  const adj = bandLeak(1000, 2000);
  const far = bandLeak(4000, 1000);
  assert.ok(pass > 0.5, 'in-band gain too low ' + pass);
  assert.ok(adj < 0.15, 'adjacent octave leaks ' + adj);
  assert.ok(far < 0.05, 'two octaves away leaks ' + far);
});

test('measured T30 tracks Eyring within a tight band at mid frequencies', () => {
  const r = simulate({ ...DEFAULT_ROOM, duration: 2.5, maxOrder: 1, seed: 13 });
  assert.ok(r.ok);
  for (const b of [2, 3, 4]) {
    const predicted = r.summary.bands[b].eyring;
    const got = r.measured[b].t30;
    assert.ok(got > 0.5 * predicted && got < 1.6 * predicted,
      `band ${b}: T30 ${got} vs Eyring ${predicted}`);
  }
});

test('measured T30 is finite at every band in the default room', () => {
  const r = simulate(DEFAULT_ROOM);
  for (const [i, m] of r.measured.entries()) {
    assert.ok(Number.isFinite(m.t30), 'band ' + i + ' t30=' + m.t30);
  }
});

/* F5: fractional impulses conserve energy. */
test('a mid-sample fractional impulse loses no energy', () => {
  const buf = new Float64Array(16);
  addFractionalImpulse(buf, 7.5, 2.0);
  const e = buf.reduce((s, v) => s + v * v, 0);
  assert.ok(Math.abs(e - 4) < 1e-9, 'energy ' + e + ' vs 4');
});

/* F6: path APIs tolerate missing arguments. */
test('directPath and allPaths do not throw on empty arguments', () => {
  const d = directPath({});
  assert.equal(d.order, 0);
  assert.equal(d.distance, 0);
  assert.equal(d.delay, 0);
  assert.deepEqual(d.pos, { x: 0, y: 0, z: 0 });
  const p = allPaths({});
  assert.equal(p.length, 1);
  assert.equal(p[0].path, 'direct');
  const s = synthesizeIR({ duration: 0.05 });
  assert.equal(s.ir.length, Math.floor(0.1 * SR)); // 0.1 s floor, not the 1.5 s default
});

/* F7: diffuseTail with a non-physical t60 emits silence, not growing noise. */
test('diffuseTail emits silence for t60 <= 0 or NaN', () => {
  for (const bad of [0, -1, NaN]) {
    const out = diffuseTail({ sampleRate: SR, duration: 0.2, t60: bad, seed: 3 });
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    assert.equal(peak, 0, 't60 ' + bad + ' gave peak ' + peak);
  }
});

/* F8: duration 0 is clamped to the floor, not silently replaced by 1.5 s. */
test('synthesizeIR honors an explicit zero duration via the floor', () => {
  const { ir } = synthesizeIR({ ...DEFAULT_ROOM, duration: 0 });
  assert.equal(ir.length, Math.floor(0.1 * SR));
});

/* F9: the cascade helper composes the biquad N times. */
test('applyBandpass with one stage equals applyBiquad', () => {
  const coef = bandpassBiquad(2000, BAND_Q, SR);
  const sig = new Float64Array(200).map((_, i) => Math.sin(i * 0.3));
  assert.deepEqual([...applyBandpass(coef, sig, 1)], [...applyBiquad(coef, sig)]);
  assert.equal(BAND_STAGES, 3);
});

/* F10: static wiring guards. */
test('auralize guards the offline-render promise', () => {
  assert.ok(/try\s*\{[\s\S]{0,200}startRendering\(\)/.test(APP), 'no try/catch around startRendering');
});

test('the error state clears the four charts', () => {
  assert.ok(APP.includes('clearRect'), 'charts not cleared on error');
  assert.ok(APP.includes('plan-canvas') && APP.includes('bands-canvas'));
});

test('resize re-render is debounced', () => {
  assert.ok(/resizeTimer[\s\S]{0,120}setTimeout/.test(APP), 'resize not debounced');
});

test('README documents an HTTP server, not file:// opening', () => {
  assert.ok(/http\.server/.test(README), 'no server instruction');
  assert.ok(/file:\/\/.*not work|do \*\*not\*\* load over `file:\/\/`/.test(README), 'file:// caveat missing');
});

/* F11: schroeder stays correct with its simplified signature. */
test('schroeder accepts a plain buffer with no extra arguments', () => {
  const sig = new Float64Array(100).fill(0.5);
  const edc = schroeder(sig);
  assert.ok(Math.abs(edc[0]) < 1e-9);
  assert.equal(edc.length, 100);
});

test('octave bands and sound-speed constants are shared by all paths', () => {
  assert.equal(OCTAVE_BANDS.length, 6);
  assert.equal(SPEED_OF_SOUND, 343);
  const e = eyringRT60(DEFAULT_ROOM.dims, DEFAULT_ROOM.materials, 3);
  assert.ok(e > 0 && e < 1);
});
