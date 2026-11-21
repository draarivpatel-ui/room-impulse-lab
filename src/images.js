/* Image source model for a rectangular room. Pure ES module.
 *
 * Every specular reflection path in a shoebox room unfolds to a straight line
 * between the listener and a mirrored copy of the source. Copies sit on an
 * integer lattice: index (l, m, n) means the path crosses |l| wall pairs in x,
 * |m| in y and |n| in z, so its reflection order is |l| + |m| + |n|. This is
 * geometric acoustics: diffraction and scattering are not modeled.
 */

import { OCTAVE_BANDS, SPEED_OF_SOUND, distance, materialById } from './acoustics.js';

/**
 * Coordinate of a lattice image along one axis. c is the source coordinate,
 * L the room extent, k the signed lattice index. k = 0 is the source itself,
 * k = 1 mirrors across the +axis wall, k = -1 across the -axis wall.
 */
export function imageCoord(c, L, k) {
  const kk = Math.trunc(k) || 0;
  return kk * L + (kk % 2 !== 0 ? L - c : c);
}

/**
 * How often a path to lattice index k crosses each wall pair. For k > 0 the
 * first (and every odd) crossing hits the +axis wall; for k < 0 the -axis
 * wall. Returns { plus, minus } counts with plus + minus = |k|.
 */
export function wallCrossings(k) {
  const a = Math.abs(Math.trunc(k) || 0);
  return k > 0
    ? { plus: Math.ceil(a / 2), minus: Math.floor(a / 2) }
    : { plus: Math.floor(a / 2), minus: Math.ceil(a / 2) };
}

/** Exact count of images of order <= n on the 3D lattice: 1 + sum(4k^2+2). */
export function latticeCount(maxOrder) {
  const n = Math.max(0, Math.trunc(maxOrder) || 0);
  return 1 + (4 * n * (n + 1) * (2 * n + 1)) / 6 + 2 * n;
}

/** Exact count of images of order exactly n (>0): 4n^2 + 2. */
export function orderCount(n) {
  const k = Math.trunc(n) || 0;
  return k > 0 ? 4 * k * k + 2 : 1;
}

const WALL_FOR_AXIS = {
  x: { plus: 'xMax', minus: 'xMin' },
  y: { plus: 'yMax', minus: 'yMin' },
  z: { plus: 'ceiling', minus: 'floor' }
};

/**
 * Per-band pressure gain of one image: geometric spreading (1/distance)
 * times sqrt(1 - alpha) for each wall crossed. Absorption coefficients act on
 * energy, so the pressure factor is the square root. Returns an array keyed
 * by band index plus the per-wall crossing tally.
 */
function imageGain(crossings, materials, dist) {
  const counts = {};
  for (const [axis, c] of Object.entries(crossings)) {
    const walls = WALL_FOR_AXIS[axis];
    counts[walls.plus] = (counts[walls.plus] || 0) + c.plus;
    counts[walls.minus] = (counts[walls.minus] || 0) + c.minus;
  }
  const perBand = OCTAVE_BANDS.map((_, b) => {
    let g = 1;
    for (const [wall, n] of Object.entries(counts)) {
      const alpha = materialById(materials && materials[wall]).alpha[b] ?? 0;
      g *= Math.pow(Math.sqrt(Math.max(0, 1 - alpha)), n);
    }
    return dist > 0 ? g / dist : 0;
  });
  return { perBand, counts };
}

/**
 * Enumerate every image source up to maxOrder, sorted by propagation delay.
 * Each entry: lattice index, position, order, delay (s), distance (m),
 * wall crossing counts, per-band gain, and a human-readable path label.
 */
export function enumerateImages({ dims, source, listener, materials = {}, maxOrder = 3, speedOfSound = SPEED_OF_SOUND } = {}) {
  const d = dims || {};
  const s = source || {};
  const r = listener || {};
  const L = { x: Number(d.x) || 0, y: Number(d.y) || 0, z: Number(d.z) || 0 };
  const order = Math.max(0, Math.trunc(maxOrder) || 0);
  const c = Number.isFinite(speedOfSound) && speedOfSound > 0 ? speedOfSound : SPEED_OF_SOUND;
  const out = [];
  for (let l = -order; l <= order; l++) {
    for (let m = -order; m <= order; m++) {
      for (let n = -order; n <= order; n++) {
        const o = Math.abs(l) + Math.abs(m) + Math.abs(n);
        if (o === 0 || o > order) continue;
        const pos = {
          x: imageCoord(s.x, L.x, l),
          y: imageCoord(s.y, L.y, m),
          z: imageCoord(s.z, L.z, n)
        };
        const dist = distance(pos, r);
        if (!(dist > 0)) continue; // degenerate or coincident image
        const crossings = { x: wallCrossings(l), y: wallCrossings(m), z: wallCrossings(n) };
        const { perBand, counts } = imageGain(crossings, materials, dist);
        out.push({
          lattice: [l, m, n],
          order: o,
          pos,
          distance: dist,
          delay: dist / c,
          crossings: counts,
          gains: perBand,
          path: describePath(l, m, n)
        });
      }
    }
  }
  out.sort((a, b) => a.delay - b.delay || a.order - b.order);
  return out;
}

/** Short label like 'x+y-z' describing which axes the path crosses. */
function describePath(l, m, n) {
  const parts = [];
  const add = (axis, k) => {
    for (let i = 0; i < Math.abs(k); i++) parts.push(k > 0 ? axis + '+' : axis + '-');
  };
  add('x', l);
  add('y', m);
  add('z', n);
  return parts.join(' ');
}

/** Direct path entry in the same shape, order 0. */
export function directPath({ source, listener, speedOfSound = SPEED_OF_SOUND } = {}) {
  const s = source || {};
  const r = listener || {};
  const dist = distance(s, r);
  const c = Number.isFinite(speedOfSound) && speedOfSound > 0 ? speedOfSound : SPEED_OF_SOUND;
  return {
    lattice: [0, 0, 0],
    order: 0,
    pos: { x: s.x || 0, y: s.y || 0, z: s.z || 0 },
    distance: dist,
    delay: dist / c,
    crossings: {},
    gains: OCTAVE_BANDS.map(() => (dist > 0 ? 1 / dist : 0)),
    path: 'direct'
  };
}

/** Direct + images, unified and delay-sorted. */
export function allPaths(opts) {
  const direct = directPath(opts);
  const images = enumerateImages(opts);
  return [direct].concat(images).sort((a, b) => a.delay - b.delay || a.order - b.order);
}

/**
 * Energy of every path integrated per band: sum(gain^2). Useful for comparing
 * the total specular energy two rooms carry; the IR synthesizer normalizes
 * its stochastic tail against the direct gain, not this sum.
 */
export function totalPathEnergy(paths, band) {
  let e = 0;
  for (const p of paths || []) e += (p.gains[band] || 0) ** 2;
  return e;
}
