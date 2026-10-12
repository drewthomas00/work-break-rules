'use strict';

/**
 * Clock arithmetic. A time is 'HH:MM' on the workplace's wall clock. Without a
 * time zone, a span is the difference between wall-clock times; with one, it
 * is the real time elapsed, so a shift across a daylight-saving change counts
 * the hour it gains or loses.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE = 60000;
const DAY = 24 * 60;

/**
 * Check a calendar date, refusing anything that is not one.
 * @param {string} what - names the value in the error
 * @param {unknown} value
 * @returns {{ year: number, month: number, day: number }}
 */
function parseDate(what, value) {
  const m = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  if (!m) throw new TypeError(`${what} must be a date string 'YYYY-MM-DD', got ${describe(value)}`);
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new TypeError(`${what} is not a real date: ${value}`);
  }
  return { year, month, day };
}

/**
 * Minutes after midnight for 'HH:MM' (00:00–23:59).
 * @param {string} what
 * @param {unknown} value
 * @returns {number}
 */
function minutes(what, value) {
  const m = typeof value === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
  if (!m) throw new TypeError(`${what} must be a time 'HH:MM', got ${describe(value)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 'HH:MM' for minutes after midnight, wrapping past 24:00.
 * @param {number} mins
 * @returns {string}
 */
function clock(mins) {
  const m = ((Math.round(mins) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * A length of time in words: '4 h 30 min', '45 min', '6 h'.
 * @param {number} mins
 * @returns {string}
 */
function duration(mins) {
  const total = Math.round(mins);
  const h = Math.floor(total / 60); const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

// ── Time zones ───────────────────────────────────────────────────────

/** @type {Map<string, Intl.DateTimeFormat>} */
const FORMATS = new Map();

/**
 * A formatter that reads an instant on `timeZone`'s wall clock; throws a
 * TypeError for a zone the runtime does not know.
 * @param {string} timeZone
 * @returns {Intl.DateTimeFormat}
 */
function zoneFormat(timeZone) {
  let f = FORMATS.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      throw new TypeError(`timeZone must be an IANA time zone like 'America/Los_Angeles', got ${describe(timeZone)}`);
    }
    FORMATS.set(timeZone, f);
  }
  return f;
}

/**
 * The wall-clock reading of an instant on `timeZone`, as if it were UTC
 * milliseconds (so the difference from the instant is the zone's offset).
 * @param {number} epoch
 * @param {string} timeZone
 * @returns {number}
 */
function wallAt(epoch, timeZone) {
  /** @type {Record<string, number>} */
  const p = {};
  for (const part of zoneFormat(timeZone).formatToParts(new Date(epoch))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
}

/**
 * Every instant at which `timeZone`'s clock reads `mins` minutes after the
 * midnight that begins `date` (mins may exceed a day): none in a
 * spring-forward gap, two in a fall-back hour.
 * @param {string} date
 * @param {number} mins
 * @param {string} timeZone
 * @returns {number[]} epochs, earliest first
 */
function instantsOf(date, mins, timeZone) {
  const { year, month, day } = parseDate('date', date);
  const wall = Date.UTC(year, month - 1, day) + mins * MINUTE;
  const found = new Set();
  for (const probe of [wall - DAY * MINUTE / 2, wall, wall + DAY * MINUTE / 2]) {
    const offset = wallAt(probe, timeZone) - probe;
    const epoch = wall - offset;
    if (wallAt(epoch, timeZone) === wall) found.add(epoch);
  }
  return [...found].sort((a, b) => a - b);
}

module.exports = { parseDate, minutes, clock, duration, describe, zoneFormat, wallAt, instantsOf, DAY, MINUTE };
