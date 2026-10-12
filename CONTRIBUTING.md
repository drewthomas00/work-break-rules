# Contributing

This package is data about the law, and it is only useful while that data is right. The most valuable contribution is telling us that a rule changed.

## Reporting a change in the law

Open a [law change issue](https://github.com/drewthomas00/work-break-rules/issues/new?template=law-change.yml). It asks for:

- the jurisdiction and the rule;
- the provision that sets it (statute, regulation or code section);
- a link to the official text: a legislature, a government gazette or the agency that enforces it;
- the date it takes effect.

A news article or an HR blog is a fine way to hear about a change, but it is not a source. If the official text is not online yet, say so and link what you have; the issue stays open until the text can be read.

## Changing the data

Every entry in [`data.js`](data.js) carries a citation, a source link and a confidence level. A pull request that changes a value must:

1. **Cite the provision** in `citation`, and link its text in `sourceUrl`.
2. **Set `confidence` honestly.** `high` means the value was read in the primary text on an official site. `medium` means it rests on an agency summary or an unofficial copy of the text; say which in `note`.
3. **Keep the history.** A change in the law is a new version with its `effectiveFrom` (a jurisdiction may be a list of versions, oldest first), not an edit that rewrites the past.
4. **Encode the stricter reading** where the text is conditional or ambiguous, and say so in `note`.
5. **Add or update a test** that pins the new value at its boundary: the case that just passes and the one that just fails.

The maintainer reads every cited source before merging. A change without a source that can be read is not merged, however likely it is to be right.

## Changing the code

- No dependencies. The package runs on Node 18 and later, CommonJS, with Node's built-in test runner (`npm test`).
- A fix comes with a test that fails without it.
- Wrong input throws an error naming the field. Never fall back to a default that would loosen a check.
- A place the tables do not cover answers unknown. Never answer "no rule".

## Review schedule

Most changes in this area take effect on January 1 or July 1. The maintainer re-checks every entry against its source twice a year, in December and June, ahead of those dates, and after any report of a change. Then `AS_OF` in `data.js` is bumped and a new version published.

`AS_OF` is the date of the last full review. `npm run check-freshness` fails once it is more than six months old. CI runs that check on every push and monthly, and `npm publish` runs it first, so stale tables cannot be published unnoticed. Bump `AS_OF` only after a review, never to silence the check.

## Questions about your own situation

Whether a rule applies to a particular business or worker is a question for a lawyer or the agency that enforces it. This package and its issue tracker cannot answer it.
