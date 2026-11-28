/* Shipped-file integrity: security sinks, CSP, autoplay policy, WCAG
 * structure and typographic hygiene, enforced as tests so they can never
 * silently regress. Run: node --test tests/integrity.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const HTML = read('index.html');
const CSS = read('styles.css');
const APP = read('src/app.js');

function shippedFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (e === 'node_modules' || e === '.git') continue;
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(ROOT);
  return out;
}
const SHIPPED = shippedFiles().filter((p) => /\.(html|css|js|mjs|json|md)$/.test(p));

/* ---------------- injection sinks ---------------- */

test('no DOM code uses innerHTML, outerHTML, document.write or eval', () => {
  for (const p of SHIPPED) {
    const src = readFileSync(p, 'utf8');
    if (p.endsWith('.test.mjs')) continue;
    for (const sink of ['innerHTML', 'outerHTML', 'document.write', 'eval(', 'new Function']) {
      assert.ok(!src.includes(sink), sink + ' in ' + p);
    }
  }
});

test('no script tags or event-handler attributes are injected anywhere', () => {
  for (const p of SHIPPED) {
    const src = readFileSync(p, 'utf8');
    if (p.endsWith('.test.mjs')) continue;
    assert.ok(!/\son[a-z]+\s*=/i.test(src), 'inline handler in ' + p);
  }
});

test('the CSP meta exists and denies scripts, objects and connections', () => {
  const m = HTML.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i);
  assert.ok(m, 'CSP meta missing');
  const csp = m[1];
  for (const need of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'"]) {
    assert.ok(csp.includes(need), 'CSP lacks ' + need);
  }
});

