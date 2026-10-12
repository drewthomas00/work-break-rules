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
const { parseDate, minutes, duration, describe } = require('./time');
const { readWorkday } = require('./timeline');
const { validateJurisdiction, INDUSTRIES } = require('./validate');

for (const [code, value] of Object.entries(RAW)) validateJurisdiction(code, value);
const TABLES = deepFreeze(RAW);
const CODES = Object.keys(TABLES).sort();
const FACTS = ['industry', 'employeesOnDuty', 'retailEmployees', 'locationEmployees'];
const OPTIONS = ['jurisdiction', 'date', 'start', 'end', 'segments', 'breaks', 'waived', 'facts', 'timeZone'];

// ── Jurisdictions ────────────────────────────────────────────────────

/**
 * Normalise a jurisdiction to 'US-XX' (or 'US' for federal law). Accepts
 * 'US-CA', 'us-ca', or { country: 'US', subdivision: 'CA' } ('US-CA' as the
 * subdivision too). Anything unreadable throws; a well-formed place outside
 * the tables is returned as is (and answers unknown).
 * @param {unknown} input
 * @returns {string}
 */
function normalizeJurisdiction(input) {
  let code;
  if (typeof input === 'string') code = input.trim().toUpperCase();
  else if (input && typeof input === 'object' && typeof (/** @type {any} */ (input)).country === 'string') {
    const o = /** @type {{ country: string, subdivision?: unknown }} */ (input);
    const country = o.country.trim().toUpperCase();
    let sub = typeof o.subdivision === 'string' ? o.subdivision.trim().toUpperCase() : '';
    if (sub.startsWith(`${country}-`)) sub = sub.slice(country.length + 1);
    code = sub ? `${country}-${sub}` : country;
  }
  if (!code || !/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(code)) {
    throw new TypeError(`jurisdiction must be an ISO 3166 code like 'US-CA', got ${describe(input)}`);
  }
  return code;
}

/**
 * The versions of a jurisdiction's rules, oldest first.
 * @param {string} code
 * @returns {any[] | null}
 */
function versionsOf(code) {
  const v = TABLES[code];
  if (!v) return null;
  return Array.isArray(v) ? v : [v];
}

/**
 * The rules in force on a date: the last version whose effectiveFrom is on or
 * before it. null before the first.
 * @param {any[]} versions
 * @param {string} date
 * @returns {any | null}
 */
function versionOn(versions, date) {
  let found = null;
  for (const v of versions) if (!v.effectiveFrom || v.effectiveFrom <= date) found = v;
  return found;
}

/**
 * The rules for a place: those in force on `on`, or the current ones. null
 * when the tables do not cover the place, or hold no rule in force that day.
 * @param {unknown} jurisdiction
 * @param {{ on?: string }} [options]
 * @returns {object | null}
 */
