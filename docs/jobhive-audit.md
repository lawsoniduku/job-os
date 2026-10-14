# JobHive import and cron audit — 14 October 2026

## Conclusion

The scheduled importer is running. The reviewed 12 and 13 October runs completed all five source steps. There are confirmed implementation defects that discard valid candidates and undermine eligibility evidence. The production database was not queried, so this audit does not assign an exact share of the user's observed decline to each defect.

## Observed workflow evidence

[13 October run](https://github.com/lawsoniduku/job-os/actions/runs/38381237775), job 115241891981:

| Source | CSV rows scanned | Candidates retained after filters/dedup | Logged duplicates |
| --- | ---: | ---: | ---: |
| iCIMS | 209,897 | 1,154 | 261 |
| Phenom | 131,959 | 242 | 52 |
| Recruitee | 16,201 | 1,661 | 232 |
| Y Combinator | 3,810 | 1 | 102 |
| BambooHR | 18,947 | 2,865 | 242 |
| Total | 380,814 | 5,923 | 889 |

These are **not 5,923 newly inserted or verified-eligible jobs**. Normal upserts ignore existing records, and the import gate checks a coarse region label rather than the personalized eligibility engine. The original “upserted” counter counts accepted write requests, including ignored conflicts. Its “region split of kept” was counted before deduplication, so it does not sum to the retained total.

The [12 October run](https://github.com/lawsoniduku/job-os/actions/runs/38235330969) also kept only one YC job (103 logged duplicates). The schedule is `0 3 * * *` (04:00 Lagos), but the reviewed 13 October run was created at 10:07 UTC / 11:07 Lagos. Scheduled time is not actual execution time. This delay is observed; its platform-level cause is not established.

## Confirmed defects and current changes

### 1. Distinct YC jobs collapse into one URL — fixed

JobHive's [upstream YC fixture](https://github.com/kalil0321/ats-scrapers/blob/main/tests/test_ycombinator.py) supplies an application link of this form:

`https://account.ycombinator.com/authenticate?continue=https%3A%2F%2Fwww.workatastartup.com%2Fapplication%3Fsignup_job_id%3D93354`

Our `canonicalUrl` retained only a short allow-list of parameters. It dropped `continue`, turning different job IDs into the identical `/authenticate` URL. The importer keeps the first and treats the rest as duplicates, regardless of employer/title. This reproduces the failure mechanism consistent with the production counters. The complete live CSV could not be downloaded from this environment (HTTP 403), so the exact 102 discarded rows were not individually inspected.

The fix removes known tracking parameters only, preserves unknown parameters and nested redirects, and preserves case-sensitive job identities. A regression fixture with 103 distinct YC jobs now retains all 103; true duplicates and tracking variations still collapse.

### 2. EMEA is rejected before eligibility evaluation — fixed

`KEEP_REGIONS` omitted EMEA even though `detectEligibilityRegion` emits EMEA and `checkEligibility` accepts it for a Nigerian target. The importer now retains EMEA candidates. This does not make them automatically eligible: search still applies the job's restrictions.

### 3. Missing remote flags were treated as explicit on-site work — fixed

The CSV mapping converted every value other than true/1/yes into false. `fastReject` then discarded any such record with a non-African country, before reading its text. Unknown/missing flags now stay unknown and proceed to classification. Explicit non-remote foreign jobs retain the existing fast exclusion. The number of live rows affected by missing flags is unmeasured.

### 4. Failures and counters could be misleading — fixed

- All five source steps used `continue-on-error: true`; a failed command could leave a green workflow. This was a masking risk, not an observed source failure in the two inspected JobHive runs.
- Row-by-row recovery returned true when even one row succeeded, allowing failed neighbors to be counted as successful. It now returns exact accepted/failed row lists.
- Unresolved write failures and failed freshness updates did not fail the process. They now set a non-zero exit status.
- Counters now distinguish candidates, accepted write requests and pre/post-dedup region totals. They do not claim actual inserts or verified eligibility.
- The cron uses independent matrix jobs for the same five sources, `fail-fast: false`, maximum parallelism two, and no `continue-on-error`. Other sources still complete while failures remain visible. Concurrency prevents overlapping runs on the same ref. Dependency installation uses the lockfile.
- The occasional batch runner now exits non-zero if any source fails. CSV headers are validated, and dry runs no longer require database credentials.

## Remaining issues that need a broader repair

### Search can lose valid results after a bulk import

`/ai/search` sorts candidates by `posted_at`, selects only 600, and only then applies personalized eligibility. New JobHive candidates that later fail the gate can push older valid candidates outside those 600. Missing source dates are also normalized to import time, giving undated rows an artificial recency advantage. Thus more imported jobs can produce fewer visible eligible matches. This is a confirmed code-path limitation; its current magnitude requires a production query replay. Raising the cap alone trades the problem for latency rather than resolving retrieval quality.

### Import-time country policy is still Nigeria-focused

Non-African on-site roles and region buckets such as US/UK/Canada/Regional are discarded before users in those countries can search them. JobHive ingestion and search must become country-neutral together. The retained source volume should not be expanded blindly while retrieval still evaluates only 600 candidates and storage limits are unknown.

### Tagging can discard genuinely worldwide jobs

The single-African-country detector scans the entire description before the worldwide location check. A worldwide job mentioning customers in Kenya becomes Regional and is dropped. Reproduced offline. This requires a distinction between employer/customer geography and actual applicant restrictions across all supported countries; simply permitting every Regional row would reintroduce the false positives under investigation.

### Only five sources get daily freshness updates

The batch runner also imports Ashby, Lever, Workable, Teamtailor, SmartRecruiters, Greenhouse and other sources, but they are absent from this cron. JobHive-only employers outside the curated native connectors are therefore not necessarily revisited. A non-null `last_seen_at` older than 28 days is excluded from search, even when the job might still be open. Refresh previously imported sources incrementally or revalidate their actual job pages; a blind timestamp update is not evidence of liveness.

There is historical evidence of an earlier version of this problem: [commit 775701a](https://github.com/lawsoniduku/job-os/commit/775701a51e49c5ce9cbd4cb2d67cf07c36571107), dated 27 August, records that all 5,249 JobHive rows were excluded by the former `posted_at` freshness gate. Main already contains that fix. This historical claim is from the commit message, not a fresh database measurement.

### Descriptions and existing records lose evidence

Descriptions are truncated to 3,000 characters before eligibility signals are extracted. A residency requirement after that point disappears; a worldwide-tagged fixture then returns certain despite the omitted restriction. Normal repeat imports use `ignoreDuplicates: true`, refreshing only `last_seen_at`, so changed restrictions are not updated on existing jobs. The broad `--repair-regions` mode overwrites conflicts and is unsuitable as an automatic fix without protecting trusted native-source rows and enrichment. Full-text signal extraction, safe evidence refresh and source-aware update rules are still needed.

## Validation and rollout

18 JobHive tests pass, alongside the 95 eligibility/scoring checks in PR #12. Tests cover redirect identity, real duplicate preservation, unknown remote flags, EMEA, partial batch failure, retry exhaustion, explicit repair mode and no-write dry runs. Workflow YAML and importer syntax checks pass. No production import, backfill, deletion, workflow rerun or deployment was performed.

After review/merge, the next scheduled or manually dispatched run can insert newly recovered YC/EMEA candidates. It cannot recover every historical issue above. Compare per-source counts, verify actual new inserts with database measurements, replay known user-reported searches, and inspect the source diversity of the 600 evaluated candidates before declaring recall restored. The next run's counts may differ from this snapshot as upstream data changes.

Adjacent finding: the [13 October native ingestion run](https://github.com/lawsoniduku/job-os/actions/runs/38476816216) logged 50 failed rows (`invalid input syntax for type json`) while the workflow remained green. That is separate from JobHive and remains unpatched here.
