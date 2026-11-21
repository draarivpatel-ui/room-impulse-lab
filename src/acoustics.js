/* Room Impulse Lab acoustics engine. Pure ES module, zero dependencies,
 * fully deterministic. Runs unchanged in the browser and in Node.
 *
 * Classic statistical room acoustics: Sabine, Eyring and Millington-Sette
 * reverberation times, equivalent absorption area, mean free path, and air
 * absorption. Everything is a closed-form function of the room model, so the
 * test suite can check every number against a hand-computed value.
 */

export const SPEED_OF_SOUND = 343; // m/s at 20 C, sea level
export const SABINE_K = 0.161; // s/m, the Sabine constant at 20 C
export const OCTAVE_BANDS = [125, 250, 500, 1000, 2000, 4000];
export const MAX_RT60 = 30; // displayed/predicted values clamp here (s)

/* Absorption coefficients per octave band for common surfaces. Values are
 * representative mid-band figures from standard tables (Kuttruff, "Room
 * Acoustics"); they are teaching values, not manufacturer data. */
export const MATERIALS = [
  { id: 'concrete', label: 'Poured concrete', alpha: [0.01, 0.01, 0.02, 0.02, 0.02, 0.03] },
  { id: 'brick', label: 'Brick wall', alpha: [0.03, 0.03, 0.03, 0.04, 0.05, 0.07] },
  { id: 'gypsum', label: 'Gypsum board on studs', alpha: [0.29, 0.10, 0.05, 0.04, 0.07, 0.09] },
  { id: 'glass', label: 'Window glass', alpha: [0.35, 0.25, 0.18, 0.12, 0.07, 0.04] },
  { id: 'wood', label: 'Wood panel or floor', alpha: [0.15, 0.11, 0.10, 0.07, 0.06, 0.07] },
  { id: 'carpet', label: 'Heavy carpet on pad', alpha: [0.05, 0.10, 0.30, 0.50, 0.60, 0.70] },
  { id: 'curtain', label: 'Heavy curtain', alpha: [0.14, 0.35, 0.55, 0.70, 0.70, 0.65] },
  { id: 'acoustictile', label: 'Acoustic ceiling tile', alpha: [0.20, 0.50, 0.75, 0.85, 0.90, 0.85] },
  { id: 'audience', label: 'Upholstered seating', alpha: [0.30, 0.45, 0.65, 0.80, 0.85, 0.85] }
];

export const SURFACE_IDS = ['xMin', 'xMax', 'yMin', 'yMax', 'floor', 'ceiling'];

export const SURFACE_LABELS = {
  xMin: 'Wall at x = 0',
  xMax: 'Wall at x = L',
  yMin: 'Wall at y = 0',
  yMax: 'Wall at y = W',
  floor: 'Floor',
  ceiling: 'Ceiling'
};

export function materialById(id) {
  return MATERIALS.find((m) => m.id === id) || MATERIALS[0];
}

export function clamp(x, lo, hi) {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

export function safeDiv(a, b, fallback = 0) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return fallback;
  const v = a / b;
  return Number.isFinite(v) ? v : fallback;
}

export const DEFAULT_ROOM = {
  dims: { x: 6.0, y: 4.5, z: 3.0 },
  source: { x: 2.0, y: 1.6, z: 1.2 },
  listener: { x: 4.6, y: 3.2, z: 1.4 },
  materials: {
    xMin: 'gypsum', xMax: 'gypsum',
    yMin: 'glass', yMax: 'gypsum',
    floor: 'carpet', ceiling: 'acoustictile'
  },
  maxOrder: 3,
  seed: 7,
  sampleRate: 44100,
  duration: 1.5
};

/**
 * Face areas in square metres. xMin/xMax face the x axis, yMin/yMax the y
 * axis, floor/ceiling the z axis.
 */
