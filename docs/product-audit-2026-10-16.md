# Product audit — 16 October 2026

## Reproduced in production

Guest landing → Data analyst · Nigeria → Show more returned Clickatell Lead BI & Analytics (19 June 2024), Bluecloud Lead Business Intelligence Engineer (4 October 2023), and Kuda Data Analyst – Credit (22 January 2026). Source refresh timestamps kept old publication dates discoverable. The same search included Alan Analytics and pricing expert, location Anywhere in France, as Unconfirmed for Nigeria.

Guest Briefing and Pipeline correctly request sign-in. Authenticated candidate/employer flows were not exercised; this is not a complete security audit.

## Implemented in this patch

- Shared 180-day publication-age policy for search, refinements, native ingestion and JobHive ingestion. Future dates beyond one day and invalid dates are excluded. Undated jobs remain discoverable but cannot satisfy an explicit recency filter. Saved records/application history are not deleted. SQL filtering and final ranking both apply the policy.
- Country-qualified Anywhere locations cannot become worldwide matches. Nigeria remains included in Africa-wide hiring; genuine worldwide and unconfirmed Remote remain supported.
- Initial date requests now use the same recency parser as follow-up refinements.
- Anonymous job reports no longer suppress listings globally. The repository permits anonymous inserts, and the old server suppressed a job after one expired report or any two reports, without proving closure or distinct reporters. Reports remain recorded for review; confirmed liveness failures still exclude jobs.
- Corrected score explanation and disclosed the age policy in results.

## Remaining findings requiring separate work

- Weekly email digest uses coarse region buckets rather than the full eligibility engine, and includes Nigeria/Africa buckets irrespective of subscriber country. It also lacks the live-posting check used by website search. No digest was sent during this audit.
- Briefing searches only the first preferred role while displaying all preferred roles in its label. Fetch failures are rendered as no matches.
- Salary display assumes USD and does not show pay periods. Source normalization/storage must preserve currency and period before amounts can be compared safely.
- Existing prune script deletes on last-seen age without checking saved/application references. Absence from a source is not proof of closure, especially for unscheduled bulk-import sources. Do not run it as the proposed cleanup without protection and a reviewed dry run.
- Job reports' live schema/RLS should be inspected and rate-limited; removing the global suppression closes the search manipulation path but does not prevent report-table spam.

## Validation

239 eligibility/search/import/verification regression checks passed locally; production frontend build and whitespace/syntax checks passed. Added fixed-clock age boundaries, stale/future examples, consistent recency parsing, and country-qualified Anywhere checks on both full descriptions and precomputed signals.

Storage impact is prevention of old imports, not measured reclaimed disk space. No existing rows were deleted and no new source inventory was enabled.
