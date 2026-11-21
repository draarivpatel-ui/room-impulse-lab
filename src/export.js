/* Export builders: WAV (16 bit PCM), RFC 4180 CSV with spreadsheet-formula
 * protection, and a plain JSON snapshot. Pure ES module: works in Node for
 * tests and hands ArrayBuffers/strings to the browser for downloads. */

/**
 * Encode mono Float64 samples [-1, 1] as 16 bit PCM WAV. Out-of-range
 * samples are clipped, never wrapped. Returns an ArrayBuffer.
 */
export function encodeWav(samples, sampleRate = 44100) {
  const sr = Math.max(1, Math.floor(sampleRate) || 44100);
  const src = samples || [];
  const n = src.length;
  const dataBytes = n * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);      // fmt chunk size
  v.setUint16(20, 1, true);       // PCM
  v.setUint16(22, 1, true);       // mono
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);  // byte rate
  v.setUint16(32, 2, true);       // block align
  v.setUint16(34, 16, true);      // bits per sample
  writeStr(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(src[i]) ? src[i] : 0;
    const c = x > 1 ? 1 : x < -1 ? -1 : x;
    v.setInt16(44 + i * 2, Math.round(c * 32767), true);
  }
  return buf;
}

/**
 * RFC 4180 CSV cell. Strings that could be read as a spreadsheet formula
 * (leading =, +, -, @, tab or CR) are prefixed with a single quote.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Serialize an array of flat objects to RFC 4180 CSV text (CRLF records). */
export function toCsv(rows, columns) {
  const list = Array.isArray(rows) ? rows : [];
  const cols = Array.isArray(columns) && columns.length
    ? columns
    : (list.length ? Object.keys(list[0]) : []);
  const lines = [cols.map(csvCell).join(',')];
  for (const row of list) lines.push(cols.map((c) => csvCell(row ? row[c] : '')).join(','));
  return lines.join('\r\n');
}

/** RT60 comparison table rows: one per octave band. */
export function rt60Rows(summary, measured) {
  const bands = (summary && summary.bands) || [];
  return bands.map((b) => ({
    band_hz: b.frequency,
    mean_alpha: round(b.meanAlpha, 4),
    absorption_area_m2: round(b.absorptionArea, 3),
    sabine_s: round(b.sabineClamped, 4),
    eyring_s: round(b.eyringClamped, 4),
    millington_s: round(b.millingtonClamped, 4),
    measured_t30_s: measuredT30(measured, b.band)
  }));
}

/** Reflection table rows: direct + images. */
export function pathRows(paths) {
  return (paths || []).map((p) => ({
    order: p.order,
    path: p.path,
    delay_ms: round(p.delay * 1000, 3),
    distance_m: round(p.distance, 4),
    gain_1k: round(p.gains[3] ?? 0, 6)
  }));
}

/** JSON snapshot of a full simulation for offline analysis. */
export function exportJson({ config, summary, measured, paths, meta }) {
  return JSON.stringify({
    tool: 'room-impulse-lab',
    model: 'geometric acoustics: Sabine, Eyring, Millington-Sette, image sources, Schroeder integration',
    disclaimer: 'Teaching model. Specular reflections only; no diffraction, scattering or real measurement data.',
    meta: meta || {},
    config: {
      dims: config.dims,
      source: config.source,
      listener: config.listener,
      materials: config.materials,
      maxOrder: config.maxOrder,
      seed: config.seed,
      sampleRate: config.sampleRate,
      duration: config.duration
    },
    room: {
      volume: summary.volume,
      surfaceArea: summary.surfaceArea,
      meanFreePath: summary.meanFreePath
    },
    bands: rt60Rows(summary, measured),
    paths: pathRows(paths)
  }, null, 2);
}

/** Accept either raw T30 numbers or simulate() measurement objects. */
function measuredT30(measured, band) {
  if (!measured) return '';
  const m = measured[band];
  const v = typeof m === 'number' ? m : (m && m.t30);
  return Number.isFinite(v) ? round(v, 4) : '';
}

function round(x, d) {
  if (!Number.isFinite(x)) return x;
  const m = 10 ** d;
  return Math.round(x * m) / m;
}
