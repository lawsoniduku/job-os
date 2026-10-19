# Background inference respects shared Groq capacity

The deterministic eligibility engine and inference prompt/version are unchanged.
AI remains asynchronous enrichment: quota exhaustion never blocks importing or
searching a listing, and never fabricates an eligibility answer.

## The failure this fixes

The old client swallowed HTTP 429 and its response headers into `null`. A
concurrent background worker then waited eight seconds and retried every row.
It could consume shared organization capacity while the product used the same
model, and its audit could not distinguish quota exhaustion from bad answers.

Groq's documented header semantics, checked 2026-10-19:
https://console.groq.com/docs/rate-limits

- `retry-after`: seconds until a rejected request may be retried.
- `x-ratelimit-remaining-requests` / `reset-requests`: requests **per day**.
- `x-ratelimit-remaining-tokens` / `reset-tokens`: tokens **per minute**.
- These headers do not expose every token-day or separate input/output limit.
  A 429's `retry-after` remains authoritative; we do not infer account allowances
  from the published free-plan table.

## Behavior

1. A serial worker reserves estimated prompt + maximum completion tokens before
   admission. Successful response usage replaces that reservation in the run
   budget. Successful headers update the next admission decision.
2. If observed TPM is insufficient, wait for its reset, with a 250 ms margin,
   only when the entire wait fits the configured 60-second cap.
3. Leave a configured request/token reserve for interactive traffic. This is a
   background headroom policy, not a cross-process guarantee against another
   application consuming the organization's allowance.
4. At most one actual short 429 is retried for a posting. A repeated 429, long
   reset, or run budget stops the batch, saves a rewind cursor and leaves
   unfinished jobs pending. No loop sleeps once per untouched posting.
5. Actual failed provider calls still count toward the >30% failed-call run
   status. A proactive admission deferral made **no HTTP call**, so it is not a
   provider failure. The audit explicitly reports `deferred`, `deferReason`,
   `retryAt`, `rateLimited`, `quotaWaitMs`, quota observations and run usage.
6. A changed, closed or concurrently enriched posting is a skipped stale
   snapshot, not a storage outage. Real storage errors still fail the run.

The cron restores a small JSON quota checkpoint through GitHub Actions cache;
keys are unique per run so a newer observation supersedes an older cache on
restore. State is scoped to branch and model, contains no API key, prompt or job
text, and expired observations are discarded. A missing cache safely permits
one probe; cache availability is not a database dependency. Corrupt state fails
clearly instead of silently granting a new budget.

A scheduled run starts **newest first**, rather than following an old backlog
cursor. Successful verdicts are stored once, so the next run automatically
moves on. This keeps fresh arrivals ahead of historical enrichment. Manual
backfills can pass a saved cursor when they explicitly want to continue that
snapshot; use `--days 7` for a limited fresh-postings pass.

## Defaults and controls

| Environment variable | Default | Meaning |
|---|---:|---|
| `INFER_CONCURRENCY` | 1 | Background HTTP calls admitted concurrently |
| `INFER_PACE_MS` | 2200 | Minimum idle time between background postings |
| `INFER_MAX_REQUESTS` | 100 | Per-run actual/reserved request cap |
| `INFER_MAX_TOKENS` | 60000 | Per-run estimated/actual token cap |
| `INFER_REQUEST_RESERVE` | 100 | Stop before consuming this observed RPD headroom |
| `INFER_TOKEN_RESERVE` | 1000 | TPM headroom before waiting for reset |
| `INFER_MAX_QUOTA_WAIT_MS` | 60000 | Longest single quota wait; otherwise defer |
| `INFER_QUOTA_STATE_PATH` | audit path + `.quota.json` | Atomic local quota checkpoint |

The workflow exposes request and token budgets as manual inputs and repository
variables. Raising them is an operator decision based on the actual account
allowance and live usage. No paid plan, provider switch or larger allowance is
required by this patch. The defaults deliberately do not promise a 2,100-row
backfill in a single run on free shared capacity.

PowerShell example:

```powershell
$env:INFER_MAX_REQUESTS='100'; $env:INFER_MAX_TOKENS='60000'; node --env-file=.env ingest/infer_pending.js --days 7 --limit 100
```

Offline verification: `node --test ingest/test_inference_queue.js` covers reset
parsing, fake-clock cooldowns, persisted daily deferral/resumption, bounded 429
retries, no-call accounting, stale-write skips and the existing circuit/failure
thresholds. Transport requests retain their existing 20-second timeout for
eligibility; the quota wait is separately bounded.

## Discovery scope correction

A production audit showed the worker's JavaScript pending filter omitted search's last-seen visibility gate. Migration `020_inference_discovery_freshness.sql` replaces only the pending-selection RPC to prefilter stale source observations; the worker applies the exact shared gate again before spending quota. It is independent of retention migrations 018/019 and deletes no rows. The disposable PostgreSQL fixture tests the additive replacement, stale-source exclusion and the recent-employer-evidence exception. The original 017 migration remains unchanged.

The stopped pre-fix production backfill saved 112 verdicts (93 resolved, 19 unclear) from 475 recorded model calls, with 356 call failures in its last checkpoint. The accompanying report measured discoverable JobHive pending inference at 2,053 before and 1,976 afterward; availability verification independently advanced from 0% to 44.72% during its concurrent check. Those are partial earlier-rollout observations, not acceptance results for this quota patch. Quota alone cannot turn absent hiring evidence into certainty.
