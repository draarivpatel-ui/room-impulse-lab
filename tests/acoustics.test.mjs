/* Deterministic unit tests for the acoustics engine.
 * Run: node --test tests/acoustics.test.mjs
 * Every expected value is hand-computed from the closed forms, not from the
 * implementation under test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OCTAVE_BANDS, MATERIALS, SURFACE_IDS, materialById, clamp, safeDiv,
  DEFAULT_ROOM, surfaceAreas, totalSurfaceArea, roomVolume, meanFreePath,
  equivalentAbsorptionArea, airAttenuationM, airAbsorptionArea,
  meanAbsorption, sabineRT60, eyringRT60, millingtonRT60,
  decaySigma, rt60FromSigma, distance, validateRoom, roomSummary,
  SABINE_K, MAX_RT60
} from '../src/acoustics.js';

const D = DEFAULT_ROOM.dims; // 6 x 4.5 x 3
const M = DEFAULT_ROOM.materials;
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);

/* ---------------- geometry ---------------- */

test('surfaceAreas faces use the right axis pairs', () => {
  const a = surfaceAreas(D);
  close(a.xMin, 4.5 * 3);
  close(a.xMax, 4.5 * 3);
  close(a.yMin, 6 * 3);
  close(a.yMax, 6 * 3);
  close(a.floor, 6 * 4.5);
  close(a.ceiling, 6 * 4.5);
});

test('totalSurfaceArea sums all six faces', () => {
  close(totalSurfaceArea(D), 2 * (6 * 4.5 + 6 * 3 + 4.5 * 3));
});

test('surfaceAreas of a cube gives six equal faces', () => {
  const a = surfaceAreas({ x: 2, y: 2, z: 2 });
  for (const id of SURFACE_IDS) close(a[id], 4);
});

test('roomVolume multiplies dimensions', () => {
  close(roomVolume(D), 81);
  close(roomVolume({ x: 2, y: 3, z: 4 }), 24);
});

test('meanFreePath is 4V/S', () => {
  close(meanFreePath(D), (4 * 81) / 117);
  close(meanFreePath({ x: 1, y: 1, z: 1 }), 4 / 6);
});

test('degenerate dimensions give zero, not NaN', () => {
  assert.equal(roomVolume({ x: 0, y: 1, z: 1 }), 0);
  assert.equal(meanFreePath({ x: 0, y: 0, z: 0 }), 0);
});

/* ---------------- materials ---------------- */

test('every material has six bounded alpha coefficients', () => {
  for (const m of MATERIALS) {
    assert.equal(m.alpha.length, OCTAVE_BANDS.length, m.id);
    for (const a of m.alpha) assert.ok(a >= 0 && a <= 1, m.id);
  }
});

test('material ids are unique and cover the surface defaults', () => {
  const ids = new Set(MATERIALS.map((m) => m.id));
  assert.equal(ids.size, MATERIALS.length);
  for (const id of SURFACE_IDS) assert.ok(ids.has(M[id]), 'default material ' + M[id]);
});

test('materialById falls back to the first material on unknown ids', () => {
  assert.equal(materialById('not-a-material').id, MATERIALS[0].id);
  assert.equal(materialById(undefined).id, MATERIALS[0].id);
});

test('absorptive materials beat reflective ones at high bands', () => {
  const tile = materialById('acoustictile');
  const concrete = materialById('concrete');
  for (let b = 2; b < 6; b++) assert.ok(tile.alpha[b] > concrete.alpha[b]);
});

/* ---------------- absorption area ---------------- */

test('equivalentAbsorptionArea sums S_i alpha_i for the default room', () => {
  // Hand-computed: gypsum .04, glass .12, carpet .50, tile .85 at 1 kHz.
  const expected =
    13.5 * 0.04 + 13.5 * 0.04 + 18 * 0.12 + 18 * 0.04 + 27 * 0.50 + 27 * 0.85;
  const a = equivalentAbsorptionArea(D, M, 3, { air: false });
  close(a, expected, 1e-9);
});

test('air absorption adds 4 m V on top of the wall term', () => {
  const wallsOnly = equivalentAbsorptionArea(D, M, 5, { air: false });
  const withAir = equivalentAbsorptionArea(D, M, 5);
  close(withAir - wallsOnly, 4 * airAttenuationM(5) * 81);
});

test('air absorption is zero at 125 Hz and grows with frequency', () => {
  assert.equal(airAttenuationM(0), 0);
  for (let b = 1; b < OCTAVE_BANDS.length; b++) {
    assert.ok(airAttenuationM(b) >= airAttenuationM(b - 1));
  }
  assert.ok(airAbsorptionArea(D, 5) > airAbsorptionArea(D, 1));
});

test('meanAbsorption is A_walls / S', () => {
  const expected = (13.5 * 0.04 + 13.5 * 0.04 + 18 * 0.12 + 18 * 0.04 + 27 * 0.50 + 27 * 0.85) / 117;
  close(meanAbsorption(D, M, 3), expected);
});

/* ---------------- Sabine / Eyring / Millington ---------------- */

