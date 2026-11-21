/* Room Impulse Lab UI controller. ES module, zero dependencies, offline.
 * Audio policy: no AudioContext is ever created on page load. Every audio
 * path (playback, auralization) exists only inside a real user click. */
import {
  SURFACE_IDS, MATERIALS, materialById
} from './acoustics.js';
import { simulate } from './sim.js';
import { encodeWav, toCsv, rt60Rows, pathRows, exportJson } from './export.js';
import { drawPlan, drawWaveform, drawDecay, drawBands } from './charts.js';

const $ = (id) => document.getElementById(id);
const state = { sim: null, timer: null, actx: null };
const pct = (x) => (x * 100).toFixed(1) + '%';
const num = (x, d = 2) => (Number.isFinite(x) ? Number(x).toFixed(d) : '--');
const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/* ---------- controls ---------- */

function populateMaterials() {
  for (const id of SURFACE_IDS) {
    const sel = $('mat-' + id);
    if (!sel) continue;
    sel.replaceChildren();
    for (const m of MATERIALS) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      sel.append(o);
    }
    sel.value = sel.dataset.default || 'gypsum';
  }
}

function readControls() {
  return {
    dims: {
      x: clampNum($('dim-x').value, 0.5, 60, 6),
      y: clampNum($('dim-y').value, 0.5, 60, 4.5),
      z: clampNum($('dim-z').value, 0.5, 20, 3)
    },
    source: {
      x: clampNum($('src-x').value, 0, 60, 2),
      y: clampNum($('src-y').value, 0, 60, 1.6),
      z: clampNum($('src-z').value, 0, 20, 1.2)
    },
    listener: {
      x: clampNum($('lis-x').value, 0, 60, 4.6),
      y: clampNum($('lis-y').value, 0, 60, 3.2),
      z: clampNum($('lis-z').value, 0, 20, 1.4)
    },
    materials: Object.fromEntries(SURFACE_IDS.map((id) => [id, $('mat-' + id).value])),
    maxOrder: Math.round(clampNum($('order').value, 0, 6, 3)),
    seed: Math.max(1, Math.floor(clampNum($('seed').value, 1, 999999, 7))),
    duration: clampNum($('duration').value, 0.3, 4, 1.5),
    sampleRate: 44100
  };
}

function schedule() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(run, 90);
}

function run() {
  const cfg = readControls();
  const sim = simulate(cfg);
  state.sim = sim.ok ? sim : null;
  if (!sim.ok) {
    showErrors(sim.errors);
    return;
  }
  hideErrors();
  renderAll(sim);
}

function showErrors(errors) {
  const el = $('error-banner');
  el.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = 'Room needs fixing: ';
  el.append(strong, document.createTextNode(errors.join('. ') + '.'));
  el.hidden = false;
  $('rt60-body').replaceChildren();
  $('path-body').replaceChildren();
  for (const id of ['card-eyring1k', 'card-sabine1k', 'card-measured1k', 'card-paths', 'card-mfp', 'card-volume', 'hero-t60', 'hero-paths', 'hero-direct', 'status-line', 'path-note']) {
    const t = $(id);
    if (t) t.textContent = '--';
  }
  for (const id of ['plan-canvas', 'wave-canvas', 'decay-canvas', 'bands-canvas']) {
    const c = $(id);
    const ctx = c && c.getContext ? c.getContext('2d') : null;
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
  }
}

function hideErrors() { $('error-banner').hidden = true; }

/* ---------- rendering ---------- */

