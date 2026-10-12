'use strict';

// The engine: how a workday's breaks are placed in hours worked, how meals are
// matched to the rules that need them, what a waiver or a fact changes, and how
// rest breaks are counted. Each state is pinned in states.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkWorkday, rulesFor, coverage, normalizeJurisdiction } = require('..');

const DATE = '2026-10-12';
const check = (jurisdiction, start, end, breaks = [], extra = {}) => checkWorkday({ jurisdiction, date: DATE, start, end, breaks, ...extra });
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
  // Both waived on an 11-hour day: the first waiver does not count (over 6 hours), so the
  // second may be waived (the first was not, in law), and only the first meal is missing.
  const both = check('US-CA', '07:00', '18:30', [rest('09:00'), rest('13:00'), rest('16:00')], { waived: ['meal', 'second_meal'] });
  assert.deepEqual(rules(both), ['meal_missing']);
  assert.deepEqual(both.waivers, [{ ruleId: 'meal', allowed: false }, { ruleId: 'second_meal', allowed: true }]);
  // A first meal validly waived on a short day blocks a second waiver; a 6-hour day has no second meal anyway,
  // so check the rule directly: with the first meal taken, a valid second waiver stands.
  const taken = check('US-CA', '07:00', '18:30', [meal('11:00'), rest('09:00'), rest('13:00'), rest('16:00')], { waived: ['second_meal'] });
  assert.deepEqual(rules(taken), []);
  // Massachusetts has no waiver at all.
  assert.deepEqual(rules(check('US-MA', '09:00', '16:00', [], { waived: ['meal'] })), ['meal_missing']);
});

test('a coverage fact the caller does not give brings the rule in, and is reported', () => {
  const unknown = check('US-ND', '09:00', '15:00');
  assert.deepEqual(rules(unknown), ['meal_missing']);
  assert.deepEqual(unknown.assumptions, ['employeesOnDuty', 'wall_clock']);
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
  assert.deepEqual(co.owed.map((o) => [o.kind, o.minutes]), [['break_time_pay', 20]]);
  assert.deepEqual(check('US-MA', '09:00', '16:00').owed, []);
});

test('a place the tables do not cover answers unknown', () => {
  const r = check('US-PR', '09:00', '17:00');
  assert.equal(r.known, false);
  assert.equal(r.reason, 'unknown_jurisdiction');
  assert.deepEqual(r.violations, []);
});

test('a day is checked against the rules in force that day', () => {
  // Minnesota's 30-minute meal and 15-minute rest began on 2026-01-01; before, its rules had no length to check.
  const before = checkWorkday({ jurisdiction: 'US-MN', date: '2025-12-31', start: '09:00', end: '17:00' });
  assert.equal(before.known, true);
  assert.deepEqual(before.violations, []);
  assert.ok(before.notes.some((n) => /sufficient time to eat/.test(n.note)));
  assert.deepEqual(rules(checkWorkday({ jurisdiction: 'US-MN', date: '2026-01-02', start: '09:00', end: '17:00' })), ['meal_missing', 'rest_missing']);
  // Illinois added its further meals in 2023.
  const long = (date) => rules(checkWorkday({ jurisdiction: 'US-IL', date, start: '06:00', end: '19:20', breaks: [meal('10:00', 20)] }));
  assert.deepEqual(long('2022-12-30'), []);
  assert.deepEqual(long('2023-01-02'), ['meal_missing']);
});

test('a state with no adult rule answers known, with nothing owed', () => {
  const r = check('US-TX', '06:00', '20:00');
  assert.equal(r.known, true);
  assert.deepEqual(r.violations, []);
});

test('input is checked', () => {
  assert.throws(() => checkWorkday(null), TypeError);
  assert.throws(() => check('California', '09:00', '17:00'), TypeError);
  assert.throws(() => checkWorkday({ jurisdiction: 'US-CA', date: '2026-02-30', start: '09:00', end: '17:00' }), TypeError);
  assert.throws(() => check('US-CA', '9:00', '17:00'), TypeError);
  assert.throws(() => check('US-CA', '09:00', '17:00', [{ start: '12:00', minutes: 30, kind: 'lunch' }]), TypeError);
  assert.throws(() => check('US-CA', '09:00', '17:00', [meal('18:00')]), /inside a work segment/);
  assert.throws(() => check('US-CA', '09:00', '17:00', [meal('16:45')]), /end inside/);
  assert.throws(() => check('US-CA', '09:00', '17:00', [meal('12:00'), rest('12:20')]), /overlap/);
  assert.throws(() => check('US-CA', '09:00', '17:00', [], { facts: { headcount: 3 } }), /Unknown fact/);
  assert.throws(() => check('US-CA', '09:00', '17:00', [], { facts: { industry: 'salon' } }), /industry/);
});

