/* Tests for the shared in-page / Node self-test suite.
 * Run: node --test tests/selftest.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSelfTests } from '../src/selftest.js';

const SUITE = runSelfTests();
const RESULTS = SUITE.results;

test('runSelfTests returns pass/fail counts and a result list', () => {
  assert.equal(typeof SUITE.pass, 'number');
  assert.equal(typeof SUITE.fail, 'number');
  assert.equal(SUITE.pass + SUITE.fail, RESULTS.length);
  assert.ok(RESULTS.length >= 15, 'expected at least 15 checks, got ' + RESULTS.length);
});

test('every self-check reports a name, ok flag and detail string', () => {
  for (const r of RESULTS) {
    assert.equal(typeof r.name, 'string');
    assert.ok(r.name.length > 3);
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.detail, 'string');
  }
});

test('check names are unique', () => {
  const names = RESULTS.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
});

test('all self-tests pass on the shipped engine', () => {
  const failed = RESULTS.filter((r) => !r.ok);
  assert.deepEqual(failed.map((r) => r.name + ': ' + r.detail), []);
});

test('the suite covers the requested domains', () => {
  const text = RESULTS.map((r) => r.name).join(' | ').toLowerCase();
  for (const needle of ['sabine', 'eyring', 'schroeder', 'wav', 'riff', 'monoton']) {
    assert.ok(text.includes(needle), 'missing coverage for ' + needle);
  }
});

test('runSelfTests is deterministic across calls', () => {
  const again = runSelfTests();
  assert.equal(again.results.length, RESULTS.length);
  assert.deepEqual(again.results.map((r) => r.ok), RESULTS.map((r) => r.ok));
  assert.equal(again.fail, SUITE.fail);
});
