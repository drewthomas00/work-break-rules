'use strict';

// Each state with a rule, pinned at its boundaries: the shift that just
// triggers it, the break that just satisfies it, and the one that just misses.

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkWorkday, coverage, rulesFor } = require('..');

const DATE = '2026-10-12';
const check = (jurisdiction, start, end, breaks = [], extra = {}) => checkWorkday({ jurisdiction, date: DATE, start, end, breaks, ...extra });
const rules = (r) => r.violations.map((v) => v.rule).sort();
const meal = (start, minutes = 30, extra = {}) => ({ start, minutes, kind: 'meal', ...extra });
const rest = (start, minutes = 10) => ({ start, minutes, kind: 'rest' });

test('California: meal for more than 5 hours, by the end of the 5th', () => {
  assert.deepEqual(rules(check('US-CA', '09:00', '14:00', [rest('11:00')])), []);
  assert.deepEqual(rules(check('US-CA', '09:00', '14:01', [rest('11:00')])), ['meal_missing']);
  assert.deepEqual(rules(check('US-CA', '09:00', '15:30', [meal('14:00'), rest('11:00')])), []);
  assert.deepEqual(rules(check('US-CA', '09:00', '15:30', [meal('14:01'), rest('11:00')])), ['meal_too_late']);
});

test('Colorado: meal for more than 5 hours, not in the first or last hour', () => {
  assert.deepEqual(rules(check('US-CO', '09:00', '15:00', [meal('12:00'), rest('11:00')])), []);
  assert.deepEqual(rules(check('US-CO', '09:00', '15:00', [meal('09:30'), rest('11:00')])), ['meal_too_early']);
  assert.deepEqual(rules(check('US-CO', '09:00', '15:00', [meal('14:15'), rest('11:00')])), ['meal_too_late']);
  assert.deepEqual(rules(check('US-CO', '09:00', '11:00')), []);
  assert.deepEqual(rules(check('US-CO', '09:00', '11:01')), ['rest_missing']);
});

test('Connecticut and Delaware: 7½ hours, after the first 2 and before the last 2', () => {
  for (const s of ['US-CT', 'US-DE']) {
    assert.deepEqual(rules(check(s, '09:00', '16:29')), [], s);
    assert.deepEqual(rules(check(s, '09:00', '17:00', [meal('12:00')])), [], s);
    assert.deepEqual(rules(check(s, '09:00', '17:00', [meal('10:30')])), ['meal_too_early'], s);
    assert.deepEqual(rules(check(s, '09:00', '17:00', [meal('15:00')])), ['meal_too_late'], s);
    assert.deepEqual(rules(check(s, '09:00', '17:00')), ['meal_missing'], s);
  }
});

test('Illinois: 20 minutes for 7½ continuous hours, starting within 5 hours; more every 4½', () => {
  assert.deepEqual(rules(check('US-IL', '09:00', '16:29')), []);
  assert.deepEqual(rules(check('US-IL', '09:00', '16:50', [meal('14:00', 20)])), []);
  assert.deepEqual(rules(check('US-IL', '09:00', '16:50', [meal('14:01', 20)])), ['meal_too_late']);
  assert.deepEqual(rules(check('US-IL', '08:00', '20:40', [meal('12:00', 20), meal('17:00', 20)])), []);
  assert.deepEqual(rules(check('US-IL', '08:00', '20:20', [meal('12:00', 20)])), ['meal_missing']);
});

test('Kentucky: lunch between hour 3 and hour 5 of any shift over 3 hours, and 10 minutes rest per 4 hours', () => {
  assert.deepEqual(rules(check('US-KY', '09:00', '12:00')), []);
  assert.deepEqual(rules(check('US-KY', '09:00', '13:30', [meal('12:00'), rest('10:30')])), []);
  assert.deepEqual(rules(check('US-KY', '09:00', '13:30', [meal('11:30'), rest('10:30')])), ['meal_too_early']);
  assert.deepEqual(rules(check('US-KY', '09:00', '13:30', [rest('10:30')], { waived: ['meal'] })), []);
  assert.deepEqual(rules(check('US-KY', '09:00', '13:30', [meal('12:00')])), ['rest_missing']);
});

