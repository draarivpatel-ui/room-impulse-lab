/* Physical bounce geometry for image-source paths. Pure ES module.
 *
 * The image-source method unfolds every specular path into a straight line
 * from a mirrored copy of the source to the listener. To DRAW the real ray
 * inside the room we invert that unfold: walk the straight segment from the
 * image back to the listener, note every lattice wall plane it crosses, and
 * fold each crossing point back into the physical box. Each folded crossing
 * is exactly where the physical ray reflects, so the polyline
 * source -> bounce_1 -> ... -> bounce_k -> listener has the same total
 * length as the unfolded image-to-listener distance.
 */

const AXES = ['x', 'y', 'z'];

/** Fold an unfolded coordinate u on an axis of extent L back into [0, L]. */
export function foldCoord(u, L) {
  if (!(L > 0) || !Number.isFinite(u)) return 0;
  const k = Math.floor(u / L);
  const f = u - k * L;
  const odd = ((k % 2) + 2) % 2 === 1;
  return odd ? L - f : f;
}

/**
 * Wall planes an image in lattice cell k crosses along one axis between the
 * image coordinate and the receiver. For k > 0 the boundaries are at
 * L, 2L, ..., kL; for k < 0 at 0, -L, ..., (k+1)L. Returns the plane
 * coordinates, in any order.
 */
function axisPlanes(k, L) {
  const planes = [];
  const kk = Math.trunc(k) || 0;
  if (kk > 0) for (let j = 1; j <= kk; j++) planes.push(j * L);
  if (kk < 0) for (let j = 0; j >= kk + 1; j--) planes.push(j * L);
  return planes;
}

/** Which physical wall a boundary plane on one axis folds onto. */
function wallOfPlane(plane, axis, dims) {
  const L = dims[axis];
  const folded = foldCoord(plane, L);
  if (axis === 'x') return Math.abs(folded) < 1e-9 ? 'xMin' : 'xMax';
  if (axis === 'y') return Math.abs(folded) < 1e-9 ? 'yMin' : 'yMax';
  return Math.abs(folded) < 1e-9 ? 'floor' : 'ceiling';
}

/**
 * Ordered physical bounce points for one image path: the unfolded crossings
 * sorted from the listener side outward, then folded back. Each entry is
 * { point:{x,y,z}, wall } with `wall` the surface id the ray reflects on.
 * Returns [] for the direct path or degenerate input.
 */
export function bouncePoints(dims, source, listener, path) {
  const d = dims || {};
  const s = source || {};
  const r = listener || {};
  const img = path && path.pos ? path.pos : null;
  const lattice = path && path.lattice ? path.lattice : null;
  if (!img || !lattice) return [];

  // Unfolded straight segment from the image to the listener.
  const crossings = [];
  for (let a = 0; a < 3; a++) {
    const axis = AXES[a];
    const L = Number(d[axis]) || 0;
    if (!(L > 0)) continue;
    const ia = img[axis], ra = r[axis];
    const denom = ra - ia;
    if (Math.abs(denom) < 1e-12) continue;
    for (const plane of axisPlanes(lattice[a], L)) {
      const t = (plane - ia) / denom;
      if (t > 1e-9 && t < 1 - 1e-9) crossings.push({ t, axis, plane });
    }
  }
  // The unfolded segment runs image -> listener through the mirror cells.
  // The first crossing leaving the image's own cell is the first physical
  // wall hit, so physical travel order is ascending t.
  crossings.sort((a, b) => a.t - b.t || AXES.indexOf(a.axis) - AXES.indexOf(b.axis));

  const out = [];
  let last = null;
  for (const c of crossings) {
    const u = {
      x: img.x + c.t * (r.x - img.x),
      y: img.y + c.t * (r.y - img.y),
      z: img.z + c.t * (r.z - img.z)
    };
    const point = {
      x: foldCoord(u.x, d.x),
      y: foldCoord(u.y, d.y),
      z: foldCoord(u.z, d.z)
    };
    // Merge degenerate repeats (a ray striking an edge crosses two planes at
    // once and produces one physical bounce).
    if (last && Math.abs(point.x - last.x) < 1e-9 && Math.abs(point.y - last.y) < 1e-9 && Math.abs(point.z - last.z) < 1e-9) continue;
    last = point;
    out.push({ point, wall: wallOfPlane(c.plane, c.axis, d), axis: c.axis, plane: c.plane });
  }
  return out;
}

/**
 * Full physical polyline for a path: [source, ...bouncePoints, listener].
 * For the direct path this is the two endpoints. Total length equals the
 * unfolded image-to-listener distance by construction.
 */
export function pathPolyline(dims, source, listener, path) {
  const s = source || {};
  const r = listener || {};
  const pts = [{ x: s.x || 0, y: s.y || 0, z: s.z || 0 }];
  for (const b of bouncePoints(dims, source, listener, path)) pts.push(b.point);
  pts.push({ x: r.x || 0, y: r.y || 0, z: r.z || 0 });
  return pts;
}

/** Total length of a polyline of {x,y,z} points. */
export function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < (pts || []).length; i++) {
    const a = pts[i - 1], b = pts[i];
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

/**
 * In-plane bounce paths for the top-down view: every path whose lattice
 * index has n === 0 (no floor/ceiling fold, which projects to a point in
 * plan view), direct first, then order 1, then order 2, each delay-sorted.
 */
export function planPaths(dims, source, listener, paths, maxPlanOrder = 2) {
  const list = (paths || []).filter((p) => {
    const n = p.lattice ? p.lattice[2] : 0;
    return n === 0 && p.order <= maxPlanOrder;
  });
  return list.map((p) => ({
    path: p,
    polyline: pathPolyline(dims, source, listener, p),
    bounces: bouncePoints(dims, source, listener, p)
  }));
}
