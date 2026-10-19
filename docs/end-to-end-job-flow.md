# End-to-end job flow and change boundaries

Reviewed 2026-10-18 against the surgical working tree. This is a code and contract map, not a claim that every authenticated flow has been exercised in production.

Source policy updated 2026-10-19: the native pipeline now fetches direct employer
ATS/career sites (Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
Teamtailor and Breezy) plus the retained MyJobMag Nigeria feed. JobHive remains
separate, and employer-authored postings remain supported. Six other boards
(Arbeitnow, Jobicy, Himalayas, We Work Remotely, Jobspresso and Remotive) are retired;
earlier audit descriptions of those connectors are historical. Existing database rows and application snapshots
are not deleted by source retirement. `api/sourcePolicy.js` restricts search,
digests and ongoing verification/inference/enrichment to maintained sources.
Retired board URLs cannot bypass discovery policy under a JobHive source label.

## Runtime and entry points

- `index.js` imports `api/server.js`; root `npm start` starts that Express API directly. Environment-backed dependencies are Supabase, the configured LLM provider (`lib/llm.js`), and external employer/ATS pages.
- `job-os-ui` is a separate Vite/React application. `src/main.jsx` selects the candidate application at `/`, the employer application at `/employer`, and public employer postings at `/apply/:uuid`. Vercel rewrites deep links to `index.html`.
- Candidate navigation is component state, not routing. All five candidate views mount together after entering the app. An exception in an inactive view can therefore blank the signed-in application. The Briefing SSR regression test exists because a previous undefined render variable caused exactly this failure.
- Browser Supabase configuration is the public URL/anon key; API configuration requires a server key for employer tables. The API must verify identity and filter organization ownership itself because a service role bypasses RLS.

## Data production and ownership

| Producer | Authoritative record | Search projection and ownership rule |
|---|---|---|
| Native ATS/career-site connectors and MyJobMag Nigeria | External employer posting or retained Nigeria feed | `ingest/pipeline.js` normalizes, tags, deduplicates and writes `jobs`. Native connector ownership must survive overlap with JobHive. |
| JobHive CSV importer | Upstream ATS dataset row | `ingest/import_jobhive.js` streams one ATS slice, rejects out-of-scope rows, normalizes/tags, deduplicates, then uses `core/jobhiveRefreshWriter.js`. Existing rows are refreshed only when owned by JobHive for the same ATS; IDs, creation time and application links survive. Native ingestion continues to use the separate insert-only `core/jobhiveWriter.js`. |
| Employer console | `job_postings`, organization-scoped | `api/employer.js` mirrors open postings into `jobs` with `source=ats_source=employer` and `/apply/:postingId`. Draft/closed postings are removed from search. JobHive and stale pruning must not acquire ownership of this projection. |
| Eligibility extraction/inference | Posting evidence, not applicant identity | Versioned `jobs.elig_signals` supports lean search; inference and verification may add evidence. A source refresh must recompute source-derived signals when content changes without discarding conclusive employer verification. |
| Posting verification | Employer response/evidence at check time | `postingVerification.js`, `check_links.js` and `verificationWriter.js` maintain closure/location evidence and link timestamps. A recent import is not proof of an open employer posting. |

`posted_at`, source observation/fetch time, `last_seen_at`, and employer verification time answer different questions. They must not be substituted for one another. Deadline evidence must be handled before a long description is shortened. The full supplied text is needed for eligibility extraction even when the persisted description is bounded.

JobHive normal import historically ignored duplicate URLs and separately touched last-seen timestamps. The revised refresh writer counts actual inserts and refreshes separately, protects other owners, refuses incomplete observations that erase known geography or text, and skips explicitly older observations. New inserts have per-run defaults of 500 rows and 10 MiB of serialized payload per ATS slice; refreshes do not consume that admission budget. These are intake controls, not a measured physical database-size cap. Full descriptions are retained in this release so downstream CV and eligibility consumers keep the complete requirements; description truncation remains deferred.

Source content changes invalidate old inference and record `source.changed_at`. Older positive employer proof is retained for history but cannot override newer applicant requirements or grant a green worldwide verdict until a fresh employer check. A definitive closure remains effective across transient failures. The shared `core/jobSignalsWriter.js` uses JSONB compare-and-swap and bounded retries so verification, backfill, inference and importer workers merge against the latest evidence instead of replacing another writer's metadata.

`core/jobhiveObservations.js` loads a paginated, bounded index of existing importer-owned rows for one ATS. Supplied expired deadlines and stale upstream fetch times can therefore update existing source metadata without importing rejected jobs, rewriting content, refreshing `last_seen_at`, or altering inference/employer proof. Missing rows in a partial feed do not trigger deletion or inferred closure.

Discovery keeps the 180-day ordinary publication window. Older current-year postings require conclusive employer-open evidence from the last seven days; a recent upstream observation can admit such a record for later verification within the JobHive budget, but does not itself make the record discoverable. Known expired source deadlines override positive discovery evidence, including after employer content is projected into a result. Stale source observations require recent conclusive employer evidence. Explicit user recency filters remain based on publication date.

## Search and consumer contract

