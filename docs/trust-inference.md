# WS1: pending inference coverage

## Scope and contract

This change selects plausible pending rows in PostgreSQL before paging, rather than fetching the newest 3,000 jobs and filtering that slice in JavaScript. Migration 017 installs a service-role-only, newest-first keyset RPC and a partial ordering index. It does not modify production rows.

The runner defaults to `MAX_DISCOVERY_AGE_DAYS` from `api/jobFreshness.js` (180 days). Missing publication dates and older current-year jobs with recent open evidence can still be examined, matching discovery exceptions. SQL uses a deliberately broad recent-evidence prefilter; JavaScript applies the exact shared freshness policy. Current-year old postings without fresh proof, expired deadlines, stale source observations, retired sources and closed listings do not receive model calls.

SQL selects descriptions of at least 200 characters, ambiguous bare locations, no current-version inference, no dead link/last-known closure, and no early decisive cached flags when those signals match the current version. Exact worldwide/anywhere locations and current required hiring scopes are excluded before paging; ambiguous `Global` and optional invitations remain eligible for the deterministic recheck. Stale signals are recomputed in JavaScript. `needsInference` retains the existing conservative prerequisites and now additionally requires the unchanged deterministic engine to return its exact region-unconfirmed fallback. Title geography, stated country requirements and positive worldwide evidence therefore cannot waste a model call. The deterministic engine and prompt are unchanged; `INFER_VERSION` stays 2. Cursor comparisons preserve PostgreSQL microseconds, including distinct timestamps within one JavaScript millisecond.

New verdicts store `at`, `model` and `provider` in `elig_signals.infer`, including honest `unclear` responses. Existing verdicts with missing audit metadata are not assigned invented dates or model IDs. Storing an unclear verdict removes it from the inference backlog, not from the UI's Unconfirmed eligibility state.

Writes replace the broken call to an unimported helper with a dedicated service-role `write_job_inference` RPC from migration 017. The expected full posting text, company, source, URL, link status and prior evidence are compared atomically in a POST body. Long descriptions never become URL query predicates. The RPC merges only deterministic flag fields and inference, preserving importer/availability and other metadata. JavaScript reloads evidence conflicts and refuses an answer if the posting text/identity changes, closes or becomes decided before a retry writes it.

## Supported model configuration

Groq's official [production model list](https://console.groq.com/docs/models), checked October 19, 2026, lists `openai/gpt-oss-120b`. It lists Llama 3.3 as Enterprise-only. The client now defaults to `openai/gpt-oss-120b`, while respecting an explicit `GROQ_MODEL` model ID. No provider API was called to test account access.

Set `LLM_PROVIDER=groq` and the `GROQ_API_KEY` Actions secret. An optional repository variable `GROQ_MODEL` takes precedence over the old secret of the same name. Remove or update an old model secret if the account cannot use that model. Missing keys, malformed model IDs and unknown providers fail before database selection. A configured key is not proof of provider health; runtime failures are measured separately.

