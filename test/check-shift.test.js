'use strict';

// The engine: how a shift's breaks are placed in hours worked, how a meal rule
// finds the meal that satisfies it, what a waiver or a fact changes, and how
// rest breaks are counted. Each state is pinned in states.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkShift, shiftFromPunches, rulesFor, coverage, normalizeJurisdiction } = require('..');

const DATE = '2026-10-12';
const check = (jurisdiction, start, end, breaks = [], extra = {}) => checkShift({ jurisdiction, date: DATE, start, end, breaks, ...extra });
const rules = (r) => r.violations.map((v) => v.rule).sort();
const meal = (start, minutes = 30, extra = {}) => ({ start, minutes, kind: 'meal', ...extra });
const rest = (start, minutes = 10) => ({ start, minutes, kind: 'rest' });

test('time worked excludes an off-duty meal and includes rest and on-duty meals', () => {
  assert.equal(check('US-TX', '09:00', '17:30', [meal('13:00'), rest('11:00')]).workedMinutes, 480);
  assert.equal(check('US-TX', '09:00', '17:30', [meal('13:00', 30, { onDuty: true })]).workedMinutes, 510);
});

test('a shift past midnight, and a break after midnight', () => {
  const r = check('US-CA', '20:00', '04:30', [meal('00:00'), rest('22:00'), rest('02:30')]);
  assert.equal(r.workedMinutes, 480);
  assert.deepEqual(rules(r), []);
});

test('a meal starts in hours worked: an earlier off-duty meal does not count toward the next limit', () => {
  // California 11 h worked: first meal by the end of hour 5, second by the end of hour 10.
  const ok = check('US-CA', '07:00', '19:00', [meal('11:00'), meal('16:30'), rest('09:00'), rest('14:00'), rest('18:00')]);
  assert.deepEqual(rules(ok), []);
  // The second meal at 17:45 starts after 10 h 15 min worked.
  const late = check('US-CA', '07:00', '19:00', [meal('11:00'), meal('17:45'), rest('09:00'), rest('14:00'), rest('18:30')]);
  assert.deepEqual(rules(late), ['meal_too_late']);
  assert.equal(late.violations[0].ruleId, 'second_meal');
});

test('each meal rule takes its own meal: one meal cannot satisfy two rules', () => {
  const r = check('US-CA', '07:00', '19:00', [meal('11:00'), rest('09:00'), rest('14:00'), rest('17:00')]);
  assert.deepEqual(r.violations.map((v) => [v.rule, v.ruleId]), [['meal_missing', 'second_meal']]);
});

test('a short meal is reported as too short, not missing', () => {
  const r = check('US-CA', '09:00', '15:00', [meal('12:00', 20), rest('10:30')]);
  assert.deepEqual(rules(r), ['meal_too_short']);
  assert.equal(r.violations[0].limit, 30);
  assert.equal(r.violations[0].actual, 20);
});

test('an on-duty meal counts only where the rule allows one', () => {
  // Massachusetts does not allow an on-duty meal; Colorado does.
  assert.deepEqual(rules(check('US-MA', '09:00', '16:30', [meal('12:00', 30, { onDuty: true })])), ['meal_missing']);
  const co = check('US-CO', '09:00', '16:00', [meal('12:00', 30, { onDuty: true }), rest('10:30'), rest('14:30')]);
  assert.deepEqual(rules(co), []);
  assert.ok(co.notes.some((n) => /on-duty meal is time worked/.test(n.note)));
});

test('a waiver counts only within the rule\'s own limits', () => {
  // California: the first meal may be waived only if the day is no more than 6 hours.
  const six = check('US-CA', '09:00', '15:00', [rest('11:00')], { waived: ['meal'] });
  assert.deepEqual(rules(six), []);
  assert.deepEqual(six.waivers, [{ ruleId: 'meal', allowed: true }]);
  const seven = check('US-CA', '09:00', '16:00', [rest('11:00'), rest('14:00')], { waived: ['meal'] });
  assert.deepEqual(rules(seven), ['meal_missing']);
  assert.deepEqual(seven.waivers, [{ ruleId: 'meal', allowed: false }]);
  // The second meal: only if the day is no more than 12 hours and the first was not waived.
  const both = check('US-CA', '07:00', '18:30', [rest('09:00'), rest('13:00'), rest('16:00')], { waived: ['meal', 'second_meal'] });
  assert.deepEqual(rules(both), ['meal_missing', 'meal_missing']);
  // Massachusetts has no waiver at all.
  assert.deepEqual(rules(check('US-MA', '09:00', '16:00', [], { waived: ['meal'] })), ['meal_missing']);
});

test('a coverage fact the caller does not give brings the rule in, and is reported', () => {
  const unknown = check('US-ND', '09:00', '15:00');
  assert.deepEqual(rules(unknown), ['meal_missing']);
  assert.deepEqual(unknown.assumptions, ['employeesOnDuty']);
  assert.deepEqual(rules(check('US-ND', '09:00', '15:00', [], { facts: { employeesOnDuty: 1 } })), []);
  assert.deepEqual(rules(check('US-ND', '09:00', '15:00', [], { facts: { employeesOnDuty: 2 } })), ['meal_missing']);
});

