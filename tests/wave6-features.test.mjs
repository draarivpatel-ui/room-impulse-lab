/* Wave-6 feature tests: the interactive SVG ray plan (driven through a tiny
 * DOM stub so it runs in Node), new-control wiring between index.html and
 * src/app.js, and integrity checks on the new page surface.
 * Run: node --test tests/wave6-features.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate } from '../src/sim.js';
import { DEFAULT_ROOM } from '../src/acoustics.js';
import { planPaths } from '../src/raypath.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const APP = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
const SIM = simulate(DEFAULT_ROOM);

/* ---------------- minimal DOM stub ---------------- */

class StubNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.textContent = '';
    this.namespaceURI = 'stub-svg-ns';
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  append(...kids) { this.children.push(...kids); }
  appendChild(k) { this.children.push(k); return k; }
  replaceChildren(...kids) { this.children = [...kids]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, ev = {}) { for (const fn of this.listeners[type] || []) fn(ev); }
  queryAll(pred, out = []) {
    if (pred(this)) out.push(this);
    for (const c of this.children) c.queryAll(pred, out);
    return out;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 420 }; }
}

function withStubDom(fn) {
  const g = globalThis;
  const prevDoc = g.document, prevWin = g.window;
  const winListeners = {};
  g.document = { createElementNS: (ns, tag) => new StubNode(tag) };
  g.window = { addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); } };
  try { return fn(winListeners); }
  finally { g.document = prevDoc; g.window = prevWin; }
}

const countTag = (svg, tag) => svg.queryAll((n) => n.tagName === tag).length;
const byClass = (svg, frag) => svg.queryAll((n) => (n.attributes.class || '').includes(frag));
const byClassToken = (svg, token) => svg.queryAll((n) => (n.attributes.class || '').split(' ').includes(token));

/* ---------------- renderRayPlan ---------------- */

const { renderRayPlan } = await import('../src/raysvg.js');

test('renderRayPlan paints a path element for every plan path', () => {
  withStubDom(() => {
    const svg = new StubNode('svg');
    renderRayPlan(svg, SIM.config, SIM.paths);
    const plans = planPaths(SIM.config.dims, SIM.config.source, SIM.config.listener, SIM.paths, 2);
    const paths = svg.queryAll((n) => n.tagName === 'path' && (n.attributes.d || '').startsWith('M'));
    assert.equal(paths.length, plans.length);
    assert.ok(plans.length >= 4, 'expected direct + first + second order paths');
  });
});

test('renderRayPlan marks bounce points on the wall frame', () => {
  withStubDom(() => {
    const svg = new StubNode('svg');
    renderRayPlan(svg, SIM.config, SIM.paths);
    const bounces = byClass(svg, 'ray-bounce');
    const plans = planPaths(SIM.config.dims, SIM.config.source, SIM.config.listener, SIM.paths, 2);
    const expected = plans.reduce((n, p) => n + p.bounces.length, 0);
    assert.equal(bounces.length, expected);
    assert.ok(expected > 0);
  });
});

test('renderRayPlan draws one direct, first-order and second-order layer group', () => {
  withStubDom(() => {
    const svg = new StubNode('svg');
    renderRayPlan(svg, SIM.config, SIM.paths);
    assert.equal(byClass(svg, 'ray-group-direct').length, 1);
    assert.equal(byClass(svg, 'ray-group-order1').length, 1);
    assert.equal(byClass(svg, 'ray-group-order2').length, 1);
    assert.equal(byClass(svg, 'ray-direct').filter((n) => n.tagName === 'path').length, 1);
  });
});

test('renderRayPlan draws the room rect and four wall labels', () => {
  withStubDom(() => {
    const svg = new StubNode('svg');
    renderRayPlan(svg, SIM.config, SIM.paths);
    const room = byClass(svg, 'ray-room');
    assert.equal(room.length, 1);
    assert.equal(byClass(svg, 'ray-wall-label').length, 4);
  });
});

test('handles expose slider role, labels and keyboard wiring', () => {
  withStubDom(() => {
    const svg = new StubNode('svg');
    renderRayPlan(svg, SIM.config, SIM.paths);
    const handles = byClassToken(svg, 'ray-handle');
    assert.equal(handles.length, 2);
    for (const h of handles) {
      assert.equal(h.attributes.role, 'slider');
      assert.equal(h.attributes.tabindex, '0');
      assert.match(h.attributes['aria-label'], /Drag or use arrow keys/);
      assert.ok(h.listeners.keydown?.length >= 1);
      assert.ok(h.listeners.pointerdown?.length >= 1);
    }
  });
});

test('arrow keys nudge the source through onMove and clamp to the room', () => {
  withStubDom(() => {
    const svg = new StubNode('svg');
    const moves = [];
    renderRayPlan(svg, SIM.config, SIM.paths, { onMove: (w, pt) => moves.push([w, pt]) });
    const src = byClassToken(svg, 'ray-handle-source')[0];
    src.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
    src.dispatch('keydown', { key: 'ArrowUp', shiftKey: true, preventDefault() {} });
    assert.equal(moves.length, 2);
    assert.equal(moves[0][0], 'source');
    assert.ok(Math.abs(moves[0][1].x - (SIM.config.source.x + 0.1)) < 1e-9);
    assert.ok(Math.abs(moves[1][1].y - (SIM.config.source.y - 0.5)) < 1e-9);
    // Unhandled keys are ignored.
    src.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    assert.equal(moves.length, 2);
  });
});

