/* Interactive ray-bounce plan rendered as live SVG. Pure ES module; no DOM
 * outside the supplied svg element, so the geometry core stays Node-testable
 * through raypath.js. Source and listener handles drag (pointer) and nudge
 * (arrow keys); movement is reported through opts.onMove so the app owns all
 * state. Styling lives in styles.css classes, keeping light/dark themes. */

import { planPaths } from './raypath.js';
import { materialById } from './acoustics.js';

const VB_W = 640;
const VB_H = 420;

const WALL_EDGES = [
  { id: 'xMin', edge: 'left' }, { id: 'xMax', edge: 'right' },
  { id: 'yMin', edge: 'top' }, { id: 'yMax', edge: 'bottom' }
];

function el(svg, tag, attrs) {
  const node = document.createElementNS(svg.namespaceURI, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  return node;
}

/**
 * Render the top-down ray plan into `svg`.
 * config: { dims, source, listener, materials }; paths: sim.paths.
 * opts.onMove(which:'source'|'listener', {x, y}) is called while dragging.
 */
export function renderRayPlan(svg, config, paths, opts = {}) {
  if (!svg || !config || !config.dims) return;
  const { dims, source, listener } = config;
  svg.replaceChildren();
  svg.setAttribute('viewBox', '0 0 ' + VB_W + ' ' + VB_H);

  const m = { l: 40, r: 18, t: 20, b: 34 };
  const pw = Math.max(60, VB_W - m.l - m.r);
  const ph = Math.max(60, VB_H - m.t - m.b);
  const scale = Math.min(pw / dims.x, ph / dims.y);
  const ox = m.l + (pw - dims.x * scale) / 2;
  const oy = m.t + (ph - dims.y * scale) / 2;
  const px = (pt) => ({ x: ox + pt.x * scale, y: oy + pt.y * scale });

  // Axis meter ticks, matching the canvas plan view.
  const ticks = el(svg, 'g', { class: 'ray-ticks' });
  const stepX = Math.max(1, Math.round(dims.x / 6));
  for (let x = 0; x <= dims.x + 1e-9; x += stepX) {
    const t = el(svg, 'text', { x: ox + x * scale, y: oy + dims.y * scale + 16, 'text-anchor': 'middle' });
    t.textContent = String(Math.round(x * 10) / 10);
    ticks.append(t);
  }
  const stepY = Math.max(1, Math.round(dims.y / 4));
  for (let y = 0; y <= dims.y + 1e-9; y += stepY) {
    const t = el(svg, 'text', { x: ox - 8, y: oy + y * scale + 3, 'text-anchor': 'end' });
    t.textContent = String(Math.round(y * 10) / 10);
    ticks.append(t);
  }
  svg.append(ticks);

  // Bounce paths, deepest order first so the direct ray sits on top.
  const plans = planPaths(dims, source, listener, paths, 2);
  const groupOrder = { 2: 'ray-path ray-order2', 1: 'ray-path ray-order1', 0: 'ray-path ray-direct' };
  for (const cls of ['ray-path ray-order2', 'ray-path ray-order1', 'ray-path ray-direct']) {
    const g = el(svg, 'g', { class: cls === 'ray-path ray-order2' ? 'ray-group-order2' : cls === 'ray-path ray-order1' ? 'ray-group-order1' : 'ray-group-direct' });
    for (const plan of plans) {
      if (groupOrder[plan.path.order] !== cls) continue;
      const d = plan.polyline.map((p, i) => {
        const q = px(p);
        return (i === 0 ? 'M' : 'L') + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
      }).join(' ');
      g.append(el(svg, 'path', { d, class: cls, fill: 'none' }));
      if (plan.path.order > 0) {
        for (const b of plan.bounces) {
          const q = px(b.point);
          g.append(el(svg, 'circle', { cx: q.x, cy: q.y, r: 3, class: 'ray-bounce ray-bounce-' + plan.path.order }));
        }
      }
    }
    svg.append(g);
  }

  // Room frame and per-edge material labels.
  const room = el(svg, 'rect', { x: ox, y: oy, width: dims.x * scale, height: dims.y * scale, class: 'ray-room' });
  svg.append(room);
  const labelPos = {
    xMin: { x: ox - 4, y: oy + dims.y * scale / 2, anchor: 'end' },
    xMax: { x: ox + dims.x * scale + 4, y: oy + dims.y * scale / 2, anchor: 'start' },
    yMin: { x: ox + dims.x * scale / 2, y: oy - 6, anchor: 'middle' },
    yMax: { x: ox + dims.x * scale / 2, y: oy + dims.y * scale + 26, anchor: 'middle' }
  };
  const mats = config.materials || {};
  for (const w of WALL_EDGES) {
    const p = labelPos[w.id];
    const t = el(svg, 'text', { x: p.x, y: p.y, 'text-anchor': p.anchor, class: 'ray-wall-label' });
    t.textContent = materialById(mats[w.id]).label;
    svg.append(t);
  }

  // Legend.
  const legend = el(svg, 'g', { class: 'ray-legend' });
  const items = [
    ['ray-direct', 'direct'], ['ray-order1', '1st order'], ['ray-order2', '2nd order']
  ];
  items.forEach(([cls, label], i) => {
    const y = m.t + 4 + i * 15;
    legend.append(el(svg, 'line', { x1: VB_W - m.r - 78, y1: y - 4, x2: VB_W - m.r - 62, y2: y - 4, class: 'ray-path ' + cls }));
    const t = el(svg, 'text', { x: VB_W - m.r - 56, y, class: 'ray-legend-text' });
    t.textContent = label;
    legend.append(t);
  });
  svg.append(legend);

  // Drag handles. Pointer position -> room coordinates. The window-level
  // listeners bind once per svg element so repeat renders never stack them.
  const state = svg._rayDrag || (svg._rayDrag = { drag: null, dims, ox, oy, scale, onMove: opts.onMove });
  state.dims = dims; state.ox = ox; state.oy = oy; state.scale = scale;
  state.onMove = opts.onMove;
  if (!svg._rayWired) {
    svg._rayWired = true;
    window.addEventListener('pointermove', (ev) => {
      const st = svg._rayDrag;
      if (!st || !st.drag) return;
      const rect = svg.getBoundingClientRect();
      const sx = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * VB_W;
      const sy = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * VB_H;
      if (typeof st.onMove === 'function') {
        st.onMove(st.drag, {
          x: Math.min(st.dims.x, Math.max(0, (sx - st.ox) / st.scale)),
          y: Math.min(st.dims.y, Math.max(0, (sy - st.oy) / st.scale))
        });
      }
    }, { passive: true });
    window.addEventListener('pointerup', () => {
      if (svg._rayDrag) svg._rayDrag.drag = null;
    }, { passive: true });
  }
  const move = (which, pt) => { if (typeof opts.onMove === 'function') opts.onMove(which, pt); };

  const handle = (which, pos, cls) => {
    const q = px(pos);
    const g = el(svg, 'g', {
      class: 'ray-handle ' + cls, tabindex: '0', role: 'slider',
      'aria-label': which + ' at x ' + pos.x.toFixed(2) + ' m, y ' + pos.y.toFixed(2) + ' m. Drag or use arrow keys.'
    });
    g.append(el(svg, 'circle', { cx: q.x, cy: q.y, r: 9, class: 'ray-handle-ring' }));
    g.append(el(svg, 'circle', { cx: q.x, cy: q.y, r: 5.5, class: 'ray-handle-dot' }));
    const t = el(svg, 'text', { x: q.x + 13, y: q.y - 9, class: 'ray-handle-label' });
    t.textContent = which === 'source' ? 'source' : 'listener';
    g.append(t);
    g.addEventListener('pointerdown', (ev) => {
      state.drag = which;
      ev.preventDefault();
      ev.stopPropagation();
    });
    g.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 0.5 : 0.1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (!d) return;
      ev.preventDefault();
      const base = which === 'source' ? source : listener;
      move(which, {
        x: Math.min(dims.x, Math.max(0, base.x + d[0])),
        y: Math.min(dims.y, Math.max(0, base.y + d[1]))
      });
    });
    return g;
  };
  svg.append(handle('source', source, 'ray-handle-source'));
  svg.append(handle('listener', listener, 'ray-handle-listener'));
}
