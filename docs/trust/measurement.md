# Trust measurement and rollout

The production baseline in `baseline-2026-10-19.json` was supplied by the owner. It has not been independently fetched. No production backfill, model call, posting fetch, migration or deployment was run during this work. Production after numbers remain pending; passing offline tests does not demonstrate that ~2,100 pending rows have been resolved.

`trust_report.js` is a read-only inventory: GETs against `/rest/v1/jobs`, exhaustive UUID cursor paging, bounded page sizes, and no model calls, posting requests, RPCs or writes. A failed page aborts the report. Importing the module does not load environment files or create a database connection. Fixture mode never connects. The data read can change between pages, so freeze ingestion briefly if you need directly comparable before/after snapshots.

The measurement PR depends on the UI trust-policy PR for `shared/jobTrust.js`. Merge the MyJobMag correction first so it is counted as a maintained source. Merge the availability PR before running checks that should earn the new Verified label.

## Definitions

- Discoverable denominator: maintained source, valid apply URL, shared publication/deadline/source freshness policy, and no confirmed dead status. Includes roles whose eligibility engine excludes the selected country: this is a corpus measurement before a particular role query or country exclusion, rather than a promise every row appears in a search.
- Confident eligibility: engine returns eligible=true and certain/likely for the selected country (High/Good in the UI). This is not the same numerator as stored AI verdicts. Full employer evidence is applied exactly as it is for search. No new eligibility rules are introduced.
- Verified availability: same independent seven-day, current, exact-posting proof policy as the UI. Historical version-3 positive observations without auditable identity/URL/HTTP metadata stay Unverified until checked again. Positive eligibility cannot grant availability.
- Pending inference: discoverable, no current-version model inference, `needsInference` true and engine at its exact unresolved remote branch. A stored `unclear` answer is a completed attempt, not an actionable resolution; current/auditable inference counts expose this distinction. Current version is not bumped for audit metadata.
- Dead-link share uses **all stored rows per source**, including retired/stale records; the discoverable denominator excludes dead rows and would otherwise hide the problem.
- Sources above 30% Unverified are flagged, with reason counts and ATS breakdowns. An unsupported/challenged source needs a documented explanation, not a fabricated positive check.
- Sources with zero discoverable rows report null percentages, not 100% trust.

## Before/after evidence

| Measurement | Before | After | Evidence |
|---|---:|---:|---|
| Production AI verdicts | 111 / 31,126 stored rows | Pending | Owner-supplied Oct 19 baseline |
| Production pending BambooHR + iCIMS | 1,943 + 192 | Pending | Owner-supplied baseline; user must run backfill |
| Synthetic pending inference | 1 | 0 | `offline-before.json`, `offline-after.json` |
| Synthetic confident eligibility | 0/1 | 1/1 | Mocked employer global-hiring statement, existing engine |
| Synthetic verified availability | 0/1 | 1/1 | Mocked exact posting, fresh version-4 evidence |

The synthetic example verifies report accounting only. It is not a model-quality benchmark, a live adapter check, or a production reduction claim.

## Commands (PowerShell)

Run locally/offline first:

```powershell
node --test scripts/trust_report.test.js
node scripts/trust_report.js --fixture scripts/fixtures/trust-before.json --at 2026-10-19T12:00:00Z --json
node scripts/trust_report.js --fixture scripts/fixtures/trust-after.json --at 2026-10-19T12:00:00Z --json
npm run test:eligibility; npm run test:jobhive; npm run test:search; npm run test:verification
```

The following are **for the owner to run**, after configuring the intended Supabase environment. Keep output files private; the report contains aggregate source/platform diagnostics, not CVs or job descriptions.

```powershell
node scripts/trust_report.js --country nigeria --json | Out-File -Encoding utf8 trust-before.json
```

Follow each workstream's reviewed migration/backfill instructions. Apply 018 before 019; inspect and explicitly replace the actual retention cron using that workstream's guarded installer. The repository does not contain the existing deployed cron command. Do not enable another nightly cleanup without reviewing it. Migration 009 and unrelated dependency/rate-limiter changes are outside this work.

After enrichment/availability checks and a separate review of their failure summaries:

```powershell
node scripts/trust_report.js --country nigeria --json | Out-File -Encoding utf8 trust-after.json
```

Check pending inference, unclear answers, and failure totals separately. Audit every >30% unknown source using reason/ATS counts. Y Combinator remains unverified unless an adapter can demonstrate reliable proof. Add those **measured** before/after figures to the five PRs; do not replace pending cells with fixture results.

The archive migration preserves deleted rows, so moving data into `jobs_archive` does not itself reduce total database storage. Removing archived history needs its own agreed retention decision.
