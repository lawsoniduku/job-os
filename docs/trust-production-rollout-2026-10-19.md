# Production compatibility preflight, October 19

The authorized rollout inspected project hsixftmpmzouhfaivxgl before applying any DDL. It found 30,841 jobs, 399 applications, 252 actual orphan references, and an existing archive with 2,493 historical rows. Those are fresh measured counts, distinct from the earlier owner-supplied baseline.

Two schema differences require compatibility before applying the reviewed migrations:

- `jobs.posted_at` and `created_at` are `timestamp without time zone`, stored as UTC. The pending worker now accepts their unzoned JSON values without losing PostgreSQL microseconds and emits an explicit UTC continuation cursor. Migration 017 fixes the queue function timezone to UTC so SQL comparisons do not depend on the caller's timezone. The disposable PostgreSQL fixture now uses the actual column types and a non-UTC caller.
- Existing `jobs_archive` is a flat jobs-shaped table. Migration 018 preserves it in place as `jobs_archive_legacy_20261019`, keeps it private with RLS and revoked client privileges, then creates the audited append-only archive. No original archive row is converted, deleted, or copied. Unrecognized schemas, name collisions or foreign-key dependents fail safely. Disposable tests cover both a fresh database and the legacy archive layout.

The preflight also found a superseded unbounded `archive_stale_jobs(integer)` SECURITY DEFINER RPC executable by public clients. Migration 018 revokes public, anonymous, authenticated and service-role execution; its body remains available to the database owner for audit. The current application has no callers.

The existing nightly job is `prune-stale-jobs`, an unbounded DELETE after 45 days. Following migrations 018/019, replace that exact reviewed cron using the guarded installer, preserving all applications and historical archives. No broad prune or archive purge is part of this compatibility patch.

Two adversarial regression cases failed before the patch and pass afterward. Database behavior is tested in the existing isolated PostgreSQL CI workflows before any production migration application. The deterministic eligibility engine and inference contract are unchanged.

Manual inference workflow dispatch now has an opt-in `trust_reports` input. It captures the existing read-only report immediately before and after the backfill, including failed enrichment runs, in the same audit artifact. It stays off for scheduled passes to avoid repeatedly downloading the full job corpus or increasing normal egress. Credentials stay in the existing GitHub Actions environment.

The availability rollout must not skip recently checked legacy proofs: the due queue also selects missing/old verification versions. Once a new-version observation is persisted it leaves that version-upgrade queue, even when the outcome is honestly unknown. This makes an immediate backfill possible without negative date offsets or repeatedly checking the same batch.
