/* URL-hash bookmarking: serialize the room configuration into a compact,
 * tamper-evident hash fragment so a tuned classroom survives a reload or a
 * shared link. Pure ES module; no DOM access, works in Node tests. */

import { DEFAULT_ROOM, SURFACE_IDS, MATERIALS } from './acoustics.js';

const TAG = 'r1';
const MAT_IDS = new Set(MATERIALS.map((m) => m.id));

/* Cross-platform base64url without Buffer/btoa dependence: UTF-8 encode the
 * JSON, then base64 it from raw bytes. */
function b64encode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) { bytes.push(c); continue; }
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++; }
    }
    if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  const tbl = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], d = bytes[i + 2];
    out += tbl[a >> 2] + tbl[((a & 3) << 4) | ((b ?? 0) >> 4)] +
      (b === undefined ? '=' : tbl[((b & 15) << 2) | ((d ?? 0) >> 6)]) +
      (d === undefined ? '=' : tbl[d & 63]);
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(b64) {
  const tbl = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  // State hashes are unpadded base64url. Reject unknown characters, impossible
  // lengths and non-zero trailing pad bits instead of silently truncating them.
  if (!s || !/^[A-Za-z0-9+/]+$/.test(s) || s.length % 4 === 1) return '';
  const vals = Array.from(s, (ch) => tbl.indexOf(ch));
  if (vals.length % 4 === 2 && (vals[vals.length - 1] & 0x0f) !== 0) return '';
  if (vals.length % 4 === 3 && (vals[vals.length - 1] & 0x03) !== 0) return '';
  const bytes = [];
  for (let i = 0; i < vals.length; i += 4) {
    const a = vals[i], b = vals[i + 1];
    bytes.push((a << 2) | (b >> 4));
    const c = vals[i + 2];
    if (c !== undefined) {
      bytes.push(((b & 15) << 4) | (c >> 2));
      const d = vals[i + 3];
      if (d !== undefined) bytes.push(((c & 3) << 6) | d);
    }
  }
  // Strict UTF-8 decode: malformed continuation bytes, overlong forms,
  // surrogates and out-of-range code points all invalidate the hash.
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) { str += String.fromCharCode(b); continue; }
    let code = 0, need = 0;
    if ((b & 0xe0) === 0xc0) { code = b & 0x1f; need = 1; }
    else if ((b & 0xf0) === 0xe0) { code = b & 0x0f; need = 2; }
    else if ((b & 0xf8) === 0xf0) { code = b & 0x07; need = 3; }
    else return '';
    if (i + need >= bytes.length) return '';
    for (let j = 1; j <= need; j++) {
      const cb = bytes[i + j];
      if ((cb & 0xc0) !== 0x80) return '';
      code = (code << 6) | (cb & 0x3f);
    }
    i += need;
    if ((need === 1 && code < 0x80) || (need === 2 && code < 0x800) || (need === 3 && code < 0x10000)) return '';
    if (code >= 0xd800 && code <= 0xdfff) return '';
    if (code > 0x10ffff) return '';
    if (code > 0xffff) {
      code -= 0x10000;
      str += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else str += String.fromCharCode(code);
  }
  return str;
}

const clampN = (v, lo, hi, fb) => {
  // Missing slots decode as JSON null; treat null/empty as absent, not 0.
  const n = v === null || v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
};

/** Compact wire form: arrays, not objects, keep the hash short. */
export function encodeState(cfg) {
  const c = cfg || {};
  const wire = {
    v: 1,
    d: [c.dims?.x, c.dims?.y, c.dims?.z],
    s: [c.source?.x, c.source?.y, c.source?.z],
    l: [c.listener?.x, c.listener?.y, c.listener?.z],
    m: SURFACE_IDS.map((id) => (c.materials || {})[id]),
    o: c.maxOrder,
    e: c.seed,
    u: c.duration
  };
  return TAG + '.' + b64encode(JSON.stringify(wire));
}

/**
 * Decode a hash string ('#r1.<b64>' or bare 'r1.<b64>') into a config shaped
 * like readControls() output. Returns null for anything malformed rather
 * than trusting untrusted input.
 */
export function decodeState(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h.startsWith(TAG + '.')) return null;
  let wire;
  try {
    wire = JSON.parse(b64decode(h.slice(TAG.length + 1)));
  } catch {
    return null;
  }
  if (!wire || wire.v !== 1 || !Array.isArray(wire.d) || !Array.isArray(wire.m)) return null;
  const B = DEFAULT_ROOM;
  const materials = {};
  wire.m.forEach((id, i) => {
    materials[SURFACE_IDS[i]] = MAT_IDS.has(id) ? id : B.materials[SURFACE_IDS[i]];
  });
  const dims = {
    x: clampN(wire.d[0], 0.5, 60, B.dims.x),
    y: clampN(wire.d[1], 0.5, 60, B.dims.y),
    z: clampN(wire.d[2], 0.5, 20, B.dims.z)
  };
  return {
    dims,
    source: { x: clampN(wire.s && wire.s[0], 0, dims.x, B.source.x), y: clampN(wire.s && wire.s[1], 0, dims.y, B.source.y), z: clampN(wire.s && wire.s[2], 0, dims.z, B.source.z) },
    listener: { x: clampN(wire.l && wire.l[0], 0, dims.x, B.listener.x), y: clampN(wire.l && wire.l[1], 0, dims.y, B.listener.y), z: clampN(wire.l && wire.l[2], 0, dims.z, B.listener.z) },
    materials,
    maxOrder: Math.round(clampN(wire.o, 0, 6, B.maxOrder)),
    seed: Math.max(1, Math.floor(clampN(wire.e, 1, 999999, B.seed))),
    duration: clampN(wire.u, 0.3, 4, B.duration),
    sampleRate: 44100
  };
}
