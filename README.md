# work-break-rules

[![npm](https://img.shields.io/npm/v/work-break-rules)](https://www.npmjs.com/package/work-break-rules)
[![CI](https://github.com/drewthomas00/work-break-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/drewthomas00/work-break-rules/actions/workflows/ci.yml)
[![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)](https://www.npmjs.com/package/work-break-rules?activeTab=dependencies)
[![node](https://img.shields.io/node/v/work-break-rules)](https://www.npmjs.com/package/work-break-rules)
[![license](https://img.shields.io/npm/l/work-break-rules)](LICENSE)

Does this workday give the breaks the law requires?

US meal and rest break rules for adult employees — every state and DC, plus federal law — as cited, dated data, with a checker that takes a workday (a planned shift, or the day's clock punches) and answers every breach: a missing, short, early or late meal, a second meal, too few rest breaks, too long without one. Where the law sets pay for a missed break, such as California's extra hour, it says how much. Each breach names the provision it comes from, with a link.

Pure functions. No network, no runtime dependencies. TypeScript types included.

```sh
npm install work-break-rules
```

**Not legal advice, and not reviewed by a lawyer.** See [Not legal advice](#not-legal-advice).

## Why this is harder than it looks

**"After 5 hours" means different things.** California's meal is due for a work period of *more than* 5 hours and must *start* by the end of the 5th. Oregon's must be *finished* before the 5th hour begins. Illinois counts 7½ *continuous* hours; Massachusetts, more than 6 in a calendar day; New York looks at the clock — a meal between 11 a.m. and 2 p.m. for a shift spanning those hours, and another between 5 and 7 p.m. for a long day.

**A rest break is counted, then placed.** California earns one per 4 hours "or major fraction", none under 3½. Washington counts per 4 hours but also says no one works more than 3 hours without one. Minnesota wants one inside every 4 consecutive hours.

**It is the workday that counts.** A split shift of 9–1 and 5–9 is 8 hours of work in California, not two 4-hour shifts. Pass every stretch of work in the day.

**Coverage depends on facts about the employer.** Maryland's rule is for retail employers with 50 or more retail employees; North Dakota's applies only with two people on duty; Nevada's not where only one person is employed at the workplace; Nebraska's only to "workshops and mechanical establishments". A fact you don't pass is assumed to bring the rule in, and is reported.

**"No rule" is an answer; "unknown" is not.** Most states have no adult break law, and say so. A place the tables do not cover answers `known: false`.

## Usage

```js
const { checkWorkday } = require('work-break-rules');
// or: import { checkWorkday } from 'work-break-rules';

checkWorkday({
  jurisdiction: 'US-CA',                    // where the work is done
  date: '2026-10-12',
  start: '09:00',
  end: '17:30',
  breaks: [
    { start: '11:00', minutes: 10, kind: 'rest' },
    { start: '15:00', minutes: 30, kind: 'meal' },
  ],
  timeZone: 'America/Los_Angeles',
});
// {
//   jurisdiction: 'US-CA', known: true, workedMinutes: 480, spanMinutes: 510,
//   violations: [
//     { rule: 'meal_too_late', ruleId: 'meal', limit: 300, actual: 360, break: 1, at: 360,
//       jurisdiction: 'US-CA', citations: [{ citation: 'IWC Wage Order 2-2001, § 11(A)–(C) …', sourceUrl: 'https://…' }, …],
//       confidence: 'high', note: '…', message: 'The meal at 15:00 starts after 6 h worked; the limit is 5 h' },
//     { rule: 'rest_missing', ruleId: 'rest', limit: 2, actual: 1, … },
//   ],
//   owed: [
//     { kind: 'premium_pay', for: 'meal', hours: 1, jurisdiction: 'US-CA', citations: […] },
//     { kind: 'premium_pay', for: 'rest', hours: 1, … },
//   ],
//   waivers: [], notes: [{ jurisdiction: 'US-CA', note: 'Rest breaks are paid time.' }], assumptions: []
// }
```

### A day of clock punches

```js
checkWorkday({
  jurisdiction: 'US-CA',
  date: '2026-10-12',
  segments: [{ start: '09:00', end: '13:00' }, { start: '13:30', end: '17:30' }], // clock-in to clock-out
  breaks: [{ start: '11:00', minutes: 10, kind: 'rest' }, { start: '15:00', minutes: 10, kind: 'rest' }], // paid, not clocked out
  timeZone: 'America/Los_Angeles',
});
```

The gaps between segments are off duty, and count as meals. A split shift is the same: two segments with a long gap.

### Options

| Option | Default | Meaning |
|---|---|---|
| `jurisdiction` | — | `'US-CA'`, or `{ country: 'US', subdivision: 'CA' }`. Where the work is done. |
| `date` | — | `'YYYY-MM-DD'`, the day the workday starts. A day before a rule's `effectiveFrom` answers `known: false`. |
| `start`, `end` | — | `'HH:MM'`, for one stretch of work. An end at or before the start runs past midnight. |
| `segments` | — | Instead of `start`/`end`: every stretch of work in the workday, in order, `{ start, end }`. Each time is placed at the first moment after the one before it at which the clock reads it — later the same day or the next. The whole day must fit in 24 hours of real time. |
| `breaks` | `[]` | `{ start, minutes, kind: 'meal' \| 'rest', onDuty? }`, each inside a segment. An off-duty meal is not time worked; a rest break and an on-duty meal are. |
| `waived` | `[]` | Ids of rules the employee validly waived for this day — a meal rule's `id` (see `rulesFor`), or `'rest'`. A waiver the rule does not allow is reported in `waivers` with `allowed: false`, and the rule is checked anyway. An id the jurisdiction does not have throws. |
| `facts` | `{}` | `industry` (`retail`, `restaurant`, `personal_service`, `manufacturing`, `office`, `healthcare`, `other`), `employeesOnDuty` (people on duty at the worksite), `retailEmployees` (the employer's retail employees in the state), `locationEmployees` (employees at this location). |
| `timeZone` | — | The workplace's IANA zone. Times are then instants: a day across a daylight-saving change counts the hour it gains or loses, and a time that does not exist that day throws. Without it, spans are wall-clock minutes and `assumptions` says `'wall_clock'`. |

Unknown option names throw. Hours in every rule are **hours worked**: time on the clock less off-duty time so far. A meal's position is the hours worked when it starts.

### Breaches

| `rule` | Meaning |
|---|---|
| `meal_missing` | A meal rule applies and no meal was given (or none that counts — an on-duty meal where the rule needs relief). |
| `meal_too_short` | The meal is shorter than the rule's minutes. |
| `meal_too_early` / `meal_too_late` | Outside the rule's window in hours worked, or a stretch of work longer than the rule allows without a meal. |
| `meal_outside_hours` | Outside a clock window (New York); `window` and `given` hold the times. |
| `rest_missing` | Fewer rest breaks of the required length than the hours worked earn. |
| `rest_late` | A stretch of work longer than the rule allows without a rest. |

`rule` says what went wrong; `ruleId` says which rule (a meal rule's `id`, or `'rest'`). `limit` and `actual` are minutes — a meal's length, or time worked — except for `rest_missing`, where they count breaks. `at` is where the problem begins, in real minutes from the start of the workday; `message` says it in words.

Each meal rule takes its own meal, and meals are matched to rules as a whole: a day passes if any assignment of its meals satisfies every rule. A miss is reported against the longest meal no rule took.

### What is owed

`owed` lists the pay the law sets for the breaches found: California's extra hour of pay per workday for a missed meal and another for a missed rest (`premium_pay`, in hours); the minutes of each missed or late rest break in Colorado and Washington, and of each missed meal or rest break in Minnesota, doubled there for its liquidated damages (`break_time_pay`, in minutes). It **assumes the break was not provided**. Several states, California among them, owe nothing when the employer provided the break and the employee chose to skip it — punches alone cannot tell the difference, so record that separately. Fines payable to the state are in each rule's `penalty.description`, not in `owed`.

### `rulesFor(jurisdiction, { on? })`

The rules in force on `on` (`'YYYY-MM-DD'`), or the current ones: `{ effectiveFrom, meals, rest, penalty, unchecked, basis }`, or `null` for a place the tables do not cover. A day is always checked against the rules in force that day: Minnesota before 2026 and Illinois before 2023 have their earlier rules. `basis` says where a jurisdiction with no rule was checked; `unchecked` lists rules that cannot be checked against a schedule (Vermont's "reasonable opportunities to eat", New York's "midway" timing).

## How the tables are encoded

- Where a rule is conditional or vague, the **stricter** reading is encoded and the `note` says so: Kentucky's lunch on any shift over 3 hours at 30 minutes (the statute says "reasonable"), Colorado's "to the extent practical" hour after the start and before the end, Nevada's statutory "major fraction" over the regulation's schedule, Maryland's extra rest from 8 hours, New York's 45-minute night meal (NYSDOL allows 30 as a matter of course). A checker built on these tables will sometimes flag a lawful shift; it should never pass an unlawful one because of the encoding.
- An exemption that needs facts the input does not carry (Oregon's lone retail worker, Maine's small workplace with frequent paid breaks, Tennessee's "ample opportunity to rest") is not encoded, and the note says so.
- Every entry has a `confidence`: **high** when the primary text (statute, regulation or wage order on an official site, or an official mirror) was read; **medium** when only an agency statement, a summary or a reputable copy could be reached.

## Coverage

As of 2026-10-11.

| Code | Meal | Rest | Pay owed | Confidence |
|---|---|---|---|---|
| US (federal) | — | — | | high |
| US-CA | more than 5 h, by end of hour 5; second after 10 h | 10 min per 4 h or major fraction, from 3½ h | 1 h premium each | high |
| US-CO | more than 5 h, not in the first or last hour | 10 min per 4 h or major fraction | missed rest time | high |
| US-CT | 7½ h, after the first 2 and before the last 2 | — | | high |
| US-DE | 7½ h, after the first 2 and before the last 2 | — | | high |
| US-IL | 20 min at 7½ h, starting within 5 h; more every 4½ h | — | | high |
| US-KY | lunch between hour 3 and 5 | 10 min per 4 h | | high |
| US-MA | more than 6 h | — | | high |
| US-MD | retail, 50+ retail employees, location of 6+: more than 6 h | retail: 15 min at 4–6 h; more from 8 h | | high |
| US-ME | no more than 6 consecutive hours without | — | | high |
| US-MN | 6 h (since 2026-01-01) | 15 min within every 4 consecutive hours | missed break time, doubled | high |
| US-ND | more than 5 h, 2+ on duty | — | | high |
| US-NE | 8 h, manufacturing only | — | | high |
| US-NH | no more than 5 consecutive hours without | — | | high |
| US-NV | no 8 continuous hours without | 10 min per 4 h or major fraction, from 3½ h | | high |
| US-NY | 11–2 for a shift over 6 h; 45 min for a night start; 20 min 5–7 p.m. | — | | high |
| US-OR | 6 h, finished before hour 5 or 6 begins; more at 14 and 22 h | 10 min per 4 h or major fraction | | high |
| US-RI | 20 min at 6 h, 30 at 8 h; 3+ on the shift | — | | high |
| US-TN | 6 h, not in the first hour | — | | medium |
| US-VT | reasonable opportunity to eat (not checked) | — | | high |
| US-WA | more than 5 h, between hour 2 and 5; every 5 h | 10 min per 4 h, no 3 h without | missed rest time | high |
| US-WV | 20 min at 6 h | — | | high |

**No adult meal or rest break rule** (each with its source in `basis`): AK, AR, GA, IA, ID, IN, MI, MO, MT, NC, NM, OK, PA, SC, SD, TX, UT, VA, WI, WY (high); AL, AZ, DC, FL, HI, KS, LA, MS, NJ, OH (medium — no official statement on adults could be reached, and no law was found).

## Known limitations

These are judgment calls and gaps a user should know about before relying on a result.

- **The workday is yours to assemble.** The checker sees only the segments you pass. California and most states count a workday as a fixed 24-hour period; split it differently and the hours change.
- **Without `timeZone`, time is wall-clock time.** An overnight day across a daylight-saving change is off by an hour; `assumptions` says `'wall_clock'`.
- **New York.** The statute's noonday meal applies to a shift "extending over" 11 a.m.–2 p.m., and its night meal to a shift starting between 1 p.m. and 6 a.m. The tables read them as alternatives by start time: a shift of more than 6 hours starting between 6 a.m. and 1 p.m. that overlaps 11–2 by at least 30 minutes takes the noonday meal; one starting between 1 p.m. and 6 a.m. takes the night meal. The night meal's "midway" timing is not checked.
- **The repeated hour.** When the clocks go back, a time that follows a time in the first occurrence of the repeated hour reads as its second occurrence; a break inside the repeated hour reads as its first. There is no way to name the occurrence explicitly.
- **Further meals.** Oregon's meals after the first (at 14 and 22 hours) and Illinois's (every further 4½ hours) are counted, but when they are taken is not checked.
- **Stricter readings that will flag some lawful days:** Kentucky's lunch on any shift over 3 hours at 30 minutes, Colorado's "to the extent practical" first and last hour, Nevada's statutory "major fraction", Maryland's extra rest from 8 hours, New York's 45-minute night meal, Washington's rest break on a shift just over 3 hours, Maine's meal for every 6-hour stretch. Each is in its rule's `note`.
- **Exemptions not encoded** because they depend on facts the input does not carry: Oregon's lone retail worker, Maine's small workplace with frequent paid breaks, Tennessee's "ample opportunity to rest", Connecticut's employer giving 30 paid minutes, agency-granted exemptions, and collective bargaining agreements everywhere (pass those as waivers where the law lets an agreement replace the rule).
- **Timing "near the middle"** of a work period (California, Colorado, Oregon, Washington rest breaks) is guidance the checker does not test.
- **Ten "no rule" answers are medium confidence** — no official statement on adults could be reached, and no law was found (see Coverage).
- **Not reviewed by a lawyer.**

## Not covered

- **Minors.** Break rules written for workers under 18 are in [youth-employment-rules](https://github.com/drewthomas00/youth-employment-rules). A minor gets both: check the shift with each and apply the stricter.
- City and county ordinances (scheduling laws such as New York City's and Philadelphia's fair workweek rules are not break rules, but may apply too), collective bargaining agreements, and employer policy.
- Hospital and acute-care rules, agricultural work, and other industry-specific regimes; US territories.
- Heat-illness recovery periods, lactation breaks and restroom access.

## How the tables were checked

Each rule's `citations` name the provisions it comes from, and each `sourceUrl` links the text. The tables were compiled with AI-assisted research against those sources on the date in `AS_OF`, then checked a second time, independently, against the primary text (see [Authorship](#authorship)). **They have not been reviewed by a lawyer.**

## Not legal advice

Break law changes — Minnesota rewrote its rules for 2026, Colorado reissues its order most years — and courts read the same words differently. This package is a tool to catch mistakes in a schedule or a timesheet; it does not tell an employer that a schedule is lawful, and the employer remains responsible for the law that applies to it, including what this package does not cover. If you find a value that is wrong, please open an issue with the provision and a link.

## Contributing

Every number needs a linkable source. A correction should cite the provision, link the official text if it can be reached, and say what changed and from when. A change in the law is a new version with its `effectiveFrom` (a jurisdiction may be a list of versions, oldest first), not an edit that rewrites the past.

The tables are re-checked against their sources every December and June, and after any reported change; `AS_OF` is the date of the last full review, and CI fails once it is more than six months old. See [CONTRIBUTING.md](CONTRIBUTING.md) for what a report or a pull request needs.

## Testing

```sh
npm test
```

Node's built-in test runner, no framework. CI runs the suite on Node 18–26 and again under a non-UTC `TZ`.

## Authorship

This package was written by [Claude](https://www.anthropic.com/claude) (Claude Opus 5.5, Anthropic's AI model), working in Claude Code at the direction of Drew Thomas. Claude wrote the code and the tests and did the research behind the tables. Drew decided what the package should do, and publishes and maintains it. Commits that Claude wrote say so in a `Co-Authored-By` trailer.

## Related packages

- **[youth-employment-rules](https://github.com/drewthomas00/youth-employment-rules)** — may a 15-year-old work this shift here? US child labor hours, with a schedule checker
- **[age-of-majority](https://github.com/drewthomas00/age-of-majority)** — the age of majority and the digital-consent age by jurisdiction
- **[tcpa-quiet-hours](https://github.com/drewthomas00/tcpa-quiet-hours)** — is it legal to send this marketing message right now, in the recipient's local time

## License

MIT © [Drew Thomas](https://drewthomasbuilds.com)
