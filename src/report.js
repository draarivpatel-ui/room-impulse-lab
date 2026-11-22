/* Fingerprinted acoustic report: a deterministic JSON document covering the
 * room model, ISO 3382 clarity metrics and the ANSI S12.60 verdict, sealed
 * with a SHA-256 fingerprint so a saved report can be integrity-checked.
 * Pure ES module; the hash is the local SHA-256 in sha256.js so the report
 * is byte-identical in the browser and in Node. */

import { sha256Hex } from './sha256.js';
import { OCTAVE_BANDS } from './acoustics.js';
import { rt60Rows, pathRows } from './export.js';

/** Canonical JSON: stable because every object is built with a fixed key
 * order. Used for fingerprinting and for the downloaded file itself. */
export function canonicalJson(obj) {
  return JSON.stringify(obj);
}

const round = (x, d) => {
  if (!Number.isFinite(x)) return x;
  const m = 10 ** d;
  return Math.round(x * m) / m;
};
const num = (x, d = 4) => (Number.isFinite(x) ? round(x, d) : null);

/**
 * Build the report body (without the fingerprint). `sim` is the object
 * simulate() returns, extended with clarity and ansi results.
 */
export function reportBody(sim) {
  const cfg = sim.config || {};
  const sum = sim.summary || {};
  const clarity = sim.clarity || {};
  const ansi = sim.ansi || {};
  return {
    tool: 'room-impulse-lab',
    reportVersion: 2,
    model: 'geometric acoustics: Sabine, Eyring, Millington-Sette, image sources, Schroeder integration, ISO 3382 clarity',
    disclaimer: 'Teaching model. Specular reflections only; no diffraction, scattering or real measurement data.',
    config: {
      dims: cfg.dims,
      source: cfg.source,
      listener: cfg.listener,
      materials: cfg.materials,
      maxOrder: cfg.maxOrder,
      seed: cfg.seed,
      sampleRate: cfg.sampleRate,
      duration: cfg.duration
    },
    room: {
      volume: sum.volume,
      surfaceArea: sum.surfaceArea,
      meanFreePath: sum.meanFreePath
    },
    ansiS1260: {
      standard: ansi.standard || 'ANSI S12.60',
      limitS: ansi.limit,
      verdict: ansi.verdict,
      worstBandHz: ansi.worstBand,
      worstT60S: num(ansi.worstT60),
      treatment: ansi.treatment ? {
        material: ansi.treatment.material,
        panelCount: ansi.treatment.panelCount,
        panelAreaM2: ansi.treatment.panelAreaM2,
        areaNeededM2: num(ansi.treatment.areaNeededM2, 3),
        deficitSabines: num(ansi.treatment.deficitSabines, 3)
      } : null
    },
    clarity: {
      broadband: {
        c50Db: num(clarity.broadband && clarity.broadband.c50, 3),
        c80Db: num(clarity.broadband && clarity.broadband.c80, 3),
        d50: num(clarity.broadband && clarity.broadband.d50, 4)
      },
      bands: (clarity.bands || []).map((b) => ({
        bandHz: b.frequency,
        c50Db: num(b.c50, 3),
        c80Db: num(b.c80, 3),
        d50: num(b.d50, 4),
        edtS: num(b.edt),
        t20S: num(b.t20),
        t30S: num(b.t30)
      }))
    },
    bands: rt60Rows(sum, sim.measured),
    paths: pathRows(sim.paths),
    stats: {
      pathCount: sim.stats ? sim.stats.pathCount : 0,
      directDelayMs: num(sim.stats ? sim.stats.directDelayMs : 0, 3)
    }
  };
}

/** Full report: body plus its SHA-256 fingerprint of the canonical body. */
export function buildReport(sim) {
  const body = reportBody(sim);
  const fingerprint = sha256Hex(canonicalJson(body));
  return { ...body, fingerprintSha256: fingerprint };
}

/** Serialized report JSON (the downloaded file text). */
export function reportJson(sim) {
  return canonicalJson(buildReport(sim));
}

/**
 * Recompute the fingerprint of a parsed report object and compare it to the
 * stored one. Returns { ok, expected, found }.
 */
export function verifyReport(report) {
  if (!report || typeof report !== 'object') return { ok: false, expected: '', found: '' };
  const found = report.fingerprintSha256;
  const body = { ...report };
  delete body.fingerprintSha256;
  const expected = sha256Hex(canonicalJson(body));
  return { ok: typeof found === 'string' && found === expected, expected, found };
}

/** Per-band clarity rows for CSV export. */
export function clarityRows(clarity) {
  const bands = (clarity && clarity.bands) || [];
  return bands.map((b) => ({
    band_hz: b.frequency,
    c50_db: num(b.c50, 3),
    c80_db: num(b.c80, 3),
    d50: num(b.d50, 4),
    edt_s: num(b.edt, 4),
    t20_s: num(b.t20, 4),
    t30_s: num(b.t30, 4)
  }));
}

/** Compact one-line ANSI verdict row for CSV export. */
export function ansiRows(ansi) {
  if (!ansi) return [];
  return [{
    standard: ansi.standard || 'ANSI S12.60',
    limit_s: num(ansi.limit, 2),
    verdict: ansi.verdict || '',
    worst_band_hz: ansi.worstBand || '',
    worst_t60_s: num(ansi.worstT60, 4),
    panel_count: ansi.treatment ? ansi.treatment.panelCount : '',
    panel_material: ansi.treatment ? ansi.treatment.material : ''
  }];
}

export { OCTAVE_BANDS };
