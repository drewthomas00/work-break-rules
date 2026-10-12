'use strict';

/**
 * work-break-rules — does this workday give the meal and rest breaks the law
 * requires here?
 *
 * NOT LEGAL ADVICE. The tables cover the meal and rest break rules that US
 * states and DC set for adult employees of private, non-agricultural
 * employers. A place they do not cover answers "unknown", never "no rule".
 */

const { AS_OF, JURISDICTIONS: RAW } = require('./data');
const { deepFreeze } = require('./freeze');
const { minutes, duration, describe } = require('./time');
const { readWorkday } = require('./timeline');
const { validateEntry, INDUSTRIES } = require('./validate');

for (const [code, entry] of Object.entries(RAW)) validateEntry(code, entry);
const TABLES = deepFreeze(RAW);
const CODES = Object.keys(TABLES).sort();
const FACTS = ['industry', 'employeesOnDuty', 'retailEmployees', 'locationEmployees'];
const OPTIONS = ['jurisdiction', 'date', 'start', 'end', 'segments', 'breaks', 'waived', 'facts', 'timeZone'];

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
  return TABLES[code] || null;
}

/**
 * The jurisdictions the tables cover, and the date they were checked.
 * @returns {{ asOf: string, jurisdictions: string[] }}
 */
function coverage() {
  return { asOf: AS_OF, jurisdictions: CODES.slice() };
}

// ── Small predicates ─────────────────────────────────────────────────

/**
 * Does `mins` satisfy `{ hours, op }` ('>', '>=', '<', '<=')?
 * @param {number} mins
 * @param {{ hours: number, op: string }} b
 * @returns {boolean}
 */
function meets(mins, b) {
  const limit = b.hours * 60;
  switch (b.op) {
    case '>': return mins > limit;
    case '>=': return mins >= limit;
    case '<': return mins < limit;
    default: return mins <= limit;
  }
}

/**
 * Is the wall-clock minute `t` (any day) inside the daily range [a, b), which
 * may wrap past midnight?
 * @param {number} t
 * @param {[string, string]} range
 * @returns {boolean}
 */
