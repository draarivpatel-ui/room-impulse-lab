/* Tests for WAV/CSV/JSON export safety and format correctness.
 * Run: node --test tests/export.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, csvCell, toCsv, rt60Rows, pathRows, exportJson } from '../src/export.js';
import { simulate } from '../src/sim.js';
import { DEFAULT_ROOM } from '../src/acoustics.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);

/* ---------------- WAV ---------------- */

test('WAV header carries RIFF/WAVE/fmt/data markers at fixed offsets', () => {
  const buf = encodeWav([0, 0.5, -0.5], 44100);
  const s = (off, n) => String.fromCharCode(...new Uint8Array(buf.slice(off, off + n)));
  assert.equal(s(0, 4), 'RIFF');
  assert.equal(s(8, 4), 'WAVE');
  assert.equal(s(12, 4), 'fmt ');
  assert.equal(s(36, 4), 'data');
});

test('WAV header fields describe 16-bit mono PCM at the given rate', () => {
  const buf = encodeWav(new Float64Array(100), 22050);
  const v = new DataView(buf);
  assert.equal(v.getUint32(4, true), 36 + 200);   // chunk size
  assert.equal(v.getUint32(16, true), 16);        // fmt size
  assert.equal(v.getUint16(20, true), 1);         // PCM
  assert.equal(v.getUint16(22, true), 1);         // mono
  assert.equal(v.getUint32(24, true), 22050);     // sample rate
  assert.equal(v.getUint32(28, true), 44100);     // byte rate = sr * 2
  assert.equal(v.getUint16(32, true), 2);         // block align
  assert.equal(v.getUint16(34, true), 16);        // bits
  assert.equal(v.getUint32(40, true), 200);       // data bytes
  assert.equal(buf.byteLength, 44 + 200);
});

test('WAV samples quantize to int16 with clipping, never wraparound', () => {
  const buf = encodeWav([1.0, -1.0, 2.0, -2.0, 0.5, NaN], 44100);
  const v = new DataView(buf);
  assert.equal(v.getInt16(44, true), 32767);
  assert.equal(v.getInt16(46, true), -32767);
  assert.equal(v.getInt16(48, true), 32767);   // clipped, not wrapped
  assert.equal(v.getInt16(50, true), -32767);
  assert.equal(v.getInt16(52, true), Math.round(0.5 * 32767));
  assert.equal(v.getInt16(54, true), 0);        // NaN becomes silence
});

test('WAV handles empty and missing input without throwing', () => {
  const buf = encodeWav([]);
  assert.equal(buf.byteLength, 44);
  assert.equal(new DataView(buf).getUint32(40, true), 0);
});

/* ---------------- CSV ---------------- */

test('csvCell prefixes spreadsheet formula leaders with a quote', () => {
  for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
    const cell = csvCell(lead + 'SUM(A1:A9)');
    const unquoted = cell.startsWith('"') ? cell.slice(1, -1) : cell;
    assert.ok(unquoted.startsWith("'"), JSON.stringify(cell));
  }
});

test('csvCell leaves ordinary text and numbers alone', () => {
  assert.equal(csvCell('direct'), 'direct');
  assert.equal(csvCell('x+ y-'), 'x+ y-');
  assert.equal(csvCell(1.5), '1.5');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(Infinity), '');
});

test('csvCell quotes and escapes commas, quotes and newlines', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
});

test('toCsv emits CRLF records with a header row', () => {
  const csv = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'a,b');
  assert.equal(lines[1], '1,x');
  assert.equal(lines[2], '2,y');
  assert.equal(lines.length, 3);
});

test('toCsv honors explicit column order and missing values', () => {
  const csv = toCsv([{ a: 1 }], ['b', 'a', 'c']);
  assert.equal(csv.split('\r\n')[0], 'b,a,c');
  assert.equal(csv.split('\r\n')[1], ',1,');
});

test('toCsv on empty input still yields a parseable header', () => {
  assert.equal(toCsv([]), '');
  assert.equal(toCsv([], ['a', 'b']), 'a,b');
});

/* ---------------- export tables ---------------- */

const SIM = simulate(DEFAULT_ROOM);

