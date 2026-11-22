/* Tests for the fingerprinted acoustic report.
 * Run: node --test tests/report.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/sim.js';
import { DEFAULT_ROOM, SURFACE_IDS } from '../src/acoustics.js';
import {
  reportBody, buildReport, reportJson, verifyReport, canonicalJson,
  clarityRows, ansiRows
} from '../src/report.js';

const SIM = simulate(DEFAULT_ROOM);
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);

/* ---------------- body ---------------- */

test('reportBody carries the room, model, clarity and ANSI sections', () => {
  const b = reportBody(SIM);
  assert.equal(b.tool, 'room-impulse-lab');
  assert.equal(b.reportVersion, 2);
  assert.equal(b.room.volume, 81);
  assert.equal(b.bands.length, 6);
  assert.equal(b.paths.length, SIM.paths.length);
  assert.equal(b.ansiS1260.standard, 'ANSI S12.60');
  assert.ok(['PASS', 'FAIL', 'SCOPE'].includes(b.ansiS1260.verdict));
  assert.ok('broadband' in b.clarity && 'bands' in b.clarity);
  assert.equal(b.clarity.bands.length, 6);
});

test('reportBody embeds the exact simulation config', () => {
  const b = reportBody(SIM);
  assert.deepEqual(b.config.dims, SIM.config.dims);
  assert.deepEqual(b.config.materials, SIM.config.materials);
  assert.equal(b.config.seed, SIM.config.seed);
  assert.equal(b.config.maxOrder, SIM.config.maxOrder);
});

test('reportBody keeps the teaching disclaimer', () => {
  assert.match(reportBody(SIM).disclaimer, /Teaching model/);
});

test('reportBody has no fingerprint field of its own', () => {
  assert.ok(!('fingerprintSha256' in reportBody(SIM)));
});

/* ---------------- fingerprint ---------------- */

test('buildReport attaches a 64-char hex fingerprint', () => {
  const r = buildReport(SIM);
  assert.match(r.fingerprintSha256, /^[0-9a-f]{64}$/);
});

test('the fingerprint is deterministic for an identical room', () => {
  const a = buildReport(simulate(DEFAULT_ROOM));
  const b = buildReport(simulate(DEFAULT_ROOM));
  assert.equal(a.fingerprintSha256, b.fingerprintSha256);
});

test('the fingerprint changes when the room changes', () => {
  const a = buildReport(SIM);
  const b = buildReport(simulate({ ...DEFAULT_ROOM, dims: { ...DEFAULT_ROOM.dims, x: 7 } }));
  const c = buildReport(simulate({ ...DEFAULT_ROOM, seed: 8 }));
  assert.notEqual(a.fingerprintSha256, b.fingerprintSha256);
  assert.notEqual(a.fingerprintSha256, c.fingerprintSha256);
});

test('canonicalJson is stable across two builds', () => {
  assert.equal(canonicalJson(reportBody(SIM)), canonicalJson(reportBody(simulate(DEFAULT_ROOM))));
});

/* ---------------- verifyReport ---------------- */

test('verifyReport accepts the report it just fingerprinted', () => {
  const r = buildReport(SIM);
  const v = verifyReport(r);
  assert.ok(v.ok);
  assert.equal(v.expected, r.fingerprintSha256);
});

test('verifyReport catches a tampered room volume', () => {
  const r = buildReport(SIM);
  const t = { ...r, room: { ...r.room, volume: r.room.volume + 1 } };
  assert.equal(verifyReport(t).ok, false);
});

test('verifyReport catches a tampered verdict', () => {
  const r = buildReport(SIM);
  const t = { ...r, ansiS1260: { ...r.ansiS1260, verdict: 'PASS' === r.ansiS1260.verdict ? 'FAIL' : 'PASS' } };
  assert.equal(verifyReport(t).ok, false);
});

test('verifyReport catches a deleted fingerprint', () => {
  const r = buildReport(SIM);
  const t = { ...r };
  delete t.fingerprintSha256;
  assert.equal(verifyReport(t).ok, false);
});

test('verifyReport fails closed on non-objects', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    assert.equal(verifyReport(bad).ok, false);
  }
});

/* ---------------- reportJson ---------------- */

test('reportJson parses to a complete fingerprinted report', () => {
  const j = JSON.parse(reportJson(SIM));
  assert.match(j.fingerprintSha256, /^[0-9a-f]{64}$/);
  assert.ok(verifyReport(j).ok);
  assert.equal(j.room.volume, 81);
});

test('reportJson serializes the treatment plan for a failing room', () => {
  const live = Object.fromEntries(SURFACE_IDS.map((id) => [id, 'concrete']));
  const sim = simulate({ ...DEFAULT_ROOM, materials: live });
  const j = JSON.parse(reportJson(sim));
  assert.equal(j.ansiS1260.verdict, 'FAIL');
  assert.ok(j.ansiS1260.treatment);
  assert.ok(j.ansiS1260.treatment.panelCount >= 1);
  assert.match(j.ansiS1260.treatment.material, /Acoustic ceiling tile/);
});

test('reportJson embeds clarity metrics for every band', () => {
  const j = JSON.parse(reportJson(SIM));
  for (const b of j.clarity.bands) {
    assert.ok('c50Db' in b && 'd50' in b && 'edtS' in b && 't30S' in b);
    assert.ok([125, 250, 500, 1000, 2000, 4000].includes(b.bandHz));
  }
});

/* ---------------- clarityRows / ansiRows ---------------- */

test('clarityRows emits one row per band with finite metrics', () => {
  const rows = clarityRows(SIM.clarity);
  assert.equal(rows.length, 6);
  for (const [i, r] of rows.entries()) {
    assert.equal(r.band_hz, [125, 250, 500, 1000, 2000, 4000][i]);
    assert.ok(Number.isFinite(r.d50) && r.d50 >= 0 && r.d50 <= 1);
    assert.ok('c50_db' in r && 'c80_db' in r && 'edt_s' in r && 't20_s' in r && 't30_s' in r);
  }
});

test('clarityRows blanks non-finite clarity values', () => {
  const rows = clarityRows({ bands: [{ frequency: 500, c50: Infinity, c80: -Infinity, d50: NaN, edt: NaN, t20: 1, t30: 1 }] });
  assert.equal(rows[0].c50_db, null);
  assert.equal(rows[0].c80_db, null);
  assert.equal(rows[0].d50, null);
  close(rows[0].t20_s, 1);
});

test('clarityRows of missing input is an empty list', () => {
  assert.deepEqual(clarityRows(null), []);
  assert.deepEqual(clarityRows({}), []);
});

test('ansiRows compresses the verdict into one CSV-ready row', () => {
  const rows = ansiRows(SIM.ansi);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.standard, 'ANSI S12.60');
  assert.equal(r.limit_s, 0.6);
  assert.ok(['PASS', 'FAIL'].includes(r.verdict));
});

test('ansiRows survives a null verdict object', () => {
  assert.deepEqual(ansiRows(null), []);
});