test('a workday of several segments: the gaps between them are off duty and count as meals', () => {
  const punches = (segments, breaks = [], extra = {}) => checkWorkday({ jurisdiction: 'US-CA', date: DATE, segments, breaks, ...extra });
  // Clocked out 13:00–13:30: that gap is the meal.
  assert.deepEqual(rules(punches([{ start: '09:00', end: '13:00' }, { start: '13:30', end: '17:30' }], [rest('11:00'), rest('15:00')])), []);
  // A split shift, 09–13 and 17–21: 8 hours in the workday, so it earns two rest breaks.
  const split = punches([{ start: '09:00', end: '13:00' }, { start: '17:00', end: '21:00' }], [rest('11:00')]);
  assert.equal(split.workedMinutes, 480);
  assert.deepEqual(rules(split), ['rest_missing']);
  // Checked one shift at a time, each half would need nothing: the workday is what counts.
  assert.deepEqual(rules(check('US-CA', '09:00', '13:00', [rest('11:00')])), []);
  // A night workday across midnight, clocked out 01:00–01:30.
  const night = punches([{ start: '22:00', end: '01:00' }, { start: '01:30', end: '06:00' }], [rest('23:30'), rest('03:30')]);
  assert.equal(night.workedMinutes, 450);
  assert.deepEqual(rules(night), []);
  assert.throws(() => punches([]), TypeError);
  assert.throws(() => punches([{ start: '09:00', end: '13:00' }, { start: '12:00', end: '17:00' }]), TypeError);
  assert.throws(() => checkWorkday({ jurisdiction: 'US-CA', date: DATE, start: '09:00', end: '17:00', segments: [{ start: '09:00', end: '17:00' }] }), /not both/);
});

test('with a time zone, a workday across a daylight-saving change counts real time', () => {
  // Los Angeles falls back at 02:00 on 2026-11-01: 22:00 to 06:00 is 9 hours.
  const fall = { jurisdiction: 'US-CA', date: '2026-10-31', start: '22:00', end: '06:00', breaks: [meal('03:00'), rest('00:00'), rest('05:00')] };
  const wall = checkWorkday(fall);
  assert.equal(wall.workedMinutes, 450);
  assert.deepEqual(rules(wall), []);
  assert.ok(wall.assumptions.includes('wall_clock'));
  const real = checkWorkday({ ...fall, timeZone: 'America/Los_Angeles' });
  assert.equal(real.workedMinutes, 510);
  assert.deepEqual(rules(real), ['meal_too_late']);
  assert.ok(!real.assumptions.includes('wall_clock'));
  // Spring forward on 2026-03-08: 22:00 to 06:00 is 7 hours, and 02:30 never happens.
  const spring = { jurisdiction: 'US-TX', date: '2026-03-07', start: '22:00', end: '06:00', timeZone: 'America/Chicago' };
  assert.equal(checkWorkday(spring).workedMinutes, 420);
  assert.throws(() => checkWorkday({ ...spring, breaks: [rest('02:30')] }), /does not exist/);
  assert.throws(() => checkWorkday({ ...spring, timeZone: 'Mars/Olympus' }), /timeZone/);
});

test('options and waivers are checked', () => {
  assert.throws(() => checkWorkday({ jurisdiction: 'US-CA', date: DATE, start: '09:00', end: '17:00', timezone: 'UTC' }), /Unknown option/);
  assert.throws(() => check('US-NY', '09:00', '17:00', [], { waived: ['meal'] }), /not a rule in US-NY/);
  assert.throws(() => check('US-CA', '09:00', '17:00', [], { waived: 'meal' }), TypeError);
  assert.throws(() => check('US-CA', '09:00', '17:00', [], { facts: { employeesOnDuty: -1 } }), TypeError);
});

