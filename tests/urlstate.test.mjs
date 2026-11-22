/* Tests for URL-hash bookmark state encode/decode.
 * Run: node --test tests/urlstate.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState } from '../src/urlstate.js';
import { DEFAULT_ROOM, SURFACE_IDS, MATERIALS } from '../src/acoustics.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);

/* ---------------- encode ---------------- */

test('encodeState emits a versioned r1 hash fragment', () => {
  const h = encodeState(DEFAULT_ROOM);
  assert.match(h, /^r1\.[A-Za-z0-9_-]+$/);
  assert.ok(!h.includes('='));
  assert.ok(!h.includes('+'));
  assert.ok(!h.includes('/'));
});

test('encodeState keeps the hash compact', () => {
  assert.ok(encodeState(DEFAULT_ROOM).length < 260);
});

/* ---------------- round-trip ---------------- */

test('the default room survives a full round-trip', () => {
  const back = decodeState('#' + encodeState(DEFAULT_ROOM));
  assert.ok(back);
  for (const k of ['x', 'y', 'z']) {
    close(back.dims[k], DEFAULT_ROOM.dims[k]);
    close(back.source[k], DEFAULT_ROOM.source[k]);
    close(back.listener[k], DEFAULT_ROOM.listener[k]);
  }
  assert.deepEqual(back.materials, DEFAULT_ROOM.materials);
  assert.equal(back.maxOrder, DEFAULT_ROOM.maxOrder);
  assert.equal(back.seed, DEFAULT_ROOM.seed);
  close(back.duration, DEFAULT_ROOM.duration);
  assert.equal(back.sampleRate, 44100);
});

test('a custom room survives a full round-trip', () => {
  const cfg = {
    dims: { x: 12.5, y: 8.25, z: 4.2 },
    source: { x: 1.1, y: 2.2, z: 1.5 },
    listener: { x: 9.9, y: 6.6, z: 1.8 },
    materials: { xMin: 'brick', xMax: 'glass', yMin: 'curtain', yMax: 'wood', floor: 'concrete', ceiling: 'audience' },
    maxOrder: 5,
    seed: 4242,
    duration: 2.7,
    sampleRate: 44100
  };
  const back = decodeState(encodeState(cfg));
  assert.ok(back);
  close(back.dims.x, 12.5);
  close(back.dims.y, 8.25);
  assert.deepEqual(back.materials, cfg.materials);
  assert.equal(back.maxOrder, 5);
  assert.equal(back.seed, 4242);
  close(back.duration, 2.7);
});

test('decode accepts a bare fragment without the leading #', () => {
  const h = encodeState(DEFAULT_ROOM);
  assert.ok(decodeState(h));
  assert.ok(decodeState('#' + h));
});

/* ---------------- tamper and malformed input ---------------- */

test('garbage and empty hashes decode to null, not a crash', () => {
  for (const h of ['', '#', null, undefined, '#abc', 'r2.xyz', 'r1.', '#r1', 'plain-text']) {
    assert.equal(decodeState(h), null, JSON.stringify(h));
  }
});

test('corrupted base64 inside r1 decodes to null or a clamped config', () => {
  const h = encodeState(DEFAULT_ROOM);
  const bad = '#r1.' + h.slice(3, -2) + '!!';
  const out = decodeState(bad);
  if (out) {
    for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(out.dims[k]));
    for (const id of SURFACE_IDS) assert.ok(MATERIALS.some((m) => m.id === out.materials[id]));
  }
});

test('a flipped character in the payload never produces a crash', () => {
  const h = encodeState(DEFAULT_ROOM);
  for (const pos of [5, 10, 20, h.length - 3]) {
    const mutated = h.slice(0, pos) + 'Z' + h.slice(pos + 1);
    const out = decodeState(mutated);
    assert.ok(out === null || typeof out === 'object');
  }
});

test('a wrong version marker is rejected', () => {
  const h = encodeState(DEFAULT_ROOM);
  assert.equal(decodeState('r9.' + h.slice(3)), null);
});

/* ---------------- clamping / fallback ---------------- */

test('out-of-range values clamp into the control bounds', () => {
  const wild = { ...DEFAULT_ROOM, dims: { x: 500, y: -4, z: 99 }, maxOrder: 99, seed: 0, duration: 99 };
  const back = decodeState(encodeState(wild));
  assert.ok(back);
  assert.equal(back.dims.x, 60);
  assert.equal(back.dims.y, 0.5);
  assert.equal(back.dims.z, 20);
  assert.equal(back.maxOrder, 6);
  assert.equal(back.seed, 1);
  assert.equal(back.duration, 4);
});

test('non-finite values fall back to the default room', () => {
  const wild = { ...DEFAULT_ROOM, dims: { x: NaN, y: 4.5, z: 3 }, source: { x: Infinity, y: 1.6, z: 1.2 } };
  const back = decodeState(encodeState(wild));
  assert.ok(back);
  close(back.dims.x, DEFAULT_ROOM.dims.x);
  close(back.source.x, DEFAULT_ROOM.source.x);
});

test('unknown material ids fall back to the default surface material', () => {
  const cfg = { ...DEFAULT_ROOM, materials: { ...DEFAULT_ROOM.materials, floor: 'cloud', ceiling: 'acoustictile' } };
  const back = decodeState(encodeState(cfg));
  assert.ok(back);
  assert.equal(back.materials.floor, DEFAULT_ROOM.materials.floor);
  assert.equal(back.materials.ceiling, 'acoustictile');
});

test('a wire payload missing the materials list is rejected', () => {
  // Hand-craft a valid-r1 base64 payload with no m array.
  const payload = { v: 1, d: [6, 4.5, 3], s: [2, 1.6, 1.2], l: [4.6, 3.2, 1.4], o: 3, e: 7, u: 1.5 };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  assert.equal(decodeState('r1.' + b64), null);
});

test('encodeState of missing input still produces a decodable fragment', () => {
  const h = encodeState();
  assert.match(h, /^r1\./);
  const back = decodeState(h);
  assert.ok(back === null || typeof back === 'object');
});

/* ---------------- determinism ---------------- */

test('two encodes of the same room produce identical fragments', () => {
  assert.equal(encodeState(DEFAULT_ROOM), encodeState(DEFAULT_ROOM));
});

test('different rooms produce different fragments', () => {
  const a = encodeState(DEFAULT_ROOM);
  const b = encodeState({ ...DEFAULT_ROOM, seed: 8 });
  const c = encodeState({ ...DEFAULT_ROOM, dims: { ...DEFAULT_ROOM.dims, x: 7 } });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});
