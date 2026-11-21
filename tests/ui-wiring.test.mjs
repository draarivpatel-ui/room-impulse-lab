/* Static cross-checks between index.html and src/app.js: every element id the
 * controller reaches for must exist, every listener must bind to a real node,
 * and every download/toast path must be wired. Catches rename drift that unit
 * tests of the pure engine cannot see. Run: node --test tests/ui-wiring.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const APP = readFileSync(join(ROOT, 'src/app.js'), 'utf8');

const htmlIds = new Set([...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const appIds = new Set([...APP.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const dynamicIds = new Set([...APP.matchAll(/\$\('([^']+)' \+ [a-zA-Z]+\)/g)].map((m) => m[1]));

test('every literal element id used by the controller exists in the page', () => {
  const missing = [...appIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], 'missing ids: ' + missing.join(', '));
});

test('templated ids resolve to real markup', () => {
  // $('mat-' + id) must match the six material selects.
  assert.ok(dynamicIds.has('mat-'));
  for (const s of ['xMin', 'xMax', 'yMin', 'yMax', 'floor', 'ceiling']) {
    assert.ok(htmlIds.has('mat-' + s), 'mat-' + s);
  }
});

test('every control listed for change wiring exists', () => {
  const wireList = APP.match(/const ids = \[([\s\S]*?)\];/)[1];
  const listed = [...wireList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const id of listed) {
    if (id === 'mat-') continue; // template prefix, covered by the templated-id test
    assert.ok(htmlIds.has(id), 'wired id missing: ' + id);
  }
});

test('every export button exists and is bound in the controller', () => {
  for (const id of ['export-wav', 'export-rt60', 'export-paths', 'export-json']) {
    assert.ok(htmlIds.has(id), id + ' missing from HTML');
    assert.ok(APP.includes(`$('${id}').addEventListener`), id + ' not bound');
  }
});

test('every audio button exists and is bound in the controller', () => {
  for (const id of ['play-sweep', 'play-ir', 'auralize', 'hear-room']) {
    assert.ok(htmlIds.has(id), id + ' missing from HTML');
    assert.ok(APP.includes(`$('${id}').addEventListener`), id + ' not bound');
  }
});

test('all canvas and table render targets exist', () => {
  for (const id of ['plan-canvas', 'wave-canvas', 'decay-canvas', 'bands-canvas', 'rt60-body', 'path-body']) {
    assert.ok(htmlIds.has(id), id + ' missing');
  }
});

test('every button in the page declares a type', () => {
  const bad = [...HTML.matchAll(/<button(?![^>]*\btype=)[^>]*>/g)];
  assert.equal(bad.length, 0, 'buttons without type: ' + bad.length);
});

test('no eyebrow, kicker or tagline elements surround the title', () => {
  for (const bad of ['kicker', 'eyebrow', 'tagline', 'subtitle', 'hero-sub']) {
    assert.ok(!new RegExp(bad, 'i').test(HTML), bad + ' found');
  }
});

test('decorative glyphs inside controls are hidden from assistive tech', () => {
  const spans = [...HTML.matchAll(/<button[\s\S]*?<span([^>]*)>/g)];
  for (const s of spans) assert.ok(/aria-hidden="true"/.test(s[1]), 'glyph not hidden');
});

test('table headers declare a column scope', () => {
  const heads = [...HTML.matchAll(/<th\b[^>]*>/g)];
  assert.ok(heads.length >= 10, 'expected header cells');
  for (const h of heads) assert.ok(/scope="col"/.test(h[0]), 'th without scope: ' + h[0]);
});

test('the page loads exactly the local stylesheet and module', () => {
  assert.ok(HTML.includes('href="styles.css"'));
  assert.ok(HTML.includes('src="src/app.js"'));
  assert.ok(!/src="http|href="http/.test(HTML));
});

test('no inline styles ship in the markup', () => {
  assert.ok(!/style="/.test(HTML), 'inline style attribute found');
});

test('meta description is present and honest', () => {
  const m = HTML.match(/<meta name="description" content="([^"]+)"/);
  assert.ok(m && m[1].length > 40, 'description missing');
});