function inClockRange(t, range) {
  const m = ((t % 1440) + 1440) % 1440;
  const a = minutes('clock', range[0]); const b = minutes('clock', range[1]);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

/**
 * Whether a rule's coverage condition holds, given the facts the caller knows.
 * A fact the caller did not give is assumed to bring the rule in (the stricter
 * reading), and is reported.
 * @param {object | null} when
 * @param {Record<string, any>} facts
 * @param {Set<string>} assumed
 * @returns {boolean}
 */
function covered(when, facts, assumed) {
  if (!when) return true;
  const known = (k) => { if (facts[k] === undefined) { assumed.add(k); return false; } return true; };
  if (when.industries && known('industry') && !when.industries.includes(facts.industry)) return false;
  if (when.exceptIndustries && known('industry') && when.exceptIndustries.includes(facts.industry)) return false;
  for (const [rule, fact] of [['minEmployeesOnDuty', 'employeesOnDuty'], ['minRetailEmployees', 'retailEmployees'], ['minLocationEmployees', 'locationEmployees']]) {
    if (when[rule] !== undefined && known(fact) && facts[fact] < when[rule]) return false;
  }
  return true;
}

// ── Meals ────────────────────────────────────────────────────────────

/**
 * Does a meal rule's trigger hold for this workday?
 * @param {object} t
 * @param {import('./timeline').Workday} day
 * @returns {boolean}
 */
function triggered(t, day) {
  if (t.minWorked && !meets(day.worked, t.minWorked)) return false;
  if (t.maxWorked && !meets(day.worked, t.maxWorked)) return false;
  if (t.minSpan && !meets(day.span, t.minSpan)) return false;
  if (t.overlapsClock) {
    const [lo, hi] = day.clockWindow(minutes('clock', t.overlapsClock[0]), minutes('clock', t.overlapsClock[1]));
    if (!(lo < day.span && hi > 0)) return false;
  }
  if (t.startsBetweenClock && !inClockRange(day.startWall, t.startsBetweenClock)) return false;
  if (t.startsBefore && !(day.startWall < minutes('clock', t.startsBefore))) return false;
  if (t.endsAfter && !(day.endWall > minutes('clock', t.endsAfter))) return false;
  return true;
}

/**
 * Why `meal` does not satisfy `rule`'s length and window, or null if it does.
 * @param {object} rule
 * @param {import('./timeline').Pause} meal
 * @param {import('./timeline').Workday} day
 * @returns {{ rule: string, limit: string|number, actual: string|number, message: string } | null}
 */
function mealFault(rule, meal, day) {
  const at = day.wallClock(meal.start);
  if (meal.minutes < rule.minutes) {
    return { rule: 'meal_too_short', limit: rule.minutes, actual: meal.minutes, message: `The meal at ${at} is ${meal.minutes} minutes; ${rule.minutes} are required` };
  }
  const w = rule.window || {};
  const p = meal.workedBefore;
  const early = (limitMins) => ({ rule: 'meal_too_early', limit: duration(limitMins), actual: duration(p), message: `The meal at ${at} starts after ${duration(p)} worked; it may not start before ${duration(limitMins)}` });
  const late = (limitMins, actualMins, what) => ({ rule: 'meal_too_late', limit: duration(limitMins), actual: duration(actualMins), message: `The meal at ${at} ${what} after ${duration(actualMins)} worked; the limit is ${duration(limitMins)}` });
  if (w.notBeforeWorkedHours !== undefined && p < w.notBeforeWorkedHours * 60) return early(w.notBeforeWorkedHours * 60);
  if (w.startByWorkedHours !== undefined && p > w.startByWorkedHours * 60) return late(w.startByWorkedHours * 60, p, 'starts');
  if (w.endByWorkedHours !== undefined && p + meal.minutes > w.endByWorkedHours * 60) return late(w.endByWorkedHours * 60, p + meal.minutes, 'ends');
  if (w.notInLastWorkedHours !== undefined && p > day.worked - w.notInLastWorkedHours * 60) return late(day.worked - w.notInLastWorkedHours * 60, p, 'starts');
  if (w.clock) {
    const [lo, hi] = day.clockWindow(minutes('clock', w.clock[0]), minutes('clock', w.clock[1]));
    if (meal.start < lo || meal.start + meal.minutes > hi) {
      const span = `${day.wallClock(lo)}–${day.wallClock(hi)}`;
      return { rule: 'meal_outside_hours', limit: span, actual: `${at}–${day.wallClock(meal.start + meal.minutes)}`, message: `The meal at ${at} must fall within ${span}` };
    }
  }
  return null;
}

/**
 * The longest stretch worked between `stops`.
 * @param {import('./timeline').Workday} day
 * @param {import('./timeline').Pause[]} stops
 * @returns {{ from: number, minutes: number }}
 */
function longestStretch(day, stops) {
  let from = 0; let longest = { from: 0, minutes: 0 };
  for (const [at, resume] of [...stops.map((p) => [p.start, p.start + p.minutes]), [day.span, day.span]]) {
    const worked = day.workedAt(at) - day.workedAt(from);
    if (worked > longest.minutes) longest = { from, minutes: worked };
    from = resume;
  }
  return longest;
}

/**
 * Check the meal rules. Each rule takes the earliest unused meal that
 * satisfies it, so one meal never satisfies two rules.
 * @param {object} entry
 * @param {import('./timeline').Workday} day
 * @param {{ facts: object, assumed: Set<string>, waived: Set<string>, waivers: object[], breach: Function }} ctx
 */
function checkMeals(entry, day, ctx) {
  const used = new Set();
  for (const rule of entry.meals) {
    if (!covered(rule.appliesWhen, ctx.facts, ctx.assumed) || !triggered(rule.trigger, day)) continue;
    if (waivedOk(rule.id, rule.waiver, day, ctx)) continue;
    const counts = (p) => p.kind === 'meal' && (!p.onDuty || rule.onDutyAllowed);
    if (rule.window && rule.window.maxStretch) {
      // "No more than N hours without a meal": every stretch between meals
      // that count is held to the limit, however long the day.
      const stops = day.pauses.filter((p) => counts(p) && p.minutes >= rule.minutes);
      const s = longestStretch(day, stops);
      if (!meets(s.minutes, rule.window.maxStretch)) {
        const limit = duration(rule.window.maxStretch.hours * 60);
        ctx.breach(rule, stops.length ? 'meal_too_late' : 'meal_missing', { limit, actual: duration(s.minutes), from: day.wallClock(s.from) },
          `${duration(s.minutes)} worked from ${day.wallClock(s.from)} without a ${rule.minutes}-minute meal; the limit is ${rule.window.maxStretch.op === '<' ? 'under ' : ''}${limit}`);
      }
      continue;
    }
    const candidates = day.pauses.filter((p) => counts(p) && !used.has(p));
    const fit = candidates.find((p) => !mealFault(rule, p, day));
    if (fit) { used.add(fit); continue; }
    if (!candidates.length) {
      ctx.breach(rule, 'meal_missing', { limit: rule.minutes, actual: 0 }, `${duration(day.worked)} worked needs a ${rule.minutes}-minute meal (${rule.id})`);
      continue;
    }
    const best = candidates[0];
    used.add(best);
    const f = /** @type {NonNullable<ReturnType<typeof mealFault>>} */ (mealFault(rule, best, day));
    ctx.breach(rule, f.rule, { limit: f.limit, actual: f.actual, break: best.index }, f.message);
  }
}

/**
 * Is a waiver of `id` on record, and does the rule allow it here? Records it.
 * @param {string} id
 * @param {{ maxWorkedHours?: number, requiresNotWaived?: string } | null} waiver
 * @param {import('./timeline').Workday} day
 * @param {{ waived: Set<string>, waivers: object[] }} ctx
 * @returns {boolean}
 */
function waivedOk(id, waiver, day, ctx) {
  if (!ctx.waived.has(id)) return false;
  const ok = waiver !== null
    && (waiver.maxWorkedHours === undefined || day.worked <= waiver.maxWorkedHours * 60)
    && (waiver.requiresNotWaived === undefined || !ctx.waived.has(waiver.requiresNotWaived));
  ctx.waivers.push({ ruleId: id, allowed: ok });
  return ok;
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
  if (rest.minimumShiftHours !== null && h < rest.minimumShiftHours) return 0;
  const whole = Math.floor(h / rest.perHours);
  const rem = h - whole * rest.perHours;
  return whole + (rest.majorFraction && rem > rest.perHours / 2 ? 1 : 0);
}

/**
 * Check the rest rule.
 * @param {object} entry
 * @param {import('./timeline').Workday} day
 * @param {{ facts: object, assumed: Set<string>, waived: Set<string>, waivers: object[], breach: Function }} ctx
 * @returns {number} rest breaks missing or late
 */
function checkRest(entry, day, ctx) {
  const rest = entry.rest;
  if (!rest || !covered(rest.appliesWhen, ctx.facts, ctx.assumed)) return 0;
  if (waivedOk('rest', rest.waiver, day, ctx)) return 0;
  let due = restBreaksDue(rest, day.worked);
  // A day that itself runs past "no longer than N hours without a rest" needs one.
  if (rest.maxStretch && !meets(day.worked, rest.maxStretch)) due = Math.max(due, 1);
  const taken = day.pauses.filter((p) => p.kind === 'rest' && p.minutes >= rest.minutes);
  if (taken.length < due) {
    ctx.breach(rest, 'rest_missing', { limit: due, actual: taken.length },
      `${duration(day.worked)} worked needs ${due} rest break${due === 1 ? '' : 's'} of ${rest.minutes} minutes; ${taken.length} given`);
    return due - taken.length;
  }
  if (rest.maxStretch && due > 0) {
    const s = longestStretch(day, taken);
    if (!meets(s.minutes, rest.maxStretch)) {
      const limit = duration(rest.maxStretch.hours * 60);
      ctx.breach(rest, 'rest_late', { limit, actual: duration(s.minutes), from: day.wallClock(s.from) },
        `${duration(s.minutes)} worked from ${day.wallClock(s.from)} without a rest break; the limit is ${rest.maxStretch.op === '<' ? 'under ' : ''}${limit}`);
      return 1;
    }
  }
  return 0;
}

// ── The check ────────────────────────────────────────────────────────

/**
 * Check one workday's breaks against the meal and rest break rules where the
 * work is done.
 *
 * @param {object} input
 * @param {string | { country: string, subdivision?: string }} input.jurisdiction - where the work is done
 * @param {string} input.date - 'YYYY-MM-DD', the day the workday starts
 * @param {string} [input.start] - 'HH:MM', for a single stretch of work
 * @param {string} [input.end] - 'HH:MM'; at or before the start runs past midnight
 * @param {Array<{ start: string, end: string }>} [input.segments] - instead of start/end: every stretch of work in the day (clock-in to clock-out); the gaps are off duty
 * @param {Array<{ start: string, minutes: number, kind: 'meal'|'rest', onDuty?: boolean }>} [input.breaks] - breaks inside the segments
 * @param {string[]} [input.waived] - ids of rules (a meal rule's id, or 'rest') the employee validly waived for this day
 * @param {{ industry?: string, employeesOnDuty?: number, retailEmployees?: number, locationEmployees?: number }} [input.facts]
 * @param {string} [input.timeZone] - IANA zone of the workplace; counts real time across a daylight-saving change
 * @returns {object}
 */
function checkWorkday(input) {
  if (!input || typeof input !== 'object') throw new TypeError('checkWorkday takes an options object');
  for (const k of Object.keys(input)) if (!OPTIONS.includes(k)) throw new TypeError(`Unknown option ${describe(k)}; expected one of ${OPTIONS.join(', ')}`);
  const code = normalizeJurisdiction(input.jurisdiction);
  const day = readWorkday(input);
  const facts = readFacts(input.facts);
  const waived = new Set(readWaived(input.waived));

  const result = {
    jurisdiction: code, known: true, workedMinutes: day.worked, spanMinutes: day.span,
    violations: [], owed: [], waivers: [], notes: [], assumptions: [],
  };
  const entry = TABLES[code];
  if (!entry) return { ...result, known: false, reason: 'unknown_jurisdiction' };
  if (entry.effectiveFrom && day.date < entry.effectiveFrom) return { ...result, known: false, reason: 'no_rule_in_force' };
  for (const id of waived) {
    if (id !== 'rest' && !entry.meals.some((m) => m.id === id)) throw new TypeError(`waived names ${describe(id)}, which is not a rule in ${code}; its rules are ${[...new Set(entry.meals.map((m) => m.id)), ...(entry.rest ? ['rest'] : [])].join(', ') || 'none'}`);
  }

  const assumed = new Set();
  const ctx = {
    facts, assumed, waived, waivers: result.waivers,
    breach: (rule, kind, fields, message) => result.violations.push({
      rule: kind, ruleId: rule.id || 'rest', ...fields,
      jurisdiction: code, citations: rule.citations, confidence: rule.confidence, note: rule.note, message,
    }),
  };
  checkMeals(entry, day, ctx);
  const restShort = checkRest(entry, day, ctx);

  // What a missed break costs, where the law sets it as pay to the employee.
  const p = entry.penalty;
  if (p) {
    const owe = (o) => result.owed.push({ ...o, jurisdiction: code, citations: p.citations });
    if (p.premiumHours && result.violations.some((v) => v.rule.startsWith('meal_'))) owe({ kind: 'premium_pay', for: 'meal', hours: p.premiumHours.meal });
    if (p.premiumHours && result.violations.some((v) => v.rule.startsWith('rest_'))) owe({ kind: 'premium_pay', for: 'rest', hours: p.premiumHours.rest });
    if (p.missedRestPaid && restShort) owe({ kind: 'rest_time_pay', for: 'rest', minutes: restShort * entry.rest.minutes });
  }
  if (entry.rest && entry.rest.paid && day.pauses.some((x) => x.kind === 'rest')) result.notes.push({ jurisdiction: code, note: 'Rest breaks are paid time.' });
  if (day.pauses.some((x) => x.kind === 'meal' && x.onDuty)) result.notes.push({ jurisdiction: code, note: 'An on-duty meal is time worked, and is paid.' });
  for (const u of entry.unchecked) result.notes.push({ jurisdiction: code, note: u });
  result.assumptions.push(...[...assumed].sort());
  if (!day.zoned) result.assumptions.push('wall_clock');
  return result;
}

/**
 * @param {unknown} facts
 * @returns {Record<string, any>}
 */
function readFacts(facts) {
  if (facts === undefined) return {};
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new TypeError('facts must be an object');
  const f = /** @type {Record<string, unknown>} */ (facts);
  for (const k of Object.keys(f)) if (!FACTS.includes(k)) throw new TypeError(`Unknown fact ${describe(k)}; expected one of ${FACTS.join(', ')}`);
  if (f.industry !== undefined && !INDUSTRIES.includes(/** @type {string} */ (f.industry))) throw new TypeError(`facts.industry must be one of ${INDUSTRIES.join(', ')}`);
  for (const k of FACTS.slice(1)) if (f[k] !== undefined && !(Number.isInteger(f[k]) && /** @type {number} */ (f[k]) >= 0)) throw new TypeError(`facts.${k} must be a whole number`);
  return f;
}

/**
 * @param {unknown} waived
 * @returns {string[]}
 */
function readWaived(waived) {
  if (waived === undefined) return [];
  if (!Array.isArray(waived) || !waived.every((w) => typeof w === 'string')) throw new TypeError('waived must be an array of rule ids');
  return waived;
}

module.exports = { checkWorkday, rulesFor, coverage, normalizeJurisdiction, AS_OF, INDUSTRIES };
