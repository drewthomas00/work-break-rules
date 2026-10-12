'use strict';

/**
 * A workday as a timeline in real minutes from its first start.
 *
 * The caller gives wall-clock times: the work segments (clock-in to clock-out,
 * or a planned shift's start and end) and the breaks inside them. Each time is
 * placed after the one before it, rolling to the next day where the clock goes
 * backwards. With a time zone, each wall-clock time becomes an instant and the
 * timeline counts real minutes; without one, it counts wall-clock minutes.
 */

const { parseDate, minutes, clock, describe, zoneFormat, wallAt, instantsOf, DAY, MINUTE } = require('./time');

const KINDS = ['meal', 'rest'];

/**
 * @typedef {object} Pause
 * @property {'meal'|'rest'} kind
 * @property {number} start - real minutes from the workday's start
 * @property {number} minutes
 * @property {boolean} onDuty - a meal eaten while working: time worked, and paid
 * @property {number | null} index - its index in `breaks`, or null for a gap between segments
 * @property {number} [workedBefore]
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
 * @property {(a: number, b: number) => [number, number]} clockWindow - a daily wall-clock window as real minutes, the copy that meets the workday
 * @property {boolean} zoned
 */

/**
 * Read a workday from the checker's input.
 * @param {{ date: unknown, start?: unknown, end?: unknown, segments?: unknown, breaks?: unknown, timeZone?: unknown }} input
 * @returns {Workday}
 */
