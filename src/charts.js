/* Canvas charts for Room Impulse Lab. Pure drawing, no dependencies.
 * Colors come from CSS custom properties so light and dark themes work. */

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim();
  return {
    ink: get('--ink', '#1c2430'),
    soft: get('--ink-soft', '#4b586a'),
    faint: get('--ink-faint', '#64748a'),
    panel: get('--panel', '#ffffff'),
    alt: get('--panel-alt', '#eef2f6'),
    line: get('--line', '#d4dce4'),
    accent: get('--accent', '#2658b8'),
    accentSoft: get('--accent-soft', '#dce7fa'),
    clay: get('--clay', '#b34a21'),
    gold: get('--gold', '#9a7116'),
    teal: get('--teal', '#0f766e')
  };
}

function setup(canvas) {
  if (!canvas) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(240, Math.round(rect.width || canvas.width));
  const h = Math.max(160, Math.round(rect.height || canvas.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, p: palette() };
}

const font10 = () => '10px ' + getComputedStyle(document.body).fontFamily;
const font12 = () => '600 12px ' + getComputedStyle(document.body).fontFamily;

/**
 * Top-down plan (x-y plane): room outline, source, listener, first-order
 * image sources with dashed propagation paths back to the listener.
 */
export function drawPlan(canvas, config, paths) {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h, p } = s;
  const { dims, source, listener } = config;
  const m = { l: 34, r: 14, t: 16, b: 30 };
  const pw = Math.max(60, w - m.l - m.r);
  const ph = Math.max(60, h - m.t - m.b);
  const scale = Math.min(pw / dims.x, ph / dims.y);
  const ox = m.l + (pw - dims.x * scale) / 2;
  const oy = m.t + (ph - dims.y * scale) / 2;
  const px = (pt) => ({ x: ox + pt.x * scale, y: oy + pt.y * scale });

  ctx.strokeStyle = p.soft;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(ox, oy, dims.x * scale, dims.y * scale);

  // First-order images: dashed construction lines to the listener.
  const first = (paths || []).filter((q) => q.order === 1);
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  for (const img of first) {
    const a = px(img.pos);
    const b = px(listener);
    ctx.strokeStyle = p.faint;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = p.gold;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.setLineDash([]);

  const src = px(source);
  const lis = px(listener);
  ctx.fillStyle = p.clay;
  ctx.beginPath();
  ctx.arc(src.x, src.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.arc(lis.x, lis.y, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = p.panel;
  ctx.beginPath();
  ctx.arc(lis.x, lis.y, 8.5, 0, Math.PI * 2);
  ctx.stroke();

  // Meter ticks on both axes.
  ctx.fillStyle = p.faint;
  ctx.font = font10();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = 0; x <= dims.x; x += Math.max(1, Math.round(dims.x / 6))) {
    ctx.fillText(String(x), ox + x * scale, oy + dims.y * scale + 5);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let y = 0; y <= dims.y; y += Math.max(1, Math.round(dims.y / 4))) {
    ctx.fillText(String(y), ox - 5, oy + y * scale);
  }
  ctx.textAlign = 'left';
  ctx.fillText('source', src.x + 9, src.y - 9);
  ctx.fillText('listener', lis.x + 11, lis.y - 9);
}

/** Impulse response waveform. */
export function drawWaveform(canvas, ir, sampleRate) {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h, p } = s;
  const m = { l: 44, r: 16, t: 16, b: 30 };
  const pw = Math.max(60, w - m.l - m.r);
  const ph = Math.max(20, h - m.t - m.b);
  const n = ir ? ir.length : 0;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ir[i]));
  peak = peak || 1;

  ctx.strokeStyle = p.line;
  ctx.fillStyle = p.faint;
  ctx.font = font10();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    const y = m.t + (1 - (v + 1) / 2) * ph;
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
    ctx.fillText(String(v), m.l - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const dur = n / (sampleRate || 44100);
  for (let i = 0; i <= 5; i++) {
    const t = (dur * i) / 5;
    const x = m.l + (i / 5) * pw;
    ctx.fillText(t.toFixed(2) + ' s', x, m.t + ph + 6);
  }

  // One vertical min/max segment per screen pixel: the full IR can be
  // hundreds of thousands of samples, and one lineTo per sample both
  // crawls and blurs into a solid bar.
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(n / pw));
  for (let x = 0; x < pw; x++) {
    const start = Math.floor((x / pw) * n);
    const end = Math.min(n, start + step);
    let lo = 0, hi = 0;
    for (let i = start; i < end; i++) {
      const v = ir[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const yHi = m.t + (1 - (hi / peak + 1) / 2) * ph;
    const yLo = m.t + (1 - (lo / peak + 1) / 2) * ph;
    ctx.moveTo(m.l + x, yHi);
    ctx.lineTo(m.l + x, Math.max(yLo, yHi + 0.5));
  }
  ctx.stroke();
}

/** Schroeder decay curve with the fitted T30 segment highlighted. */
export function drawDecay(canvas, edc, fit, sampleRate) {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h, p } = s;
  const m = { l: 44, r: 16, t: 16, b: 30 };
  const pw = Math.max(60, w - m.l - m.r);
  const ph = Math.max(20, h - m.t - m.b);
  const n = edc ? edc.length : 0;
  const sr = sampleRate || 44100;
  const dbToY = (db) => m.t + (0 - Math.max(-65, Math.min(0, db))) / 65 * ph;

  ctx.strokeStyle = p.line;
  ctx.fillStyle = p.faint;
  ctx.font = font10();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const db of [0, -10, -20, -30, -40, -50, -60]) {
    const y = dbToY(db);
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
    ctx.fillText(String(db), m.l - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const dur = n / sr;
  for (let i = 0; i <= 5; i++) {
    const t = (dur * i) / 5;
    ctx.fillText(t.toFixed(2) + ' s', m.l + (i / 5) * pw, m.t + ph + 6);
  }
  if (!n) return;

  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = m.l + (i / Math.max(1, n - 1)) * pw;
    const y = dbToY(edc[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (fit && Number.isFinite(fit.slope) && fit.slope < 0) {
    const t0 = 0, t1 = Math.min(dur, -65 / fit.slope);
    ctx.strokeStyle = p.clay;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(m.l + (t0 / dur) * pw, dbToY(fit.intercept + fit.slope * t0));
    ctx.lineTo(m.l + (t1 / dur) * pw, dbToY(fit.intercept + fit.slope * t1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = p.clay;
    ctx.font = font12();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('T30 ' + (-60 / fit.slope).toFixed(2) + ' s', m.l + pw - 4, m.t + 6);
  }
}

/** Grouped bars: Sabine, Eyring and measured T30 per octave band. */
export function drawBands(canvas, summary, measured) {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h, p } = s;
  const bands = (summary && summary.bands) || [];
  if (!bands.length) return;

  const legend = [[p.accent, 'Sabine'], [p.clay, 'Eyring'], [p.teal, 'Measured T30']];
  ctx.font = font10();
  let lx = 44, ly = 13, legendBottom = ly + 7;
  const items = [];
  for (const [color, label] of legend) {
    const lw = ctx.measureText(label).width;
    if (lx + 18 + lw + 10 > w - 8) { lx = 44; ly += 14; }
    items.push({ color, label, x: lx, y: ly });
    legendBottom = ly + 7;
    lx += 18 + lw + 18;
  }

  const m = { l: 44, r: 16, t: legendBottom + 10, b: 34 };
  const pw = Math.max(60, w - m.l - m.r);
  const ph = Math.max(20, h - m.t - m.b);
  const maxT = Math.max(0.5, ...bands.map((b) => Math.max(b.sabineClamped, b.eyringClamped, (measured && measured[b.band] && measured[b.band].t30) || 0) * 1.15));

  ctx.strokeStyle = p.line;
  ctx.fillStyle = p.faint;
  ctx.font = font10();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = (maxT * i) / yTicks;
    const y = m.t + (1 - i / yTicks) * ph;
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
    ctx.fillText(v.toFixed(1), m.l - 6, y);
  }
  ctx.strokeStyle = p.soft;
  ctx.strokeRect(m.l, m.t, pw, ph);

  const groupW = pw / bands.length;
  const barW = Math.min(22, (groupW - 24) / 3);
  const colors = [p.accent, p.clay, p.teal];
  bands.forEach((b, i) => {
    const vals = [b.sabineClamped, b.eyringClamped, (measured && measured[b.band] && measured[b.band].t30) || 0];
    const base = m.l + i * groupW + groupW / 2;
    vals.forEach((v, vi) => {
      const bh = Math.max(0, Math.min(v, maxT) / maxT) * ph;
      ctx.fillStyle = colors[vi];
      ctx.globalAlpha = vi === 2 ? 0.85 : 1;
      ctx.fillRect(base + (vi - 1) * (barW + 5) - barW / 2, m.t + ph - bh, barW, bh);
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle = p.soft;
    ctx.font = font10();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(b.frequency >= 1000 ? (b.frequency / 1000) + ' kHz' : b.frequency + ' Hz', base, m.t + ph + 6);
  });
  ctx.fillStyle = p.faint;
  ctx.fillText('octave band', m.l + pw / 2, h - 4);

  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(it.x, it.y - 5, 10, 10);
    ctx.fillStyle = p.faint;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.label, it.x + 15, it.y);
  }
}