test('Maryland: retail only, from 50 retail employees; 15 minutes at 4–6 hours, 30 over 6', () => {
  const big = { facts: { industry: 'retail', retailEmployees: 60, locationEmployees: 12 } };
  assert.deepEqual(rules(check('US-MD', '09:00', '13:00', [], big)), ['rest_missing']);
  assert.deepEqual(rules(check('US-MD', '09:00', '13:00', [rest('11:00', 15)], big)), []);
  assert.deepEqual(rules(check('US-MD', '09:00', '13:00', [], { ...big, waived: ['rest'] })), []);
  assert.deepEqual(rules(check('US-MD', '09:00', '15:31', [meal('12:00')], big)), []);
  assert.deepEqual(rules(check('US-MD', '09:00', '15:31', [rest('11:00', 15)], big)), ['meal_missing']);
  assert.deepEqual(rules(check('US-MD', '08:00', '18:30', [meal('12:00')], big)), ['rest_missing']);
  assert.deepEqual(rules(check('US-MD', '09:00', '15:31', [], { facts: { industry: 'restaurant', retailEmployees: 60, locationEmployees: 12 } })), []);
  assert.deepEqual(rules(check('US-MD', '09:00', '15:31', [], { facts: { industry: 'retail', retailEmployees: 49, locationEmployees: 12 } })), []);
  // A single location with 5 or fewer employees is exempt.
  assert.deepEqual(rules(check('US-MD', '09:00', '15:31', [], { facts: { industry: 'retail', retailEmployees: 60, locationEmployees: 5 } })), []);
});

test('Massachusetts: more than 6 hours', () => {
  assert.deepEqual(rules(check('US-MA', '09:00', '15:00')), []);
  assert.deepEqual(rules(check('US-MA', '09:00', '15:01')), ['meal_missing']);
});

test('Maine and New Hampshire: no more than 6 / 5 consecutive hours without a meal, every stretch', () => {
  assert.deepEqual(rules(check('US-ME', '08:00', '14:00')), []);
  assert.deepEqual(rules(check('US-ME', '08:00', '14:01')), ['meal_missing']);
  assert.deepEqual(rules(check('US-ME', '06:00', '19:30', [meal('12:00')])), ['meal_too_late']);
  assert.deepEqual(rules(check('US-ME', '06:00', '19:30', [meal('12:00'), meal('16:00')])), []);
  assert.deepEqual(rules(check('US-NH', '09:00', '14:00')), []);
  assert.deepEqual(rules(check('US-NH', '09:00', '15:30', [meal('14:01')])), ['meal_too_late']);
  assert.deepEqual(rules(check('US-NH', '09:00', '15:30', [meal('12:00', 30, { onDuty: true })])), []);
});

test('Minnesota: a meal for 6 hours, and 15 minutes rest inside every 4 consecutive hours', () => {
  assert.deepEqual(rules(check('US-MN', '09:00', '12:59')), []);
  assert.deepEqual(rules(check('US-MN', '09:00', '13:00')), ['rest_missing']);
  assert.deepEqual(rules(check('US-MN', '09:00', '13:00', [rest('10:00', 15)])), []);
  // One rest at hour 1 then 5¾ hours with none: the rolling window catches it.
  assert.deepEqual(rules(check('US-MN', '09:00', '16:30', [rest('10:00', 15), meal('12:00')])), ['rest_late']);
  assert.deepEqual(rules(check('US-MN', '09:00', '17:30', [rest('10:30', 15), meal('12:30'), rest('15:00', 15)])), []);
  assert.deepEqual(rules(check('US-MN', '09:00', '15:00', [rest('10:30', 15), rest('13:30', 15)])), ['meal_missing']);
});

