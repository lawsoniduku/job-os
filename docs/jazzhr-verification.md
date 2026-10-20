# JazzHR availability evidence

Verifier v7 accepts single-tenant HTTPS `*.applytojob.com` vacancy URLs in
the observed `/apply/jobs/details/<id>` and `/apply/<id>/<slug>` formats.
The public upstream JazzHR adapter documents both HTML listing and JSON-LD
detail data: https://github.com/kalil0321/ats-scrapers/blob/main/src/ats_scrapers/scrapers/jazzhr.py

A matching title is insufficient: JSON-LD must explicitly identify this vacancy
on the same employer origin with the exact case-sensitive job ID. Alternate
old/new routes for that same ID may match; another tenant or recommendation
cannot. Structured applicant locations and complete descriptions still go
through the deterministic engine. Remote status alone never proves worldwide
hiring eligibility.

HTTP 404/410, an exact vacancy redirect to its employer's known listing index,
or an unambiguously expired structured deadline can establish closure.
Timeouts, access blocks, missing identity and legacy pages without adequate
structured evidence stay Unverified. No bot-challenge bypass is implemented.

Tests cover worldwide and unknown scope, employer country restrictions,
case-sensitive identities, old/new route redirects, malicious hosts, indexes,
HTTP failures, explicit expiration and network failure.
