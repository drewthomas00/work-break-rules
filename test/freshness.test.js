'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkFreshness, MAX_AGE_DAYS } = require('../scripts/check-freshness');
const { AS_OF } = require('..');

test('fresh up to the limit, stale the day after', () => {
  assert.equal(checkFreshness('2026-01-01', '2026-01-01').ok, true);
  assert.equal(checkFreshness('2026-01-01', '2026-07-03').ok, true); // 183 days
  const stale = checkFreshness('2026-01-01', '2026-07-04');
  assert.equal(stale.ok, false);
  assert.match(stale.message, /184 days ago/);
  assert.equal(MAX_AGE_DAYS, 183);
});

test('an AS_OF in the future is refused, not counted as fresh', () => {
  assert.equal(checkFreshness('2026-01-02', '2026-01-01').ok, false);
});

test('dates must be real calendar dates', () => {
  assert.throws(() => checkFreshness('2026-02-30', '2026-03-01'), /AS_OF must be a real date/);
  assert.throws(() => checkFreshness('2026-1-1', '2026-03-01'), /AS_OF must be a real date/);
  assert.throws(() => checkFreshness('2026-01-01', 'today'), /today must be a real date/);
});

test('the published AS_OF is a real date', () => {
  assert.doesNotThrow(() => checkFreshness(AS_OF, AS_OF));
});
