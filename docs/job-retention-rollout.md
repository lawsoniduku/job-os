# Archived retention and application integrity

This workstream changes no production data by itself. Migrations 018/019 and the installer are for the owner to review and run. Neither migration activates a cron. Migration 018 contains the canonical nightly command and its guarded installer, so the scheduled behavior is version-controlled.

## What changes

A BEFORE DELETE trigger archives the complete jobs row and identifiers of linked applications in `jobs_archive`, in the same transaction as every delete. If archiving fails, deletion fails. The archive has no client policies; only the server role can read it. Migration 019 records actual orphan references in a private repair table, sets only those `applications.job_id` values to NULL, and validates an `ON DELETE SET NULL` FK. Application snapshots and application rows remain intact.

Retention defaults to 180 days, matching `MAX_DISCOVERY_AGE_DAYS`. Both publication/creation and last feed observation must be older than the retention threshold. It skips employer-owned jobs, all `job_postings` mirrors, saved jobs, and positive verification within seven days. Malformed or missing timestamps on a positive verification conservatively preserve the row. A missing `last_seen_at` also preserves a row. Pruning refuses to run before the validated application FK or while a cascading job FK exists. A batch locks and deletes at most 500 rows, using `SKIP LOCKED`; the server limit is 5,000.

This is retention, not proof of closure. A failed connector does not make a role ineligible. Older current-year jobs with fresh positive evidence remain protected. Freshly observed 2025 jobs can remain stored, but discovery already excludes previous-year publications. This change does not widen discovery or delete those rows by guessing why they were refreshed.

Archiving protects recovery and shrinks the active table. It does **not** reduce total stored descriptions or promise lower Supabase disk usage. No archive purge or blocking `VACUUM FULL` runs. Archive retention/export needs a separate reviewed policy.

## Review the actual cron first

Repository migration 003 only adds `last_seen_at`; 003b contains a raw unbounded delete. Neither defines a cron. The deployed nightly job name, owner and command have not been inspected, so this PR cannot claim it has replaced the live scheduler.

Run these **read-only** queries yourself in the SQL editor:

```sql
select jobid, jobname, schedule, command, database, username, active
from cron.job order by jobid;

-- Copy the entire object after reviewing every job, including custom function
-- calls. Inspect custom function definitions before deciding they are unrelated.
select coalesce(jsonb_object_agg(jobid::text, to_jsonb(j)), '{}'::jsonb)
  as reviewed_inventory from cron.job j;

select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname ilike '%prun%';

select count(*) as actual_orphans
from public.applications a where a.job_id is not null
  and not exists (select 1 from public.jobs j where j.id = a.job_id);

select conname, conrelid::regclass, confdeltype, pg_get_constraintdef(oid)
from pg_constraint where confrelid = 'public.jobs'::regclass;
```

If `pg_cron` is not enabled, the cron queries fail harmlessly. Enable it separately only after reviewing whether GitHub Actions or another scheduler already performs cleanup. Search the complete inventory for indirect cleanup functions; a generic function name cannot be classified reliably by regex.

## Local validation before rollout

Offline JavaScript tests, including RPC spies and static SQL contracts:

```powershell
node --test ingest/test_retention.js
```

The SQL behavior fixture requires a **new disposable local PostgreSQL database**, a local admin connection and `psql`. It refuses databases without the `jobos_retention_test_` prefix and refuses a preexisting jobs table. It creates local cluster roles only if absent. Use a disposable local cluster, never any Supabase project. Replace `localhost` with your local connection settings if necessary:

```powershell
createdb -h localhost -U postgres jobos_retention_test_local
psql -h localhost -U postgres -d jobos_retention_test_local -v ON_ERROR_STOP=1 -f supabase/scripts/test_job_retention.sql
```

The fixture checks orphan audit/repair, validated FK enforcement, no lost application/saved history, protected candidates, privileged RPCs, archive failure rollback and direct-delete archiving. It does not simulate concurrent sessions or install pg_cron. PostgreSQL is absent from the implementation environment, so the supplied SQL fixture has **not been executed here**. Static checks are not database execution. The dedicated `Retention integrity checks` workflow also runs this SQL fixture in an isolated PostgreSQL 16 service, with no production secrets; its result must be checked on the PR.

## Manual rollout order

1. Capture the read-only orphan count, FK definitions, cron inventory and your trust report before applying anything. The supplied baseline is 253 orphans; that is not a hard-coded row count or a fresh measurement.
2. Review and apply migration 018 in the SQL editor. It does not prune or schedule anything. If an existing `jobs_archive` has a different shape, stop and reconcile its schema; do not discard existing archives.
3. Review and apply migration 019. It changes actual orphan `job_id` values and adds the FK. Any unfamiliar existing FK or ID type stops the transaction for inspection.
4. Preview retention. The CLI now defaults to a read-only preview; it does not raw-delete rows:

```powershell
node --env-file=.env ingest/prune_stale.js --dry-run
```

5. After reviewing the preview, a deliberately bounded manual run is available:

```powershell
node --env-file=.env ingest/prune_stale.js --execute --max-batches 1
```

Use a server-side service role environment. Failed or uncertain mutations are not automatically retried. Inspect `jobs_archive` before rerunning a timed-out request.

6. Replace exactly the reviewed old cron with the installer. Copy the complete inventory object into the JSON literal and the **exact** legacy command into `$old$...$old$`. Values below are placeholders and deliberately cannot be run as-is:

```sql
select public.install_job_retention_cron(
  p_reviewed_inventory => $inventory$<PASTE COMPLETE REVIEWED INVENTORY JSON>$inventory$::jsonb,
  p_expected_jobid => <REVIEWED LEGACY JOB ID>,
  p_expected_command => $old$<EXACT REVIEWED LEGACY COMMAND>$old$
);
```

If review establishes there is no existing cleanup in pg_cron **or any other scheduler**, pass NULL for both expected replacement arguments. Do not use that path merely because the old name is unfamiliar. The installer compares the entire supplied inventory with the current inventory, checks the selected command/database/owner exactly, rejects additional obvious cleanup jobs, and replaces the reviewed job transactionally. It is admin-only, including no service-role execution grant. Any failure rolls back the unschedule and installation together.

The new named job `jobcopilot-archive-stale-jobs` runs `select public.archive_prune_stale_jobs(180, 500);` at `40 3 * * *` in pg_cron's configured timezone. Check `show cron.timezone;` and `cron.job_run_details`; do not assume Lagos time or successful completion. More than 500 stale rows require several nights or explicit bounded owner runs. Do not silently increase the batch to clear a backlog.

7. Recount actual orphans (expected zero), inspect FK validation, compare retained application/saved row counts, and confirm an archive record exists for each acknowledged deletion. Record real after numbers in the PR before claiming production acceptance. No production verification has been performed in this workstream.

## Before/after evidence

| Metric | Supplied production baseline | Implementation validation | Production after |
|---|---:|---|---|
| Orphan application references | 253 | Fixture and FK SQL supplied; static contracts pass | Owner-run measurement pending |
| Archived deletes | Not supplied | Atomic BEFORE DELETE trigger and bounded RPC | Owner-run measurement pending |
| Application/saved history retained | Required | Script uses RPC only; prune skips saved rows; FK sets job reference NULL | Owner-run measurement pending |

To recover a job, an administrator can inspect `job_row` and `application_refs` from the private archive, then design an explicit restore using the current schema and ownership rules. Restoration is intentionally not automated; a restored listing still needs current eligibility/availability evidence. Repair audit records preserve UUIDs for preexisting orphans, but missing original job content cannot be recreated from a UUID.
