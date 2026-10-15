# Current posting verification — October 2026

Live Nigerian searches exposed US-only Affirm, South-African Kuda, Mexican Avahi,
removed STACK/micro1 links, internal-only First Intuition and a Cyma talent pool.

Search and refinement use current posting evidence when available. A failed or
pending page check does not suppress a matching role. Country uncertainty remains
explicitly Unconfirmed; confirmed exclusions and closed jobs remain excluded. Employer adapters (BambooHR, Workable, Greenhouse, Lever) and structured
posting data refresh the title, location, full description and remote arrangement.
Known Greenhouse employers can resolve board copies to a unique current employer
posting and direct application URL. No model inference survives refreshed evidence.

Checks distinguish current, removed, unknown and pending. Blocked or unsupported
sources are not called dead; they remain visible with an availability notice. Exact title
matching and explicit expiry/removed/redirect evidence avoid treating any HTTP 200
as an open vacancy. All outbound requests use an explicit HTTPS host allowlist,
manual redirect validation, response-size limits and timeouts.

Compact verification evidence uses existing elig_signals JSONB (no migration).
Successful checks cache for six hours; failed checks for five minutes. Request work
is bounded to 14 seconds and eight workers. Counts describe returned matches; the availability notice counts returned roles
whose live availability could not be confirmed.
The scheduled link checker uses the same adapters, persists 500-row batches and
checks all regions, so Supabase's response limit no longer truncates large sweeps.

Workable retains the country when remote. Normalization preserves full descriptions.
Explicit multi-region hiring alternatives survive individual country mentions.
Onsite titles, internal-only vacancies and talent pools do not enter verified results.
Worldwide inference requires actual worldwide evidence, not the word Remote.

Candidate retrieval exhausts sixteen disjoint UUID index ranges with four workers.
This avoids the broad OR scan that timed out customer support while retaining the
complete matching pool. Live read-only checks returned 727 support candidates,
176 assistant candidates and 1,101 analyst candidates without database timeouts.

Limitations: current evidence is not a hiring guarantee, employment-law opinion or
proof of qualification. Unsupported sources can have unconfirmed availability; their listing evidence is
still used for location eligibility without claiming a successful live check. Credentials, applications and
user profiles are not submitted or changed by verification.
