# Native source refresh

The native importer previously inserted new rows with duplicate URLs ignored, then
updated `last_seen_at` by URL for everything it saw. Existing source text and
eligibility restrictions never refreshed. That final update could also stamp a
JobHive or employer-owned row when a native source collided with its URL.

`nativeRefreshWriter.js` replaces that split operation. It batch-reads the current
50-row URL slice, inserts new records in one conflict-ignoring batch, and refreshes
existing records only when both source and ATS owner match. Existing records use
bounded compare-and-swap writes with four workers; only a race reloads an
individual URL. It retains row IDs and creation time, so saved jobs/applications
keep their identity. Collision rows receive no content or freshness changes.

The source snapshot supplies full text, title, company, location, remote state,
and publication date. Canonical tagging is rerun after missing known location and
country values are preserved. A meaningful input change drops old inference,
preserves independent verification history, and sets `source.changed_at` so older
positive evidence cannot establish current availability. Concurrent inference or
verification wins trigger a reload and merge. New input cannot import AI results
or posting observations. Reobserving identical content preserves inference and
the original change time.

Collection start (`source.fetched_at`) orders overlapping runs; content changes
use the actual write-time clock. A delayed old collection or older explicit
upstream revision cannot replace newer content. `last_seen_at` means source
observation, never publication. Known dates survive missing source dates.

Greenhouse's `updated_at` and Breezy's `updated_date` are revisions, not publication
dates. New undated postings remain undated. Existing stored dates are preserved
conservatively because historic dates cannot safely be reconstructed; the new
Greenhouse source metadata records `publication_unknown`. Lever list/additional/
closing sections are included in full because hiring restrictions often live
there. SmartRecruiters now retains available jobAd sections instead of returning
the title due to a ternary precedence bug, and labels list-only descriptions
incomplete. No extra per-posting detail requests were added.

Incomplete descriptions cannot replace known full text. MyJobMag remains enabled;
a shorter RSS summary does not erase an existing longer description. Such skips
are counted separately and do not stamp freshness. This conservative rule can
skip a legitimate shorter MyJobMag revision; a future direct-page fetch can
resolve it, rather than claiming a partial feed retracts a known restriction.
Native deduplication now keeps distinct application URLs with identical title and
location so that every owned opening can refresh; search still deduplicates
results for the candidate.

Validation: `node --test ingest/test_native_refresh.js ingest/test_native_connectors.js`;
`npm run test:jobhive`; `npm run test:search`. All fixtures are local and no
production writes are performed by these tests. No database migration or model /
engine contract change is required.

## Review corrections

Snapshot projections include `remote_type` and `eligibility_region`; otherwise an unchanged source would incorrectly invalidate inference on every refresh. Tests now honor real SELECT projections. Unchanged descriptions are not resent in UPDATE payloads.

Employer-board HTTP failures other than expected 404s fail the source run while retaining independently successful employer rows. They cannot masquerade as green empty boards. Unknown publication metadata is displayed honestly and cannot qualify for a recency filter, urgency banner or newest-first ordering; stored historical dates still constrain visibility, so this does not resurrect 2025 records.

The public TestGorilla Ashby API was verified on October 19 (four listed roles, including the previously missing People & Talent Operations Partner) and added to the maintained direct-company registry without a geography hint. Eligibility remains independently assessed for each vacancy.