export function surfaceAreas(dims) {
  const d = dims || {};
  const x = Number(d.x) || 0;
  const y = Number(d.y) || 0;
  const z = Number(d.z) || 0;
  return {
    xMin: y * z,
    xMax: y * z,
    yMin: x * z,
    yMax: x * z,
    floor: x * y,
    ceiling: x * y
  };
}

export function totalSurfaceArea(dims) {
  const a = surfaceAreas(dims);
  return SURFACE_IDS.reduce((s, k) => s + a[k], 0);
}

export function roomVolume(dims) {
  const d = dims || {};
  return (Number(d.x) || 0) * (Number(d.y) || 0) * (Number(d.z) || 0);
}

/** Mean free path between reflections, 4V/S (metres). */
export function meanFreePath(dims) {
  return safeDiv(4 * roomVolume(dims), totalSurfaceArea(dims), 0);
}

/**
 * Equivalent absorption area A = sum_i S_i * alpha_i for one band index, plus
 * the optional air term 4 m V (see airAttenuation below). Returns sabines (m2).
 */
export function equivalentAbsorptionArea(dims, materials, band, opts = {}) {
  const areas = surfaceAreas(dims);
  let a = 0;
  for (const id of SURFACE_IDS) {
    const mat = materialById(materials && materials[id]);
    a += areas[id] * (mat.alpha[band] ?? 0);
  }
  if (opts.air !== false) a += airAbsorptionArea(dims, band);
  return a;
}

/**
 * Air absorption expressed as extra sabines: 4 m V. The attenuation constant
 * m grows steeply with frequency; values below are a fixed mid-humidity
 * approximation (roughly 50% RH, 20 C) for teaching purposes.
 */
export const AIR_M = [0.0000, 0.0004, 0.0012, 0.0028, 0.0075, 0.0260];

export function airAttenuationM(band) {
  return AIR_M[band] ?? 0;
}

export function airAbsorptionArea(dims, band) {
  return 4 * airAttenuationM(band) * roomVolume(dims);
}

/** Mean absorption coefficient A_bar = A / S (no air term in A). */
export function meanAbsorption(dims, materials, band) {
  return safeDiv(equivalentAbsorptionArea(dims, materials, band, { air: false }), totalSurfaceArea(dims), 0);
}

/**
 * Sabine T60 = 0.161 V / A. Includes the air term in A. A totally live room
 * (A = 0) has no finite reverberation time: Infinity is returned and callers
 * clamp it for display.
 */
export function sabineRT60(dims, materials, band, opts = {}) {
  const a = equivalentAbsorptionArea(dims, materials, band, opts);
  if (!(a > 0)) return Infinity;
  return (SABINE_K * roomVolume(dims)) / a;
}

/**
 * Eyring T60 = 0.161 V / (-S ln(1 - a_bar)). The air term is added to the
 * effective absorption denominator, as is standard practice. At a_bar = 1
 * (perfectly absorbing room) the result tends to 0.
 */
export function eyringRT60(dims, materials, band, opts = {}) {
  const s = totalSurfaceArea(dims);
  const aBar = meanAbsorption(dims, materials, band);
  let denom;
  if (aBar >= 1) denom = Infinity; // -S ln(0)
  else denom = -s * Math.log(1 - aBar);
  if (opts.air !== false) denom += airAbsorptionArea(dims, band);
  if (!(denom > 0)) return Infinity;
  return (SABINE_K * roomVolume(dims)) / denom;
}

/**
 * Millington-Sette T60 = 0.161 V / sum_i (-S_i ln(1 - alpha_i)). Uses each
 * surface's own coefficient, so it survives a single perfectly absorbing
 * face that makes Eyring degenerate.
 */
export function millingtonRT60(dims, materials, band, opts = {}) {
  const areas = surfaceAreas(dims);
  let denom = 0;
  for (const id of SURFACE_IDS) {
    const mat = materialById(materials && materials[id]);
    const alpha = clamp(mat.alpha[band] ?? 0, 0, 1);
    if (alpha >= 1) { denom = Infinity; break; }
    denom += -areas[id] * Math.log(1 - alpha);
  }
  if (opts.air !== false) denom += airAbsorptionArea(dims, band);
  if (!(denom > 0)) return Infinity;
  return (SABINE_K * roomVolume(dims)) / denom;
}

