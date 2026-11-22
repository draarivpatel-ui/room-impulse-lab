/* Tests for the ISO 3382 clarity suite and the ANSI S12.60 classroom check.
 * Run: node --test tests/clarity.test.mjs
 * Every expected value is hand-computed, not read back from the code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  energySplit, clarityDb, c50, c80, d50, clarityRating, clarityTable,
  ansiClassroom, ansiVolumeLimit, treatmentFor, ANSI_BAND_INDICES,
  CLARITY_RATINGS, PANEL_AREA
} from '../src/clarity.js';
import { simulate } from '../src/sim.js';
import {
  DEFAULT_ROOM, SURFACE_IDS, OCTAVE_BANDS, eyringRT60,
  SABINE_K, equivalentAbsorptionArea
} from '../src/acoustics.js';

const D = DEFAULT_ROOM.dims; // 6 x 4.5 x 3, V = 81 m3, S = 117 m2
const M = DEFAULT_ROOM.materials;
const SR = 44100;
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);

/* ---------------- energySplit ---------------- */

test('energySplit splits a flat signal at the boundary index', () => {
  const sig = new Float64Array(SR * 0.1).fill(1); // 4410 ones
  const s = energySplit(sig, SR, 50);
  assert.equal(s.index, 2205);
  close(s.early, 2205);
  close(s.late, 2205);
});

test('energySplit boundary index is rounded from milliseconds', () => {
  const sig = new Float64Array(1000).fill(1);
  const s = energySplit(sig, 8000, 100); // 100 ms at 8 kHz = 800 samples
  assert.equal(s.index, 800);
  close(s.early, 800);
});

test('energySplit clamps the boundary to the buffer ends', () => {
  const sig = new Float64Array(100).fill(1);
  assert.equal(energySplit(sig, SR, 0).index, 0);
  assert.equal(energySplit(sig, SR, 99999).index, 100);
  assert.equal(energySplit(sig, SR, -5).index, 0);
});

test('energySplit handles empty input', () => {
  const s = energySplit(new Float64Array(0), SR, 50);
  assert.equal(s.early, 0);
  assert.equal(s.late, 0);
});

/* ---------------- clarityDb / C50 / C80 / D50 ---------------- */

test('equal early and late energy gives 0 dB clarity', () => {
  const sig = new Float64Array(SR * 0.1).fill(1);
  close(clarityDb(sig, SR, 50), 0);
});

test('a 4:1 early-to-late energy ratio is 10 log10(4) dB', () => {
  const sig = new Float64Array(SR * 0.1); // 4410 samples
  sig.fill(2, 0, 2205);      // early energy 4*2205
  sig.fill(1, 2205);         // late energy 2205
  close(c50(sig, SR), 10 * Math.log10(4), 1e-9);
});

test('an impulse before 50 ms gives infinite clarity, after gives -inf', () => {
  const early = new Float64Array(SR * 0.2);
  early[Math.floor(0.02 * SR)] = 1;
  assert.equal(c50(early, SR), Infinity);
  const late = new Float64Array(SR * 0.2);
  late[Math.floor(0.1 * SR)] = 1;
  assert.equal(c50(late, SR), -Infinity);
});

test('an impulse between 50 and 80 ms separates C50 from C80', () => {
  const sig = new Float64Array(SR * 0.2);
  sig[Math.floor(0.065 * SR)] = 1; // 65 ms: late for C50, early for C80
  assert.equal(c50(sig, SR), -Infinity);
  assert.equal(c80(sig, SR), Infinity);
});

test('silence yields NaN clarity, not a crash', () => {
  const z = new Float64Array(1000);
  assert.ok(Number.isNaN(clarityDb(z, SR, 50)));
  assert.ok(Number.isNaN(d50(z, SR)));
});

test('D50 is the early energy fraction', () => {
  const sig = new Float64Array(SR * 0.1).fill(1);
  close(d50(sig, SR), 0.5);
  sig.fill(3, 0, 2205); // early 9*2205, late 2205 -> 0.9
  close(d50(sig, SR), 0.9);
});

test('D50 is 1 for a purely early impulse and 0 for a purely late one', () => {
  const a = new Float64Array(SR * 0.1);
  a[0] = 1; // 0 ms: all energy early
  close(d50(a, SR), 1);
  const b = new Float64Array(SR * 0.1);
  b[Math.floor(0.09 * SR)] = 1; // 90 ms: all energy late
  close(d50(b, SR), 0);
});

test('clarityDb honors a non-default sample rate', () => {
  const sig = new Float64Array(1000).fill(1);
  close(clarityDb(sig, 8000, 62.5), 0); // 62.5 ms at 8 kHz = sample 500
});

