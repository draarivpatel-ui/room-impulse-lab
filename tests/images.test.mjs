/* Tests for the image-source lattice geometry.
 * Run: node --test tests/images.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageCoord, wallCrossings, orderCount, latticeCount, enumerateImages,
  directPath, allPaths, totalPathEnergy
} from '../src/images.js';
import { DEFAULT_ROOM, materialById, SPEED_OF_SOUND } from '../src/acoustics.js';

const D = DEFAULT_ROOM.dims;
const M = DEFAULT_ROOM.materials;
const SRC = DEFAULT_ROOM.source;
const LIS = DEFAULT_ROOM.listener;
const ROOM = { dims: D, source: SRC, listener: LIS, materials: M };
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);

/* ---------------- lattice math ---------------- */

test('imageCoord mirrors the coordinate across the wall planes', () => {
  close(imageCoord(1.0, 6, 0), 1.0);
  close(imageCoord(1.0, 6, 1), 2 * 6 - 1.0);
  close(imageCoord(1.0, 6, -1), -1.0);
  close(imageCoord(1.0, 6, 2), 2 * 6 + 1.0);
  close(imageCoord(1.0, 6, -2), -2 * 6 + 1.0);
});

test('imageCoord never needs dims when k is zero', () => {
  assert.equal(imageCoord(2.5, 0, 0), 2.5);
});

test('wallCrossings counts the alternating wall reflections', () => {
  assert.deepEqual(wallCrossings(1), { plus: 1, minus: 0 });
  assert.deepEqual(wallCrossings(-1), { plus: 0, minus: 1 });
  assert.deepEqual(wallCrossings(2), { plus: 1, minus: 1 });
  assert.deepEqual(wallCrossings(-2), { plus: 1, minus: 1 });
  assert.deepEqual(wallCrossings(3), { plus: 2, minus: 1 });
  assert.deepEqual(wallCrossings(-3), { plus: 1, minus: 2 });
  assert.deepEqual(wallCrossings(0), { plus: 0, minus: 0 });
});

test('wallCrossings handles non-integer indices defensively', () => {
  assert.deepEqual(wallCrossings(NaN), { plus: 0, minus: 0 });
  assert.deepEqual(wallCrossings(1.5), { plus: 1, minus: 0 });
});

test('orderCount matches the spherical lattice shell count', () => {
  assert.equal(orderCount(0), 1);
  assert.equal(orderCount(1), 6);   // 6 face neighbors
  assert.equal(orderCount(2), 18);  // 12 edges + 6 axes of length 2
  assert.equal(orderCount(3), 38);
  assert.equal(orderCount(4), 66);
});

test('latticeCount is 1 + cumulative shells', () => {
  assert.equal(latticeCount(0), 1);
  assert.equal(latticeCount(1), 7);
  assert.equal(latticeCount(2), 25);
  assert.equal(latticeCount(3), 63);
  assert.equal(latticeCount(6), 377);
});

/* ---------------- direct path ---------------- */

test('directPath uses straight-line distance and unit pressure gain per band', () => {
  const p = directPath({ source: SRC, listener: LIS });
  const dx = 4.6 - 2.0, dy = 3.2 - 1.6, dz = 1.4 - 1.2;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  close(p.distance, dist);
  close(p.delay, dist / SPEED_OF_SOUND);
  assert.equal(p.order, 0);
  assert.equal(p.path, 'direct');
  assert.deepEqual(p.gains, new Array(6).fill(1 / dist));
});

test('directPath delay is always positive for distinct points', () => {
  const p = directPath({ source: { x: 5.9, y: 4.4, z: 2.9 }, listener: { x: 0.1, y: 0.1, z: 0.1 } });
  assert.ok(p.delay > 0);
  assert.ok(Number.isFinite(p.delay));
});

/* ---------------- enumerateImages ---------------- */

test('order 0 produces no images', () => {
  assert.equal(enumerateImages({ ...ROOM, maxOrder: 0 }).length, 0);
});

test('order 1 produces exactly six first-order images', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 1 });
  assert.equal(imgs.length, 6);
  for (const im of imgs) assert.equal(im.order, 1);
});

test('counts match latticeCount minus the origin cell', () => {
  for (const order of [2, 3]) {
    const imgs = enumerateImages({ ...ROOM, maxOrder: order });
    assert.equal(imgs.length, latticeCount(order) - 1);
  }
});

test('image list is sorted by ascending delay', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 3 });
  for (let i = 1; i < imgs.length; i++) assert.ok(imgs[i].delay >= imgs[i - 1].delay - 1e-12);
});

test('no two images share a lattice cell', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 2 });
  const seen = new Set(imgs.map((im) => im.lattice.join(',')));
  assert.equal(seen.size, imgs.length);
});

test('delay equals distance over sound speed and gains are per-band arrays', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 2 });
  for (const im of imgs) {
    const a = im.pos, b = LIS;
    const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
    close(im.distance, d, 1e-9);
    close(im.delay, d / SPEED_OF_SOUND, 1e-12);
    assert.equal(im.gains.length, 6);
  }
});

