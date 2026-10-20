# Recurring JobHive coverage

The daily workflow now refreshes the original iCIMS, Phenom, Recruitee,
Y Combinator and BambooHR slices plus JazzHR, Rippling, Personio, Pinpoint,
Gem, Recruiterbox, Eightfold, Greenhouse, Lever, Ashby, Workable,
SmartRecruiters, Teamtailor and Breezy.

Native company registries remain active. Their ownership wins overlapping
URLs; JobHive supplies employers outside those registries. The six retired
aggregator feeds stay excluded. MyJobMag stays enabled.

## Bounded intake

The original slices retain 500 new rows / 10 MiB each per invocation. Each
added platform admits at most 50 new rows / 1 MiB per invocation: at most
700 additional new rows / 14 MiB across all fourteen added platforms.
These are serialized payload ceilings, not physical database-size estimates.
Existing owned records refresh independently of the new-row budget.

The importer still applies language, publication, deadline, source observation
and deterministic country eligibility gates, deduplicates application identities,
and selects the added platforms' new candidates with certain/likely deterministic
eligibility before unconfirmed candidates, newest-first within each group.
The original five keep their previous newest-first admission order.
Unconfirmed jobs still fill spare capacity; this is intake priority, not a new
eligibility verdict. It prevents newer generic Remote rows from exhausting a
small intake budget before evidenced worldwide/Nigeria/EMEA roles are reached.
No eligibility rules are weakened and
no missing dates are replaced with import dates. Unknown remote scope remains
unconfirmed. The version-controlled retention policy remains separate.

Daily imports run at 03:00 UTC with at most two source jobs in parallel.
Each job has a 45-minute limit. Source failures stay visible while independent
sources continue; the complete nineteen-source run can take longer than the
former five-source run. Logs distinguish inserted, refreshed, budget-deferred,
collisions and failures. Review throughput before raising any budget.

## Operation

The workflow's `sources` input accepts `all` or comma-separated maintained
names, such as `jazzhr,rippling`. Unknown names fail before any import.
`dry_run` scans/classifies without database reads or writes. Retry individual
failed jobs rather than rerunning successful imports unnecessarily.

Availability is independent of collection: an imported posting is not Verified
without exact current evidence. Unsupported or blocked employer pages stay
Unverified. This expansion does not claim all upstream postings are global,
eligible, open, or included in our bounded database.
