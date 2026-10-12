# work-break-rules

[![npm](https://img.shields.io/npm/v/work-break-rules)](https://www.npmjs.com/package/work-break-rules)
[![CI](https://github.com/drewthomas00/work-break-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/drewthomas00/work-break-rules/actions/workflows/ci.yml)
[![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)](https://www.npmjs.com/package/work-break-rules?activeTab=dependencies)
[![node](https://img.shields.io/node/v/work-break-rules)](https://www.npmjs.com/package/work-break-rules)
[![license](https://img.shields.io/npm/l/work-break-rules)](LICENSE)

Does this shift give the breaks the law requires?

US meal and rest break rules for adult employees — every state and DC, plus federal law — as cited, dated data, with a checker that takes a shift (planned, or rebuilt from clock punches) and answers every breach: a missing, short, early or late meal, a second meal, too few rest breaks, too long without one. Where the law sets pay for a missed break, such as California's extra hour, it says how much. Each breach names the provision it comes from, with a link.

Pure functions. No network, no runtime dependencies. TypeScript types included.

```sh
npm install work-break-rules
```

**Not legal advice, and not reviewed by a lawyer.** See [Not legal advice](#not-legal-advice).

## Why this is harder than it looks

**"After 5 hours" means different things.** California's meal is due for a work period of *more than* 5 hours and must *start* by the end of the 5th. Oregon's must be *finished* before the 5th hour begins. Illinois counts 7½ *continuous* hours; Massachusetts, more than 6 in a calendar day; New York looks at the clock — a meal between 11 a.m. and 2 p.m. for a shift spanning those hours, and another between 5 and 7 p.m. for a long day.

**A rest break is counted, then placed.** California earns one per 4 hours "or major fraction", none under 3½. Washington counts per 4 hours but also says no one works more than 3 hours without one. Minnesota wants one inside every 4 consecutive hours.

**Coverage depends on facts about the employer.** Maryland's rule is for retail employers with 50 or more retail employees; North Dakota's applies only with two people on duty; Nebraska's only to "workshops and mechanical establishments". A fact you don't pass is assumed to bring the rule in, and is reported.

**"No rule" is an answer; "unknown" is not.** Most states have no adult break law, and say so. A place the tables do not cover answers `known: false`.

## Usage

```js
const { checkShift } = require('work-break-rules');
// or: import { checkShift } from 'work-break-rules';

checkShift({
  jurisdiction: 'US-CA',                    // where the work is done
  date: '2026-10-12',
  start: '09:00',
  end: '17:30',
  breaks: [
    { start: '11:00', minutes: 10, kind: 'rest' },
    { start: '15:00', minutes: 30, kind: 'meal' },
  ],
});
// {
//   jurisdiction: 'US-CA', known: true, workedMinutes: 480,
//   violations: [
//     { rule: 'meal_too_late', ruleId: 'meal', limit: '5 h', actual: '6 h', break: 1,
//       jurisdiction: 'US-CA', citations: [{ citation: 'IWC Wage Order 2-2001, § 11(A)–(C) …', sourceUrl: 'https://…' }, …],
//       confidence: 'high', note: '…', message: 'The meal at 15:00 is late: 6 h worked, the limit is 5 h' },
//     { rule: 'rest_missing', ruleId: 'rest', limit: 2, actual: 1, … },
//   ],
//   owed: [
//     { kind: 'premium_pay', for: 'meal', hours: 1, jurisdiction: 'US-CA', citations: […] },
//     { kind: 'premium_pay', for: 'rest', hours: 1, … },
//   ],
//   waivers: [], notes: [{ jurisdiction: 'US-CA', note: 'Rest breaks are paid time.' }], assumptions: []
// }
```

### From clock punches

```js
const { checkShift, shiftFromPunches } = require('work-break-rules');

const shift = shiftFromPunches({
  date: '2026-10-12',
  segments: [{ start: '09:00', end: '13:00' }, { start: '13:30', end: '17:30' }], // in/out pairs
  restBreaks: [{ start: '11:00', minutes: 10 }, { start: '15:00', minutes: 10 }], // paid, not clocked out
});
checkShift({ jurisdiction: 'US-CA', ...shift });
```

The gaps between work segments are read as off-duty meals.

### Options

| Option | Default | Meaning |
|---|---|---|
| `jurisdiction` | — | `'US-CA'`, or `{ country: 'US', subdivision: 'CA' }`. Where the work is done. |
| `date` | — | `'YYYY-MM-DD'`, the day the shift starts. A shift before a rule's `effectiveFrom` answers `known: false`. |
| `start`, `end` | — | `'HH:MM'`. An end at or before the start runs past midnight. |
| `breaks` | `[]` | `{ start, minutes, kind: 'meal' \| 'rest', onDuty? }`. A break that starts earlier on the clock than the shift is after midnight. An off-duty meal is not time worked; a rest break and an on-duty meal are. |
| `waived` | `[]` | Ids of meal rules (or `'rest'`) the employee validly waived for this shift. A waiver the rule does not allow is reported in `waivers` with `allowed: false`, and the rule is checked anyway. |
| `facts` | `{}` | `{ industry, employeesOnDuty, employerEmployees }`. `industry` is one of `retail`, `restaurant`, `personal_service`, `manufacturing`, `office`, `healthcare`, `other`. |

Hours in every rule are **hours worked**: time on the clock less off-duty meals taken so far. A meal's position is the hours worked when it starts.

### Breaches

| `rule` | Meaning |
|---|---|
| `meal_missing` | A meal rule applies and no meal was given (or none that counts — an on-duty meal where the rule needs relief). |
| `meal_too_short` | The meal is shorter than the rule's minutes. |
| `meal_too_early` / `meal_too_late` | Outside the rule's window in hours worked, or a stretch of work longer than the rule allows without a meal. |
| `meal_outside_hours` | Outside a clock window (New York). |
| `rest_missing` | Fewer rest breaks of the required length than the hours worked earn. |
| `rest_late` | A stretch of work longer than the rule allows without a rest. |

Each meal rule takes its own meal: one meal never satisfies two rules.

### What is owed

`owed` lists the pay the law sets for the breaches found: California's extra hour of pay per workday for a missed meal and another for a missed rest; a missed rest break's own minutes in Colorado, Minnesota and Washington. It **assumes the break was not provided**. Several states, California among them, owe nothing when the employer provided the break and the employee chose to skip it — punches alone cannot tell the difference, so record that separately. Fines payable to the state are in each rule's `penalty.description`, not in `owed`.

### `rulesFor(jurisdiction)`

The table entry: `{ effectiveFrom, meals, rest, penalty, unchecked, basis }`, or `null` for a place the tables do not cover. `basis` says where a jurisdiction with no rule was checked; `unchecked` lists rules that cannot be checked against a schedule (Vermont's "reasonable opportunities to eat", New York's "midway" timing).

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
| US-MD | retail, 50+ employees: more than 6 h | retail: 15 min at 4–6 h; more from 8 h | | high |
| US-ME | no more than 6 consecutive hours without | — | | high |
| US-MN | 6 h (since 2026-01-01) | 15 min within every 4 consecutive hours | missed break time | high |
| US-ND | more than 5 h, 2+ on duty | — | | high |
| US-NE | 8 h, manufacturing only | — | | high |
| US-NH | no more than 5 consecutive hours without | — | | high |
| US-NV | no 8 continuous hours without | 10 min per 4 h or major fraction, from 3½ h | | high |
| US-NY | 11–2 for a shift over 6 h; 45 min for a night start; 20 min 5–7 p.m. | — | | high |
| US-OR | 6 h, finished before hour 5 or 6 begins; second at 14 h | 10 min per 4 h or major fraction | | high |
| US-RI | 20 min at 6 h, 30 at 8 h; 3+ on the shift | — | | high |
| US-TN | 6 h, not in the first hour | — | | medium |
| US-VT | reasonable opportunity to eat (not checked) | — | | high |
| US-WA | more than 5 h, between hour 2 and 5; every 5 h | 10 min per 4 h, no 3 h without | missed rest time | high |
| US-WV | 20 min at 6 h | — | | high |

**No adult meal or rest break rule** (each with its source in `basis`): AK, AR, GA, IA, ID, IN, MI, MO, MT, NC, NM, OK, PA, SC, SD, TX, UT, VA, WI, WY (high); AL, AZ, DC, FL, HI, KS, LA, MS, NJ, OH (medium — no official statement on adults could be reached, and no law was found).

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

Every number needs a linkable source. A correction should cite the provision, link the official text if it can be reached, and say what changed and from when. A change in the law is a new `effectiveFrom`, not an edit that rewrites the past.

## Testing

```sh
npm test
```

Node's built-in test runner, no framework. CI runs the suite on Node 18–24 and again under a non-UTC `TZ`.

## Authorship

This package was written by [Claude](https://www.anthropic.com/claude) (Claude Opus 5.5, Anthropic's AI model), working in Claude Code at the direction of Drew Thomas. Claude wrote the code and the tests and did the research behind the tables. Drew decided what the package should do, and publishes and maintains it. Commits that Claude wrote say so in a `Co-Authored-By` trailer.

## Related packages

- **[youth-employment-rules](https://github.com/drewthomas00/youth-employment-rules)** — may a 15-year-old work this shift here? US child labor hours, with a schedule checker
- **[age-of-majority](https://github.com/drewthomas00/age-of-majority)** — the age of majority and the digital-consent age by jurisdiction
- **[tcpa-quiet-hours](https://github.com/drewthomas00/tcpa-quiet-hours)** — is it legal to send this marketing message right now, in the recipient's local time

## License

MIT © [Drew Thomas](https://drewthomasbuilds.com)
