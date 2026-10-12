'use strict';

/**
 * A workday as a timeline in real minutes from its first start.
 *
 * The caller gives wall-clock times: the work segments (clock-in to clock-out,
 * or a planned shift's start and end) and the breaks inside them. Each time is
 * placed at the first moment, after the time before it, at which the clock
 * reads it — later the same day, or the next day. With a time zone those
 * moments are instants, so a day across a daylight-saving change counts the
 * hour it gains or loses, and a time in the repeated hour after the clocks go
 * back reads as its second occurrence when it follows a time in the first.
 * Without one, they are wall-clock minutes.
 */

const { parseDate, minutes, clock, describe, zoneFormat, wallAt, instantsOf, DAY, MINUTE } = require('./time');

const KINDS = ['meal', 'rest'];
const SEGMENT_KEYS = ['start', 'end'];
const BREAK_KEYS = ['start', 'minutes', 'kind', 'onDuty'];

/**
 * @typedef {object} Pause
 * @property {'meal'|'rest'} kind
 * @property {number} start - real minutes from the workday's start
 * @property {number} minutes
 * @property {boolean} onDuty - a meal eaten while working: time worked, and paid
 * @property {number | null} index - its index in `breaks`, or null for a gap between segments
 * @property {number} workedBefore - minutes worked when it starts
 */

/**
 * @typedef {object} Workday
 * @property {string} date
 * @property {number} span - real minutes from the first start to the last end
 * @property {number} worked - real minutes worked: the span less off-duty time
 * @property {Pause[]} pauses - breaks and gaps, in order
 * @property {number} startWall - the first start, minutes after midnight
 * @property {number} endWall - the last end on the same scale (past 1440 the next day)
 * @property {(t: number) => number} workedAt - minutes worked by real minute t
 * @property {(t: number) => string} wallClock - 'HH:MM' on the wall clock at real minute t
 * @property {(a: number, b: number) => [number, number]} clockWindow - a daily wall-clock window [a, b) as real minutes, the copy that meets the workday
 * @property {boolean} zoned
 */

/**
 * The moments, in absolute minutes, at which the workplace clock reads `w`
 * minutes after the midnight that begins `date` (w may run into the next day).
 * @param {string} date
 * @param {string | undefined} tz
 * @returns {(w: number) => number[]}
 */
function momentsOf(date, tz) {
  if (!tz) return (w) => [w];
  return (w) => instantsOf(date, w, tz).map((e) => Math.round(e / MINUTE));
}

/**
 * Refuse keys a caller did not mean: a typo must not change the answer.
 * @param {Record<string, unknown>} o
 * @param {string[]} allowed
 * @param {string} what
 */
function onlyKeys(o, allowed, what) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new TypeError(`${what} has unknown key ${describe(k)}; expected ${allowed.join(', ')}`);
}

/**
 * Read the work segments: wall-clock times, each placed after the last.
 * @param {any} input - the checker's options; any until checked here
 * @param {(w: number) => number[]} moments
 * @param {string | undefined} tz
 * @returns {{ segments: Array<{ s: number, e: number }>, origin: number, startWall: number, endWall: number }}
 */
function readSegments(input, moments, tz) {
  let raw;
  if (input.segments !== undefined) {
    if (input.start !== undefined || input.end !== undefined) throw new TypeError('give start and end, or segments, not both');
    if (!Array.isArray(input.segments) || !input.segments.length) throw new TypeError('segments must be a non-empty array of { start, end }');
    raw = input.segments.map((s, i) => {
      if (!s || typeof s !== 'object') throw new TypeError(`segments[${i}] must be { start, end }`);
      onlyKeys(s, SEGMENT_KEYS, `segments[${i}]`);
      return [minutes(`segments[${i}].start`, s.start), minutes(`segments[${i}].end`, s.end), `segments[${i}]`];
    });
  } else {
    raw = [[minutes('start', input.start), minutes('end', input.end), 'the shift']];
  }

  const first = moments(raw[0][0]);
  if (!first.length) throw new TypeError(`${raw[0][2]}.start: ${clock(raw[0][0])} does not exist on ${input.date} in ${tz} (the clocks go forward)`);
  const origin = first[0];
  let prev = origin; let prevWall = raw[0][0];
  /**
   * The first moment after `prev` (or at it, unless strict) at which the clock reads `m`.
   * @param {number} m
   * @param {boolean} strict
   * @param {string} what
   */
  const place = (m, strict, what) => {
    for (const w of [m, m + DAY, m + 2 * DAY]) {
      const at = moments(w).find((x) => (strict ? x > prev : x >= prev));
      if (at !== undefined) {
        if (at - origin > DAY) break;
        prev = at; prevWall = w;
        return at;
      }
    }
    throw new TypeError(`${what}: ${clock(m)} ${moments(m).length || !tz ? 'is more than 24 hours after the start' : `does not exist on that day in ${tz} (the clocks go forward)`}; a workday is checked within 24 hours`);
  };
  const segments = raw.map(([s, e, what], i) => {
    // A segment may start the minute the last one ended; it must end after it starts.
    const start = i === 0 ? origin : place(s, false, `${what}.start`);
    const end = place(e, true, `${what}.end`);
    return { s: start - origin, e: end - origin };
  });
  return { segments, origin, startWall: raw[0][0], endWall: prevWall };
}