test('rest breaks: per 4 hours or major fraction, with a minimum shift', () => {
  // California: none under 3.5 h, one to 6 h, two over 6 h.
  assert.deepEqual(rules(check('US-CA', '09:00', '12:20')), []);
  assert.deepEqual(rules(check('US-CA', '09:00', '12:30')), ['rest_missing']);
  assert.deepEqual(rules(check('US-CA', '09:00', '15:00', [rest('11:00')], { waived: ['meal'] })), []);
  const seven = check('US-CA', '09:00', '15:31', [meal('12:00'), rest('11:00')]);
  assert.deepEqual(rules(seven), ['rest_missing']);
  assert.equal(seven.violations[0].limit, 2);
});

test('rest breaks: a rest under the required length does not count', () => {
  assert.deepEqual(rules(check('US-CA', '09:00', '13:00', [rest('11:00', 5)])), ['rest_missing']);
});

test('what a missed break costs', () => {
  const ca = check('US-CA', '09:00', '17:30', [meal('15:00'), rest('11:00')]);
  assert.deepEqual(ca.owed.map((o) => [o.kind, o.for, o.hours]), [['premium_pay', 'meal', 1], ['premium_pay', 'rest', 1]]);
  const co = check('US-CO', '09:00', '17:30', [meal('12:00')]);
  assert.deepEqual(co.owed.map((o) => [o.kind, o.minutes]), [['rest_time_pay', 20]]);
  assert.deepEqual(check('US-MA', '09:00', '16:00').owed, []);
});

test('a place the tables do not cover answers unknown', () => {
  const r = check('US-PR', '09:00', '17:00');
  assert.equal(r.known, false);
  assert.equal(r.reason, 'unknown_jurisdiction');
  assert.deepEqual(r.violations, []);
});

test('a shift before a rule took effect answers unknown', () => {
  const r = checkShift({ jurisdiction: 'US-MN', date: '2025-12-31', start: '09:00', end: '17:00' });
  assert.equal(r.known, false);
  assert.equal(r.reason, 'no_rule_in_force');
});

test('a state with no adult rule answers known, with nothing owed', () => {
  const r = check('US-TX', '06:00', '20:00');
  assert.equal(r.known, true);
  assert.deepEqual(r.violations, []);
});

test('input is checked', () => {
  assert.throws(() => checkShift(null), TypeError);
  assert.throws(() => check('California', '09:00', '17:00'), TypeError);
  assert.throws(() => checkShift({ jurisdiction: 'US-CA', date: '2026-02-30', start: '09:00', end: '17:00' }), TypeError);
  assert.throws(() => check('US-CA', '9:00', '17:00'), TypeError);
  assert.throws(() => check('US-CA', '09:00', '17:00', [{ start: '12:00', minutes: 30, kind: 'lunch' }]), TypeError);
  assert.throws(() => check('US-CA', '09:00', '17:00', [meal('18:00')]), /inside the shift/);
  assert.throws(() => check('US-CA', '09:00', '17:00', [meal('12:00'), rest('12:20')]), /overlap/);
  assert.throws(() => check('US-CA', '09:00', '17:00', [], { facts: { headcount: 3 } }), /Unknown fact/);
  assert.throws(() => check('US-CA', '09:00', '17:00', [], { facts: { industry: 'salon' } }), /industry/);
});

test('shiftFromPunches reads the gaps between punches as off-duty meals', () => {
  const shift = shiftFromPunches({ date: DATE, segments: [{ start: '09:00', end: '13:00' }, { start: '13:30', end: '17:30' }], restBreaks: [{ start: '11:00', minutes: 10 }, { start: '15:00', minutes: 10 }] });
  assert.deepEqual(shift, {
    date: DATE, start: '09:00', end: '17:30',
    breaks: [{ start: '13:00', minutes: 30, kind: 'meal' }, { start: '11:00', minutes: 10, kind: 'rest' }, { start: '15:00', minutes: 10, kind: 'rest' }],
  });
  assert.deepEqual(rules(checkShift({ jurisdiction: 'US-CA', ...shift })), []);
  const night = shiftFromPunches({ date: DATE, segments: [{ start: '22:00', end: '01:00' }, { start: '01:30', end: '06:00' }] });
  assert.deepEqual([night.start, night.end, night.breaks[0].start, night.breaks[0].minutes], ['22:00', '06:00', '01:00', 30]);
  assert.throws(() => shiftFromPunches({ date: DATE, segments: [] }), TypeError);
});

test('jurisdictions', () => {
  assert.equal(normalizeJurisdiction(' us-ca '), 'US-CA');
  assert.equal(normalizeJurisdiction({ country: 'us', subdivision: 'ny' }), 'US-NY');
  assert.equal(rulesFor('US-PR'), null);
  assert.equal(coverage().jurisdictions.length, 52);
});

test('the tables are frozen', () => {
  assert.ok(Object.isFrozen(rulesFor('US-CA').meals[0].window));
  assert.throws(() => { 'use strict'; rulesFor('US-CA').meals[0].minutes = 10; }, TypeError);
});