function readWorkday(input) {
  const date = input.date;
  parseDate('date', date);
  const tz = input.timeZone;
  if (tz !== undefined && typeof tz !== 'string') throw new TypeError('timeZone must be a string');
  if (tz !== undefined) zoneFormat(tz);

  let raw;
  if (input.segments !== undefined) {
    if (input.start !== undefined || input.end !== undefined) throw new TypeError('give start and end, or segments, not both');
    if (!Array.isArray(input.segments) || !input.segments.length) throw new TypeError('segments must be a non-empty array of { start, end }');
    raw = input.segments.map((s, i) => {
      if (!s || typeof s !== 'object') throw new TypeError(`segments[${i}] must be { start, end }`);
      return [minutes(`segments[${i}].start`, s.start), minutes(`segments[${i}].end`, s.end), `segments[${i}]`];
    });
  } else {
    raw = [[minutes('start', input.start), minutes('end', input.end), 'the shift']];
  }

  // Wall-clock minutes from the date's midnight, each after the last.
  let prev = -1;
  const place = (m, what, strictlyAfter) => {
    let w = m;
    while (strictlyAfter ? w <= prev : w < prev) w += DAY;
    if (w - raw[0][0] >= DAY) throw new TypeError(`${what}: a workday is checked within 24 hours of its start`);
    prev = w;
    return w;
  };
  const walls = raw.map(([s, e, what]) => {
    // A segment may start the minute the last one ended; it must end after it starts.
    const ws = place(s, `${what}.start`, false);
    const we = place(e, `${what}.end`, true);
    return [ws, we];
  });

  // Real minutes for a wall-clock time, no earlier than `notBefore`.
  let toReal; let epoch0 = 0;
  if (tz) {
    epoch0 = firstInstant(date, walls[0][0], tz, -Infinity, 'start');
    toReal = (w, notBefore, what) => (firstInstant(date, w, tz, epoch0 + notBefore * MINUTE, what) - epoch0) / MINUTE;
  } else {
    toReal = (w) => w - walls[0][0];
  }
  let last = 0;
  const segments = walls.map(([ws, we], i) => {
    const s = toReal(ws, last, `${raw[i][2]}.start`);
    const e = toReal(we, s, `${raw[i][2]}.end`);
    if (e <= s) throw new TypeError(`${raw[i][2]} must end after it starts`);
    last = e;
    return { s, e, ws, we };
  });

  const pauses = [];
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].s > segments[i - 1].e) pauses.push({ kind: 'meal', start: segments[i - 1].e, minutes: segments[i].s - segments[i - 1].e, onDuty: false, index: null });
  }

  const breaks = input.breaks === undefined ? [] : input.breaks;
  if (!Array.isArray(breaks)) throw new TypeError('breaks must be an array');
  breaks.forEach((b, i) => {
    if (!b || typeof b !== 'object') throw new TypeError(`breaks[${i}] must be an object`);
    if (!KINDS.includes(b.kind)) throw new TypeError(`breaks[${i}].kind must be 'meal' or 'rest', got ${describe(b.kind)}`);
    if (!Number.isInteger(b.minutes) || b.minutes <= 0) throw new TypeError(`breaks[${i}].minutes must be a whole number of minutes above 0`);
    if (b.onDuty !== undefined && typeof b.onDuty !== 'boolean') throw new TypeError(`breaks[${i}].onDuty must be a boolean`);
    const m = minutes(`breaks[${i}].start`, b.start);
    const seg = segments.find((sg) => [m, m + DAY].some((w) => w >= sg.ws && w < sg.we));
    if (!seg) throw new TypeError(`breaks[${i}] must start inside a work segment`);
    const w = m >= seg.ws ? m : m + DAY;
    const start = toReal(w, seg.s, `breaks[${i}].start`);
    if (start + b.minutes > seg.e) throw new TypeError(`breaks[${i}] must end inside its work segment`);
    pauses.push({ kind: b.kind, start, minutes: b.minutes, onDuty: b.onDuty === true, index: i });
  });
  pauses.sort((a, b) => a.start - b.start);
  for (let i = 1; i < pauses.length; i++) {
    if (pauses[i].start < pauses[i - 1].start + pauses[i - 1].minutes) throw new TypeError('breaks must not overlap');
  }

  const offDuty = pauses.filter((p) => p.kind === 'meal' && !p.onDuty);
  const workedAt = (t) => t - offDuty.reduce((sum, p) => sum + Math.max(0, Math.min(t, p.start + p.minutes) - p.start), 0);
  for (const p of pauses) p.workedBefore = workedAt(p.start);
  const span = segments[segments.length - 1].e;

  const wallClock = tz
    ? (t) => clock(((wallAt(epoch0 + t * MINUTE, tz) % (DAY * MINUTE)) + DAY * MINUTE) % (DAY * MINUTE) / MINUTE)
    : (t) => clock(walls[0][0] + t);
  const clockWindow = (a, b) => {
    const end = b <= a ? b + DAY : b;
    let best = null;
    for (const k of [-DAY, 0, DAY]) {
      const lo = lenient(a + k); const hi = lenient(end + k);
      if (lo < span && hi > 0) return [lo, hi];
      if (!best) best = [lo, hi];
    }
    return best;
  };
  // A daily window's bound as real minutes; a bound in a gap moves past it.
  function lenient(w) {
    if (!tz) return w - walls[0][0];
    const { year, month, day } = parseDate('date', date);
    const list = instantsOf(date, w, tz);
    const epoch = list.length ? list[0] : Date.UTC(year, month - 1, day) + w * MINUTE - (wallAt(epoch0, tz) - epoch0);
    return (epoch - epoch0) / MINUTE;
  }

  return {
    date, span, worked: workedAt(span), pauses,
    startWall: walls[0][0], endWall: walls[walls.length - 1][1],
    workedAt, wallClock, clockWindow, zoned: Boolean(tz),
  };
}

/**
 * The earliest instant, not before `notBefore`, at which the clock reads `w`.
 * @param {string} date
 * @param {number} w
 * @param {string} tz
 * @param {number} notBefore
 * @param {string} what
 * @returns {number}
 */
function firstInstant(date, w, tz, notBefore, what) {
  const list = instantsOf(date, w, tz);
  if (!list.length) throw new TypeError(`${what}: ${clock(w)} does not exist on that day in ${tz} (the clocks go forward)`);
  const ok = list.find((e) => e >= notBefore);
  if (ok === undefined) throw new TypeError(`${what}: ${clock(w)} comes before the time before it`);
  return ok;
}

module.exports = { readWorkday, KINDS };
