# Phase 3 — African Ingestion Framework

A scalable, slug-driven ingestion layer. Adding a company is one line in the
registry, not a new file. Everything stays dependency-light (axios only) and
network-free to test (the core was validated on mock payloads).

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
    registry.js        the company seed list  ← edit this to add coverage
  pipeline.js      fetch → language → dedup → tag → upsert
  verify.js        pings every slug, reports LIVE vs 404 + job count
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
  Mono, Smile ID, Vendease, Sabi, Risevest … plus global remote-friendly boards.
  Ranking can finally surface roles that are actually open to African talent because
  they're now *in the database*.
- **Region pre-tagged**: African-HQ employers carry a `region` hint, so their roles
  get `eligibility_region = Africa/Nigeria` even when the JD never says "Africa".
  Search reads this precomputed field instead of re-scanning text per query.
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
