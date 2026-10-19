# Weekly digest discovery repair

The previous digest selected the newest 500 rows before applying role preferences,
used coarse region tags instead of candidate eligibility, and admitted Nigeria/Africa
rows for subscribers in every country. It could email closed or ambiguous postings
as "eligible", miss a relevant role beyond row 500, and send an unsubscribe link to
the frontend where the API handler does not exist.

The read-only `ingest/core/digestFeed.js` now scans the seven-day publication pool
once per run in 500-row UUID pages. Every query selects maintained sources, excludes
known dead links and uses search's source-visibility policy. Each unique normalized
country/role preference shares that scan, retaining at most 30 deduplicated results.
There is no newest-500 candidate cutoff or complete-corpus array per subscriber.
Database page failures abort discovery before any delivery begins.

Eligibility uses the deterministic engine, the same employer evidence projection,
freshness/deadline checks, vacancy checks and preferred-title relevance policy as
search. Only certain/likely location verdicts enter a digest described as eligible.
Unconfirmed results remain available through interactive search; the digest does
not fabricate a positive label. Missing/unknown countries and unsupported role
preferences are explicitly skipped and counted, without an invented Nigeria
fallback. Existing subscribers must supply a recognized country to receive this
targeted digest. No subscriber records are changed by this repair.

The weekly promise remains an explicit seven-day publication filter: older roles,
including recently reverified older current-year roles, do not become "new this
week". An undated import is not a new publication. This does not change the ordinary
search policy that can admit older current-year openings with employer evidence.

The email shows eligibility confidence/reason separately from current availability.
Its displayed role count equals the cards included, without a hidden per-section
cap. Application links and source text are escaped. The candidate link opens `/`;
unsubscribe uses the API `/digest/unsubscribe?token=...` route. Defaults match the
existing deployed frontend/backend; `SITE_URL` and `DIGEST_API_URL` (or `API_URL`)
provide HTTPS deployment overrides. Delivery or delivery-timestamp failures produce
a failed workflow exit instead of a misleading green result.

Validation: `node --test ingest/test_digest_trust.js` passes 13 offline tests;
`npm run test:search` passes 115 tests; script syntax passes. Cases include domestic
Nigeria versus Canada, EMEA Nigeria despite a coarse Regional tag, dead/retired/
stale/expired jobs, uncertain eligibility, mismatched stored role labels, relevant
rows beyond 500, bounded output after multiple pages, shared subscriber scans,
failed later pages, escaped rendering, and correct unsubscribe routing. No email,
production data write or scheduled workflow dispatch was performed for this repair.