function renderAll(sim) {
  const b1k = sim.summary.bands[3];
  $('card-eyring1k').textContent = num(b1k.eyringClamped) + ' s';
  $('card-sabine1k').textContent = num(b1k.sabineClamped) + ' s';
  $('card-measured1k').textContent = num(sim.measured[3].t30) + ' s';
  $('card-paths').textContent = String(sim.stats.imageCount);
  $('card-mfp').textContent = num(sim.summary.meanFreePath) + ' m';
  $('card-volume').textContent = num(sim.summary.volume) + ' m3';

  $('hero-t60').textContent = num(b1k.eyringClamped) + ' s';
  $('hero-paths').textContent = String(sim.stats.imageCount);
  $('hero-direct').textContent = num(sim.stats.directDelayMs, 1) + ' ms';

  renderTable(sim);
  renderPaths(sim);
  renderCharts(sim);
  const alpha = materialById(sim.config.materials.floor).alpha[3];
  $('status-line').textContent =
    'Room ' + num(sim.config.dims.x, 1) + ' x ' + num(sim.config.dims.y, 1) + ' x ' + num(sim.config.dims.z, 1) +
    ' m. Eyring T60 at 1 kHz ' + num(b1k.eyringClamped) + ' s, measured T30 ' + num(sim.measured[3].t30) +
    ' s (R2 ' + num(sim.measured[3].r2, 3) + '). Floor alpha ' + pct(alpha) + ' at 1 kHz.';
}

function renderTable(sim) {
  const tbody = $('rt60-body');
  tbody.replaceChildren();
  sim.summary.bands.forEach((b, i) => {
    const tr = document.createElement('tr');
    const cells = [
      b.frequency >= 1000 ? (b.frequency / 1000) + ' kHz' : b.frequency + ' Hz',
      b.meanAlpha.toFixed(2),
      b.absorptionArea.toFixed(1),
      num(b.sabineClamped),
      num(b.eyringClamped),
      num(b.millingtonClamped),
      num(sim.measured[i].t30)
    ];
    for (const [j, v] of cells.entries()) {
      const td = j === 0 ? document.createElement('th') : document.createElement('td');
      if (j === 0) td.scope = 'row';
      td.textContent = v;
      tr.append(td);
    }
    tbody.append(tr);
  });
}

function renderPaths(sim) {
  const tbody = $('path-body');
  tbody.replaceChildren();
  const shown = sim.paths.slice(0, 15);
  for (const p of shown) {
    const tr = document.createElement('tr');
    const cells = [
      p.order === 0 ? 'direct' : p.path,
      String(p.order),
      (p.delay * 1000).toFixed(1) + ' ms',
      p.distance.toFixed(2) + ' m',
      (p.gains[3] * 100).toFixed(2) + '%'
    ];
    for (const [j, v] of cells.entries()) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    tbody.append(tr);
  }
  $('path-note').textContent = sim.paths.length > shown.length
    ? 'Showing ' + shown.length + ' of ' + sim.paths.length + ' specular paths (direct + ' + sim.stats.imageCount + ' images).'
    : 'All ' + sim.paths.length + ' specular paths.';
}

function renderCharts(sim) {
  drawPlan($('plan-canvas'), sim.config, sim.paths);
  drawWaveform($('wave-canvas'), sim.playback, sim.sampleRate);
  drawDecay($('decay-canvas'), sim.broadband.edc, sim.broadband.t30Fit, sim.sampleRate);
  drawBands($('bands-canvas'), sim.summary, sim.measured);
}

/* ---------- audio (gesture-gated) ---------- */

function audioContext() {
  if (!state.actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    state.actx = new AC();
  }
  if (state.actx.state === 'suspended') state.actx.resume();
  return state.actx;
}

function playSamples(samples, sampleRate, gainValue = 1) {
  const ac = audioContext();
  if (!ac) { toast('Web Audio is not available in this browser.'); return; }
  const buf = ac.createBuffer(1, samples.length, sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) data[i] = samples[i];
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = gainValue;
  src.connect(g).connect(ac.destination);
  src.start();
}

