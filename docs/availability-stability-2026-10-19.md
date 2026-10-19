# Availability repair: observed URLs and bounded provider pressure

## Root causes confirmed with public source reads

On October 19 the production database's retained MyJobMag rows used the actual
RSS format `https://www.myjobmag.com/a_fields.php?id=<numeric-id>`. The previous
adapter supported only `/job/<slug>`, so it returned `Unsupported employer
vacancy URL` without making a request. The live `aggregate_feed.xml` confirms
that these are vacancy identities, not category links.

Two real public reads established the publisher's identity chain:

- `a_fields.php?id=1363262` redirects to
  `/job/human-resource-manager-viju-industries-nigeria-limited-1`.
- `a_fields.php?id=1364745` redirects to
  `/job/director-academics-newglobe-10`.

The current pages have a canonical URL, a main `h2` with `id="job<same-id>"`,
a `subjob-title`, and a matching `JobPosting`. Their structured data omits its
own URL/identifier and emits deadline offsets such as `+0000`. Requiring a
JSON-LD URL alone excluded valid evidence; accepting every HTTP 200 would
have hidden the identity problem.

The verifier now recognizes only a single positive numeric RSS ID, the
historical `/job/<numeric-id>/<slug>` format, and the existing `/job/<slug>`
format. A numeric RSS redirect earns availability only when the canonical
page, main heading ID/title and exact structured title agree. Conflicting
structured URLs, other IDs, unrelated redirects and category pages remain
unknown. Current public HTML captures for both vacancies produced `ok` in a
read-only replay. Historical ID 27481 also confirmed the older numeric route;
no current availability is claimed for that old vacancy.

The public Tether posting
`https://careers.tether.io/o/senior-nodejs-software-engineer-holepunch-100-remote-worldwide-12/c/new`
likewise omits a structured URL. Its same-origin `/api/offers/<slug>` endpoint
was observed returning exact offer ID 2787195, slug, published state, title,
description and requirements. This specific known custom host now uses the
existing strict Recruitee API contract. Other custom hosts retain conservative
structured verification; an API host is not guessed from an arbitrary domain.
Availability proof does not imply Nigeria eligibility.

DHL `https://careers.dhl.com/job/AV-386210` and Thermo Fisher
`https://jobs.thermofisher.com/job/R-01362216` redirected to localized home pages
without exact posting evidence. These observations remain unknown. They do not
justify labeling every Phenom job open or closed. Other Phenom/YC custom
coverage gaps remain documented in `availability-trust.md`.

## Operational changes

Verification version 5 makes the changed adapters due for refresh. Existing
conclusive restrictions/closures are preserved through transient failures.
Unsupported hosts/routes carry `retryable: false`; the scheduled queue skips
only those current-version observations. A future verifier version makes them
due again automatically. Listings remain searchable with uncertainty labels.

Scheduled checks use at most two simultaneous requests per employer host,
within the existing total worker limit. A real 429 reads `Retry-After`; that
host enters a bounded cooldown (default 60 seconds, maximum one hour). Remaining
rows from that host are recorded as unverified and explicitly not checked,
with no invented HTTP status. Other employers continue normally. The next run
retries deferred rows under the normal due policy. No extra provider, queue
service or database migration is needed.

## Validation

Adversarial cases were added before implementation. Real RSS routes and
`+0000` deadline cases initially failed. Tests cover wrong IDs, unrelated
redirects, category pages, duplicate/malformed IDs, conflicting structured
URLs, per-host concurrency, isolated 429 cooldowns and unsupported-queue
version invalidation. `npm run test:verification` passes 79 tests.

This change performs no production writes or workflow dispatches. Live HTTP
reads and a read-only Supabase sample established the root causes. Complete
production before/after coverage must come from the trust report after rollout;
these sample observations are not a source-wide verification success rate.

## Reported Zelh remote-location loss

The live Operations & Customer Service Representative offer had `location: "Remote job"` but a visible, required multiple-choice application location field listing Serbia and Ukraine. The adapter discarded those choices as office metadata. Version 5 now preserves exact vacancy locations when the offer API explicitly makes this selection visible and mandatory. The ordinary deterministic country engine then excludes Nigeria. Optional office preferences and missing location controls still do not turn an explicitly global role into a country restriction. Two adversarial regressions cover foreign choices, a Nigerian alternative, optional/hidden controls and missing choices. This changes source evidence extraction, not country eligibility rules.