/**
 * Read the breaks, each inside a work segment.
 * @param {unknown} breaks
 * @param {Array<{ s: number, e: number }>} segments
 * @param {(w: number) => number[]} moments
 * @param {number} origin
 * @returns {Pause[]}
 */
function readBreaks(breaks, segments, moments, origin) {
  if (breaks === undefined) return [];
  if (!Array.isArray(breaks)) throw new TypeError('breaks must be an array');
  return breaks.map((b, i) => {
    const what = `breaks[${i}]`;
    if (!b || typeof b !== 'object') throw new TypeError(`${what} must be an object`);
    onlyKeys(b, BREAK_KEYS, what);
    if (!KINDS.includes(b.kind)) throw new TypeError(`${what}.kind must be 'meal' or 'rest', got ${describe(b.kind)}`);
    if (!Number.isInteger(b.minutes) || b.minutes <= 0) throw new TypeError(`${what}.minutes must be a whole number of minutes above 0`);
    if (b.onDuty !== undefined && typeof b.onDuty !== 'boolean') throw new TypeError(`${what}.onDuty must be true or false`);
    const m = minutes(`${what}.start`, b.start);
    const ts = [m, m + DAY].flatMap(moments).map((x) => x - origin);
    const start = ts.sort((x, y) => x - y).find((t) => segments.some((sg) => t >= sg.s && t < sg.e));
    if (start === undefined) {
      if ([m, m + DAY].some((w) => !moments(w).length)) throw new TypeError(`${what}.start: ${clock(m)} does not exist on that day in the workplace's time zone (the clocks go forward)`);
      throw new TypeError(`${what} must start inside a work segment`);
    }
    const seg = segments.find((sg) => start >= sg.s && start < sg.e);
    if (start + b.minutes > /** @type {{ e: number }} */ (seg).e) throw new TypeError(`${what} must end inside its work segment`);
    return { kind: b.kind, start, minutes: b.minutes, onDuty: b.onDuty === true, index: i, workedBefore: 0 };
  });
}

/**
 * Read a workday from the checker's input.
 * @param {any} input - the checker's options; any until checked here
 * @returns {Workday}
 */
function readWorkday(input) {
  const date = input.date;
  parseDate('date', date);
  const tz = input.timeZone;
  if (tz !== undefined && typeof tz !== 'string') throw new TypeError('timeZone must be a string');
  if (tz !== undefined) zoneFormat(tz);
  const moments = momentsOf(date, tz);

  const { segments, origin, startWall, endWall } = readSegments(input, moments, tz);
  /** @type {Pause[]} */
  const pauses = [];
  for (let i = 1; i < segments.length; i++) {
    const gap = segments[i].s - segments[i - 1].e;
    if (gap > 0) pauses.push({ kind: 'meal', start: segments[i - 1].e, minutes: gap, onDuty: false, index: null, workedBefore: 0 });
  }
  pauses.push(...readBreaks(input.breaks, segments, moments, origin));
  pauses.sort((a, b) => a.start - b.start);
  for (let i = 1; i < pauses.length; i++) {
    if (pauses[i].start < pauses[i - 1].start + pauses[i - 1].minutes) throw new TypeError('breaks must not overlap');
  }

  const offDuty = pauses.filter((p) => p.kind === 'meal' && !p.onDuty);
  const workedAt = (t) => t - offDuty.reduce((sum, p) => sum + Math.max(0, Math.min(t, p.start + p.minutes) - p.start), 0);
  for (const p of pauses) p.workedBefore = workedAt(p.start);
  const span = segments[segments.length - 1].e;

  const wallClock = tz
    ? (t) => clock((((wallAt((origin + t) * MINUTE, tz) / MINUTE) % DAY) + DAY) % DAY)
    : (t) => clock(startWall + t);
  // A daily window's bound as real minutes; a bound that falls in a
  // spring-forward gap moves to the end of the gap.
  const bound = (w) => {
    if (!tz) return w - origin;
    for (let step = 0; step <= 120; step += 1) {
      const list = moments(w + step);
      if (list.length) return list[0] - origin;
    }
    return w - origin;
  };
  const clockWindow = (a, b) => {
    const end = b <= a ? b + DAY : b;
    /** @type {[number, number] | null} */
    let fallback = null;
    for (const k of [-DAY, 0, DAY]) {
      const lo = bound(a + k); const hi = bound(end + k);
      if (lo < span && hi > 0) return [lo, hi];
      if (!fallback) fallback = [lo, hi];
    }
    return /** @type {[number, number]} */ (fallback);
  };

  return { date, span, worked: workedAt(span), pauses, startWall, endWall, workedAt, wallClock, clockWindow, zoned: Boolean(tz) };
}

module.exports = { readWorkday };