/* ---------------- clarityRating ---------------- */

test('clarityRating maps C50 to the teaching bands', () => {
  assert.equal(clarityRating(3).label, 'Good');
  assert.equal(clarityRating(2).label, 'Good');
  assert.equal(clarityRating(0).label, 'Fair');
  assert.equal(clarityRating(-1.9).label, 'Fair');
  assert.equal(clarityRating(-2).label, 'Fair');
  assert.equal(clarityRating(-2.1).label, 'Poor');
  assert.equal(clarityRating(-40).label, 'Poor');
});

test('CLARITY_RATINGS is ordered high to low with real thresholds', () => {
  for (let i = 1; i < CLARITY_RATINGS.length; i++) {
    assert.ok(CLARITY_RATINGS[i].min < CLARITY_RATINGS[i - 1].min);
  }
});

/* ---------------- clarityTable ---------------- */

const SIM = simulate(DEFAULT_ROOM);

test('clarityTable covers all six octave bands plus broadband', () => {
  assert.equal(SIM.clarity.bands.length, OCTAVE_BANDS.length);
  for (const [i, b] of SIM.clarity.bands.entries()) {
    assert.equal(b.band, i);
    assert.equal(b.frequency, OCTAVE_BANDS[i]);
    assert.ok('c50' in b && 'c80' in b && 'd50' in b);
    assert.ok('edt' in b && 't20' in b && 't30' in b);
  }
  assert.ok('c50' in SIM.clarity.broadband);
});

test('per-band C50 grows toward the high bands in a real room', () => {
  // Absorption rises with frequency in this room, so the late field dies
  // faster and clarity improves. 4 kHz should read better than 125 Hz.
  const b = SIM.clarity.bands;
  assert.ok(b[5].c50 > b[0].c50, '4k C50 ' + b[5].c50 + ' vs 125 ' + b[0].c50);
});

test('per-band D50 stays inside [0, 1]', () => {
  for (const b of SIM.clarity.bands) {
    assert.ok(b.d50 >= 0 && b.d50 <= 1, 'band ' + b.frequency + ' D50 ' + b.d50);
  }
});

test('per-band EDT/T20/T30 are finite in the default room', () => {
  for (const b of SIM.clarity.bands) {
    assert.ok(Number.isFinite(b.edt), 'edt ' + b.frequency);
    assert.ok(Number.isFinite(b.t20), 't20 ' + b.frequency);
    assert.ok(Number.isFinite(b.t30), 't30 ' + b.frequency);
  }
});

