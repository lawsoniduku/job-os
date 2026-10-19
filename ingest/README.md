# Phase 3 — African Ingestion Framework

A slug-driven ingestion layer for direct employer career sites, paired with
the separately scheduled, bounded JobHive importer. Adding an employer usually
means adding its verified career-site slug to the relevant registry.

## Active source policy — 19 October 2026

Discovery uses JobHive, direct company listings and the retained MyJobMag Nigeria feed. The native pipeline
fetches employer boards on Greenhouse, Lever, Ashby, Workable and SmartRecruiters,
plus employer-owned Teamtailor RSS and Breezy career sites. Employer-authored
postings on JobCopilot remain a direct source.

The six retired boards are Arbeitnow, Jobicy, Himalayas, We Work Remotely,
Jobspresso and Remotive. MyJobMag remains active for Nigerian coverage and follows
the existing publication, language, deduplication and eligibility checks. The six
retired boards have no live connector implementations. Historical
audit documents and regression fixtures may still name them; those references
do not reactivate ingestion. Existing database rows and saved application
history are not deleted by this change.

JobHive continues to use `import_jobhive.js` and its own workflow, admission
budgets, eligibility gates and refresh ownership rules. Retiring aggregators
does not expand the JobHive source inventory or bypass eligibility checks.

## Structure
```
ingest/
  core/
    normalize.js   canonical Job shape; HTML strip; remote inferred (no false default-true)
    language.js    drops non-English postings at the source (kills the German-jobs leak)
    dedup.js       url + content-key dedup (same role across boards)
    tag.js         role_cluster / seniority / remote_type / eligibility_region at ingest
  connectors/
    ats/greenhouse.js  generic slug fetcher
    ats/lever.js       generic slug fetcher
    ats/ashby.js       generic slug fetcher
    ats/workable.js    direct employer boards
    ats/smartrecruiters.js direct employer boards
    feeds/teamtailor.js employer-owned RSS feeds
    feeds/breezy.js     employer-owned career-site JSON
    feeds/myjobmag.js   retained Nigeria RSS/XML feeds
    registry.js        the company seed list  ← edit this to add coverage
  pipeline.js      fetch → language → dedup → tag → upsert
  verify.js        pings every slug, reports LIVE vs 404 + job count
  trace_nigeria.js read-only stage counts for Nigeria/Africa-seeded employer boards
```

## Run order
```bash
node ingest/verify.js      # 1. confirm which registry slugs are live; prune/fix dead ones
node ingest/pipeline.js    # 2. ingest → normalized, English-only, deduped, pre-tagged rows
node enrich.js             # 3. optional: re-tag any legacy rows (now boundary-aware)
```

## Why this raises search quality
- **Coverage**: seeds Paystack, Flutterwave, Kuda, Moniepoint, Wave, Andela, mPharma,
  Wasoko, Sun King, M-KOPA, Reliance Health, Helium Health, Cowrywise, Eden Life,
  Mono, Smile ID, Vendease, Sabi, Risevest … plus direct career sites of global employers.
  Ranking can finally surface roles that are actually open to African talent because
  they're now *in the database*.
- **Region pre-tagged**: registry region hints assist classification; they are not
  proof that every vacancy at an African-headquartered employer accepts every
  African applicant. Search still evaluates the posting's actual requirements.
- **No German jobs**: the language filter removes them before they ever hit the DB.
- **No phantom remotes**: `remote` is inferred from real signal, not defaulted true.

## ⚠️ One required manual step
Registry slugs are **best-effort guesses** (my sandbox can't reach Greenhouse/Lever/
Ashby to confirm them). Run `node ingest/verify.js` once on your machine: it prints
which slugs are live and how many jobs each returns. Keep the green ones, fix or drop
the red ones. Dead slugs are harmless (skipped silently) — verification just tightens
the list. To verify a new company: find its public board URL
(`boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<slug>`),
add `{ slug, name, region }` to the right array, re-run verify.

## Next (Phase 4 hooks already in place)
`tag.js` writes the fields a hybrid retriever needs; `eligibility_region` becomes an
indexed filter; the normalized `description` is the embedding input when pgvector
lands. No re-architecture required to add semantic search later.
