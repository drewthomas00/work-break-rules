'use strict';

/**
 * Clock arithmetic on 'HH:MM' strings. Every time here is a wall-clock time on
 * the workplace's own calendar, so nothing reads the machine's time zone.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Check a calendar date, refusing anything that is not one.
 * @param {string} what - names the value in the error
 * @param {unknown} value
 * @returns {string}
 */
function parseDate(what, value) {
  const m = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  if (!m) throw new TypeError(`${what} must be a date string 'YYYY-MM-DD', got ${describe(value)}`);
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new TypeError(`${what} is not a real date: ${value}`);
  }
  return value;
}

/**
 * Minutes after midnight. Hours may run past 23 for a time after midnight
 * ('24:30' is 12:30 a.m. the next morning).
 * @param {string} what
 * @param {unknown} value
 * @returns {number}
 */
function minutes(what, value) {
  const m = typeof value === 'string' ? /^(\d{2}):([0-5]\d)$/.exec(value) : null;
  if (!m || Number(m[1]) > 47) throw new TypeError(`${what} must be a time 'HH:MM', got ${describe(value)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 'HH:MM' for minutes after midnight; past 24:00 is written as the next
 * morning's clock time with "(next day)".
 * @param {number} mins
 * @returns {string}
 */
function clock(mins) {
  const h = Math.floor(mins / 60); const m = mins % 60;
  const text = `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return h >= 24 ? `${text} (next day)` : text;
}

/**
 * A length of time in words: '4 h 30 min', '45 min', '6 h'.
 * @param {number} mins
 * @returns {string}
 */
function duration(mins) {
  const h = Math.floor(mins / 60); const m = Math.round(mins % 60);
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

module.exports = { parseDate, minutes, clock, duration, describe };
