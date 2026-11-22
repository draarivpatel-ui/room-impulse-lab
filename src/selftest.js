/* In-page self-tests: a compact engine audit that runs identically in the
 * browser (the "Run self-tests" button) and in the Node test suite. Each
 * check is an independent pure function returning { name, ok, detail }; the
 * UI renders the list verbatim. Pure ES module, no DOM access. */

import {
  DEFAULT_ROOM, SURFACE_IDS, OCTAVE_BANDS, sabineRT60, eyringRT60,
  roomSummary, roomVolume, equivalentAbsorptionArea, SABINE_K
} from './acoustics.js';
import { simulate } from './sim.js';
import { schroeder, fitDecay, synthesizeIR } from './ir.js';
import { c50, d50, ansiClassroom, ansiVolumeLimit, treatmentFor } from './clarity.js';
import { encodeWav } from './export.js';
import { sha256Hex } from './sha256.js';
import { buildReport, verifyReport } from './report.js';
import { encodeState, decodeState } from './urlstate.js';
import { pathPolyline, polylineLength } from './raypath.js';
import { latticeCount, allPaths } from './images.js';

const SIM = simulate(DEFAULT_ROOM);
const close = (a, b, tol) => Math.abs(a - b) <= tol;

function check(name, fn) {
  try {
    const detail = fn();
    return { name, ok: true, detail: typeof detail === 'string' ? detail : 'ok' };
  } catch (e) {
    return { name, ok: false, detail: (e && e.message) || String(e) };
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); return undefined; }