/**
 * Schroeder decay constant for a given reverberation time: amplitude decays
 * as exp(-sigma t) where sigma = ln(10^3) / T60 = 6.9078 / T60. Energy decays
 * twice as fast.
 */
export function decaySigma(t60) {
  return safeDiv(6.907755278982137, t60, 0);
}

/** RT60 implied by an exponential amplitude sigma. */
export function rt60FromSigma(sigma) {
  return safeDiv(6.907755278982137, sigma, 0);
}

/** Distance between two 3D points. */
export function distance(a, b) {
  const dx = (a && a.x) - (b && b.x);
  const dy = (a && a.y) - (b && b.y);
  const dz = (a && a.z) - (b && b.z);
  const d2 = dx * dx + dy * dy + dz * dz;
  return d2 > 0 ? Math.sqrt(d2) : 0;
}

/**
 * Fail-closed validation of a room configuration. Returns { ok, errors }.
 * Every coordinate must be finite and inside the box; dimensions must be
 * positive; every material id must exist. Nothing here silently repairs an
 * impossible room.
 */
export function validateRoom(cfg) {
  const errors = [];
  const c = cfg || {};
  const d = c.dims || {};
  for (const k of ['x', 'y', 'z']) {
    if (!Number.isFinite(d[k]) || d[k] <= 0) errors.push('dimension ' + k + ' must be a positive number');
  }
  const inside = (p, name) => {
    const q = p || {};
    for (const k of ['x', 'y', 'z']) {
      if (!Number.isFinite(q[k])) { errors.push(name + ' ' + k + ' must be a finite number'); continue; }
      if (Number.isFinite(d[k]) && d[k] > 0 && (q[k] < 0 || q[k] > d[k])) {
        errors.push(name + ' ' + k + ' lies outside the room');
      }
    }
  };
  inside(c.source, 'source');
  inside(c.listener, 'listener');
  const mats = c.materials || {};
  for (const id of SURFACE_IDS) {
    if (!MATERIALS.some((m) => m.id === mats[id])) errors.push('surface ' + id + ' has an unknown material');
  }
  if (!Number.isFinite(c.maxOrder) || c.maxOrder < 0 || c.maxOrder > 8 || Math.floor(c.maxOrder) !== c.maxOrder) {
    errors.push('reflection order must be an integer between 0 and 8');
  }
  if (c.source && c.listener && distance(c.source, c.listener) < 0.05) {
    errors.push('source and listener must be at least 5 cm apart');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Per-band summary used by the table and charts: A, mean alpha and all three
 * predicted RT60 values, clamped to MAX_RT60 for display.
 */
export function roomSummary(dims, materials) {
  const s = totalSurfaceArea(dims);
  const v = roomVolume(dims);
  return {
    volume: v,
    surfaceArea: s,
    meanFreePath: meanFreePath(dims),
    bands: OCTAVE_BANDS.map((f, i) => {
      const aWalls = equivalentAbsorptionArea(dims, materials, i, { air: false });
      const aAir = airAbsorptionArea(dims, i);
      const sabine = sabineRT60(dims, materials, i);
      const eyring = eyringRT60(dims, materials, i);
      const millington = millingtonRT60(dims, materials, i);
      return {
        band: i,
        frequency: f,
        absorptionArea: aWalls + aAir,
        wallAbsorption: aWalls,
        airAbsorption: aAir,
        meanAlpha: meanAbsorption(dims, materials, i),
        sabine,
        eyring,
        millington,
        sabineClamped: Math.min(sabine, MAX_RT60),
        eyringClamped: Math.min(eyring, MAX_RT60),
        millingtonClamped: Math.min(millington, MAX_RT60)
      };
    })
  };
}