test('sabineRT60 matches the hand-computed value', () => {
  const a = 40.41 + 4 * 0.0028 * 81; // walls + air at 1 kHz
  close(sabineRT60(D, M, 3), (SABINE_K * 81) / a, 1e-9);
});

test('sabineRT60 uses exactly 0.161 V / A', () => {
  const single = { xMin: 'concrete', xMax: 'concrete', yMin: 'concrete', yMax: 'concrete', floor: 'concrete', ceiling: 'concrete' };
  const d = { x: 5, y: 4, z: 3 };
  const a = 2 * (4 * 3) * 0.02 + 2 * (5 * 3) * 0.02 + 2 * (5 * 4) * 0.02 + 4 * airAttenuationM(3) * 60;
  close(sabineRT60(d, single, 3), (0.161 * 60) / a, 1e-9);
});

test('a nearly live concrete cube is finite but very long', () => {
  const all = Object.fromEntries(SURFACE_IDS.map((id) => [id, 'concrete']));
  const d = { x: 1, y: 1, z: 1 };
  // A = 6 m2 x alpha 0.01 = 0.06 sabines at 125 Hz (the air term is zero there).
  close(sabineRT60(d, all, 0, { air: false }), 0.161 / 0.06, 1e-9);
  close(eyringRT60(d, all, 0, { air: false }), 0.161 / (-6 * Math.log(0.99)), 1e-9);
  close(millingtonRT60(d, all, 0, { air: false }), 0.161 / (-6 * Math.log(0.99)), 1e-9);
  close(sabineRT60(d, all, 0), 0.161 / 0.06, 1e-9);
});

test('eyringRT60 is always <= sabineRT60 (extra absorption factor)', () => {
  for (let b = 0; b < 6; b++) assert.ok(eyringRT60(D, M, b) <= sabineRT60(D, M, b) + 1e-12);
});

test('eyringRT60 matches the hand-computed value at 1 kHz', () => {
  const aBar = 40.41 / 117;
  const denom = -117 * Math.log(1 - aBar) + 4 * 0.0028 * 81;
  close(eyringRT60(D, M, 3), (0.161 * 81) / denom, 1e-9);
});

test('eyring and sabine converge for a nearly live room', () => {
  const all = Object.fromEntries(SURFACE_IDS.map((id) => [id, 'concrete']));
  const d = { x: 4, y: 3, z: 2.5 };
  const s = sabineRT60(d, all, 0);
  const rel = Math.abs(eyringRT60(d, all, 0) - s) / s;
  assert.ok(rel < 0.01, 'rel diff ' + rel);
});

test('millingtonRT60 matches the hand-computed value at 1 kHz', () => {
  const denom =
    -13.5 * Math.log(0.96) - 13.5 * Math.log(0.96) +
    -18 * Math.log(0.88) - 18 * Math.log(0.96) +
    -27 * Math.log(0.5) - 27 * Math.log(0.15) +
    4 * 0.0028 * 81;
  close(millingtonRT60(D, M, 3), (0.161 * 81) / denom, 1e-9);
});

test('the most absorptive catalog room shortens every model below the live one', () => {
  const dead = Object.fromEntries(SURFACE_IDS.map((id) => [id, 'audience']));
  const live = Object.fromEntries(SURFACE_IDS.map((id) => [id, 'concrete']));
  for (let b = 1; b < 6; b++) {
    assert.ok(eyringRT60(D, dead, b) < 0.5 * eyringRT60(D, live, b), 'band ' + b);
    assert.ok(millingtonRT60(D, dead, b) < 0.5 * millingtonRT60(D, live, b), 'band ' + b);
  }
});

test('more absorption always shortens every RT60 model', () => {
  const lively = { ...M, floor: 'concrete', ceiling: 'concrete' };
  const dead = { ...M, floor: 'audience', ceiling: 'acoustictile' };
  for (let b = 0; b < 6; b++) {
    assert.ok(sabineRT60(D, dead, b) <= sabineRT60(D, lively, b));
    assert.ok(eyringRT60(D, dead, b) <= eyringRT60(D, lively, b));
    assert.ok(millingtonRT60(D, dead, b) <= millingtonRT60(D, lively, b));
  }
});

test('a bigger room reverberates longer at fixed materials', () => {
  const small = { x: 3, y: 2.5, z: 2.5 };
  const big = { x: 12, y: 10, z: 6 };
  for (let b = 0; b < 6; b++) assert.ok(sabineRT60(big, M, b) > sabineRT60(small, M, b));
});

test('decaySigma and rt60FromSigma are exact inverses', () => {
  for (const t of [0.3, 1.0, 2.5]) close(rt60FromSigma(decaySigma(t)), t, 1e-12);
  close(decaySigma(1), Math.log(1000), 1e-9);
});

test('distance is Euclidean', () => {
  close(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 }), 13);
  assert.equal(distance(null, null), 0);
});

/* ---------------- roomSummary ---------------- */

