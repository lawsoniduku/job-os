# Provider pressure and reported-posting rechecks

Recruitee checks now share a 600 ms start interval across tenant subdomains,
in addition to the existing two-request employer-host concurrency bound.
Its HTTP 429 cooldown is shared across those tenants and honors Retry-After.
Other ATS retain independent employer pressure controls.

Rows deferred without a request are not persisted as newly checked. Their
timestamps and verifier versions stay unchanged and they remain due. Completed
observations are saved, then the run stops on a cooldown instead of repeatedly
selecting the same due rows. The summary separates checked/saved/deferred work.
Actual persistence failures still fail the run.

The existing verification workflow also accepts an exact stored HTTPS posting
URL. It selects at most that one row using its unique URL, keeps the normal
source/freshness rules, invokes the same verifier and atomic writer, and does
not wait for the bulk due window. Exact checks have a separate single-check
concurrency lane. They do not insert or directly modify job content.

Tests cover exact URL filtering, unsafe input, cross-tenant pacing/cooldown,
and independence from other ATS. This provides a reproducible normal-pipeline
recheck for user-reported postings without manual production data edits.