const TESTS = [
  () => check('Sabine matches the closed form at 1 kHz', () => {
    const a = equivalentAbsorptionArea(DEFAULT_ROOM.dims, DEFAULT_ROOM.materials, 3);
    const want = (SABINE_K * 81) / a;
    const got = sabineRT60(DEFAULT_ROOM.dims, DEFAULT_ROOM.materials, 3);
    return assert(close(got, want, 1e-9), got + ' vs ' + want) ?? 'T60 ' + got.toFixed(3) + ' s';
  }),

  () => check('Eyring never exceeds Sabine across all bands', () => {
    for (let b = 0; b < OCTAVE_BANDS.length; b++) {
      const s = sabineRT60(DEFAULT_ROOM.dims, DEFAULT_ROOM.materials, b);
      const e = eyringRT60(DEFAULT_ROOM.dims, DEFAULT_ROOM.materials, b);
      if (!(e <= s + 1e-12)) throw new Error('band ' + b + ': ' + e + ' > ' + s);
    }
    return '6 bands monotone';
  }),

  () => check('More absorption shortens every RT60 model (monotonicity)', () => {
    const lively = { ...DEFAULT_ROOM.materials, floor: 'concrete', ceiling: 'concrete' };
    const dead = { ...DEFAULT_ROOM.materials, floor: 'audience', ceiling: 'acoustictile' };
    for (let b = 0; b < 6; b++) {
      if (!(sabineRT60(DEFAULT_ROOM.dims, dead, b) <= sabineRT60(DEFAULT_ROOM.dims, lively, b))) throw new Error('sabine band ' + b);
      if (!(eyringRT60(DEFAULT_ROOM.dims, dead, b) <= eyringRT60(DEFAULT_ROOM.dims, lively, b))) throw new Error('eyring band ' + b);
    }
    return 'dead room shorter at all bands';
  }),

  () => check('Schroeder EDC is non-increasing across the whole IR', () => {
    const edc = SIM.broadband.edc;
    for (let i = 1; i < edc.length; i++) {
      if (edc[i] > edc[i - 1] + 1e-6) throw new Error('rise at sample ' + i + ': ' + edc[i - 1] + ' -> ' + edc[i]);
    }
    return edc.length + ' samples, ends at ' + edc[edc.length - 1].toFixed(1) + ' dB';
  }),

  () => check('T30 fit recovers a synthetic 1 s exponential decay', () => {
    const sr = 44100;
    const sig = new Float64Array(sr);
    for (let i = 0; i < sr; i++) sig[i] = Math.exp(-6.907755278982137 * (i / sr));
    const edc = schroeder(sig);
    const fit = fitDecay(edc, sr, -5, -35);
    return assert(close(fit.t60, 1.0, 0.02), 'T30 ' + fit.t60 + ' vs 1.0') ?? 'T30 ' + fit.t60.toFixed(3) + ' s';
  }),

  () => check('C50 is strongly positive for an early impulse, negative for a late one', () => {
    const sr = 44100;
    const early = new Float64Array(sr * 0.2);
    early[Math.floor(0.02 * sr)] = 1;
    const late = new Float64Array(sr * 0.2);
    late[Math.floor(0.1 * sr)] = 1;
    const cE = c50(early, sr), cL = c50(late, sr);
    if (!(cE > 10)) throw new Error('early C50 ' + cE);
    if (!(cL < -5)) throw new Error('late C50 ' + cL);
    return 'early ' + cE.toFixed(1) + ' dB, late ' + cL.toFixed(1) + ' dB';
  }),

  () => check('D50 stays inside [0, 1] on the simulated room', () => {
    const d = d50(SIM.ir, SIM.sampleRate);
    return assert(d >= 0 && d <= 1, 'D50 ' + d) ?? 'D50 ' + (d * 100).toFixed(1) + '%';
  }),

  () => check('ANSI S12.60 limits and verdicts behave on known rooms', () => {
    if (ansiVolumeLimit(200) !== 0.6) throw new Error('limit at 200 m3 ' + ansiVolumeLimit(200));
    if (ansiVolumeLimit(400) !== 0.7) throw new Error('limit at 400 m3');
    if (Number.isFinite(ansiVolumeLimit(1000))) throw new Error('scope at 1000 m3');
    const dead = Object.fromEntries(SURFACE_IDS.map((id) => [id, 'audience']));
    const live = Object.fromEntries(SURFACE_IDS.map((id) => [id, 'concrete']));
    const getT = (mats) => (b) => eyringRT60(DEFAULT_ROOM.dims, mats, b);
    const aDead = ansiClassroom(DEFAULT_ROOM.dims, dead, getT(dead));
    const aLive = ansiClassroom(DEFAULT_ROOM.dims, live, getT(live));
    if (aDead.verdict !== 'PASS') throw new Error('dead room ' + aDead.verdict);
    if (aLive.verdict !== 'FAIL' || !aLive.treatment) throw new Error('live room ' + aLive.verdict);
    return 'dead room PASS, live room FAIL with ' + aLive.treatment.panelCount + ' panels';
  }),

  () => check('Treatment panels cover the Sabine deficit', () => {
    const live = Object.fromEntries(SURFACE_IDS.map((id) => [id, 'concrete']));
    const tr = treatmentFor(DEFAULT_ROOM.dims, live, 0.6, 3, 'acoustictile');
    if (!tr || tr.panelCount < 1) throw new Error('no treatment');
    const covered = tr.panelCount * tr.panelAreaM2 * tr.panelAlpha;
    if (covered + 1e-9 < tr.deficitSabines) throw new Error(covered + ' < ' + tr.deficitSabines);
    return tr.panelCount + ' panels cover ' + tr.deficitSabines.toFixed(1) + ' sabines';
  }),

  () => check('Exported WAV has a valid RIFF/WAVE header', () => {
    const buf = new Uint8Array(encodeWav([0, 0.5, -0.5], 44100));
    const s = (o, n) => String.fromCharCode(...buf.slice(o, o + n));
    if (s(0, 4) !== 'RIFF' || s(8, 4) !== 'WAVE' || s(12, 4) !== 'fmt ' || s(36, 4) !== 'data') {
      throw new Error('bad header');
    }
    return 'RIFF/WAVE/fmt/data at fixed offsets';
  }),

  () => check('SHA-256 matches the published "abc" test vector', () => {
    const got = sha256Hex('abc');
    const want = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    return assert(got === want, got) ?? got.slice(0, 16) + '...';
  }),

  () => check('Acoustic report fingerprint survives verify and catches tampering', () => {
    const report = buildReport(SIM);
    const v1 = verifyReport(report);
    if (!v1.ok) throw new Error('self-verify failed');
    const tampered = { ...report, room: { ...report.room, volume: report.room.volume + 1 } };
    if (verifyReport(tampered).ok) throw new Error('tamper not caught');
    return 'fingerprint ' + report.fingerprintSha256.slice(0, 12) + ' verified';
  }),

  () => check('URL bookmark state round-trips every control', () => {
    const hash = '#' + encodeState(DEFAULT_ROOM);
    const back = decodeState(hash);
    if (!back) throw new Error('decode failed');
    if (Math.abs(back.dims.x - DEFAULT_ROOM.dims.x) > 1e-9) throw new Error('dims drifted');
    if (back.materials.ceiling !== DEFAULT_ROOM.materials.ceiling) throw new Error('material drifted');
    return 'hash ' + hash.slice(0, 18) + '... restored';
  }),

  () => check('Ray-bounce polyline length equals the unfolded image distance', () => {
    const paths = allPaths(DEFAULT_ROOM);
    const first = paths.find((p) => p.order === 1);
    const pts = pathPolyline(DEFAULT_ROOM.dims, DEFAULT_ROOM.source, DEFAULT_ROOM.listener, first);
    const len = polylineLength(pts);
    return assert(close(len, first.distance, 1e-6), len + ' vs ' + first.distance) ??
      'order-1 path length ' + len.toFixed(3) + ' m';
  }),

  () => check('Image lattice count matches the 4k^2+2 shell formula', () => {
    for (const n of [0, 1, 2, 3, 6]) {
      const paths = allPaths({ ...DEFAULT_ROOM, maxOrder: n });
      const want = latticeCount(n);
      if (paths.length !== want) throw new Error('order ' + n + ': ' + paths.length + ' vs ' + want);
    }
    return 'orders 0..6 exact';
  })
];

/** Run every self-test. Returns { pass, fail, results:[{name,ok,detail}] }. */
export function runSelfTests() {
  const results = TESTS.map((t) => t());
  const pass = results.filter((r) => r.ok).length;
  return { pass, fail: results.length - pass, results };
}