test('Nebraska: assembling plants, workshops and mechanical establishments only', () => {
  assert.deepEqual(rules(check('US-NE', '08:00', '16:00', [], { facts: { industry: 'personal_service' } })), []);
  assert.deepEqual(rules(check('US-NE', '08:00', '16:00', [], { facts: { industry: 'manufacturing' } })), ['meal_missing']);
  const unknown = check('US-NE', '08:00', '16:00');
  assert.deepEqual(rules(unknown), ['meal_missing']);
  assert.deepEqual(unknown.assumptions, ['industry', 'wall_clock']);
});

test('Nevada: no 8 continuous hours without a meal; rest per 4 hours or major fraction from 3½; not at a one-person workplace', () => {
  const two = { facts: { locationEmployees: 2 } };
  assert.deepEqual(rules(check('US-NV', '09:00', '16:59', [rest('11:00'), rest('14:00')], two)), []);
  assert.deepEqual(rules(check('US-NV', '09:00', '17:00', [rest('11:00'), rest('14:00')], two)), ['meal_missing']);
  assert.deepEqual(rules(check('US-NV', '09:00', '12:29', [], two)), []);
  assert.deepEqual(rules(check('US-NV', '09:00', '12:30', [], two)), ['rest_missing']);
  assert.deepEqual(rules(check('US-NV', '09:00', '17:00', [], { facts: { locationEmployees: 1 } })), []);
});

test('New York: the noonday, night and evening meals', () => {
  // A shift of more than 6 hours spanning 11–2: 30 minutes inside it.
  assert.deepEqual(rules(check('US-NY', '08:00', '14:00')), []);
  assert.deepEqual(rules(check('US-NY', '08:00', '14:01')), ['meal_missing']);
  assert.deepEqual(rules(check('US-NY', '08:00', '15:30', [meal('12:00')])), []);
  assert.deepEqual(rules(check('US-NY', '08:00', '15:30', [meal('10:30')])), ['meal_outside_hours']);
  assert.deepEqual(rules(check('US-NY', '08:00', '15:30', [meal('13:45')])), ['meal_outside_hours']);
  // A shift starting at 14:00: 45 minutes.
  assert.deepEqual(rules(check('US-NY', '14:00', '21:00', [meal('17:30', 30)])), ['meal_too_short']);
  assert.deepEqual(rules(check('US-NY', '14:00', '21:45', [meal('17:30', 45)])), []);
  // 10:00 to 20:00: noonday meal and 20 minutes between 5 and 7.
  assert.deepEqual(rules(check('US-NY', '10:00', '20:50', [meal('12:30'), meal('17:30', 20)])), []);
  assert.deepEqual(rules(check('US-NY', '10:00', '20:30', [meal('12:30')])), ['meal_missing']);
});

test('North Dakota: more than 5 hours, with 2 or more on duty', () => {
  assert.deepEqual(rules(check('US-ND', '09:00', '14:00', [], { facts: { employeesOnDuty: 2 } })), []);
  assert.deepEqual(rules(check('US-ND', '09:00', '14:01', [], { facts: { employeesOnDuty: 2 } })), ['meal_missing']);
});

test('Oregon: the meal window depends on the shift; rest from just over 2 hours', () => {
  // 6 to 7 hours: after hour 2, finished before hour 5 begins.
  assert.deepEqual(rules(check('US-OR', '09:00', '15:30', [meal('12:30'), rest('10:30'), rest('14:00')])), []);
  assert.deepEqual(rules(check('US-OR', '09:00', '15:30', [meal('12:31'), rest('10:30'), rest('14:00')])), ['meal_too_late']);
  assert.deepEqual(rules(check('US-OR', '09:00', '15:30', [meal('10:59'), rest('10:30'), rest('14:00')])), ['meal_too_early']);
  // More than 7 hours: after hour 3, finished before hour 6 begins.
  assert.deepEqual(rules(check('US-OR', '09:00', '17:30', [meal('12:00'), rest('10:30'), rest('15:00')])), []);
  assert.deepEqual(rules(check('US-OR', '09:00', '17:30', [meal('11:30'), rest('10:30'), rest('15:00')])), ['meal_too_early']);
  assert.deepEqual(rules(check('US-OR', '09:00', '14:59', [rest('11:00')])), []);
  assert.deepEqual(rules(check('US-OR', '09:00', '11:00')), []);
  assert.deepEqual(rules(check('US-OR', '09:00', '11:01')), ['rest_missing']);
});