test('every documented name imports through ESM', async () => {
  const mod = await import('../index.js');
  for (const name of ['checkWorkday', 'rulesFor', 'coverage', 'normalizeJurisdiction', 'AS_OF', 'INDUSTRIES']) {
    assert.ok(name in mod, name);
  }
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

// Code review, 2026-10-11.

test('a typo inside a break or a segment throws, it does not change the answer', () => {
  assert.throws(() => check('US-MA', '09:00', '16:30', [{ start: '12:00', minutes: 30, kind: 'meal', onduty: true }]), /unknown key/);
  assert.throws(() => checkWorkday({ jurisdiction: 'US-CA', date: DATE, segments: [{ start: '09:00', End: '13:00' }] }), /unknown key/);
});

test('meals are matched to rules as a whole, not first come first served', () => {
  // New York, 06:30-15:30: the noonday meal (30, within 11-2). A 45-minute meal at 11:00 fits it,
  // and so does a 30 at 13:00; either way the day passes.
  assert.deepEqual(rules(check('US-NY', '06:30', '15:30', [meal('11:00', 45), meal('13:00', 30)])), []);
  // California 07:00-19:30, meals at 13:00 (6 h worked) and 18:00: only the first meal is late.
  const ca = check('US-CA', '07:00', '19:30', [meal('13:00'), meal('18:00'), rest('09:00'), rest('15:00'), rest('17:00')]);
  assert.deepEqual(ca.violations.map((v) => [v.rule, v.ruleId]), [['meal_too_late', 'meal']]);
  // A one-minute gap between punches is not blamed for a missing meal.
  const gap = checkWorkday({ jurisdiction: 'US-CA', date: DATE, segments: [{ start: '09:00', end: '10:00' }, { start: '10:01', end: '17:30' }], breaks: [meal('14:30'), rest('11:00'), rest('15:30')] });
  assert.deepEqual(gap.violations.map((v) => v.rule), ['meal_too_late']);
});

test('every meal a long day earns is required', () => {
  const day = (j, segs, breaks) => rules(checkWorkday({ jurisdiction: j, date: DATE, segments: segs, breaks }));
  // Oregon: three meals from 22 hours.
  assert.deepEqual(day('US-OR', [{ start: '00:00', end: '23:00' }], [meal('03:30'), meal('12:00'), rest('01:30'), rest('06:00'), rest('09:00'), rest('14:00'), rest('17:00'), rest('20:00')]), ['meal_missing']);
  // Illinois: a fourth 20-minute meal at 21 hours.
  assert.deepEqual(day('US-IL', [{ start: '00:00', end: '22:00' }], [meal('04:00', 20), meal('09:00', 20), meal('14:00', 20)]), ['meal_missing']);
});

test('New York: the noonday and night meals are alternatives by start time', () => {
  // A 05:00 start takes the night meal (45), not also the noonday one.
  assert.deepEqual(rules(check('US-NY', '05:00', '12:00', [meal('08:15', 45)])), []);
  // 07:00-14:00 spans all of 11-2: the noonday meal applies.
  assert.deepEqual(rules(check('US-NY', '07:00', '14:00')), ['meal_missing']);
  // 05:30-11:45 starts in the night window: 45 minutes, and no noonday meal on top.
  assert.deepEqual(rules(check('US-NY', '05:30', '11:45', [meal('08:30', 45)])), []);
});

test('the repeated hour when the clocks go back, and the 24-hour bound in real time', () => {
  // Los Angeles, 2026-11-01: clocked in 01:30 (first 01:30), out at 01:15 (after the change): 45 minutes.
  const r = checkWorkday({ jurisdiction: 'US-TX', date: '2026-11-01', start: '01:30', end: '01:15', timeZone: 'America/Los_Angeles' });
  assert.equal(r.workedMinutes, 45);
  // Without a zone the same times read as almost a full day.
  assert.equal(checkWorkday({ jurisdiction: 'US-TX', date: '2026-11-01', start: '01:30', end: '01:15' }).workedMinutes, 1425);
  // A day longer than 24 real hours is refused.
  assert.throws(() => checkWorkday({ jurisdiction: 'US-TX', date: '2026-10-31', segments: [{ start: '01:30', end: '23:00' }, { start: '23:30', end: '01:40' }], timeZone: 'America/Los_Angeles' }), /24 hours/);
});

test('waiving a rest break where there is no rest rule throws', () => {
  assert.throws(() => check('US-MA', '09:00', '17:00', [meal('12:00')], { waived: ['rest'] }), /not a rule in US-MA/);
});

test('Minnesota owes missed break time twice over, for meals and rests', () => {
  const r = checkWorkday({ jurisdiction: 'US-MN', date: DATE, start: '09:00', end: '15:00', breaks: [rest('10:00', 15), rest('13:00', 15)] });
  assert.deepEqual(r.owed.map((o) => [o.kind, o.for, o.minutes]), [['break_time_pay', 'meal', 60]]);
});

test('assumptions and notes only for rules that applied', () => {
  // North Dakota's meal rule is not triggered by a 2-hour shift: nothing assumed about who is on duty.
  assert.deepEqual(check('US-ND', '09:00', '11:00').assumptions, ['wall_clock']);
  // A Maryland restaurant is outside the retail rule: no rest note, no headcount assumed.
  const md = check('US-MD', '09:00', '13:00', [rest('11:00', 15)], { facts: { industry: 'restaurant' } });
  assert.deepEqual(md.notes, []);
  assert.deepEqual(md.assumptions, ['wall_clock']);
  // A short meal under a "no more than N hours without" rule is reported as short.
  assert.deepEqual(rules(check('US-NH', '09:00', '15:00', [meal('12:00', 20)])), ['meal_too_short']);
});