test('pointer drag routes window-level moves through onMove once', () => {
  withStubDom((win) => {
    const svg = new StubNode('svg');
    const moves = [];
    renderRayPlan(svg, SIM.config, SIM.paths, { onMove: (w, pt) => moves.push([w, pt]) });
    const listener = byClassToken(svg, 'ray-handle-listener')[0];
    listener.dispatch('pointerdown', { preventDefault() {}, stopPropagation() {} });
    for (const fn of win.pointermove || []) fn({ clientX: 320, clientY: 210 });
    for (const fn of win.pointerup || []) fn({});
    assert.equal(moves.length, 1);
    assert.equal(moves[0][0], 'listener');
    assert.ok(moves[0][1].x >= 0 && moves[0][1].x <= SIM.config.dims.x);
    assert.ok(moves[0][1].y >= 0 && moves[0][1].y <= SIM.config.dims.y);
    // After pointerup, further moves are ignored.
    for (const fn of win.pointermove || []) fn({ clientX: 10, clientY: 10 });
    assert.equal(moves.length, 1);
  });
});

test('repeat renders do not stack window listeners', () => {
  withStubDom((win) => {
    const svg = new StubNode('svg');
    renderRayPlan(svg, SIM.config, SIM.paths);
    renderRayPlan(svg, SIM.config, SIM.paths);
    renderRayPlan(svg, SIM.config, SIM.paths);
    assert.equal((win.pointermove || []).length, 1);
    assert.equal((win.pointerup || []).length, 1);
  });
});

test('renderRayPlan tolerates a missing svg or config', () => {
  withStubDom(() => {
    assert.doesNotThrow(() => renderRayPlan(null, SIM.config, SIM.paths));
    assert.doesNotThrow(() => renderRayPlan(new StubNode('svg'), null, SIM.paths));
    assert.doesNotThrow(() => renderRayPlan(new StubNode('svg'), {}, SIM.paths));
  });
});

test('re-render clears the previous frame instead of appending', () => {
  withStubDom(() => {
    const svg = new StubNode('svg');
    renderRayPlan(svg, SIM.config, SIM.paths);
    const first = countTag(svg, 'path');
    renderRayPlan(svg, SIM.config, SIM.paths);
    assert.equal(countTag(svg, 'path'), first);
  });
});

/* ---------------- new-control wiring ---------------- */

const htmlIds = new Set([...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test('every wave-6 element id exists in the page', () => {
  for (const id of [
    'ray-svg', 'clarity-body', 'ansi-card', 'ansi-badge', 'ansi-detail', 'ansi-note',
    'ab-compare', 'ab-status', 'run-selftests', 'selftest-summary', 'selftest-list',
    'export-clarity', 'export-ansi', 'export-report', 'report-sha'
  ]) {
    assert.ok(htmlIds.has(id), id + ' missing from index.html');
  }
});

test('wave-6 buttons are bound in the controller', () => {
  for (const id of ['ab-compare', 'run-selftests', 'export-clarity', 'export-ansi', 'export-report']) {
    assert.ok(APP.includes(`$('${id}').addEventListener`), id + ' not bound');
  }
});

test('the ray plan renderer is invoked from the app with an onMove callback', () => {
  assert.match(APP, /renderRayPlan\(/);
  assert.match(APP, /onMove/);
});

test('the app decodes a bookmark hash before first render', () => {
  assert.match(APP, /decodeState\(/);
  assert.match(APP, /location\.hash/);
});

test('the app writes the report fingerprint into the page', () => {
  assert.match(APP, /report-sha/);
  assert.match(APP, /fingerprintSha256/);
});

test('self-test results render through DOM APIs, not string HTML', () => {
  const block = APP.match(/runSelfTests[\s\S]*?selftest-list[\s\S]*?(?=\n  function|\n})/);
  assert.ok(block, 'self-test render block not found');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(block[0]));
});

/* ---------------- page markers and hygiene ---------------- */

test('the new UI markers a deploy check can grep for exist in index.html', () => {
  for (const marker of ['ANSI S12.60', 'C50', 'ray-svg', 'selftest', 'SHA-256']) {
    assert.ok(HTML.includes(marker), 'missing marker ' + marker);
  }
});

test('the favicon is still an inline data URI (zero favicon requests)', () => {
  assert.match(HTML, /<link[^>]+rel="icon"[^>]+href="data:/);
});

test('no new module reaches for the network', () => {
  for (const f of ['clarity.js', 'raypath.js', 'raysvg.js', 'sha256.js', 'report.js', 'urlstate.js', 'selftest.js']) {
    const src = readFileSync(join(ROOT, 'src', f), 'utf8');
    for (const bad of ['fetch(', 'XMLHttpRequest', 'new Image(', 'import(']) {
      assert.ok(!src.includes(bad), bad + ' in ' + f);
    }
  }
});

test('simulate() exposes the clarity and ANSI results the UI renders', () => {
  assert.ok(SIM.clarity && Array.isArray(SIM.clarity.bands));
  assert.ok(SIM.ansi && ['PASS', 'FAIL', 'SCOPE'].includes(SIM.ansi.verdict));
  assert.ok('broadband' in SIM.clarity);
  assert.ok('c50' in SIM.clarity.broadband);
  assert.ok('t30' in SIM.clarity.broadband);
});
