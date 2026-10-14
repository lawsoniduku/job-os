# Eligibility audit — 14 October 2026

Reviewed main at `2c90c030a0a941c92e980be42052c977b4911870` and reproduced failures offline. No production database, deployed API, application forms, or runtime logs were inspected. These are confirmed code defects, not a measurement of production failure rates.

## Fixed in this focused patch

| Reproduction | Before | After |
| --- | --- | --- |
| UK user; body says “Open to Nigeria.” | Certain: open to anyone, anywhere | Unconfirmed outside the named country |
| Canadian user; body says “Open to candidates in Africa.” | Certain: open to anyone, anywhere | Unconfirmed outside the named region |
| Nigerian user; worldwide location; body says “Applicants must reside in Kenya.” | Certain: worldwide | Excluded with the quoted residency requirement |
| Nigerian user; Nigeria in title; body requires India residency | Certain: title matches | Excluded; body requirements take precedence |
| Nairobi location with a generated Nigeria region tag | Certain for Nigeria | Excluded; generated tags are not proof of hiring eligibility |
| Worldwide location but no usable description/signals | Certain | Unconfirmed |
| Remote search without a user country | Could return likely eligible without checking residency | No positive personal eligibility claim |
| Missing/unknown/excluded UI verdict | Could default to Eligible | Unconfirmed or Not eligible |
| Search/Briefing totals containing possible results | Labelled actually/verified eligible | Labelled matches; cards distinguish confidence |

An invitation naming one country is not necessarily exclusive. Only explicit mandatory or “only” language in the new scope extractor excludes other locations. Invitations without exclusivity leave outsiders unconfirmed. Company addresses and customer-market mentions do not become requirements in this new extractor.

Existing legacy rules still operate separately; the new extractor is a guardrail, not a complete natural-language parser.

## Remaining issues requiring a broader change

1. **Work authorization is not connected to search.** `aiSearch` sends only country; `scoreJobLocally` calls `checkEligibility(job, country)`. Saved citizenship, authorizations and `needs_sponsorship` do not participate. `EligibilityCard` also automatically adds residence to authorizations and defaults citizenship to residence. These must become separate, explicit facts; residency alone does not establish citizenship or work authorization. Changing the residence card does not currently update the profile country used by search.
2. **Country restrictions are still applied globally.** `HARD_EXCLUSIONS` rejects “US only” even for a US target, and the US-residency company gate also excludes US users. The database region prefilter admits only Global/Remote/Unknown for most non-African countries. Kenya and other specific African jobs are tagged Regional and can be removed before their own residents are evaluated. South Africa's key also differs between the prefilter and country map. Fix retrieval and verdict logic together, using a multi-country test matrix.
3. **Search target can replace residence.** An explicit country in a query wins over profile country. That is useful for exploration, but cannot establish that the person may work or live there. Destination, residence, citizenship, authorization and relocation preferences need separate fields.
4. **Refinement has different safeguards.** `/ai/refine` scores eligibility, but does not apply the main search endpoint's reported-job suppression or default freshness/liveness filters. A reported or closed role can reappear after refinement.
5. **Legacy evidence rules remain brittle.** Headquarters mentions can exclude international roles; statutory benefits are treated as jurisdiction locks; some broad location signals return before checking those locks. Inferred region membership is incomplete for individual non-African countries. Requirements that the parser does not recognize remain a coverage risk.
6. **Employer application gates are not generally inspected.** Country dropdowns, payroll limitations and authorization questions can exist only on the application form. An eligible label cannot promise those have been checked. Old saved conversation verdicts also need revalidation after logic changes.

## Validation and rollout

- 28 existing scoring checks, 36 existing inference checks, and 31 new guardrail checks pass (`npm run test:eligibility`). New job fixtures compare raw descriptions, current cached signals without descriptions, and stale signals with descriptions.
- Production frontend build passes (`cd job-os-ui && npm run build`).
- Added a pull-request workflow to run eligibility checks and the frontend build without production secrets.
- `SIGNALS_VERSION` increases from 2 to 3. Deploy backend and frontend together after review. Run the existing **Backfill eligibility signals** workflow on the merged revision so stored rows receive the new scope information. Until coverage returns, the backend's existing version-aware probe fetches descriptions; expect higher latency. Rows missing details stay unconfirmed.
- Before treating this as a complete eligibility repair, replay reported jobs and representative real listings for Nigeria, Kenya, South Africa, US, UK and Canada against the deployed service, including refinements and saved sessions. No live-data validation or deployment was performed in this audit.