test('roomSummary reports six bands with clamped display values', () => {
  const s = roomSummary(D, M);
  assert.equal(s.bands.length, 6);
  for (const b of s.bands) {
    assert.ok(b.sabineClamped <= MAX_RT60);
    assert.ok(b.eyringClamped <= MAX_RT60);
    assert.ok(b.millingtonClamped <= MAX_RT60);
    assert.ok(b.absorptionArea >= b.wallAbsorption);
    close(b.wallAbsorption + b.airAbsorption, b.absorptionArea);
  }
});

test('roomSummary frequencies follow OCTAVE_BANDS', () => {
  const s = roomSummary(D, M);
  s.bands.forEach((b, i) => assert.equal(b.frequency, OCTAVE_BANDS[i]));
});

/* ---------------- validateRoom ---------------- */

test('the default room validates clean', () => {
  const v = validateRoom(DEFAULT_ROOM);
  assert.ok(v.ok, v.errors.join());
  assert.equal(v.errors.length, 0);
});

test('non-positive dimensions fail closed', () => {
  for (const k of ['x', 'y', 'z']) {
    const cfg = { ...DEFAULT_ROOM, dims: { ...D, [k]: 0 } };
    assert.ok(!validateRoom(cfg).ok);
    const neg = { ...DEFAULT_ROOM, dims: { ...D, [k]: -2 } };
    assert.ok(!validateRoom(neg).ok);
    const nan = { ...DEFAULT_ROOM, dims: { ...D, [k]: NaN } };
    assert.ok(!validateRoom(nan).ok);
  }
});

test('positions outside the room are rejected', () => {
  const out = { ...DEFAULT_ROOM, source: { x: 7, y: 1, z: 1 } };
  assert.ok(!validateRoom(out).ok);
  const under = { ...DEFAULT_ROOM, listener: { x: 1, y: -1, z: 1 } };
  assert.ok(!validateRoom(under).ok);
});

test('boundary positions are allowed', () => {
  const onWall = { ...DEFAULT_ROOM, source: { x: 0, y: 0, z: 0 }, listener: { x: 6, y: 4.5, z: 3 } };
  assert.ok(validateRoom(onWall).ok);
});

test('unknown materials are rejected per surface', () => {
  for (const id of SURFACE_IDS) {
    const cfg = { ...DEFAULT_ROOM, materials: { ...M, [id]: 'cloud' } };
    assert.ok(!validateRoom(cfg).ok, id);
  }
});

test('non-integer and out-of-range reflection orders are rejected', () => {
  for (const bad of [-1, 9, 2.5, NaN]) {
    assert.ok(!validateRoom({ ...DEFAULT_ROOM, maxOrder: bad }).ok, String(bad));
  }
  for (const good of [0, 1, 8]) assert.ok(validateRoom({ ...DEFAULT_ROOM, maxOrder: good }).ok);
});

test('coincident source and listener are rejected', () => {
  const same = { x: 1, y: 1, z: 1 };
  assert.ok(!validateRoom({ ...DEFAULT_ROOM, source: same, listener: same }).ok);
});

/* ---------------- small helpers ---------------- */

test('clamp and safeDiv guard non-finite input', () => {
  assert.equal(clamp(NaN, 0, 1), 0);
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(safeDiv(1, 0, 7), 7);
  assert.equal(safeDiv(NaN, 2, 7), 7);
  close(safeDiv(6, 3), 2);
});

/* ---------------- extended edge coverage ---------------- */

test('surfaceAreas of a zeroed box returns zeros', () => {
  const a = surfaceAreas({ x: 0, y: 0, z: 0 });
  for (const id of SURFACE_IDS) assert.equal(a[id], 0);
});

test('an out-of-range band index contributes no wall term', () => {
  const a = equivalentAbsorptionArea(D, M, 7, { air: false });
  assert.equal(a, 0);
});

test('airAttenuationM returns 0 outside the table', () => {
  assert.equal(airAttenuationM(9), 0);
  assert.equal(airAttenuationM(-1), 0);
});

test('sabineRT60 at an unknown band is Infinity (no absorption at all)', () => {
  assert.equal(sabineRT60(D, M, 9), Infinity);
});

test('validateRoom reports a missing config instead of crashing', () => {
  const v = validateRoom({});
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 8);
});

test('validateRoom flags non-finite coordinates', () => {
  const cfg = { ...DEFAULT_ROOM, source: { x: NaN, y: 1, z: 1 } };
  assert.ok(!validateRoom(cfg).ok);
});

test('DEFAULT_ROOM keeps source and listener inside the box', () => {
  for (const p of [DEFAULT_ROOM.source, DEFAULT_ROOM.listener]) {
    assert.ok(p.x >= 0 && p.x <= DEFAULT_ROOM.dims.x);
    assert.ok(p.y >= 0 && p.y <= DEFAULT_ROOM.dims.y);
    assert.ok(p.z >= 0 && p.z <= DEFAULT_ROOM.dims.z);
  }
});

test('eyringRT60 with air disabled excludes the 4 m V term', () => {
  const aBar = meanAbsorption(D, M, 5);
  const expected = 0.161 * 81 / (-117 * Math.log(1 - aBar));
  close(eyringRT60(D, M, 5, { air: false }), expected, 1e-9);
  assert.ok(eyringRT60(D, M, 5) < expected); // air term shortens it
});
