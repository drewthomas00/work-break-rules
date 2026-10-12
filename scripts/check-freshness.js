'use strict';

/**
 * Fails once the tables are older than a review cycle allows.
 *
 * AS_OF is the date every entry was last checked against its source. Laws
 * change on their own schedule, so a table nobody has re-read in six months
 * is stale even if no issue was filed. Bump AS_OF in data.js only after a
 * review (see CONTRIBUTING.md), never to silence this check.
 *
 * Run by CI on every push, monthly on a schedule, and before `npm publish`.
 */

const MAX_AGE_DAYS = 183;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} asOf - 'YYYY-MM-DD'
 * @param {string} today - 'YYYY-MM-DD'
 * @param {number} [maxAgeDays]
 * @returns {{ ok: boolean, message: string }}
 */
function checkFreshness(asOf, today, maxAgeDays = MAX_AGE_DAYS) {
  const parse = (what, s) => {
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;
    if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== s) throw new TypeError(`${what} must be a real date as YYYY-MM-DD, got ${JSON.stringify(s)}`);
    return ms;
  };
  const days = Math.round((parse('today', today) - parse('AS_OF', asOf)) / DAY_MS);
  if (days < 0) return { ok: false, message: `AS_OF (${asOf}) is after today (${today}). AS_OF records a review that has already happened.` };
  if (days > maxAgeDays) {
    return {
      ok: false,
      message: `The tables were last reviewed on ${asOf}, ${days} day${days === 1 ? '' : 's'} ago (the limit is ${maxAgeDays}). `
        + 'Re-check every entry against its source, record what changed, then bump AS_OF in data.js. See CONTRIBUTING.md.',
    };
  }
  return { ok: true, message: `The tables were last reviewed on ${asOf}, ${days} day${days === 1 ? '' : 's'} ago (the limit is ${maxAgeDays}).` };
}

module.exports = { checkFreshness, MAX_AGE_DAYS };

if (require.main === module) {
  const { AS_OF } = require('../data');
  const result = checkFreshness(AS_OF, new Date().toISOString().slice(0, 10));
  (result.ok ? console.log : console.error)(result.message);
  if (!result.ok) process.exitCode = 1;
}
