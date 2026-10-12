'use strict';

/**
 * work-break-rules — does this shift give the meal and rest breaks the law
 * requires here?
 *
 * NOT LEGAL ADVICE. The tables cover the meal and rest break rules that US
 * states and DC set for adult employees of private, non-agricultural
 * employers. A place they do not cover answers "unknown", never "no rule".
 */

const { AS_OF, JURISDICTIONS: RAW } = require('./data');
const { deepFreeze } = require('./freeze');
const { parseDate, minutes, clock, duration, describe } = require('./time');

const DAY = 24 * 60;
const KINDS = ['meal', 'rest'];
const INDUSTRIES = ['retail', 'restaurant', 'personal_service', 'manufacturing', 'office', 'healthcare', 'other'];
const FACT_KEYS = ['industry', 'employeesOnDuty', 'employerEmployees'];

// ── Table validation ─────────────────────────────────────────────────

/**
 * Refuse a malformed table entry at load, so a bad edit fails the require()
 * rather than a check months later.
 * @param {string} code
 * @param {any} e - one raw table entry; its shape is what is being checked
 */
function validateEntry(code, e) {
  const fail = (what) => { throw new Error(`work-break-rules: ${code}: ${what}`); };
  const keys = (o, allowed, what) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${what} has unknown key ${k}`); };
  const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const op = (o, what) => { if (!['>', '>='].includes(o)) fail(`${what}.op must be '>' or '>='`); };
  const hours = (h, what) => { if (typeof h !== 'number' || !(h > 0)) fail(`${what} must be a positive number of hours`); };
  const sourced = (o, what) => {
    if (!Array.isArray(o.citations) || !o.citations.length) fail(`${what} needs citations`);
    for (const c of o.citations) if (typeof c.citation !== 'string' || !/^https?:\/\//.test(c.sourceUrl)) fail(`${what} has a bad citation`);
  };
  const rated = (o, what) => {
    sourced(o, what);
    if (!['high', 'medium'].includes(o.confidence)) fail(`${what}.confidence must be high or medium`);
    if (typeof o.note !== 'string' || !o.note) fail(`${what} needs a note`);
  };
  const when = (w, what) => {
    if (w === null) return;
    keys(w, ['industries', 'exceptIndustries', 'minEmployeesOnDuty', 'minEmployerEmployees'], what);
    for (const list of [w.industries, w.exceptIndustries].filter(Boolean)) for (const i of list) if (!INDUSTRIES.includes(i)) fail(`${what} names unknown industry ${i}`);
  };
  const waiver = (w, what) => {
    if (w === null) return;
    keys(w, ['maxWorkedHours', 'requiresNotWaived'], what);
    if (w.maxWorkedHours != null) hours(w.maxWorkedHours, `${what}.maxWorkedHours`);
  };

  keys(e, ['effectiveFrom', 'meals', 'rest', 'penalty', 'unchecked', 'basis'], 'entry');
  if (e.effectiveFrom !== null) parseDate(`${code}.effectiveFrom`, e.effectiveFrom);
  if (!Array.isArray(e.meals) || !Array.isArray(e.unchecked)) fail('meals and unchecked must be arrays');
  if (!e.meals.length && !e.rest && !e.unchecked.length && !e.basis) fail('an entry with no rule needs a basis');
  if (e.basis) rated(e.basis, 'basis');

  e.meals.forEach((m, i) => {
    const what = `meals[${i}]`;
    keys(m, ['id', 'trigger', 'minutes', 'window', 'waiver', 'onDutyAllowed', 'appliesWhen', 'citations', 'confidence', 'note'], what);
    if (typeof m.id !== 'string' || !m.id) fail(`${what}.id`);
    const t = m.trigger;
    keys(t, ['workedHours', 'spanHours', 'op', 'belowWorkedHours', 'atMostWorkedHours', 'overlapsClock', 'startsBetweenClock', 'startsBefore', 'endsAfter'], `${what}.trigger`);
    if (t.workedHours != null || t.spanHours != null) op(t.op, `${what}.trigger`);
    for (const k of ['workedHours', 'spanHours', 'belowWorkedHours', 'atMostWorkedHours']) if (t[k] != null) hours(t[k], `${what}.trigger.${k}`);
    for (const k of ['overlapsClock', 'startsBetweenClock']) if (t[k] && !(t[k].length === 2 && t[k].every(isTime))) fail(`${what}.trigger.${k}`);
    for (const k of ['startsBefore', 'endsAfter']) if (t[k] && !isTime(t[k])) fail(`${what}.trigger.${k}`);
    if (!Object.keys(t).length) fail(`${what}.trigger is empty`);
    if (!Number.isInteger(m.minutes) || m.minutes <= 0) fail(`${what}.minutes`);
    if (m.window !== null) {
      keys(m.window, ['notBeforeWorkedHours', 'startByWorkedHours', 'endByWorkedHours', 'notInLastWorkedHours', 'clock', 'maxStretch'], `${what}.window`);
      for (const k of ['notBeforeWorkedHours', 'startByWorkedHours', 'endByWorkedHours', 'notInLastWorkedHours']) if (m.window[k] != null) hours(m.window[k], `${what}.window.${k}`);
      if (m.window.clock && !(m.window.clock.length === 2 && m.window.clock.every(isTime))) fail(`${what}.window.clock`);
      if (m.window.maxStretch) { hours(m.window.maxStretch.hours, `${what}.window.maxStretch`); op(m.window.maxStretch.op, `${what}.window.maxStretch`); }
    }
    waiver(m.waiver, `${what}.waiver`);
    if (typeof m.onDutyAllowed !== 'boolean') fail(`${what}.onDutyAllowed`);
    when(m.appliesWhen, `${what}.appliesWhen`);
    rated(m, what);
  });

  const r = e.rest;
  if (r) {
    keys(r, ['minutes', 'perHours', 'majorFraction', 'minimumShiftHours', 'table', 'maxStretch', 'paid', 'waiver', 'appliesWhen', 'citations', 'confidence', 'note'], 'rest');
    if (!Number.isInteger(r.minutes) || r.minutes <= 0) fail('rest.minutes');
    if (r.table) {
      for (const row of r.table) if (!(row.length === 3 && typeof row[0] === 'number' && ['>', '>='].includes(row[1]) && Number.isInteger(row[2]))) fail('rest.table rows are [hours, op, count]');
    } else {
      hours(r.perHours, 'rest.perHours');
      if (typeof r.majorFraction !== 'boolean') fail('rest.majorFraction');
    }
    if (r.minimumShiftHours != null) hours(r.minimumShiftHours, 'rest.minimumShiftHours');
    if (r.maxStretch) { hours(r.maxStretch.hours, 'rest.maxStretch'); op(r.maxStretch.op, 'rest.maxStretch'); }
    if (typeof r.paid !== 'boolean') fail('rest.paid');
    waiver(r.waiver, 'rest.waiver');
    when(r.appliesWhen, 'rest.appliesWhen');
    rated(r, 'rest');
  }

  const p = e.penalty;
  if (p) {
    keys(p, ['premiumHours', 'missedRestPaid', 'description', 'citations'], 'penalty');
    if (p.premiumHours !== null && !(p.premiumHours.meal > 0 && p.premiumHours.rest > 0)) fail('penalty.premiumHours');
    if (typeof p.missedRestPaid !== 'boolean' || typeof p.description !== 'string') fail('penalty');
    sourced(p, 'penalty');
  }
  for (const u of e.unchecked) if (typeof u !== 'string' || !u) fail('unchecked holds sentences');
}

for (const [code, entry] of Object.entries(RAW)) validateEntry(code, entry);
const TABLES = deepFreeze(RAW);
const CODES = Object.keys(TABLES).sort();

// ── Jurisdictions ────────────────────────────────────────────────────

/**
 * Normalise a jurisdiction to 'US-XX' (or 'US' for federal law). Accepts
 * 'US-CA', 'us-ca', or { country: 'US', subdivision: 'CA' }. Anything
 * unreadable throws; a well-formed place outside the tables is returned as is
 * (and answers unknown).
 * @param {unknown} input
 * @returns {string}
 */
function normalizeJurisdiction(input) {
  let code;
  if (typeof input === 'string') code = input.trim().toUpperCase();
  else if (input && typeof input === 'object' && typeof input.country === 'string') {
    const country = input.country.trim().toUpperCase();
    const sub = typeof input.subdivision === 'string' ? input.subdivision.trim().toUpperCase() : '';
    code = sub ? `${country}-${sub}` : country;
  }
  if (!code || !/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(code)) {
    throw new TypeError(`jurisdiction must be an ISO 3166 code like 'US-CA', got ${describe(input)}`);
  }
  return code;
}

/**
 * The table entry for a place, or null when the tables do not cover it.
 * @param {unknown} jurisdiction
 * @returns {object | null}
 */
function rulesFor(jurisdiction) {
  const code = normalizeJurisdiction(jurisdiction);
  return TABLES[code] ? TABLES[code] : null;
}

// ── Reading a shift ──────────────────────────────────────────────────

/**
 * Read and check one break, placing it on the shift's own timeline (minutes
 * after midnight of the shift's date; a break that starts earlier on the
 * clock than the shift is taken to be after midnight).
 * @param {unknown} b
 * @param {number} i
 * @param {number} start
 * @param {number} end
 */
function readBreak(b, i, start, end) {
  if (!b || typeof b !== 'object') throw new TypeError(`breaks[${i}] must be an object`);
  if (!KINDS.includes(b.kind)) throw new TypeError(`breaks[${i}].kind must be 'meal' or 'rest', got ${describe(b.kind)}`);
  let at = minutes(`breaks[${i}].start`, b.start);
  if (at < start) at += DAY;
  if (!Number.isInteger(b.minutes) || b.minutes <= 0) throw new TypeError(`breaks[${i}].minutes must be a whole number of minutes above 0`);
  if (at < start || at + b.minutes > end) throw new TypeError(`breaks[${i}] must lie inside the shift`);
  return { index: i, kind: b.kind, start: at, minutes: b.minutes, onDuty: b.onDuty === true };
}

/**
 * The shift as a timeline: its span, its breaks in order, and where each break
 * falls in hours worked. Time worked is the time on the clock less any
 * off-duty meal; a rest break and an on-duty meal are time worked.
 * @param {object} input
 */
function readShift(input) {
  parseDate('date', input.date);
  const start = minutes('start', input.start);
  let end = minutes('end', input.end);
  if (end <= start) end += DAY;
  if (!Array.isArray(input.breaks === undefined ? [] : input.breaks)) throw new TypeError('breaks must be an array');
  const breaks = (input.breaks || []).map((b, i) => readBreak(b, i, start, end)).sort((a, b) => a.start - b.start);
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i].start < breaks[i - 1].start + breaks[i - 1].minutes) throw new TypeError('breaks must not overlap');
  }
  const offDuty = (b) => b.kind === 'meal' && !b.onDuty;
  // Minutes worked before a point on the clock.
  const workedAt = (t) => (t - start) - breaks.filter((b) => offDuty(b) && b.start + b.minutes <= t).reduce((s, b) => s + b.minutes, 0);
  for (const b of breaks) b.workedBefore = workedAt(b.start);
  const worked = workedAt(end);
  return { date: input.date, start, end, breaks, worked, workedAt, offDuty };
}

// ── Does a rule reach this employer? ─────────────────────────────────

/**
 * Whether a rule's coverage condition holds, given the facts the caller knows.
 * A fact the caller did not give is assumed to bring the rule in (the stricter
 * reading), and is reported.
 * @param {object | null} when
 * @param {object} facts
 * @param {Set<string>} assumed
 * @returns {boolean}
 */
function covered(when, facts, assumed) {
  if (!when) return true;
  if (when.industries) {
    if (facts.industry === undefined) assumed.add('industry');
    else if (!when.industries.includes(facts.industry)) return false;
  }
  if (when.exceptIndustries) {
    if (facts.industry === undefined) assumed.add('industry');
    else if (when.exceptIndustries.includes(facts.industry)) return false;
  }
  if (when.minEmployeesOnDuty) {
    if (facts.employeesOnDuty === undefined) assumed.add('employeesOnDuty');
    else if (facts.employeesOnDuty < when.minEmployeesOnDuty) return false;
  }
  if (when.minEmployerEmployees) {
    if (facts.employerEmployees === undefined) assumed.add('employerEmployees');
    else if (facts.employerEmployees < when.minEmployerEmployees) return false;
  }
  return true;
}

// ── Meals ────────────────────────────────────────────────────────────

/**
 * A clock window [a, b] on the shift's timeline, moved to the copy (today's or
 * the next day's) that overlaps the shift, if either does.
 * @param {[string, string]} win
 * @param {{ start: number, end: number }} shift
 * @returns {[number, number]}
 */
function clockWindow(win, shift) {
  const a = minutes('clock', win[0]);
  let b = minutes('clock', win[1]);
  if (b <= a) b += DAY;
  for (const k of [0, DAY]) if (a + k < shift.end && b + k > shift.start) return [a + k, b + k];
  return [a, b];
}

/**
 * Is `t` (minutes after midnight, any day) inside the daily clock range
 * [a, b), which may wrap past midnight?
 * @param {number} t
 * @param {[string, string]} range
 * @returns {boolean}
 */
function inClockRange(t, range) {
  const m = t % DAY; const a = minutes('clock', range[0]); const b = minutes('clock', range[1]);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

/**
 * Is `mins` past `hours`, by `op` ('>' more than, '>=' at least)?
 * @param {number} mins
 * @param {number} hours
 * @param {string} op
 * @returns {boolean}
 */
function past(mins, hours, op) {
  return op === '>' ? mins > hours * 60 : mins >= hours * 60;
}

/**
 * The longest stretch worked between `stops` (breaks that each end a stretch).
 * @param {object} shift
 * @param {object[]} stops
 * @returns {{ from: number, minutes: number }}
 */
function longestStretch(shift, stops) {
  let from = shift.start; let longest = { from: shift.start, minutes: 0 };
  for (const t of [...stops.map((b) => ({ at: b.start, resume: b.start + b.minutes })), { at: shift.end, resume: shift.end }]) {
    const span = shift.workedAt(t.at) - shift.workedAt(from);
    if (span > longest.minutes) longest = { from, minutes: span };
    from = t.resume;
  }
  return longest;
}

/**
 * Does a meal rule's trigger hold for this shift?
 * @param {object} trigger
 * @param {object} shift
 * @returns {boolean}
 */
function triggered(trigger, shift) {
  if (trigger.workedHours != null && !past(shift.worked, trigger.workedHours, trigger.op)) return false;
  if (trigger.spanHours != null && !past(shift.end - shift.start, trigger.spanHours, trigger.op)) return false;
  if (trigger.belowWorkedHours != null && !(shift.worked < trigger.belowWorkedHours * 60)) return false;
  if (trigger.atMostWorkedHours != null && !(shift.worked <= trigger.atMostWorkedHours * 60)) return false;
  if (trigger.overlapsClock) {
    const [a, b] = clockWindow(trigger.overlapsClock, shift);
    if (!(shift.start < b && shift.end > a)) return false;
  }
  if (trigger.startsBetweenClock && !inClockRange(shift.start, trigger.startsBetweenClock)) return false;
  if (trigger.startsBefore && !(shift.start < minutes('clock', trigger.startsBefore))) return false;
  if (trigger.endsAfter && !(shift.end > minutes('clock', trigger.endsAfter))) return false;
  return true;
}

/**
 * Why `meal` does not satisfy `rule`'s length and window, or null if it does.
 * @param {object} rule
 * @param {object} meal
 * @param {object} shift
 * @returns {{ rule: string, limit: string|number, actual: string|number } | null}
 */
function mealFault(rule, meal, shift) {
  if (meal.minutes < rule.minutes) return { rule: 'meal_too_short', limit: rule.minutes, actual: meal.minutes };
  const w = rule.window || {};
  const p = meal.workedBefore;
  if (w.notBeforeWorkedHours != null && p < w.notBeforeWorkedHours * 60) {
    return { rule: 'meal_too_early', limit: duration(w.notBeforeWorkedHours * 60), actual: duration(p) };
  }
  if (w.startByWorkedHours != null && p > w.startByWorkedHours * 60) {
    return { rule: 'meal_too_late', limit: duration(w.startByWorkedHours * 60), actual: duration(p) };
  }
  if (w.endByWorkedHours != null && p + meal.minutes > w.endByWorkedHours * 60) {
    return { rule: 'meal_too_late', limit: duration(w.endByWorkedHours * 60), actual: duration(p + meal.minutes) };
  }
  if (w.notInLastWorkedHours != null && p > shift.worked - w.notInLastWorkedHours * 60) {
    return { rule: 'meal_too_late', limit: duration(shift.worked - w.notInLastWorkedHours * 60), actual: duration(p) };
  }
  if (w.clock) {
    const [a, b] = clockWindow(w.clock, shift);
    if (meal.start < a || meal.start + meal.minutes > b) {
      return { rule: 'meal_outside_hours', limit: `${clock(a)}–${clock(b)}`, actual: `${clock(meal.start)}–${clock(meal.start + meal.minutes)}` };
    }
  }
  return null;
}

// ── Rest ─────────────────────────────────────────────────────────────

/**
 * How many rest breaks a day of `workedMinutes` earns under `rest`.
 * @param {object} rest
 * @param {number} workedMinutes
 * @returns {number}
 */
function restBreaksDue(rest, workedMinutes) {
  const h = workedMinutes / 60;
  if (rest.table) {
    let n = 0;
    for (const [hours, op, count] of rest.table) if (op === '>' ? h > hours : h >= hours) n = count;
    return n;
  }
  if (rest.minimumShiftHours != null && h < rest.minimumShiftHours) return 0;
  const whole = Math.floor(h / rest.perHours);
  const rem = h - whole * rest.perHours;
  return whole + (rest.majorFraction && rem > rest.perHours / 2 ? 1 : 0);
}

// ── The check ────────────────────────────────────────────────────────

/**
 * The law behind a breach.
 * @param {string} code
 * @param {{ citations: object[], confidence: string, note?: string|null }} rule
 */
function source(code, rule) {
  return { jurisdiction: code, citations: rule.citations, confidence: rule.confidence, note: rule.note || null };
}

/**
 * Check one shift's breaks against the meal and rest break rules where the
 * work is done.
 *
 * @param {object} input
 * @param {string | { country: string, subdivision?: string }} input.jurisdiction - where the work is done
 * @param {string} input.date - 'YYYY-MM-DD', the day the shift starts
 * @param {string} input.start - 'HH:MM'
 * @param {string} input.end - 'HH:MM'; at or before the start runs past midnight
 * @param {Array<{ start: string, minutes: number, kind: 'meal'|'rest', onDuty?: boolean }>} [input.breaks]
 * @param {string[]} [input.waived] - ids of meal rules the employee validly waived for this shift
 * @param {{ industry?: string, employeesOnDuty?: number, employerEmployees?: number }} [input.facts]
 * @returns {object}
 */
function checkShift(input) {
  if (!input || typeof input !== 'object') throw new TypeError('checkShift takes an options object');
  const code = normalizeJurisdiction(input.jurisdiction);
  const shift = readShift(input);
  const facts = input.facts === undefined ? {} : input.facts;
  if (!facts || typeof facts !== 'object') throw new TypeError('facts must be an object');
  for (const k of Object.keys(facts)) if (!FACT_KEYS.includes(k)) throw new TypeError(`Unknown fact ${describe(k)}; expected one of ${FACT_KEYS.join(', ')}`);
  if (facts.industry !== undefined && !INDUSTRIES.includes(facts.industry)) throw new TypeError(`facts.industry must be one of ${INDUSTRIES.join(', ')}`);
  const waived = new Set(input.waived === undefined ? [] : input.waived);

  const result = {
    jurisdiction: code, known: true, workedMinutes: shift.worked,
    violations: [], owed: [], waivers: [], notes: [], assumptions: [],
  };
  const entry = TABLES[code];
  if (!entry) return { ...result, known: false, reason: 'unknown_jurisdiction' };
  if (entry.effectiveFrom && shift.date < entry.effectiveFrom) return { ...result, known: false, reason: 'no_rule_in_force' };

  const assumed = new Set();
  const breach = (rule, kind, fields, message) => result.violations.push({ rule: kind, ruleId: rule.id || 'rest', ...fields, ...source(code, rule), message });

  // Meals: each rule takes the earliest unused meal that satisfies it.
  const used = new Set();
  for (const rule of entry.meals) {
    if (!covered(rule.appliesWhen, facts, assumed) || !triggered(rule.trigger, shift)) continue;
    if (waived.has(rule.id)) {
      const w = rule.waiver;
      const ok = w && (w.maxWorkedHours == null || shift.worked <= w.maxWorkedHours * 60)
        && (!w.requiresNotWaived || !waived.has(w.requiresNotWaived));
      result.waivers.push({ ruleId: rule.id, allowed: Boolean(ok) });
      if (ok) continue;
    }
    if (rule.window && rule.window.maxStretch) {
      // "No more than N consecutive hours without a meal": every stretch between
      // meals that count is held to the limit, however long the shift.
      const { hours, op } = rule.window.maxStretch;
      const stops = shift.breaks.filter((b) => b.kind === 'meal' && b.minutes >= rule.minutes && (!b.onDuty || rule.onDutyAllowed));
      const s = longestStretch(shift, stops);
      if (past(s.minutes, hours, op)) {
        breach(rule, stops.length ? 'meal_too_late' : 'meal_missing', { limit: duration(hours * 60), actual: duration(s.minutes), from: clock(s.from) },
          `${duration(s.minutes)} worked from ${clock(s.from)} without a ${rule.minutes}-minute meal; the limit is ${op === '>' ? '' : 'under '}${duration(hours * 60)}`);
      }
      continue;
    }
    const candidates = shift.breaks.filter((b) => b.kind === 'meal' && !used.has(b) && (!b.onDuty || rule.onDutyAllowed));
    const fit = candidates.find((b) => !mealFault(rule, b, shift));
    if (fit) { used.add(fit); continue; }
    if (!candidates.length) {
      breach(rule, 'meal_missing', { limit: rule.minutes, actual: 0 }, `A shift of ${duration(shift.worked)} worked needs a ${rule.minutes}-minute meal (${rule.id})`);
      continue;
    }
    const best = candidates[0];
    used.add(best);
    const f = mealFault(rule, best, shift);
    breach(rule, f.rule, { limit: f.limit, actual: f.actual, break: best.index }, {
      meal_too_short: `The meal at ${clock(best.start)} is ${best.minutes} minutes; ${rule.minutes} are required`,
      meal_too_early: `The meal at ${clock(best.start)} starts after ${f.actual} worked; it may not start before ${f.limit}`,
      meal_too_late: `The meal at ${clock(best.start)} is late: ${f.actual} worked, the limit is ${f.limit}`,
      meal_outside_hours: `The meal at ${f.actual} must fall within ${f.limit}`,
    }[f.rule]);
  }

  // Rest.
  const rest = entry.rest;
  let restShort = 0;
  const restWaived = rest && waived.has('rest');
  if (restWaived) {
    const ok = Boolean(rest.waiver) && (rest.waiver.maxWorkedHours == null || shift.worked <= rest.waiver.maxWorkedHours * 60);
    result.waivers.push({ ruleId: 'rest', allowed: ok });
  }
  if (rest && covered(rest.appliesWhen, facts, assumed) && !(restWaived && result.waivers[result.waivers.length - 1].allowed)) {
    let due = restBreaksDue(rest, shift.worked);
    // A shift that itself runs past the "no longer than N hours without a
    // rest" limit needs at least one.
    if (rest.maxStretch && past(shift.worked, rest.maxStretch.hours, rest.maxStretch.op)) due = Math.max(due, 1);
    const taken = shift.breaks.filter((b) => b.kind === 'rest' && b.minutes >= rest.minutes);
    if (taken.length < due) {
      restShort = due - taken.length;
      breach(rest, 'rest_missing', { limit: due, actual: taken.length },
        `A shift of ${duration(shift.worked)} worked needs ${due} rest break${due === 1 ? '' : 's'} of ${rest.minutes} minutes; ${taken.length} given`);
    }
    if (rest.maxStretch && taken.length >= due && due > 0) {
      const { hours, op } = rest.maxStretch;
      const s = longestStretch(shift, taken);
      if (past(s.minutes, hours, op)) {
        breach(rest, 'rest_late', { limit: duration(hours * 60), actual: duration(s.minutes), from: clock(s.from) },
          `${duration(s.minutes)} worked from ${clock(s.from)} without a rest break; the limit is ${op === '>' ? '' : 'under '}${duration(hours * 60)}`);
      }
    }
  }

  // What a missed break costs, where the law sets it as pay to the employee.
  const p = entry.penalty;
  if (p) {
    const mealMissed = result.violations.some((v) => v.rule.startsWith('meal_'));
    const restMissed = result.violations.some((v) => v.rule.startsWith('rest_'));
    if (p.premiumHours && mealMissed) result.owed.push({ kind: 'premium_pay', for: 'meal', hours: p.premiumHours.meal, jurisdiction: code, citations: p.citations });
    if (p.premiumHours && restMissed) result.owed.push({ kind: 'premium_pay', for: 'rest', hours: p.premiumHours.rest, jurisdiction: code, citations: p.citations });
    if (p.missedRestPaid && restShort) result.owed.push({ kind: 'rest_time_pay', for: 'rest', minutes: restShort * rest.minutes, jurisdiction: code, citations: p.citations });
  }
  if (rest && rest.paid && shift.breaks.some((b) => b.kind === 'rest')) result.notes.push({ jurisdiction: code, note: 'Rest breaks are paid time.' });
  if (shift.breaks.some((b) => b.kind === 'meal' && b.onDuty)) result.notes.push({ jurisdiction: code, note: 'An on-duty meal is time worked, and is paid.' });
  for (const u of entry.unchecked) result.notes.push({ jurisdiction: code, note: u });
  result.assumptions.push(...[...assumed].sort());
  return result;
}

/**
 * Build checkShift's shift from clock punches: one work segment per
 * clock-in/clock-out pair, the gaps between them read as off-duty meals.
 * Paid rest breaks the employee did not clock out for go in `restBreaks`.
 *
 * @param {{ date: string, segments: Array<{ start: string, end: string }>, restBreaks?: Array<{ start: string, minutes: number }> }} input
 * @returns {{ date: string, start: string, end: string, breaks: object[] }}
 */
function shiftFromPunches(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.segments) || !input.segments.length) {
    throw new TypeError('shiftFromPunches takes { date, segments: [{ start, end }, ...] }');
  }
  parseDate('date', input.date);
  let prevEnd = null; let first = null;
  const spans = input.segments.map((s, i) => {
    let a = minutes(`segments[${i}].start`, s.start);
    let b = minutes(`segments[${i}].end`, s.end);
    if (first === null) first = a;
    if (a < first) a += DAY;
    if (b <= a) b += DAY;
    if (prevEnd !== null && a < prevEnd) throw new TypeError('segments must be in order and must not overlap');
    prevEnd = b;
    return [a, b];
  });
  const breaks = [];
  for (let i = 1; i < spans.length; i++) {
    breaks.push({ start: clock(spans[i - 1][1]).slice(0, 5), minutes: spans[i][0] - spans[i - 1][1], kind: 'meal' });
  }
  for (const r of input.restBreaks || []) breaks.push({ start: r.start, minutes: r.minutes, kind: 'rest' });
  return { date: input.date, start: clock(spans[0][0]).slice(0, 5), end: clock(spans[spans.length - 1][1]).slice(0, 5), breaks: breaks.filter((b) => b.minutes > 0) };
}

/**
 * The jurisdictions the tables cover, and the date they were checked.
 * @returns {{ asOf: string, jurisdictions: string[] }}
 */
function coverage() {
  return { asOf: AS_OF, jurisdictions: CODES.slice() };
}

module.exports = { checkShift, shiftFromPunches, rulesFor, coverage, normalizeJurisdiction, AS_OF, INDUSTRIES };
