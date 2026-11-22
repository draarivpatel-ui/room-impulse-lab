/* ISO 3382 speech and music clarity metrics plus the ANSI S12.60 classroom
 * compliance check. Pure ES module, zero dependencies, deterministic.
 *
 * Early-to-late energy ratios measured on an impulse response:
 *   C50  = 10 log10( E(0..50 ms) / E(50 ms..end) )   speech clarity, dB
 *   C80  = 10 log10( E(0..80 ms) / E(80 ms..end) )   music clarity, dB
 *   D50  = E(0..50 ms) / E(total)                    definition, 0..1
 * EDT and T20/T30 come from the Schroeder fits in ir.js and are bundled into
 * the per-band table so the whole ISO 3382 parameter set lives in one place.
 */

import {
  OCTAVE_BANDS, SABINE_K, roomVolume, equivalentAbsorptionArea,
  materialById, safeDiv
} from './acoustics.js';
import { schroeder, fitDecay, applyBandpass, bandpassBiquad, BAND_Q, BAND_STAGES } from './ir.js';

/** Energy split of an impulse response at a boundary time in milliseconds. */
export function energySplit(ir, sampleRate, ms) {
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const n = ir ? ir.length : 0;
  const idx = Math.max(0, Math.min(n, Math.round((ms / 1000) * sr)));
  let early = 0, late = 0;
  for (let i = 0; i < n; i++) {
    const e = ir[i] * ir[i];
    if (i < idx) early += e; else late += e;
  }
  return { early, late, index: idx };
}

/**
 * Clarity index in dB: 10 log10(early/late). A signal with no late energy is
 * perfectly clear (+Infinity); with no early energy the metric is -Infinity.
 */
export function clarityDb(ir, sampleRate, ms) {
  const { early, late } = energySplit(ir, sampleRate, ms);
  if (!(early > 0) && !(late > 0)) return NaN; // silence: undefined
  if (!(late > 0)) return Infinity;
  if (!(early > 0)) return -Infinity;
  return 10 * Math.log10(early / late);
}

/** C50, the speech clarity index (ISO 3382-1). */
export function c50(ir, sampleRate) { return clarityDb(ir, sampleRate, 50); }

/** C80, the music clarity index (ISO 3382-1). */
export function c80(ir, sampleRate) { return clarityDb(ir, sampleRate, 80); }

/** D50 ("definition"): early energy fraction within 0..50 ms, range 0..1. */
export function d50(ir, sampleRate) {
  const { early, late } = energySplit(ir, sampleRate, 50);
  const total = early + late;
  return total > 0 ? early / total : NaN;
}

/* Teaching-band speech intelligibility rating from C50, after the common
 * ISO 3382 guidance: C50 >= +2 dB is generally good for speech. */
export const CLARITY_RATINGS = [
  { min: 2, label: 'Good', note: 'meets the usual classroom target' },
  { min: -2, label: 'Fair', note: 'borderline for unamplified speech' },
  { min: -Infinity, label: 'Poor', note: 'speech intelligibility at risk' }
];

export function clarityRating(c50Db) {
  for (const r of CLARITY_RATINGS) if (c50Db >= r.min) return r;
  return CLARITY_RATINGS[CLARITY_RATINGS.length - 1];
}

/**
 * Full per-band clarity + decay table on one impulse response: each octave
 * band is isolated with the same cascaded biquad chain the measurement code
 * uses, then C50, C80, D50 and the EDT/T20/T30 Schroeder fits are measured.
 * Broadband (unfiltered) metrics ride along as `broadband`.
 */
export function clarityTable(ir, sampleRate) {
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const edc = schroeder(ir);
  const broadband = {
    c50: c50(ir, sr),
    c80: c80(ir, sr),
    d50: d50(ir, sr),
    edt: fitDecay(edc, sr, 0, -10).t60,
    t20: fitDecay(edc, sr, -5, -25).t60,
    t30: fitDecay(edc, sr, -5, -35).t60
  };
  const bands = OCTAVE_BANDS.map((f, b) => {
    const shaped = applyBandpass(bandpassBiquad(f, BAND_Q, sr), ir, BAND_STAGES);
    const edc = schroeder(shaped);
    const edt = fitDecay(edc, sr, 0, -10);
    const t20 = fitDecay(edc, sr, -5, -25);
    const t30 = fitDecay(edc, sr, -5, -35);
    return {
      band: b,
      frequency: f,
      c50: c50(shaped, sr),
      c80: c80(shaped, sr),
      d50: d50(shaped, sr),
      edt: Number.isFinite(edt.t60) ? Math.min(edt.t60, 30) : NaN,
      t20: Number.isFinite(t20.t60) ? Math.min(t20.t60, 30) : NaN,
      t30: Number.isFinite(t30.t60) ? Math.min(t30.t60, 30) : NaN
    };
  });
  return { broadband, bands };
}

