# Availability evidence and the Recruitee investigation

This workstream changes posting verification, not the deterministic country eligibility rules. No production services, postings, workflows or database were contacted during implementation. All HTTP tests use synthetic responses.

## Findings

The supplied October 19 production baseline reports unverified availability of Recruitee 90.1%, iCIMS 90.9%, Phenom 82.2%, and Y Combinator 100%. These are user-supplied measurements; no after-production measurement has been made.

The previously saved `coverage-raw-jobs.json` audit snapshot contains 2,878 Recruitee-attributed rows. All 1,957 tenant-host URLs already match the old `/o/<slug>[/c/new]` adapter. Another 921 URLs (32.0%) use 51 custom domains that the old host policy could not fetch. **The unsupported-path message alone does not explain 90.1% unknown.** The saved snapshot contains no corresponding HTTP bodies/statuses, so the remaining causes cannot honestly be assigned to blocking, malformed responses, unavailable offers, missing descriptions, identity mismatches, or scheduling limits.

Two additional coverage gaps are visible in code: iCIMS and Phenom had no supported hosts, and the scheduled queue excluded a missing `last_seen_at`, although search permits that state. The queue now uses the same source visibility and publication filters as search. It still prioritizes never-checked/oldest-checked rows and persists each bounded batch before selecting the next. Failed persistence stops the run instead of silently advancing.

## What changes

- Recruitee tenant routes support optional locale prefixes while retaining exact offer ID, slug, title, published state and full requirements checks. The 51 observed custom domains receive only exact posting-page structured-data checks. No tenant/API endpoint is guessed from a custom domain.
- iCIMS supports a single public tenant subdomain and `/jobs/<numeric-id>/.../job`. Phenom supports exact observed employer hosts and specific `/job/<requisition-id>` routes, optionally localized. Both require matching title and same-origin structured posting URL or an exact structured requisition identifier. Conflicting structured URLs defeat an identifier fallback.
- The host registry records historical source attribution counts, not proof that a host still uses an ATS. It allows no arbitrary hosts, subdomains, non-HTTPS URLs, credentials or unusual ports. Future hosts require a reviewed registry addition. All 3,078 saved iCIMS and 593 saved Phenom URL paths fit the supported routes; this is URL coverage, **not verified availability**.
- MyJobMag remains supported as `provider: jobboard`, with exact posting URL/title proof. Only its known apex/www redirect alias is permitted. Broad worldwide location metadata cannot prove worldwide eligibility; explicit description requirements still govern.
- Y Combinator remains unverified. No reliable, offline-supported adapter has been invented.
- HTTP 404/410, a recognized redirect to a listings index, an exact employer closed/unpublished state, or an unambiguously expired exact posting can establish closure. Timeouts, access blocks, rate limits, malformed JSON, unfamiliar/missing states and missing identity stay unknown. A date-only `validThrough` includes that full UTC day; impossible dates cannot close a vacancy.
- Existing Greenhouse and Lever API responses must match the requested vacancy ID. BambooHR and Workable must match the requested title before any closed-state decision. Existing structured adapters also require exact posting URL identity, rather than title alone.

## Audit contract

Verification version **4** invalidates weak positive caches for refresh; historical conclusive restrictions and closures remain retained across transient failures. New successful observations contain `v`, `status`, `checked_at`, `provider`, `identity: exact`, `evidence_url` (the original apply URL), `checked_url` (actual page/API endpoint) and `http_status`. Compact persisted/search records preserve these fields. HTTP errors also record endpoint/status where available, with a diagnostic reason. An HTTP 200 without exact vacancy evidence never earns `ok`.

Availability and country eligibility remain independent. An exact current remote vacancy can be available while its Nigeria eligibility remains unconfirmed. Unknown current checks never become verified merely because `last_known` was positive.

## Measurement and next operator steps

The first adversarial run, before implementation, failed 13 of 54 posting tests. After implementation the verification suite passes 68 tests, including additional unknown-state, exact-URL, alias, diagnostics and queue tests. These are offline outcomes, not production conversion rates.

The scheduled checker now prints checked/verified/closed/unverified counts and unknown-reason counts per source/ATS. Any checked group above 30% unverified prints an investigation marker and this document's path. It does not manufacture positive evidence to meet a percentage. Rows not reached by a bounded run need the read-only trust report to measure the complete pending population. Unsupported YC pages, blocked/challenged responses, absent exact structured data and unsupported future custom domains are expected documented reasons to retain uncertainty. Recruitee's remaining production unknown share must be diagnosed from a user-run checker/report; it is not claimed fixed by route support alone.

The GitHub workflow offers optional `source`, `limit` and `recheck_days` inputs with shell-safe environment arguments. No workflow was dispatched. After review and deployment, the operator may run the read-only trust report before and after a bounded verification run. The following commands are for PowerShell and are **not executed by this change**:

```powershell
npm run test:verification
node --env-file=.env scripts/trust_report.js --json > trust-before.json
node --env-file=.env ingest/check_links.js --source jobhive --limit 12000 --concurrency 24 --recheck-days 1
node --env-file=.env scripts/trust_report.js --json > trust-after.json
```

The third command writes verification observations and must be run by the operator only after review. The report belongs to the separate measurement workstream. Production after values and the unexplained part of Recruitee's 90.1% remain pending those operator runs.
