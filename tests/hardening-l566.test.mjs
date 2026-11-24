import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROOM, validateRoom } from '../src/acoustics.js';
import { encodeState, decodeState } from '../src/urlstate.js';
import { simulate } from '../src/sim.js';
import { buildReport, verifyReport } from '../src/report.js';

test('hash state clamps source and listener into the decoded room dimensions', () => {
  const cfg = {
    ...DEFAULT_ROOM,
    dims: { x: 2, y: 1.5, z: 2.5 },
    source: { x: 59, y: 59, z: 19 },
    listener: { x: 58, y: 0.5, z: 1 }
  };
  const back = decodeState(encodeState(cfg));
  assert.ok(back.source.x <= back.dims.x && back.source.y <= back.dims.y && back.source.z <= back.dims.z);
  assert.ok(back.listener.x <= back.dims.x && back.listener.y <= back.dims.y && back.listener.z <= back.dims.z);
  assert.ok(validateRoom(back).ok, validateRoom(back).errors.join('; '));
});

test('validateRoom rejects malformed simulation controls instead of silently clamping them', () => {
  for (const patch of [
    { duration: NaN }, { duration: 0 }, { duration: Infinity },
    { sampleRate: NaN }, { sampleRate: 0 }, { sampleRate: 44100.5 },
    { seed: NaN }, { seed: 1.5 }, { seed: -1 }
  ]) {
    assert.equal(validateRoom({ ...DEFAULT_ROOM, ...patch }).ok, false, JSON.stringify(patch));
  }
  assert.equal(validateRoom(DEFAULT_ROOM).ok, true);
});


test('hash decoding rejects trailing junk instead of accepting a valid prefix', () => {
  const h = encodeState(DEFAULT_ROOM);
  assert.equal(decodeState(h + '!!!'), null);
  assert.equal(decodeState(h + 'A'), null);
});

test('report verification is insensitive to JSON object key order', () => {
  const report = buildReport(simulate(DEFAULT_ROOM));
  const reorder = (v) => {
    if (Array.isArray(v)) return v.map(reorder);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const k of Object.keys(v).sort().reverse()) out[k] = reorder(v[k]);
    return out;
  };
  assert.ok(verifyReport(reorder(report)).ok);
});