/* ---------------- ANSI S12.60 classroom compliance ----------------
 * ANSI/ASA S12.60 limits reverberation time in unoccupied classrooms to
 *   0.6 s for rooms up to 283 m3 (10,000 ft3)
 *   0.7 s for rooms from 283 to 566 m3 (20,000 ft3)
 * evaluated in the 500, 1000 and 2000 Hz octave bands. Volumes above the
 * standard's scope return verdict 'SCOPE'. */

export const ANSI_BAND_INDICES = [2, 3, 4]; // 500, 1000, 2000 Hz in OCTAVE_BANDS

export function ansiVolumeLimit(volumeM3) {
  const v = Number(volumeM3);
  if (!(v > 0)) return NaN;
  if (v <= 283) return 0.6;
  if (v <= 566) return 0.7;
  return NaN; // outside the standard classroom scope
}

/**
 * Evaluate the room against ANSI S12.60 using a chosen per-band T60 getter
 * (defaults to the Eyring prediction). Returns
 *   { standard, limit, verdict, worstBand, worstT60, bands, treatment }.
 * verdict: 'PASS' | 'FAIL' | 'SCOPE'. `treatment` is a panel recommendation
 * for a FAIL room, null otherwise.
 */
export function ansiClassroom(dims, materials, getT60, panelMaterialId = 'acoustictile') {
  const v = roomVolume(dims);
  const limit = ansiVolumeLimit(v);
  const read = typeof getT60 === 'function' ? getT60 : null;
  const bandInfo = ANSI_BAND_INDICES.map((b) => ({
    band: b,
    frequency: OCTAVE_BANDS[b],
    t60: read ? read(b) : NaN
  }));
  let worst = null;
  for (const b of bandInfo) {
    if (Number.isFinite(b.t60) && (!worst || b.t60 > worst.t60)) worst = b;
  }
  if (!Number.isFinite(limit)) {
    return {
      standard: 'ANSI S12.60',
      limit,
      verdict: 'SCOPE',
      worstBand: worst ? worst.frequency : NaN,
      worstT60: worst ? worst.t60 : NaN,
      bands: bandInfo,
      treatment: null
    };
  }
  const pass = bandInfo.every((b) => Number.isFinite(b.t60) && b.t60 <= limit + 1e-9);
  return {
    standard: 'ANSI S12.60',
    limit,
    verdict: pass ? 'PASS' : 'FAIL',
    worstBand: worst ? worst.frequency : NaN,
    worstT60: worst ? worst.t60 : NaN,
    bands: bandInfo,
    treatment: pass ? null : treatmentFor(dims, materials, limit, worst ? worst.band : 3, panelMaterialId)
  };
}

/**
 * Absorption needed to pull the worst ANSI band down to the limit:
 * Sabine needs A_req = 0.161 V / T_limit; the gap is filled with panels of a
 * chosen material (default acoustic ceiling tile) of PANEL_AREA square
 * metres each. Returns panel count and geometry, or null when no finite
 * deficit exists.
 */
export const PANEL_AREA = 1.2; // m2 per recommended treatment panel

export function treatmentFor(dims, materials, limitT60, band = 3, panelMaterialId = 'acoustictile') {
  const v = roomVolume(dims);
  if (!(v > 0) || !(limitT60 > 0)) return null;
  const aNow = equivalentAbsorptionArea(dims, materials, band, { air: true });
  const aReq = (SABINE_K * v) / limitT60;
  const deficit = aReq - aNow;
  if (!(deficit > 0)) return null;
  const mat = materialById(panelMaterialId);
  const alpha = Math.max(0.01, mat.alpha[band] ?? 0.5);
  const areaNeeded = deficit / alpha;
  const panels = Math.ceil(areaNeeded / PANEL_AREA - 1e-9);
  return {
    band,
    frequency: OCTAVE_BANDS[band] ?? NaN,
    currentA: aNow,
    requiredA: aReq,
    deficitSabines: deficit,
    material: mat.label,
    materialId: mat.id,
    panelAlpha: alpha,
    panelAreaM2: PANEL_AREA,
    areaNeededM2: areaNeeded,
    panelCount: panels
  };
}
