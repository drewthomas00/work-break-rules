'use strict';

/**
 * The table's shape, checked at load: a malformed entry fails the require(),
 * not a check months later. index.d.ts describes the same shape for readers.
 */

const { parseDate } = require('./time');

const INDUSTRIES = ['retail', 'restaurant', 'personal_service', 'manufacturing', 'office', 'healthcare', 'other'];
const AT_LEAST = ['>', '>='];
const AT_MOST = ['<', '<='];

/**
 * Refuse a malformed table entry.
 * @param {string} code
 * @param {any} e - one raw table entry: any, because its shape is what is being checked
 */
function validateEntry(code, e) {
  const fail = (what) => { throw new Error(`work-break-rules: ${code}: ${what}`); };
  const obj = (o, what) => { if (!o || typeof o !== 'object' || Array.isArray(o)) fail(`${what} must be an object`); };
  const keys = (o, allowed, what) => { obj(o, what); for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${what} has unknown key ${k}`); };
  const has = (o, required, what) => { for (const k of required) if (!(k in o)) fail(`${what} is missing ${k}`); };
  const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const window2 = (w, what) => { if (!(Array.isArray(w) && w.length === 2 && w.every(isTime))) fail(`${what} must be ['HH:MM', 'HH:MM']`); };
  const hours = (h, what) => { if (typeof h !== 'number' || !(h > 0)) fail(`${what} must be a positive number of hours`); };
  const bound = (b, ops, what) => { keys(b, ['hours', 'op'], what); hours(b.hours, `${what}.hours`); if (!ops.includes(b.op)) fail(`${what}.op must be one of ${ops.join(' ')}`); };
  const sourced = (o, what) => {
    if (!Array.isArray(o.citations) || !o.citations.length) fail(`${what} needs citations`);
    for (const c of o.citations) {
      keys(c, ['citation', 'sourceUrl'], `${what} citation`);
      if (typeof c.citation !== 'string' || !c.citation || !/^https?:\/\/\S+$/.test(c.sourceUrl)) fail(`${what} has a bad citation`);
    }
  };
  const rated = (o, what) => {
    sourced(o, what);
    if (!['high', 'medium'].includes(o.confidence)) fail(`${what}.confidence must be high or medium`);
    if (typeof o.note !== 'string' || !o.note) fail(`${what} needs a note`);
  };
  const when = (w, what) => {
    if (w === null) return;
    keys(w, ['industries', 'exceptIndustries', 'minEmployeesOnDuty', 'minRetailEmployees', 'minLocationEmployees'], what);
    for (const list of [w.industries, w.exceptIndustries].filter(Boolean)) {
      if (!Array.isArray(list) || !list.length) fail(`${what} industry lists must be non-empty`);
      for (const i of list) if (!INDUSTRIES.includes(i)) fail(`${what} names unknown industry ${i}`);
    }
    for (const k of ['minEmployeesOnDuty', 'minRetailEmployees', 'minLocationEmployees']) {
      if (w[k] !== undefined && !(Number.isInteger(w[k]) && w[k] > 0)) fail(`${what}.${k} must be a positive whole number`);
    }
  };
  const waiver = (w, what) => {
    if (w === null) return;
    keys(w, ['maxWorkedHours', 'requiresNotWaived'], what);
    if (w.maxWorkedHours !== undefined) hours(w.maxWorkedHours, `${what}.maxWorkedHours`);
    if (w.requiresNotWaived !== undefined && !e.meals.some((m) => m.id === w.requiresNotWaived)) fail(`${what}.requiresNotWaived names no meal rule`);
  };

  keys(e, ['effectiveFrom', 'meals', 'rest', 'penalty', 'unchecked', 'basis'], 'entry');
  has(e, ['effectiveFrom', 'meals', 'rest', 'penalty', 'unchecked', 'basis'], 'entry');
  if (e.effectiveFrom !== null) parseDate(`${code}.effectiveFrom`, e.effectiveFrom);
  if (!Array.isArray(e.meals) || !Array.isArray(e.unchecked)) fail('meals and unchecked must be arrays');
  if ((e.meals.length || e.rest) && e.basis) fail('basis is for an entry with no rule');
  if (!e.meals.length && !e.rest && !e.basis) fail('an entry with no rule needs a basis');
  if (e.basis) rated(keysOk(e.basis, ['citations', 'confidence', 'note'], 'basis'), 'basis');

  e.meals.forEach((m, i) => {
    const what = `meals[${i}] (${m && m.id})`;
    keys(m, ['id', 'trigger', 'minutes', 'repeat', 'window', 'waiver', 'onDutyAllowed', 'appliesWhen', 'exemptIfPaidBreaks', 'citations', 'confidence', 'note'], what);
    has(m, ['id', 'trigger', 'minutes', 'window', 'waiver', 'onDutyAllowed', 'appliesWhen', 'citations', 'confidence', 'note'], what);
    if (m.repeat !== undefined) {
      keys(m.repeat, ['everyHours'], `${what}.repeat`);
      hours(m.repeat.everyHours, `${what}.repeat.everyHours`);
      if (!m.trigger.minWorked) fail(`${what}.repeat counts from trigger.minWorked, which it needs`);
    }
    if (m.exemptIfPaidBreaks !== undefined) {
      const x = m.exemptIfPaidBreaks;
      keys(x, ['minutes', 'perWorkedHours'], `${what}.exemptIfPaidBreaks`);
      has(x, ['minutes', 'perWorkedHours'], `${what}.exemptIfPaidBreaks`);
      if (!Number.isInteger(x.minutes) || x.minutes <= 0) fail(`${what}.exemptIfPaidBreaks.minutes`);
      hours(x.perWorkedHours, `${what}.exemptIfPaidBreaks.perWorkedHours`);
    }
    if (typeof m.id !== 'string' || !/^[a-z0-9_]+$/.test(m.id) || m.id === 'rest') fail(`${what}.id must be snake_case and not 'rest'`);
    const t = m.trigger;
    keys(t, ['minWorked', 'maxWorked', 'minSpan', 'overlapsClock', 'startsBetweenClock', 'startsBefore', 'endsAfter'], `${what}.trigger`);
    if (!Object.keys(t).length) fail(`${what}.trigger is empty`);
    if (t.minWorked) bound(t.minWorked, AT_LEAST, `${what}.trigger.minWorked`);
    if (t.minSpan) bound(t.minSpan, AT_LEAST, `${what}.trigger.minSpan`);
    if (t.maxWorked) bound(t.maxWorked, AT_MOST, `${what}.trigger.maxWorked`);
    if (t.overlapsClock) window2(t.overlapsClock, `${what}.trigger.overlapsClock`);
    if (t.startsBetweenClock) window2(t.startsBetweenClock, `${what}.trigger.startsBetweenClock`);
    for (const k of ['startsBefore', 'endsAfter']) if (t[k] !== undefined && !isTime(t[k])) fail(`${what}.trigger.${k}`);
    if (!Number.isInteger(m.minutes) || m.minutes <= 0) fail(`${what}.minutes`);
    if (m.window !== null) {
      keys(m.window, ['notBeforeWorkedHours', 'startByWorkedHours', 'endByWorkedHours', 'notInLastWorkedHours', 'clock', 'maxStretch'], `${what}.window`);
      if (!Object.keys(m.window).length) fail(`${what}.window is empty; use null`);
      for (const k of ['notBeforeWorkedHours', 'startByWorkedHours', 'endByWorkedHours', 'notInLastWorkedHours']) if (m.window[k] !== undefined) hours(m.window[k], `${what}.window.${k}`);
      if (m.window.clock) window2(m.window.clock, `${what}.window.clock`);
      if (m.window.maxStretch) bound(m.window.maxStretch, AT_MOST, `${what}.window.maxStretch`);
    }
    waiver(m.waiver, `${what}.waiver`);
    if (typeof m.onDutyAllowed !== 'boolean') fail(`${what}.onDutyAllowed`);
    when(m.appliesWhen, `${what}.appliesWhen`);
    rated(m, what);
  });

  const r = e.rest;
  if (r !== null) {
    keys(r, ['minutes', 'perHours', 'majorFraction', 'minimumShiftHours', 'table', 'maxStretch', 'paid', 'waiver', 'appliesWhen', 'citations', 'confidence', 'note'], 'rest');
    has(r, ['minutes', 'perHours', 'majorFraction', 'minimumShiftHours', 'table', 'maxStretch', 'paid', 'waiver', 'appliesWhen', 'citations', 'confidence', 'note'], 'rest');
    if (!Number.isInteger(r.minutes) || r.minutes <= 0) fail('rest.minutes');
    if (r.table !== null) {
      if (r.perHours !== null || r.minimumShiftHours !== null) fail('rest: a table replaces perHours and minimumShiftHours');
      if (!Array.isArray(r.table) || !r.table.length) fail('rest.table');
      for (const row of r.table) if (!(Array.isArray(row) && row.length === 3 && row[0] > 0 && AT_LEAST.includes(row[1]) && Number.isInteger(row[2]) && row[2] >= 0)) fail('rest.table rows are [hours, op, count]');
      for (let i = 1; i < r.table.length; i++) if (!(r.table[i][0] > r.table[i - 1][0])) fail('rest.table rows must be in ascending hours');
    } else {
      hours(r.perHours, 'rest.perHours');
      if (r.minimumShiftHours !== null) hours(r.minimumShiftHours, 'rest.minimumShiftHours');
    }
    if (typeof r.majorFraction !== 'boolean') fail('rest.majorFraction');
    if (r.maxStretch !== null) bound(r.maxStretch, AT_MOST, 'rest.maxStretch');
    if (typeof r.paid !== 'boolean') fail('rest.paid');
    waiver(r.waiver, 'rest.waiver');
    when(r.appliesWhen, 'rest.appliesWhen');
    rated(r, 'rest');
  }

  const p = e.penalty;
  if (p !== null) {
    keys(p, ['premiumHours', 'breakTimePaid', 'description', 'citations'], 'penalty');
    has(p, ['premiumHours', 'breakTimePaid', 'description', 'citations'], 'penalty');
    if (p.premiumHours !== null) { keys(p.premiumHours, ['meal', 'rest'], 'penalty.premiumHours'); if (!(p.premiumHours.meal > 0 && p.premiumHours.rest > 0)) fail('penalty.premiumHours'); }
    if (p.breakTimePaid !== null) {
      keys(p.breakTimePaid, ['meal', 'rest', 'multiplier'], 'penalty.breakTimePaid');
      if (typeof p.breakTimePaid.meal !== 'boolean' || typeof p.breakTimePaid.rest !== 'boolean' || !(p.breakTimePaid.multiplier >= 1)) fail('penalty.breakTimePaid');
      if (p.breakTimePaid.rest && !r) fail('penalty.breakTimePaid.rest needs a rest rule');
    }
    if (typeof p.description !== 'string' || !p.description) fail('penalty.description');
    sourced(p, 'penalty');
  }
  for (const u of e.unchecked) if (typeof u !== 'string' || !u) fail('unchecked holds sentences');

  /**
   * @template T
   * @param {T} o
   * @param {string[]} allowed
   * @param {string} what
   * @returns {T}
   */
  function keysOk(o, allowed, what) { keys(o, allowed, what); return o; }
}

/**
 * Refuse a malformed jurisdiction: one entry, or versions oldest first, each
 * after an effectiveFrom (only the first may have none).
 * @param {string} code
 * @param {any} value
 */
function validateJurisdiction(code, value) {
  const versions = Array.isArray(value) ? value : [value];
  if (!versions.length) throw new Error(`work-break-rules: ${code}: no versions`);
  versions.forEach((v, i) => {
    validateEntry(code, v);
    if (i > 0 && !(v.effectiveFrom && (!versions[i - 1].effectiveFrom || v.effectiveFrom > versions[i - 1].effectiveFrom))) {
      throw new Error(`work-break-rules: ${code}: versions must have increasing effectiveFrom dates`);
    }
  });
}

module.exports = { validateJurisdiction, validateEntry, INDUSTRIES };
