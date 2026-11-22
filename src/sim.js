/* Simulation orchestrator: validate the room, compute the RT60 model,
 * enumerate image sources, synthesize the impulse response and measure it
 * back per octave band. One entry point for the app and the test suite. */

import {
  DEFAULT_ROOM, OCTAVE_BANDS, validateRoom, roomSummary, distance
} from './acoustics.js';
import { allPaths, directPath } from './images.js';
import { synthesizeIR, normalizePeak, schroeder, fitDecay, applyBandpass, bandpassBiquad, estimateRT60, BAND_Q, BAND_STAGES } from './ir.js';
import { clarityTable, ansiClassroom } from './clarity.js';

export function mergeConfig(cfg = {}) {
  const base = DEFAULT_ROOM;
  return {
    dims: { ...base.dims, ...(cfg.dims || {}) },
    source: { ...base.source, ...(cfg.source || {}) },
    listener: { ...base.listener, ...(cfg.listener || {}) },
    materials: { ...base.materials, ...(cfg.materials || {}) },
    maxOrder: cfg.maxOrder ?? base.maxOrder,
    seed: cfg.seed ?? base.seed,
    sampleRate: cfg.sampleRate ?? base.sampleRate,
    duration: cfg.duration ?? base.duration
  };
}

/**
 * Run the full lab. Fail closed: an invalid room returns { ok:false, errors }
 * and nothing is synthesized or measured.
 */
export function simulate(cfg = {}) {
  const config = mergeConfig(cfg);
  const check = validateRoom(config);
  if (!check.ok) return { ok: false, errors: check.errors, config };

  const summary = roomSummary(config.dims, config.materials);
  const paths = allPaths(config);
  const direct = directPath(config);
  const { ir, sampleRate, tailGain } = synthesizeIR(config);
  const { samples: playback, gain: normGain } = normalizePeak(ir, 0.98);

  // Measured per-band T30 on the synthesized IR, the same workflow a real
  // measurement chain uses: cascaded octave-band filter, Schroeder curve,
  // slope fit. The 3-stage cascade keeps neighbouring bands from leaking
  // into the fit window.
  const measured = OCTAVE_BANDS.map((f, b) => {
    const shaped = applyBandpass(bandpassBiquad(f, BAND_Q, sampleRate), ir, BAND_STAGES);
    const edc = schroeder(shaped);
    const fit = fitDecay(edc, sampleRate, -5, -35);
    return {
      band: b, frequency: f,
      t30: Number.isFinite(fit.t60) ? Math.min(fit.t60, 30) : NaN,
      r2: fit.r2, slope: fit.slope
    };
  });
  const broadband = estimateRT60(ir, sampleRate);
  const clarity = clarityTable(ir, sampleRate);
  // ANSI S12.60 judges the modeled (Eyring) reverberation time: deterministic
  // and independent of the seeded stochastic tail.
  const ansi = ansiClassroom(config.dims, config.materials, (b) => summary.bands[b].eyring);

  return {
    ok: true,
    errors: [],
    config,
    summary,
    paths,
    direct,
    ir,
    playback,
    normGain,
    tailGain,
    sampleRate,
    measured,
    broadband,
    clarity,
    ansi,
    stats: {
      pathCount: paths.length,
      imageCount: paths.length - 1,
      directDelayMs: direct.delay * 1000,
      directDistance: distance(config.source, config.listener)
    }
  };
}
