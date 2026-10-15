# Search relevance and refinement repair

The reported query, `virtual assistant jobs open to nigeria`, returned 29 matches
from exactly 600 evaluated rows. Only two of those 29 were assistant roles.

## Root causes and changes

- Retrieval reduced aliases by substring, so `EA`, `PA` and `VA` swallowed longer
  aliases and matched words such as head, preparation and valuation. Retrieval
  now uses index-friendly literal filters with whole-word constraints on short
  abbreviations. A shared scorer checks final title relevance. Pure regex queries
  timed out intermittently; literal prefilters were verified against live data.
- The scorer excluded only known cross-department mismatches. Unknown titles and
  unrelated roles in the same department survived on geography/freshness points.
  A positive title role match is now mandatory, independently of eligibility.
  A lone skill mention or stale stored cluster is insufficient. Assistant
  abbreviations in US state lists cannot establish a role match.
- Both search endpoints now share candidate retrieval, freshness, liveness,
  reported-job suppression, stale-signal hydration, scoring and duplicate removal.
- Keyset pagination exhausts the matching candidate pool instead of stopping at
  the newest 600/500 rows. Failure to fetch a page fails the search rather than
  returning a partial total. Large clusters consequently cost more than small
  ones; observed read-only checks evaluated 6,614 engineering candidates in
  approximately 35 seconds from the development environment.
- Coarse region tags no longer remove candidates before actual country evaluation.
  They previously hid domestic and mistagged jobs for several countries.
- Seniority refinements actually filter. Refinements retain the original query,
  accumulate salary/source/date/employment/seniority filters, and support pagination.
  The UI preserves that state and displays counts from the refined search.
- Duplicate results are removed after scoring/filtering. Identity retains the full
  normalized location, and separate employers/locations are not merged. Counts
  reconcile as evaluated = matches + excluded + duplicates.
- The UI shows the complete alias list and describes title matching without
  claiming to verify sponsorship or independently confirm every posting.
- Standard ingestion now uses the tested retry/row-isolation writer, reports
  rejected source promises, refreshes accepted candidates only, and exits nonzero
  on source/write/freshness failures. Connector-internal swallowed errors remain
  outside this outer runner's visibility.

## Validation

- 48 new search regressions: reported titles, US-state acronym collisions,
  retained assistant titles, query quoting, complete pagination, stale signals,
  duplicate handling, seniority and combined filters, and database failure.
- Existing 113 eligibility/inference/JobHive checks pass.
- Frontend production build passes.
- Read-only live-data replay retained the two legitimate original assistant
  results and excluded all 27 unrelated original entries. Expanded retrieval
  also found assistant listings outside the previous newest-600 pool.

No database migration or signal-version backfill is required. This change does
not independently verify work authorization or repair all historical source data.

## Follow-up: publication-date ordering (15 October 2026)

The live assistant query still placed a 17 September posting above 4 October and
2 October postings because score was the primary ordering key. Search and
refinement now order all surviving matches by publication date descending, then
score and stable ID. The final sort after optional model scoring uses the same
comparator. Undated/invalid dates sort last; neither import time nor feed refresh
time substitutes for publication time. The UI identifies this as newest-first.

Missing source dates now remain null on new imports (the live jobs table already
contains null publication dates), and database creation time earns no freshness
bonus. Existing historical dates are not rewritten without source evidence.
Older listings can still appear below newer ones if they pass visibility checks;
publication age alone does not prove a listing has closed.

Nine additional regressions cover the reported date inversion, missing/invalid
posting dates, stable ties, model-score ordering, refinements, duplicate selection,
and ingestion date handling. All 170 checks and the frontend build pass.