/** Short log-sine sweep used as the dry excitation signal. */
function drySweep(sr, seconds = 0.5) {
  const n = Math.floor(sr * seconds);
  const out = new Float64Array(n);
  const f0 = 60, f1 = 12000;
  const k = Math.log(f1 / f0) / seconds;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 60) * Math.min(1, (seconds - t) * 12);
    out[i] = 0.5 * env * Math.sin((2 * Math.PI * f0 / k) * (Math.exp(k * t) - 1));
  }
  return out;
}

async function auralize() {
  const sim = state.sim;
  if (!sim) return;
  const ac = audioContext();
  if (!ac) { toast('Web Audio is not available in this browser.'); return; }
  const sr = sim.sampleRate;
  const dry = drySweep(sr);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) { toast('Offline rendering unsupported; playing dry sweep.'); playSamples(dry, sr, 0.9); return; }
  const off = new Offline(1, dry.length + sim.playback.length, sr);
  const conv = off.createConvolver();
  const irBuf = off.createBuffer(1, sim.playback.length, sr);
  irBuf.copyToChannel(Float32Array.from(sim.playback), 0);
  conv.buffer = irBuf;
  const dryBuf = off.createBuffer(1, dry.length, sr);
  dryBuf.copyToChannel(Float32Array.from(dry), 0);
  const src = off.createBufferSource();
  src.buffer = dryBuf;
  const g = off.createGain();
  g.gain.value = 0.9;
  src.connect(conv).connect(g).connect(off.destination);
  src.start();
  let rendered;
  try {
    rendered = await off.startRendering();
  } catch {
    toast('Auralization failed in this browser.');
    return;
  }
  playSamples(rendered.getChannelData(0), sr, 0.9);
}

/* ---------- downloads ---------- */

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- wiring ---------- */

function wire() {
  populateMaterials();
  const ids = [
    'dim-x', 'dim-y', 'dim-z', 'src-x', 'src-y', 'src-z',
    'lis-x', 'lis-y', 'lis-z', 'order', 'seed', 'duration',
    ...SURFACE_IDS.map((id) => 'mat-' + id)
  ];
  for (const id of ids) {
    const el = $(id);
    if (el) el.addEventListener('input', schedule);
    if (el) el.addEventListener('change', schedule);
  }
  $('order').addEventListener('input', () => { $('order-value').textContent = $('order').value; });

  $('play-sweep').addEventListener('click', () => {
    const sim = state.sim;
    playSamples(drySweep(sim ? sim.sampleRate : 44100), sim ? sim.sampleRate : 44100, 0.9);
  });
  $('play-ir').addEventListener('click', () => {
    if (state.sim) playSamples(state.sim.playback, state.sim.sampleRate, 0.9);
  });
  $('auralize').addEventListener('click', auralize);
  $('hear-room').addEventListener('click', auralize);

  $('export-wav').addEventListener('click', () => {
    if (!state.sim) return;
    download('room-impulse.wav', encodeWav(state.sim.playback, state.sim.sampleRate), 'audio/wav');
    toast('Impulse response exported as WAV.');
  });
  $('export-rt60').addEventListener('click', () => {
    if (!state.sim) return;
    const measured = state.sim.measured.map((m) => m.t30);
    download('room-rt60.csv', toCsv(rt60Rows(state.sim.summary, measured)), 'text/csv');
    toast('RT60 table exported.');
  });
  $('export-paths').addEventListener('click', () => {
    if (!state.sim) return;
    download('room-paths.csv', toCsv(pathRows(state.sim.paths)), 'text/csv');
    toast('Reflection path table exported.');
  });
  $('export-json').addEventListener('click', () => {
    if (!state.sim) return;
    download('room-model.json', exportJson({
      config: state.sim.config,
      summary: state.sim.summary,
      measured: state.sim.measured.map((m) => m.t30),
      paths: state.sim.paths,
      meta: { pathCount: state.sim.stats.pathCount }
    }), 'application/json');
    toast('Room model exported as JSON.');
  });

  $('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    if (state.sim) renderCharts(state.sim);
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.sim) renderCharts(state.sim); }, 150);
  });
}

wire();
run();