test('the +x first-order image is mirrored and crossed once on xMax', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 1 });
  const px = imgs.find((im) => im.lattice[0] === 1);
  assert.ok(px);
  close(px.pos.x, 2 * D.x - SRC.x);
  assert.equal(px.crossings.xMax, 1);
  assert.ok(!px.crossings.xMin, 'unexpected xMin crossing');
  const alphaXmax = materialById(M.xMax).alpha;
  for (let b = 0; b < 6; b++) {
    close(px.gains[b], Math.sqrt(1 - alphaXmax[b]) / px.distance, 1e-12);
  }
});

test('the -x first-order image is mirrored below the x=0 wall', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 1 });
  const nx = imgs.find((im) => im.lattice[0] === -1);
  assert.ok(nx);
  close(nx.pos.x, -SRC.x);
  assert.equal(nx.crossings.xMin, 1);
});

test('every path label lists one wall crossing per order', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 2 });
  for (const im of imgs) {
    const parts = im.path.split(' ');
    assert.equal(parts.length, im.order, im.path);
    for (const p of parts) assert.match(p, /^[xyz][+-]$/);
    assert.equal(im.order, Math.abs(im.lattice[0]) + Math.abs(im.lattice[1]) + Math.abs(im.lattice[2]));
  }
});

test('reflection gains shrink with order for absorptive rooms', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 3 });
  const byOrder = (o) => imgs.filter((im) => im.order === o).map((im) => im.gains[3]);
  const maxGain = (arr) => Math.max(...arr);
  assert.ok(maxGain(byOrder(3)) < maxGain(byOrder(1)));
});

test('gains never exceed 1/distance (absorption can only attenuate)', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 2 });
  for (const im of imgs) for (let b = 0; b < 6; b++) {
    assert.ok(im.gains[b] <= 1 / im.distance + 1e-12, im.path);
  }
});

test('reflective materials carry more energy than absorptive ones', () => {
  const lively = Object.fromEntries(Object.keys(M).map((k) => [k, 'concrete']));
  const dead = Object.fromEntries(Object.keys(M).map((k) => [k, 'audience']));
  const eLive = totalPathEnergy(enumerateImages({ ...ROOM, materials: lively, maxOrder: 2 }), 3);
  const eDead = totalPathEnergy(enumerateImages({ ...ROOM, materials: dead, maxOrder: 2 }), 3);
  assert.ok(eLive > eDead);
});

test('allPaths puts the direct path first then sorted images', () => {
  const paths = allPaths({ ...ROOM, maxOrder: 1 });
  assert.equal(paths[0].order, 0);
  assert.equal(paths[0].path, 'direct');
  assert.equal(paths.length, 7);
  for (let i = 1; i < paths.length; i++) assert.ok(paths[i].delay >= paths[i - 1].delay - 1e-12);
});

test('totalPathEnergy sums squared gains across every path', () => {
  const paths = allPaths({ ...ROOM, maxOrder: 1 });
  let expected = 0;
  for (const p of paths) expected += p.gains[3] * p.gains[3];
  close(totalPathEnergy(paths, 3), expected, 1e-12);
});

test('enumeration is deterministic and degenerate dims produce no crash', () => {
  const a = enumerateImages({ ...ROOM, maxOrder: 2 });
  const b = enumerateImages({ ...ROOM, maxOrder: 2 });
  assert.deepEqual(a.map((p) => p.delay), b.map((p) => p.delay));
  const flat = enumerateImages({ dims: { x: 0, y: 0, z: 0 }, source: SRC, listener: LIS, maxOrder: 1 });
  assert.equal(flat.length, 6);
});

/* ---------------- extended lattice coverage ---------------- */

test('a corner lattice image crosses one wall per nonzero axis index', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 2 });
  const corner = imgs.find((im) => im.lattice.join(',') === '1,1,0');
  assert.ok(corner);
  assert.equal(corner.crossings.xMax, 1);
  assert.equal(corner.crossings.yMax, 1);
  assert.ok(!corner.crossings.floor);
});

test('mixed-axis path gain multiplies the two wall factors', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 2 });
  const corner = imgs.find((im) => im.lattice.join(',') === '1,1,0');
  const ax = materialById(M.xMax).alpha[3];
  const ay = materialById(M.yMax).alpha[3];
  close(corner.gains[3], Math.sqrt(1 - ax) * Math.sqrt(1 - ay) / corner.distance, 1e-12);
});

test('a mirrored floor image sits below the room', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 1 });
  const fl = imgs.find((im) => im.lattice[2] === -1);
  assert.ok(fl);
  close(fl.pos.z, -SRC.z);
  assert.equal(fl.crossings.floor, 1);
});

test('allPaths at order 0 contains only the direct path', () => {
  const paths = allPaths({ ...ROOM, maxOrder: 0 });
  assert.equal(paths.length, 1);
  assert.equal(paths[0].path, 'direct');
});

test('a slower speed of sound stretches every delay', () => {
  const a = enumerateImages({ ...ROOM, maxOrder: 1 });
  const b = enumerateImages({ ...ROOM, maxOrder: 1, speedOfSound: SPEED_OF_SOUND / 2 });
  for (let i = 0; i < a.length; i++) close(b[i].delay, 2 * a[i].delay, 1e-12);
});

test('totalPathEnergy varies per band with frequency-dependent materials', () => {
  const imgs = enumerateImages({ ...ROOM, maxOrder: 2 });
  const e0 = totalPathEnergy(imgs, 0);
  const e4 = totalPathEnergy(imgs, 4);
  assert.ok(e0 !== e4);
});