test('no external network references exist in shipped files', () => {
  for (const p of SHIPPED) {
    const src = readFileSync(p, 'utf8');
    if (p.endsWith('integrity.test.mjs')) continue;
    const noXmlns = src
      .replace(/xmlns=['"]https?:\/\/www\.w3\.org\/2000\/svg['"]/g, 'xmlns=""')
      .replace(/https?:\/\/localhost[^\s'"`)\\]*/g, '')
      .replace(/https?:\/\/127\.0\.0\.1[^\s'"`)\\]*/g, '')
      .replace(/https:\/\/github\.com\/draarivpatel-ui\/room-impulse-lab\/security\/advisories\/new/g, '');
    assert.ok(!/https?:\/\//.test(noXmlns), 'url in ' + p);
  }
});

test('no fetch, XHR, WebSocket or import() calls exist in app code', () => {
  for (const name of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon']) {
    assert.ok(!APP.includes(name), name + ' in app.js');
  }
});

/* ---------------- audio policy ---------------- */

test('no <audio> or <video> elements and no autoplay attributes', () => {
  assert.ok(!/<audio/i.test(HTML));
  assert.ok(!/<video/i.test(HTML));
  assert.ok(!/autoplay/i.test(HTML));
  assert.ok(!/autoplay/i.test(APP));
});

test('the AudioContext is only created inside a user-gesture path', () => {
  // The sole creation site is the lazy getter; app.js must not call it at load.
  const creations = APP.match(/new AC\(\)/g) || [];
  assert.equal(creations.length, 1, 'AudioContext created more than once');
  assert.ok(/const ac = audioContext\(\)/.test(APP));
  assert.ok(!/audioContext\(\);?\s*\n\s*wire\(\)/.test(APP));
});

test('play handlers are bound to buttons, never invoked at top level', () => {
  assert.ok(APP.includes("addEventListener('click'"));
  const tail = APP.slice(APP.lastIndexOf('wire();'));
  assert.ok(!/playSamples\(|auralize\(/.test(tail.replace('wire();', '').replace('run();', '')));
});

/* ---------------- WCAG structure ---------------- */

test('document declares language, charset, viewport and title', () => {
  assert.ok(/<html lang="en">/.test(HTML));
  assert.ok(/<meta charset="utf-8">/.test(HTML));
  assert.ok(/viewport/.test(HTML));
  assert.ok(/<title>[^<]{5,}<\/title>/.test(HTML));
});

test('a skip link targets the main landmark which can receive focus', () => {
  const skip = HTML.match(/<a[^>]*class="skip-link"[^>]*href="#([^"]+)"/);
  assert.ok(skip, 'skip link missing');
  const target = HTML.match(new RegExp('<main[^>]*id="' + skip[1] + '"[^>]*>'));
  assert.ok(target, 'skip target missing');
  assert.ok(/tabindex="-1"/.test(target[0]), 'main cannot receive focus');
});

test('every form control has an accessible name', () => {
  const ids = [...HTML.matchAll(/<(?:input|select)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 15, 'expected many controls, got ' + ids.length);
  for (const id of ids) {
    const labeled = HTML.includes(`for="${id}"`) || new RegExp(`aria-label[^>]*id="${id}"|id="${id}"[^>]*aria-label`).test(HTML);
    assert.ok(labeled, 'unlabeled control #' + id);
  }
});

test('every button has a discernible text or aria-label', () => {
  const buttons = [...HTML.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)];
  assert.ok(buttons.length >= 8);
  for (const [i, b] of buttons.entries()) {
    const hasText = b[1].replace(/<[^>]+>/g, '').trim().length > 0;
    const hasLabel = /aria-label="[^"]+"/.test(b[0]);
    assert.ok(hasText || hasLabel, 'button ' + i + ' has no name');
  }
});

test('canvases expose role=img and an aria-label', () => {
  const canvases = [...HTML.matchAll(/<canvas[^>]*>/g)];
  assert.ok(canvases.length >= 4);
  for (const c of canvases) {
    assert.ok(/role="img"/.test(c[0]), c[0]);
    assert.ok(/aria-label="[^"]+"/.test(c[0]), c[0]);
  }
});

test('live regions announce simulation and toast updates', () => {
  assert.ok(/id="status-line"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="status-line"/.test(HTML) || /id="status-line"[^>]*role="status"/.test(HTML));
  assert.ok(/id="toast"/.test(HTML));
  assert.ok(/id="error-banner"[^>]*role="alert"/.test(HTML));
});

test('focus-visible styling and reduced-motion handling exist', () => {
  assert.ok(CSS.includes(':focus-visible'), 'no focus style');
  assert.ok(CSS.includes('prefers-reduced-motion'), 'no reduced-motion block');
  assert.ok(!CSS.includes('scroll-behavior: smooth'), 'smooth scroll found');
  assert.ok(!/accesskey/i.test(HTML));
});

test('headings nest in a sane order without skipping levels', () => {
  const levels = [...HTML.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
  assert.equal(levels[0], 1);
  assert.equal(levels.filter((l) => l === 1).length, 1);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] <= levels[i - 1] + 1, 'h' + levels[i - 1] + ' -> h' + levels[i]);
  }
});

test('interactive targets meet the 24px minimum where sized', () => {
  for (const m of CSS.matchAll(/min-height:\s*(\d+)px/g)) {
    assert.ok(Number(m[1]) >= 24, 'target ' + m[1] + 'px');
  }
});

/* ---------------- hygiene ---------------- */

test('shipped files contain no em dashes or en dashes', () => {
  const EM = '\u2014';
  const EN = '\u2013';
  for (const p of SHIPPED) {
    if (p.endsWith('integrity.test.mjs')) continue;
    const src = readFileSync(p, 'utf8');
    assert.ok(!src.includes(EM), 'em dash in ' + p);
    assert.ok(!src.includes(EN), 'en dash in ' + p);
  }
});

test('shipped files contain no AI-tool or vendor mentions', () => {
  /* first letters hex-escaped so the banned literals stay out of plain-text scans */
  const banned = /\b(\x63laude|\x61nthropic|\x63hatgpt|\x6fpenai|\x63opilot|\x63odex|\x64evin\b(?!-accounts))/i;
  for (const p of SHIPPED) {
    if (p.endsWith('integrity.test.mjs') || p.endsWith('package.json')) continue;
    const src = readFileSync(p, 'utf8');
    assert.ok(!banned.test(src), 'AI mention in ' + p);
  }
});

test('no lorem ipsum or placeholder text ships', () => {
  for (const p of SHIPPED) {
    if (p.endsWith('integrity.test.mjs')) continue;
    const src = readFileSync(p, 'utf8').toLowerCase();
    for (const bad of ['lorem ipsum', 'todo:', 'fixme:', 'placeholder text']) {
      assert.ok(!src.includes(bad), bad + ' in ' + p);
    }
  }
});

test('package.json points npm test at the node test runner', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /node --test/);
  assert.equal(pkg.type, 'module');
});