test('clarityTable of a decaying sine reports a finite 1 kHz C50', () => {
  const n = SR * 0.1;
  const sig = new Float64Array(n);
  for (let i = 0; i < n; i++) sig[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * Math.exp(-30 * i / SR);
  const t = clarityTable(sig, SR);
  assert.ok(Number.isFinite(t.bands[3].c50), 'c50 at 1 kHz ' + t.bands[3].c50);
  assert.ok(Number.isFinite(t.bands[3].d50));
});

/* ---------------- ansiVolumeLimit ---------------- */

test('ANSI volume limits follow the standard boundaries', () => {
  assert.equal(ansiVolumeLimit(1), 0.6);
  assert.equal(ansiVolumeLimit(283), 0.6);
  assert.equal(ansiVolumeLimit(284), 0.7);
  assert.equal(ansiVolumeLimit(566), 0.7);
  assert.ok(Number.isNaN(ansiVolumeLimit(567)));
  assert.ok(Number.isNaN(ansiVolumeLimit(0)));
  assert.ok(Number.isNaN(ansiVolumeLimit(NaN)));
});

test('ANSI_BAND_INDICES point at 500, 1000 and 2000 Hz', () => {
  assert.deepEqual(ANSI_BAND_INDICES, [2, 3, 4]);
  for (const [i, b] of ANSI_BAND_INDICES.entries()) {
    assert.equal(OCTAVE_BANDS[b], [500, 1000, 2000][i]);
  }
});

/* ---------------- ansiClassroom ---------------- */

const ALL = (id) => Object.fromEntries(SURFACE_IDS.map((s) => [s, id]));
const eyringOf = (mats) => (b) => eyringRT60(D, mats, b);

test('a heavily treated classroom passes ANSI S12.60', () => {
  const a = ansiClassroom(D, ALL('audience'), eyringOf(ALL('audience')));
  assert.equal(a.verdict, 'PASS');
  assert.equal(a.limit, 0.6);
  assert.equal(a.treatment, null);
  assert.equal(a.standard, 'ANSI S12.60');
});

test('a live concrete classroom fails with a treatment plan', () => {
  const a = ansiClassroom(D, ALL('concrete'), eyringOf(ALL('concrete')));
  assert.equal(a.verdict, 'FAIL');
  assert.ok(a.treatment);
  assert.ok(a.treatment.panelCount >= 1);
  assert.equal(a.treatment.panelAreaM2, PANEL_AREA);
});

test('the default room verdict is a real PASS or FAIL, never SCOPE', () => {
  assert.equal(SIM.ansi.standard, 'ANSI S12.60');
  assert.equal(SIM.ansi.limit, 0.6); // 81 m3 is a standard classroom
  assert.ok(['PASS', 'FAIL'].includes(SIM.ansi.verdict));
  assert.ok(SIM.ansi.bands.every((b) => Number.isFinite(b.t60)));
});

test('a room above 566 m3 is out of ANSI classroom scope', () => {
  const big = { x: 20, y: 15, z: 5 }; // 1500 m3
  const a = ansiClassroom(big, M, (b) => 0.4);
  assert.equal(a.verdict, 'SCOPE');
  assert.ok(Number.isNaN(a.limit));
  assert.equal(a.treatment, null);
});

test('worstBand identifies the longest-decaying ANSI band', () => {
  const a = ansiClassroom(D, M, (b) => [0.3, 0.4, 0.9, 0.7, 0.5, 0.4][b]);
  assert.equal(a.verdict, 'FAIL');
  assert.equal(a.worstBand, 500); // band index 2, t60 0.9
  close(a.worstT60, 0.9);
});

test('a band exactly at the limit still passes', () => {
  const a = ansiClassroom(D, M, () => 0.6);
  assert.equal(a.verdict, 'PASS');
});

test('missing getT60 fails closed rather than crashing', () => {
  const a = ansiClassroom(D, M, null);
  assert.equal(a.verdict, 'FAIL');
});

test('verdict bands carry frequency and the measured t60', () => {
  const a = ansiClassroom(D, M, (b) => 0.55);
  assert.equal(a.bands.length, 3);
  assert.deepEqual(a.bands.map((b) => b.frequency), [500, 1000, 2000]);
  for (const b of a.bands) close(b.t60, 0.55);
});

/* ---------------- treatmentFor ---------------- */

test('treatmentFor covers the exact Sabine deficit', () => {
  // All-concrete room: A at 1 kHz = 117*0.02 + 4*0.0028*81 = 3.247 sabines.
  // A_req = 0.161*81/0.6 = 21.735 -> deficit 18.488, tile alpha 0.85.
  const live = ALL('concrete');
  const tr = treatmentFor(D, live, 0.6, 3, 'acoustictile');
  const aNow = equivalentAbsorptionArea(D, live, 3);
  const aReq = (SABINE_K * 81) / 0.6;
  close(tr.currentA, aNow, 1e-9);
  close(tr.requiredA, aReq, 1e-9);
  close(tr.deficitSabines, aReq - aNow, 1e-9);
  close(tr.areaNeededM2, (aReq - aNow) / 0.85, 1e-9);
  assert.equal(tr.panelCount, Math.ceil(((aReq - aNow) / 0.85) / 1.2));
  assert.equal(tr.materialId, 'acoustictile');
  assert.ok(tr.panelCount > 1);
});

test('the recommended panels actually cover the deficit', () => {
  const tr = treatmentFor(D, ALL('concrete'), 0.6, 3, 'acoustictile');
  const covered = tr.panelCount * tr.panelAreaM2 * tr.panelAlpha;
  assert.ok(covered >= tr.deficitSabines - 1e-9, covered + ' vs ' + tr.deficitSabines);
});

test('no deficit means no treatment recommendation', () => {
  assert.equal(treatmentFor(D, ALL('audience'), 0.6, 3, 'acoustictile'), null);
});

test('treatmentFor returns null on degenerate input', () => {
  assert.equal(treatmentFor({ x: 0, y: 0, z: 0 }, M, 0.6, 3, 'acoustictile'), null);
  assert.equal(treatmentFor(D, M, 0, 3, 'acoustictile'), null);
  assert.equal(treatmentFor(D, M, NaN, 3, 'acoustictile'), null);
});

test('unknown panel material falls back safely', () => {
  const tr = treatmentFor(D, ALL('concrete'), 0.6, 3, 'unobtainium');
  assert.ok(tr);
  assert.equal(tr.materialId, 'concrete'); // materialById falls back to index 0
});

test('PANEL_AREA is the advertised 1.2 m2', () => {
  assert.equal(PANEL_AREA, 1.2);
});