test('Rhode Island: 20 minutes at 6 hours, 30 at 8, from 3 on the shift', () => {
  const three = { facts: { employeesOnDuty: 3 } };
  assert.deepEqual(rules(check('US-RI', '09:00', '15:20', [meal('12:00', 20)], three)), []);
  assert.deepEqual(rules(check('US-RI', '09:00', '17:20', [meal('12:00', 20)], three)), ['meal_too_short']);
  assert.deepEqual(rules(check('US-RI', '09:00', '17:30', [meal('12:00', 30)], three)), []);
  assert.deepEqual(rules(check('US-RI', '09:00', '17:30', [], { facts: { employeesOnDuty: 2 } })), []);
  assert.deepEqual(rules(check('US-RI', '09:00', '17:30', [], { facts: { employeesOnDuty: 3, industry: 'healthcare' } })), []);
});

test('Tennessee: 6 hours, not in the first hour', () => {
  assert.deepEqual(rules(check('US-TN', '09:00', '14:59')), []);
  assert.deepEqual(rules(check('US-TN', '09:00', '15:30', [meal('09:45')])), ['meal_too_early']);
  assert.deepEqual(rules(check('US-TN', '09:00', '15:30', [meal('12:00')])), []);
});

test('Washington: meal between hour 2 and 5, every 5 hours; rest every 3 hours', () => {
  assert.deepEqual(rules(check('US-WA', '09:00', '12:00')), []);
  assert.deepEqual(rules(check('US-WA', '09:00', '12:01')), ['rest_missing']);
  assert.deepEqual(rules(check('US-WA', '09:00', '15:00', [meal('12:00'), rest('10:30'), rest('13:30')])), []);
  assert.deepEqual(rules(check('US-WA', '09:00', '15:00', [meal('10:30'), rest('10:00'), rest('13:30')])), ['meal_too_early']);
  // A 12-hour shift with one meal at hour 3: more than 5 hours after it.
  assert.deepEqual(rules(check('US-WA', '07:00', '19:30', [meal('10:00'), rest('09:00'), rest('12:00'), rest('15:00'), rest('17:30')])), ['meal_too_late']);
  // A rest at hour 1 and then 4 hours with none: the late rest is owed as 10 minutes' pay.
  const late = check('US-WA', '09:00', '15:00', [meal('12:00'), rest('09:30'), rest('14:30')]);
  assert.deepEqual(rules(late), ['rest_late']);
  assert.deepEqual(late.owed.map((o) => [o.kind, o.minutes]), [['break_time_pay', 10]]);
});

test('West Virginia: 20 minutes for 6 hours; Vermont: a note, nothing checked', () => {
  assert.deepEqual(rules(check('US-WV', '09:00', '15:00')), ['meal_missing']);
  assert.deepEqual(rules(check('US-WV', '09:00', '15:20', [meal('12:00', 20)])), []);
  const vt = check('US-VT', '06:00', '20:00');
  assert.deepEqual(vt.violations, []);
  assert.match(vt.notes[0].note, /reasonable opportunities/);
});

test('coverage: federal law, 50 states and DC, each sourced; a state with no rule says why', () => {
  const { jurisdictions } = coverage();
  assert.equal(jurisdictions.length, 52);
  for (const code of jurisdictions) {
    const e = rulesFor(code);
    if (!e.meals.length && !e.rest && !e.unchecked.length) assert.ok(e.basis && e.basis.citations.length, code);
  }
});