test('rt60Rows emits one row per band with finite model values', () => {
  const rows = rt60Rows(SIM.summary, SIM.measured.map((m) => m.t30));
  assert.equal(rows.length, 6);
  for (const [i, r] of rows.entries()) {
    assert.equal(r.band_hz, SIM.summary.bands[i].frequency);
    assert.ok(Number.isFinite(r.sabine_s));
    assert.ok(Number.isFinite(r.eyring_s));
    assert.ok(Number.isFinite(r.measured_t30_s), 'measured col empty at ' + i);
  }
});

test('rt60Rows accepts simulate() measurement objects directly', () => {
  const rows = rt60Rows(SIM.summary, SIM.measured);
  for (const r of rows) assert.ok(Number.isFinite(r.measured_t30_s));
});

test('rt60Rows blanks a non-finite measurement instead of printing NaN', () => {
  const rows = rt60Rows(SIM.summary, [NaN, 0.5, Infinity, 0.4, 0.3, 0.2]);
  assert.equal(rows[0].measured_t30_s, '');
  assert.equal(rows[2].measured_t30_s, '');
  close(rows[1].measured_t30_s, 0.5);
});

test('pathRows keeps delay ordering and the direct path first', () => {
  const rows = pathRows(SIM.paths);
  assert.equal(rows.length, SIM.paths.length);
  assert.equal(rows[0].path, 'direct');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].delay_ms >= rows[i - 1].delay_ms - 1e-6);
});

test('pathRows rounds values for spreadsheet use', () => {
  const rows = pathRows(SIM.paths);
  for (const r of rows) {
    assert.ok(Number.isFinite(r.delay_ms));
    assert.ok(Number.isFinite(r.gain_1k) && r.gain_1k >= 0);
    assert.ok(String(r.delay_ms).split('.')[1]?.length <= 3 || !String(r.delay_ms).includes('.'));
  }
});

/* ---------------- JSON ---------------- */

test('exportJson round-trips and carries the teaching disclaimer', () => {
  const txt = exportJson({
    config: SIM.config, summary: SIM.summary,
    measured: SIM.measured.map((m) => m.t30), paths: SIM.paths,
    meta: { pathCount: SIM.stats.pathCount }
  });
  const j = JSON.parse(txt);
  assert.equal(j.tool, 'room-impulse-lab');
  assert.match(j.disclaimer, /Teaching model/);
  assert.equal(j.bands.length, 6);
  assert.equal(j.paths.length, SIM.paths.length);
  assert.equal(j.room.volume, 81);
  assert.ok(j.paths.every((p) => Number.isFinite(p.delay_ms)));
});

test('exportJson contains no formula-leading CSV concern and no functions', () => {
  const j = JSON.parse(exportJson({
    config: SIM.config, summary: SIM.summary,
    measured: SIM.measured, paths: SIM.paths, meta: {}
  }));
  assert.equal(typeof j.config.maxOrder, 'number');
  assert.equal(j.meta.pathCount ?? undefined, undefined);
});

/* ---------------- export hardening ---------------- */

test('a forged path label cannot smuggle a spreadsheet formula', () => {
  const rows = pathRows([{ order: 1, path: '=1+1', delay: 0.001, distance: 1, gains: [0, 0, 0, 0.1, 0, 0] }]);
  const csv = toCsv(rows);
  const cell = csv.split('\r\n')[1].split(',')[1];
  const unquoted = cell.startsWith('"') ? cell.slice(1, -1) : cell;
  assert.ok(unquoted.startsWith("'"), 'formula cell not prefixed');
});

test('encodeWav of a single sample has a two-byte data chunk', () => {
  const buf = encodeWav([0.25]);
  assert.equal(buf.byteLength, 46);
  assert.equal(new DataView(buf).getUint32(40, true), 2);
});

test('rt60Rows rounds mean alpha to four decimals', () => {
  const rows = rt60Rows(SIM.summary, []);
  for (const r of rows) {
    const decimals = String(r.mean_alpha).split('.')[1] || '';
    assert.ok(decimals.length <= 4);
  }
});

test('exportJson preserves caller meta', () => {
  const j = JSON.parse(exportJson({
    config: SIM.config, summary: SIM.summary, measured: [],
    paths: SIM.paths, meta: { pathCount: 63, tag: 'unit' }
  }));
  assert.equal(j.meta.pathCount, 63);
  assert.equal(j.meta.tag, 'unit');
});

test('pathRows of an empty array is an empty array', () => {
  assert.deepEqual(pathRows([]), []);
  assert.deepEqual(pathRows(null), []);
});