The official [reasoning documentation](https://console.groq.com/docs/reasoning) and [API reference](https://console.groq.com/docs/api-reference) support JSON mode with hidden or parsed reasoning for GPT OSS. JSON requests to the two exact GPT OSS model IDs use hidden reasoning. This inference pass requests low reasoning effort and a 4,096-token completion budget (including reasoning); other configured model IDs receive none of these GPT OSS-specific controls. Mocked HTTP tests cover those request shapes. The inference prompt, evidence validation and deterministic precedence remain unchanged.

## User-run rollout and backfill (PowerShell)

1. Review and apply `supabase/migrations/017_inference_queue.sql` using your normal migration process. This function is executable only by `service_role`, not public/anon/authenticated roles. The normal index build can briefly block writes; schedule migration application accordingly.
2. Capture a before report with WS5's read-only `scripts/trust_report.js` once that PR is available. No production reports, backfills or workflow runs were performed while preparing this change.
3. Configure Groq and use a service-role `SUPABASE_KEY`. Run offline tests first:

```powershell
npm run test:eligibility
```

The daily budget remains 300 postings. To cover the user-reported backlog of approximately 2,100 in one backfill, raise the posting budget explicitly:

```powershell
node --env-file=.env ingest/infer_pending.js --limit 3000 --scan 20000 --page-size 500 --max-pages 40 --audit inference-audit.json
```

This is a maximum of 3,000 selected postings, with at most one retry per posting, not a guarantee that Groq will resolve every one. The same scan/page/max-pages/cursor settings are available as manual workflow inputs. The workflow's longer timeout accommodates an explicitly requested backfill, while normal runs retain the smaller daily posting budget.

If the scan/page/posting cap is reached, read `resume_cursor` from the JSON audit and continue:

```powershell
$audit = Get-Content inference-audit.json -Raw | ConvertFrom-Json; node --env-file=.env ingest/infer_pending.js --limit 3000 --scan 20000 --page-size 500 --max-pages 40 --cursor $audit.resume_cursor --audit inference-audit-next.json
```

Only use that resume command when `resume_cursor` is nonempty. An empty cursor with `failed_row_retry=true` means the earliest failed posting is at the start; rerun without `--cursor`. The continuation rewinds before the earliest failed row, so failures cannot be skipped while successful rows are excluded server-side by their now-current inference. The cursor freezes the original run's upper time bound and scope. After completing a resumed backfill, run once without a cursor to catch postings that arrived after that snapshot.

`--all` removes the SQL date bound only. It does not disable discovery/closure/eligibility guards, and scan/page/posting limits still apply. Prefer the default discovery scope for this backlog.

The audit includes selected, attempted, completed, unattempted, in-flight, resolved, unclear, failed, recovered, written, calls, failed calls, storage failures, cursor and model metadata. More than 30% failed calls exits nonzero even if retries eventually recover every selected posting; exactly 30% is tolerated. Permanent Groq HTTP configuration/authentication errors stop batch inference immediately. A provider failure circuit also stops a sustained outage after at least ten calls with an 80% failed-call ratio, allowing only already in-flight calls to settle. It does not pace or pretend to attempt thousands of untouched postings. Any storage/changed-posting failure exits nonzero too.

Audit checkpoints are written before selection, during paging, before each model call, after each posting completes and at completion. Writes serialize through atomic file renames, so an interrupted process leaves the last complete JSON document. SIGINT/SIGTERM handlers persist an interrupted snapshot before exiting, with a continuation that rewinds before every unsaved/in-flight row. A hard kill can retain only the last completed checkpoint; artifact upload after cancellation depends on the runner executing the workflow's always-run upload step. Startup failure before a batch begins is logged explicitly and may have no audit artifact.

After the backfill, capture the read-only report again. The acceptance target is near-zero **pending inference**, not an automatic promise of confident eligibility for every job. Provider quota, unavailable descriptions, hard publication/source gates and postings changed during inference can prevent a one-run completion.

## Before / after evidence

| Measure | Before | After |
| --- | --- | --- |
| Production rows with AI verdicts | 111 / 31,126, user-supplied October 19 baseline | Pending user-run report; production not queried |
| Discoverable JobHive pending, BambooHR | 1,943, user-supplied baseline | Pending user-run backfill/report |
| Discoverable JobHive pending, iCIMS | 192, user-supplied baseline | Pending user-run backfill/report |
| Queue scope | Newest 3,000 rows, default 14 days before JavaScript filtering | Server-selected pending rows, shared 180-day default, cursor bounded by explicit scan/page caps |
| Recovered-call audit fixture | Earlier code reported only finally failed postings | 1 recovered posting, 2 calls, 1 failed call, 50% failed-call rate, nonzero exit |
| Partial-page continuation fixture | Released runner had no continuation cursor | Continues at the last examined row even when the posting cap stops partway through a returned page |

No production after numbers are claimed. All 24 new offline regression tests pass, including mocked real HTTP401 propagation, bounded outage behavior, long-description/null-location POST writes, microsecond cursor ordering, and an actual child-process SIGTERM with mocked Supabase/Groq transports.

The separate `Inference queue PostgreSQL regression` workflow exercises migration 017 in a disposable PostgreSQL 16 service. Its fixture script `scripts/test_inference_queue.sql` refuses every database name except `jobos_inference_test_ci` and refuses an existing `public.jobs` table. It covers server selection, required versus optional hiring scopes, microsecond paging, NULL limits, service-role-only grants, null locations, long descriptions, metadata preservation and stale text/evidence rejection. No local PostgreSQL execution or production migration application is claimed; inspect that isolated CI result and validate query plans on staging before production application.