1. `/ai/search` parses role aliases, requested country, seniority and remote preference. Explicit country text wins over the profile-country query parameter. `/ai/refine` reconstructs the intent and applies cumulative filters.
2. `searchCandidates.js` retrieves relevant role/alias candidates through paged partitions. SQL source, publication, observation and dead-link gates act before eligibility scoring. Four parallel UUID ranges use exhaustive 1,000-row keyset pages. Schema capability probes replace whole-database signal counts; missing/outdated signals are hydrated with their exact descriptions before scoring.
3. Local ranking applies eligibility, relevance, non-vacancy, salary and explicit-recency checks. Candidate employer verification then runs within a hard two-second shared budget; final ranking recomputes with the resulting evidence. Search uses in-memory checks without synchronous database persistence; the scheduled checker remains the durable evidence writer. Pending checks retain previous restrictions/closure and do not drop candidates. Unknown verification is not itself proof of closure.
4. Results are publication-date ordered, deduplicated and paginated. The server caches rankings briefly by intent and filters; that cache can mask an import/logic change until expiration or process restart.
5. `Copilot.jsx` consumes `data`, `total`, `has_more`, `intent`, counts, `sort` and eligibility/verification evidence. It persists result snapshots in threads. Restoring an old thread does not revalidate the displayed cards automatically; new search is necessary when validating a release.
6. `Briefing.jsx` searches all preferred roles through `briefingFeed.mjs`, with bounded concurrency, merged deduplication and a five-card display. It falls back to the latest saved search. It has loading, partial-error, full-error and empty states. Its final display is a sample, not the complete search inventory.
7. `verdictOf` displays green Eligible only for explicit `eligible=true, confidence=certain`; likely, unknown and excluded evidence must not become green merely because a record has `eligibility_region=Global`.

Search card fields that must remain compatible: `id`, `title`, `company`, `location`, `apply_url`, `source`, `ats_source`, `role_cluster`, `posted_at`, salary bounds, computed `score`, computed `eligibility`, and public verification information. The card does not need the full description. CV match, rewrite and interview endpoints fetch the current `jobs` row by ID separately, so deleting/recreating rows or aggressively shortening descriptions can break those later actions even if search itself still works.

## Candidate state and employer loop

- Profiles, CVs, saved searches, threads, applications and analytics are browser Supabase operations protected by their own RLS policies. `useSession` deliberately fetches the complete own profile to avoid silently dropping columns introduced by migrations.
- Applications snapshot title, company, URL, salary, verdict and role cluster. An outbound click records `applied_intent`, not proven submission; the return nudge records a separate outcome and conditionally moves the user's board card. Refreshing a source job must not rewrite these user-owned snapshots or statuses.
- `Pipeline` renders those application snapshots. Interview prep still needs a live `job_id` lookup; snapshots do not make deletion harmless to every feature.
- Employer reads/writes use bearer-authenticated `employerApi.js`, `auth.js` and organization-scoped routes. Public posting reads are anonymous-capable; submission requires authentication and reads the applicant's profile/CV server-side.
- Employer submissions snapshot the submitted CV/profile separately from the candidate's application board. Candidate deletion of a board row must not erase the employer's submission. Employer feedback and introduction consent are separate tables.
- AI drafting asks about missing employment eligibility and compensation rather than inventing facts. Bulk/scoring queue uses a paced, in-process worker. It is not a durable multi-instance worker; an importer change should not touch this path.

## Schema and operational limits

The checked-in SQL files are manually applied migrations; a complete initial `jobs`/`applications` creation baseline is not in this repository. Migration text alone cannot establish production schema parity. `apply_url` upserts require a deployed unique constraint; the non-unique index in migration 002 is not a substitute.

Scheduled ingestion, JobHive import, signal backfill, inference, link verification and weekly email are separate workflows. Weekly email currently selects coarse region labels directly rather than reusing the search eligibility and verification path. Improving search therefore does not automatically improve the digest. No email was sent during this review.

## Existing risks recorded, outside this change

- `015c_employer_rls.sql` allows candidate updates to their own sent feedback and intro requests without database column restrictions. The UI writing only `seen_at` or response status does not enforce that column boundary against a direct client. Audit and repair separately; not exercised or altered here.
- `useSession` has no rejection handler on its initial `getSession()` promise. An unexpected auth/network rejection can leave the initial blank loading shell. Build/SSR cannot establish live auth recovery.
- Profile copy promises additional work-authorization/salary personalization, while current ordinary search sends country and query rather than the entire profile. Those claims require a separate product-contract review.
- Digest filtering and unsubscribe routing differ from the candidate search path. A source expansion must not be represented as uniformly eligibility-verified across email.

## Minimal release evidence

For targeted ingestion changes:

1. Replay representative raw rows through the full import path, including worldwide wording beyond the future text cap, country restrictions, stale upstream records, expired deadlines, duplicate identity parameters and separate regional vacancies.
2. Test writer outcomes with existing JobHive, native and employer rows; preserve IDs, source ownership, verification, user references and creation/publication dates. Include write failure/retry behavior and truthful counters.
3. Run eligibility, JobHive, search/discovery and verification suites required by `.github/workflows/eligibility-tests.yml`.
4. Run the Briefing SSR regression, briefing merge tests, apply-intent tests and UI production build. These establish static/render contracts, not signed-in production workflows.
5. Before increasing import volume, dry-run source slices with rejection/candidate/insert estimates and description-size accounting. Compare a fresh search, pagination and employer click-through for a known admitted worldwide job and known excluded restricted job.
6. Check production deployed SHA and scheduled run outputs before claiming deployment or recovered coverage. Keep imported candidates, stored jobs, confirmed location eligibility and confirmed live postings as separate measurements.

Baseline checks run during this review: UI production build passed; Briefing SSR plus feed/apply-intent test command passed (6 Node test entries, including the apply-intent file's 14 assertions). Independent integration reproductions also confirm that an expired source deadline remains excluded after applying positive employer proof, that source metadata and the complete verification cache survive that projection, and that newer UK applicant restrictions beat older worldwide proof while changed positive source claims stay unconfirmed. Broader regression-suite results belong to the release check, not these isolated reproductions. Sign-in, OAuth, candidate data writes, employer publication, submission and actual RLS behavior were not exercised. No manual production data edits, pruning, employer/candidate submissions or messages were performed. Production search checks may refresh their verification cache.
