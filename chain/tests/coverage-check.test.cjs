const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collect, check, ratio } = require('../scripts/check-coverage.cjs');
const example = {
  '/tmp/BirdSubscription.sol': {
    s: { '1': 2, '2': 3 }, f: { '1': 1 }, b: { '1': [1, 2] },
    statementMap: { '1': { start: { line: 10 } }, '2': { start: { line: 11 } } }
  }
};
test('coverage threshold checker accepts truly executed branches', () => {
  assert.equal(ratio(0, 0), 100);
  assert.equal(collect(example).statements, 100);
  assert.equal(check(example).branches, 100);
});
test('coverage threshold checker rejects untested code', () => {
  const report = structuredClone(example);
  report['/tmp/BirdSubscription.sol'].b['1'][0] = 0;
  assert.throws(() => check(report), /below 90/);
});
test('coverage checker refuses to report 100% for a missing contract', () => {
  assert.throws(() => collect({}), /missing/);
});