function rulesFor(jurisdiction, options = {}) {
  const versions = versionsOf(normalizeJurisdiction(jurisdiction));
  if (!versions) return null;
  if (options.on === undefined) return versions[versions.length - 1];
  parseDate('on', options.on);
  return versionOn(versions, options.on);
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
 * @param {any} when
 * @param {Record<string, any>} facts
 * @param {Set<string>} assumed
 * @returns {boolean}
 */
function covered(when, facts, assumed) {
  if (!when) return true;
  const used = new Set();
  const known = (k) => { if (facts[k] === undefined) { used.add(k); return false; } return true; };
  let applies = true;
  if (when.industries && known('industry') && !when.industries.includes(facts.industry)) applies = false;
  if (when.exceptIndustries && known('industry') && when.exceptIndustries.includes(facts.industry)) applies = false;
  for (const [rule, fact] of [['minEmployeesOnDuty', 'employeesOnDuty'], ['minRetailEmployees', 'retailEmployees'], ['minLocationEmployees', 'locationEmployees']]) {
    if (when[rule] !== undefined && known(fact) && facts[fact] < when[rule]) applies = false;
  }
  // An assumption counts only where it decided the answer.
  if (applies) for (const k of used) assumed.add(k);
  return applies;
}

// ── Meals ────────────────────────────────────────────────────────────

/**
 * Does a meal rule's trigger hold for this workday? A clock window the day
 * overlaps by less than the meal's length cannot hold the meal, so it does
 * not trigger the rule.
 * @param {any} rule
 * @param {import('./timeline').Workday} day
 * @returns {boolean}
 */
function triggered(rule, day) {
  const t = rule.trigger;
  if (t.minWorked && !meets(day.worked, t.minWorked)) return false;
  if (t.maxWorked && !meets(day.worked, t.maxWorked)) return false;
  if (t.minSpan && !meets(day.span, t.minSpan)) return false;
  if (t.overlapsClock) {
    const [lo, hi] = day.clockWindow(minutes('clock', t.overlapsClock[0]), minutes('clock', t.overlapsClock[1]));
    if (Math.min(hi, day.span) - Math.max(lo, 0) < rule.minutes) return false;
  }
  if (t.startsBetweenClock && !inClockRange(day.startWall, t.startsBetweenClock)) return false;
  if (t.startsBefore && !(day.startWall < minutes('clock', t.startsBefore))) return false;
  if (t.endsAfter && !(day.endWall > minutes('clock', t.endsAfter))) return false;
  return true;
}

/**
 * How many meals a rule asks for: one, or with `repeat`, one more for every
 * further `everyHours` worked past the trigger.
 * @param {any} rule
 * @param {import('./timeline').Workday} day
 * @returns {number}
 */
function mealsDue(rule, day) {
  if (!rule.repeat) return 1;
  const past = day.worked - rule.trigger.minWorked.hours * 60;
  return 1 + Math.floor(past / (rule.repeat.everyHours * 60));
}

/**
 * Why `meal` does not satisfy `rule`'s length and window, or null if it does.
 * Durations in the result are minutes.
 * @param {any} rule
 * @param {import('./timeline').Pause} meal
 * @param {import('./timeline').Workday} day
 * @returns {{ rule: string, limit: number | null, actual: number | null, window?: string, given?: string, message: string } | null}
 */
function mealFault(rule, meal, day) {
  const at = day.wallClock(meal.start);
  if (meal.minutes < rule.minutes) {
    return { rule: 'meal_too_short', limit: rule.minutes, actual: meal.minutes, message: `The meal at ${at} is ${meal.minutes} minutes; ${rule.minutes} are required` };
  }
  const w = rule.window || {};
  const p = meal.workedBefore;
  const early = (limit) => ({ rule: 'meal_too_early', limit, actual: p, message: `The meal at ${at} starts after ${duration(p)} worked; it may not start before ${duration(limit)}` });
  const late = (limit, actual, verb) => ({ rule: 'meal_too_late', limit, actual, message: `The meal at ${at} ${verb} after ${duration(actual)} worked; the limit is ${duration(limit)}` });
  if (w.notBeforeWorkedHours !== undefined && p < w.notBeforeWorkedHours * 60) return early(w.notBeforeWorkedHours * 60);
  if (w.startByWorkedHours !== undefined && p > w.startByWorkedHours * 60) return late(w.startByWorkedHours * 60, p, 'starts');
  if (w.endByWorkedHours !== undefined && p + meal.minutes > w.endByWorkedHours * 60) return late(w.endByWorkedHours * 60, p + meal.minutes, 'ends');
  if (w.notInLastWorkedHours !== undefined && p > day.worked - w.notInLastWorkedHours * 60) return late(day.worked - w.notInLastWorkedHours * 60, p, 'starts');
  if (w.clock) {
    const [lo, hi] = day.clockWindow(minutes('clock', w.clock[0]), minutes('clock', w.clock[1]));
    if (meal.start < lo || meal.start + meal.minutes > hi) {
      const window = `${day.wallClock(lo)}–${day.wallClock(hi)}`;
      return { rule: 'meal_outside_hours', limit: null, actual: null, window, given: `${at}–${day.wallClock(meal.start + meal.minutes)}`, message: `The meal at ${at} must fall within ${window}` };
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
 * The largest set of (meal rule, meal) pairs that satisfy each other, each
 * meal used once. Tables hold at most a handful of meal rules a day, so an
 * exhaustive search is cheap, and unlike first-fit it never fails a day that
 * some assignment would pass.
 * @param {Array<{ rule: any }>} slots - one per meal a rule asks for
 * @param {import('./timeline').Pause[]} meals
 * @param {import('./timeline').Workday} day
 * @param {(rule: any) => (p: import('./timeline').Pause) => boolean} counts - whether a meal may count for a rule at all
 * @returns {Array<import('./timeline').Pause | null>} the meal for each slot, or null
 */
function assignMeals(slots, meals, day, counts) {
  const fits = slots.map(({ rule }) => meals.map((m) => counts(rule)(m) && !mealFault(rule, m, day)));
  let best = { count: -1, pick: /** @type {Array<number>} */ ([]) };
  const pick = [];
  const used = new Set();
  const search = (i, count) => {
    if (count + (slots.length - i) <= best.count) return;
    if (i === slots.length) { if (count > best.count) best = { count, pick: pick.slice() }; return; }
    for (let j = 0; j < meals.length; j++) {
      if (used.has(j) || !fits[i][j]) continue;
      used.add(j); pick.push(j);
      search(i + 1, count + 1);
      used.delete(j); pick.pop();
    }
    pick.push(-1);
    search(i + 1, count);
    pick.pop();
  };
  search(0, 0);
  return best.pick.map((j) => (j >= 0 ? meals[j] : null));
}

/**
 * Check the meal rules.
 * @param {any} entry
 * @param {import('./timeline').Workday} day
 * @param {any} ctx
 */
function checkMeals(entry, day, ctx) {
  const counts = (rule) => (p) => p.kind === 'meal' && (!p.onDuty || rule.onDutyAllowed);
  const slots = [];
  for (const rule of entry.meals) {
    if (!triggered(rule, day) || !covered(rule.appliesWhen, ctx.facts, ctx.assumed)) continue;
    if (waivedOk(rule.id, rule.waiver, day, ctx)) continue;
    if (rule.window && rule.window.maxStretch) {
      // "No more than N hours without a meal": every stretch between meals
      // that count is held to the limit, however long the day.
      const stops = day.pauses.filter((p) => counts(rule)(p) && p.minutes >= rule.minutes);
      const s = longestStretch(day, stops);
      if (!meets(s.minutes, rule.window.maxStretch)) {
        const short = day.pauses.find((p) => counts(rule)(p) && p.minutes < rule.minutes && p.start >= s.from && p.start < s.from + s.minutes + 1);
        const limit = rule.window.maxStretch.hours * 60;
        ctx.missedMealMinutes += rule.minutes;
        if (short) {
          ctx.breach(rule, 'meal_too_short', { limit: rule.minutes, actual: short.minutes, break: short.index, at: short.start },
            `The meal at ${day.wallClock(short.start)} is ${short.minutes} minutes; ${rule.minutes} are required`);
        } else {
          ctx.breach(rule, stops.length ? 'meal_too_late' : 'meal_missing', { limit, actual: s.minutes, at: s.from, from: day.wallClock(s.from) },
            `${duration(s.minutes)} worked from ${day.wallClock(s.from)} without a ${rule.minutes}-minute meal; the limit is ${rule.window.maxStretch.op === '<' ? 'under ' : ''}${duration(limit)}`);
        }
      }
      continue;
    }
    for (let n = mealsDue(rule, day); n > 0; n--) slots.push({ rule });
  }

  const meals = day.pauses.filter((p) => p.kind === 'meal');
  const usable = slots.map(({ rule }) => meals.filter(counts(rule)));
  const chosen = assignMeals(slots, meals, day, counts);
  const used = new Set(chosen.filter(Boolean));
  slots.forEach(({ rule }, i) => {
    if (chosen[i]) return;
    ctx.missedMealMinutes += rule.minutes;
    // Judge the miss against the longest meal no rule took: the one nearest to
    // satisfying it.
    const left = usable[i].filter((m) => !used.has(m)).sort((a, b) => b.minutes - a.minutes || a.start - b.start);
    if (!left.length) {
      ctx.breach(rule, 'meal_missing', { limit: rule.minutes, actual: 0 }, `${duration(day.worked)} worked needs a ${rule.minutes}-minute meal (${rule.id})`);
      return;
    }
    const f = /** @type {NonNullable<ReturnType<typeof mealFault>>} */ (mealFault(rule, left[0], day));
    const { rule: kind, message, ...fields } = f;
    ctx.breach(rule, kind, { ...fields, break: left[0].index, at: left[0].start }, message);
  });
}

/**
 * Is a waiver of `id` on record, and does the rule allow it here? Records it.
 * @param {string} id
 * @param {{ maxWorkedHours?: number, requiresNotWaived?: string } | null} waiver
 * @param {import('./timeline').Workday} day
 * @param {any} ctx
 * @returns {boolean}
 */
function waivedOk(id, waiver, day, ctx) {
  if (!ctx.waived.has(id)) return false;
  const ok = waiver !== null
    && (waiver.maxWorkedHours === undefined || day.worked <= waiver.maxWorkedHours * 60)
    && (waiver.requiresNotWaived === undefined || !ctx.allowed.has(waiver.requiresNotWaived));
  ctx.waivers.push({ ruleId: id, allowed: ok });
  if (ok) ctx.allowed.add(id);
  return ok;
}

// ── Rest ─────────────────────────────────────────────────────────────

/**
 * How many rest breaks a day of `workedMinutes` earns under `rest`.
 * @param {any} rest
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
 * @param {any} entry
 * @param {import('./timeline').Workday} day
 * @param {any} ctx
 * @returns {number} rest breaks missed, or taken too late
 */
function checkRest(entry, day, ctx) {
  const rest = entry.rest;
  if (!rest) return 0;
  let due = restBreaksDue(rest, day.worked);
  // A day that itself runs past "no longer than N hours without a rest" needs one.
  if (rest.maxStretch && !meets(day.worked, rest.maxStretch)) due = Math.max(due, 1);
  if (!due || !covered(rest.appliesWhen, ctx.facts, ctx.assumed)) return 0;
  ctx.restApplies = true;
  if (waivedOk('rest', rest.waiver, day, ctx)) return 0;
  const taken = day.pauses.filter((p) => p.kind === 'rest' && p.minutes >= rest.minutes);
  if (taken.length < due) {
    ctx.breach(rest, 'rest_missing', { limit: due, actual: taken.length },
      `${duration(day.worked)} worked needs ${due} rest break${due === 1 ? '' : 's'} of ${rest.minutes} minutes; ${taken.length} given`);
    return due - taken.length;
  }
  if (rest.maxStretch) {
    const s = longestStretch(day, taken);
    if (!meets(s.minutes, rest.maxStretch)) {
      const limit = rest.maxStretch.hours * 60;
      ctx.breach(rest, 'rest_late', { limit, actual: s.minutes, at: s.from, from: day.wallClock(s.from) },
        `${duration(s.minutes)} worked from ${day.wallClock(s.from)} without a rest break; the limit is ${rest.maxStretch.op === '<' ? 'under ' : ''}${duration(limit)}`);
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
 * @param {Array<{ start: string, end: string }>} [input.segments] - instead of start/end: every stretch of work in the day, in order; the gaps are off duty
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
  const versions = versionsOf(code);
  if (!versions) return { ...result, known: false, reason: 'unknown_jurisdiction' };
  const entry = versionOn(versions, day.date);
  if (!entry) return { ...result, known: false, reason: 'no_rule_in_force' };
  const ids = [...new Set(entry.meals.map((m) => m.id)), ...(entry.rest ? ['rest'] : [])];
  for (const id of waived) {
    if (!ids.includes(id)) throw new TypeError(`waived names ${describe(id)}, which is not a rule in ${code} on ${day.date}; its rules are ${ids.join(', ') || 'none'}`);
  }

  const ctx = {
    facts, waived, assumed: new Set(), allowed: new Set(), waivers: result.waivers, restApplies: false, missedMealMinutes: 0,
    breach: (rule, kind, fields, message) => result.violations.push({
      rule: kind, ruleId: rule.id || 'rest', ...fields,
      jurisdiction: code, citations: rule.citations, confidence: rule.confidence, note: rule.note, message,
    }),
  };
  checkMeals(entry, day, ctx);
  const restMissed = checkRest(entry, day, ctx);
  result.owed.push(...owedFor(entry, ctx.missedMealMinutes, restMissed, code));

  if (ctx.restApplies && entry.rest.paid && day.pauses.some((x) => x.kind === 'rest')) result.notes.push({ jurisdiction: code, note: 'Rest breaks are paid time.' });
  if (day.pauses.some((x) => x.kind === 'meal' && x.onDuty)) result.notes.push({ jurisdiction: code, note: 'An on-duty meal is time worked, and is paid.' });
  for (const u of entry.unchecked) result.notes.push({ jurisdiction: code, note: u });
  result.assumptions.push(...[...ctx.assumed].sort());
  if (!day.zoned) result.assumptions.push('wall_clock');
  return result;
}

/**
 * The pay the law sets for the breaches found, where it is pay to the
 * employee: a premium per workday, or the missed break's own time (times a
 * multiplier where the law adds damages).
 * @param {any} entry
 * @param {number} missedMealMinutes - the required minutes of every meal missed, short, or out of its window
 * @param {number} restMissed - rest breaks missed, or taken too late
 * @param {string} code
 * @returns {object[]}
 */
function owedFor(entry, missedMealMinutes, restMissed, code) {
  const p = entry.penalty;
  if (!p) return [];
  const owed = [];
  const base = { jurisdiction: code, citations: p.citations };
  if (p.premiumHours && missedMealMinutes) owed.push({ kind: 'premium_pay', for: 'meal', hours: p.premiumHours.meal, ...base });
  if (p.premiumHours && restMissed) owed.push({ kind: 'premium_pay', for: 'rest', hours: p.premiumHours.rest, ...base });
  const paid = p.breakTimePaid;
  if (paid && paid.meal && missedMealMinutes) owed.push({ kind: 'break_time_pay', for: 'meal', minutes: missedMealMinutes * paid.multiplier, ...base });
  if (paid && paid.rest && restMissed) owed.push({ kind: 'break_time_pay', for: 'rest', minutes: restMissed * entry.rest.minutes * paid.multiplier, ...base });
  return owed;
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
