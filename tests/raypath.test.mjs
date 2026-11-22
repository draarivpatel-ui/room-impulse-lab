/* Tests for the physical bounce geometry behind the ray-bounce plan.
 * Run: node --test tests/raypath.test.mjs
 * Invariants: folded polylines have the unfolded image length, every bounce
 * sits on a room wall, and the physical wall order matches the lattice. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foldCoord, bouncePoints, pathPolyline, polylineLength, planPaths
} from '../src/raypath.js';
import { allPaths, enumerateImages } from '../src/images.js';
import { DEFAULT_ROOM, distance } from '../src/acoustics.js';

const D = DEFAULT_ROOM.dims;      // 6 x 4.5 x 3
const S = DEFAULT_ROOM.source;    // 2, 1.6, 1.2
const R = DEFAULT_ROOM.listener;  // 4.6, 3.2, 1.4
const M = DEFAULT_ROOM.materials;
const CFG = { dims: D, source: S, listener: R, materials: M, maxOrder: 3 };
const PATHS = allPaths(CFG);
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);
const byLattice = (l, m, n) => PATHS.find((p) => p.lattice.join() === [l, m, n].join());

/* ---------------- foldCoord ---------------- */

test('foldCoord leaves interior coordinates alone', () => {
  close(foldCoord(0.5, 6), 0.5);
  close(foldCoord(5.9, 6), 5.9);
  close(foldCoord(3, 6), 3);
});

test('foldCoord mirrors odd cells back into the room', () => {
  close(foldCoord(6.5, 6), 5.5);    // cell +1
  close(foldCoord(-0.5, 6), 0.5);   // cell -1
  close(foldCoord(11.9, 6), 0.1);   // cell +1 edge
  close(foldCoord(-5.9, 6), 5.9);   // cell -1 edge
});

test('foldCoord maps even cells straight across', () => {
  close(foldCoord(13, 6), 1);       // cell +2
  close(foldCoord(-7, 6), 5);       // cell -2
  close(foldCoord(12, 6), 0);       // boundary -> wall plane
  close(foldCoord(18, 6), 6);       // odd boundary -> far wall
});

test('foldCoord is guarded on degenerate input', () => {
  assert.equal(foldCoord(1, 0), 0);
  assert.equal(foldCoord(NaN, 6), 0);
});

/* ---------------- bouncePoints ---------------- */

test('the direct path has no bounces', () => {
  const direct = PATHS.find((p) => p.order === 0);
  assert.deepEqual(bouncePoints(D, S, R, direct), []);
});

test('a first-order xMax image bounces once on the +x wall', () => {
  const p = byLattice(1, 0, 0);
  const b = bouncePoints(D, S, R, p);
  assert.equal(b.length, 1);
  assert.equal(b[0].wall, 'xMax');
  close(b[0].point.x, D.x);
  // Hand-computed: image at (2*6 - 2, 1.6, 1.2) = (10, 1.6, 1.2); the line
  // image -> listener crosses x = 6 at t = (6-10)/(4.6-10) = 0.7407.
  const t = (D.x - 10) / (R.x - 10);
  close(b[0].point.y, 1.6 + t * (R.y - 1.6), 1e-6);
  close(b[0].point.z, 1.2 + t * (R.z - 1.2), 1e-6);
});

test('a first-order xMin image bounces on the -x wall', () => {
  const p = byLattice(-1, 0, 0);
  const b = bouncePoints(D, S, R, p);
  assert.equal(b.length, 1);
  assert.equal(b[0].wall, 'xMin');
  close(b[0].point.x, 0);
});

test('first-order floor and ceiling images bounce on the right faces', () => {
  const floor = bouncePoints(D, S, R, byLattice(0, 0, -1));
  assert.equal(floor.length, 1);
  assert.equal(floor[0].wall, 'floor');
  close(floor[0].point.z, 0);
  const ceil = bouncePoints(D, S, R, byLattice(0, 0, 1));
  assert.equal(ceil.length, 1);
  assert.equal(ceil[0].wall, 'ceiling');
  close(ceil[0].point.z, D.z);
});

test('an order-2 +x,+y image bounces yMax then xMax', () => {
  // For the default source/listener the unfolded line crosses the y plane
  // first (t = 0.6905) then the x plane (t = 0.7407), so the physical ray
  // reflects on yMax before xMax.
  const p = byLattice(1, 1, 0);
  const b = bouncePoints(D, S, R, p);
  assert.equal(b.length, 2);
  assert.equal(b[0].wall, 'yMax');
  assert.equal(b[1].wall, 'xMax');
  close(b[0].point.y, D.y);
  close(b[1].point.x, D.x);
});

test('an order-2 double-x image bounces xMin then xMax', () => {
  // Image at (2L + sx): the ray reflects on the -x wall first, then +x.
  const p = byLattice(2, 0, 0);
  const b = bouncePoints(D, S, R, p);
  assert.equal(b.length, 2);
  assert.equal(b[0].wall, 'xMin');
  assert.equal(b[1].wall, 'xMax');
  close(b[0].point.x, 0);
  close(b[1].point.x, D.x);
});

test('every fold-order polyline is an isometry of the unfolded line', () => {
  // The strongest invariant: folding preserves length, so for EVERY path the
  // physical polyline must equal the unfolded image distance exactly.
  for (const p of PATHS) {
    const pts = pathPolyline(D, S, R, p);
    close(polylineLength(pts), p.distance, 1e-6);
  }
});

