/* Tests for the pure-JS SHA-256 used to fingerprint the acoustic report.
 * Run: node --test tests/sha256.test.mjs
 * Expected digests are published FIPS/NIST vectors plus a Node crypto
 * cross-check on awkward inputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, sha256Bytes, sha256HexBytes, utf8Bytes } from '../src/sha256.js';

const nodeSha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/* ---------------- published vectors ---------------- */

test('SHA-256 of the empty string matches the NIST vector', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('SHA-256 of "abc" matches the FIPS 180-4 vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('SHA-256 of the 448-bit "abcdbcde..." vector', () => {
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
});

test('SHA-256 of one million "a" bytes matches the long-message vector', () => {
  assert.equal(
    sha256Hex('a'.repeat(1000000)),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
  );
});

test('SHA-256 of the quick-fox sentence matches the known digest', () => {
  assert.equal(
    sha256Hex('The quick brown fox jumps over the lazy dog'),
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'
  );
});

/* ---------------- UTF-8 encoding ---------------- */

test('utf8Bytes emits ASCII bytes unchanged', () => {
  assert.deepEqual(utf8Bytes('Room'), [82, 111, 111, 109]);
});

test('utf8Bytes encodes two, three and four byte sequences', () => {
  assert.deepEqual(utf8Bytes('é'), [0xc3, 0xa9]);            // U+00E9
  assert.deepEqual(utf8Bytes('€'), [0xe2, 0x82, 0xac]);     // U+20AC
  assert.deepEqual(utf8Bytes('\u{1f3b5}'), [0xf0, 0x9f, 0x8e, 0xb5]); // U+1F3B5 surrogate pair
});

test('utf8Bytes matches the platform TextEncoder', () => {
  const samples = ['', 'a', 'room-impulse-lab', 'café', '€50', 'x\u{1f3b5}y', 'αβγ'];
  for (const s of samples) {
    assert.deepEqual(utf8Bytes(s), [...new TextEncoder().encode(s)], JSON.stringify(s));
  }
});

test('unpaired surrogates do not crash the encoder', () => {
  const b = utf8Bytes('\ud800');
  assert.ok(b.length >= 1 && b.length <= 3);
});

/* ---------------- hex output ---------------- */

test('sha256Hex returns 64 lowercase hex characters', () => {
  const h = sha256Hex('room impulse lab');
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('sha256Bytes returns a 32-byte array of bytes', () => {
  const d = sha256Bytes([97, 98, 99]); // 'abc'
  assert.equal(d.length, 32);
  for (const x of d) assert.ok(Number.isInteger(x) && x >= 0 && x <= 255);
});

test('sha256HexBytes agrees with sha256Hex on equivalent input', () => {
  assert.equal(sha256HexBytes(utf8Bytes('abc')), sha256Hex('abc'));
});

/* ---------------- cross-check against node:crypto ---------------- */

test('sha256Hex agrees with node:crypto on block-boundary lengths', () => {
  // 55/56/63/64/65 bytes straddle the single-block padding edge.
  for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1000]) {
    const s = 'x'.repeat(n);
    assert.equal(sha256Hex(s), nodeSha(s), 'length ' + n);
  }
});

test('sha256Hex agrees with node:crypto on non-ASCII strings', () => {
  for (const s of ['café', 'Ünïcödé', 'αβγδε', '你好世界', 'réverb éèê', '\u{1f3b5}']) {
    assert.equal(sha256Hex(s), nodeSha(s), JSON.stringify(s));
  }
});

test('sha256Hex agrees with node:crypto on JSON report-shaped strings', () => {
  const sample = JSON.stringify({ a: [1, 2, 3], b: { c: 'x', d: null }, e: 0.161 });
  assert.equal(sha256Hex(sample), nodeSha(sample));
});

test('different inputs give different digests', () => {
  assert.notEqual(sha256Hex('room a'), sha256Hex('room b'));
  assert.notEqual(sha256Hex(''), sha256Hex(' '));
});