test('every bounce point lies on a wall plane inside the room', () => {
  for (const p of PATHS) {
    for (const b of bouncePoints(D, S, R, p)) {
      const { x, y, z } = b.point;
      const onWall =
        Math.abs(x) < 1e-9 || Math.abs(x - D.x) < 1e-9 ||
        Math.abs(y) < 1e-9 || Math.abs(y - D.y) < 1e-9 ||
        Math.abs(z) < 1e-9 || Math.abs(z - D.z) < 1e-9;
      assert.ok(onWall, 'order ' + p.order + ' bounce off wall: ' + JSON.stringify(b.point));
      assert.ok(x >= -1e-9 && x <= D.x + 1e-9 && y >= -1e-9 && y <= D.y + 1e-9 && z >= -1e-9 && z <= D.z + 1e-9);
    }
  }
});

test('bounce count equals the path reflection order', () => {
  for (const p of PATHS) {
    assert.equal(bouncePoints(D, S, R, p).length, p.order, 'path ' + p.path);
  }
});

test('bounce walls match the path wall-crossing tally exactly', () => {
  for (const p of PATHS) {
    const bounces = bouncePoints(D, S, R, p);
    if (bounces.length !== p.order) continue; // merged edge-hit
    const tally = {};
    for (const b of bounces) tally[b.wall] = (tally[b.wall] || 0) + 1;
    const expected = {};
    for (const [w, n] of Object.entries(p.crossings)) if (n > 0) expected[w] = n;
    assert.deepEqual(tally, expected, 'path ' + p.path + ' tally mismatch');
  }
});

/* ---------------- pathPolyline / polylineLength ---------------- */

test('the polyline starts at the source and ends at the listener', () => {
  const p = byLattice(1, 0, 0);
  const pts = pathPolyline(D, S, R, p);
  close(pts[0].x, S.x); close(pts[0].y, S.y); close(pts[0].z, S.z);
  const last = pts[pts.length - 1];
  close(last.x, R.x); close(last.y, R.y); close(last.z, R.z);
  assert.equal(pts.length, p.order + 2);
});

test('polyline length equals the unfolded image distance for every path', () => {
  for (const p of PATHS) {
    const len = polylineLength(pathPolyline(D, S, R, p));
    close(len, p.distance, 1e-6);
  }
});

test('a first-order bounce point lies on the image-to-listener segment', () => {
  const p = byLattice(1, 0, 0);
  const [b] = bouncePoints(D, S, R, p);
  // Image at (10, 1.6, 1.2): S' -> B -> R must be collinear within float eps.
  const img = p.pos;
  const dIB = distance(img, b.point);
  const dBR = distance(b.point, R);
  close(dIB + dBR, p.distance, 1e-9);
});

test('the physical polyline length equals the unfolded distance piecewise', () => {
  const p = byLattice(1, 1, 0);
  const pts = pathPolyline(D, S, R, p);
  assert.equal(pts.length, 4); // S, bounce, bounce, R
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += distance(pts[i - 1], pts[i]);
  close(sum, p.distance, 1e-9);
});

test('pathPolyline of the direct path is just source and listener', () => {
  const direct = PATHS.find((p) => p.order === 0);
  const pts = pathPolyline(D, S, R, direct);
  assert.equal(pts.length, 2);
  close(polylineLength(pts), direct.distance);
});

test('polylineLength of an empty or single-point line is zero', () => {
  assert.equal(polylineLength([]), 0);
  assert.equal(polylineLength([{ x: 1, y: 2, z: 3 }]), 0);
});

test('bouncePoints survives missing and degenerate input', () => {
  assert.deepEqual(bouncePoints(D, S, R, null), []);
  assert.deepEqual(bouncePoints(D, S, R, {}), []);
  assert.deepEqual(bouncePoints({}, {}, {}, byLattice(1, 0, 0)), []);
});

/* ---------------- planPaths ---------------- */

test('planPaths keeps direct, 4 first-order and 8 second-order in-plane rays', () => {
  const plans = planPaths(D, S, R, PATHS, 2);
  const orders = plans.map((p) => p.path.order);
  assert.equal(orders.filter((o) => o === 0).length, 1);
  assert.equal(orders.filter((o) => o === 1).length, 4);  // x+-, y+- only
  assert.equal(orders.filter((o) => o === 2).length, 8);  // +-1+-1 and +-2
  assert.equal(plans.length, 13);
});

test('planPaths never includes a floor or ceiling fold', () => {
  const plans = planPaths(D, S, R, PATHS, 2);
  for (const p of plans) assert.equal(p.path.lattice[2], 0);
});

test('each plan entry carries its polyline and bounce list', () => {
  const plans = planPaths(D, S, R, PATHS, 2);
  for (const p of plans) {
    assert.equal(p.polyline.length, p.path.order + 2);
    assert.equal(p.bounces.length, p.path.order);
  }
});

test('planPaths of an empty path list is empty', () => {
  assert.deepEqual(planPaths(D, S, R, []), []);
});

/* ---------------- high-order sanity ---------------- */

test('an order-3 mixed lattice path bounces on all three axes', () => {
  const cfg = { ...CFG, maxOrder: 3 };
  const paths = enumerateImages(cfg);
  const p = paths.find((q) => q.lattice.join() === '1,1,1');
  assert.ok(p, 'lattice 1,1,1 missing');
  const walls = bouncePoints(D, S, R, p).map((b) => b.wall);
  assert.equal(walls.length, 3);
  const axes = new Set(walls.map((w) => ({ xMin: 'x', xMax: 'x', yMin: 'y', yMax: 'y', floor: 'z', ceiling: 'z' })[w]));
  assert.deepEqual([...axes].sort(), ['x', 'y', 'z']);
});
