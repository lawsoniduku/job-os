# Employer ATS: review work, preserve trust

JobCopilot already had organisation membership, posting publication, private CV uploads, applications, a screening queue and in-app candidate feedback. This release extends that hiring loop rather than creating a second applicant database.

## Research and decisions

| Official reference | Useful capability | JobCopilot implementation |
| --- | --- | --- |
| [Ashby application review](https://docs.ashbyhq.com/application-review) | Fast queues, review context, reasons, advance/archive actions | Applicant search and stage filters, oldest-first review, CV beside evidence, explicit rejection reasons |
| [Greenhouse scorecards](https://support.greenhouse.io/hc/en-us/articles/4414777492891-Scorecard-overview) | Predetermined criteria and structured interviewer feedback | Per-role required/preferred criteria; human ratings and recommendation; private notes and history |
| [Greenhouse Talent Matching](https://support.greenhouse.io/hc/en-us/articles/41131616864283-Talent-Matching-Data-Processing-FAQ) | Assistive matching against recruiter-defined criteria | Immediate literal mention scan; optional semantic AI review with validated source quotes; no automated hiring decisions |
| [Workable bulk resumes](https://help.workable.com/hc/en-us/articles/115012661408-Uploading-candidate-resumes-CVs-Individual-and-bulk-options) | Private sourced candidates, bulk imports and duplicate handling | Existing browser extraction and private upload loop retained; SHA-256 content fingerprints; no invented candidate accounts |
| [Ashby dashboards](https://docs.ashbyhq.com/core-dashboards) | Pipeline visibility and actionable work | Stage counts, unreviewed applicants, aging and due next steps; counts are not presented as conversion rates |
| [Ashby ATS](https://www.ashbyhq.com/platform/recruiting/ats) | Connected hiring workflow and privacy controls | One application record, scoped recruiter routes, private review tables and recoverable scanning leases |

## What ships

- Manual job posting remains available when the model is unavailable. Employer-declared countries reach the shared deterministic eligibility engine through the searchable mirror.
- Criteria are explicit, job-related, capped at 12, and separate from hiring location. Basic CV scanning uses no model calls. Coverage means mentions in a CV, not proficiency or hiring suitability. Review defaults to longest-waiting first.
- A recruiter can explicitly request a deeper AI review. It recognises equivalent experience, offers interview questions, retains model/time/source metadata and requires source quotes for positive claims. Missing evidence stays a question for a person. CV changes or changed criteria invalidate visible AI output. The first 14,000 CV characters are reviewed and partial reviews are labelled.
- CV scanning uses database leases, conditional completion, restart recovery and criteria-change invalidation. It does not depend on a browser continuing to poll.
- Private notes, human scorecards, next steps and activity are inaccessible to browser database clients. Server requests resolve membership and filter by organisation; private review saves check a record version to prevent stale edits. Candidate database writes are restricted to acknowledging feedback and responding to introductions; candidates cannot rewrite employer decisions.
- Application receipts are idempotent and transactional. A repeated application cannot reset a recruiter decision. Feedback and the stage change commit together. Uploaded CVs receive private stage updates; this release does not pretend to send them email.
- Employer pages and application pages load separately from the candidate app. Errors show recoverable messages instead of a blank employer shell or a misleading new-organisation form.

## Boundaries

This is a working recruiter foundation, not a claim of enterprise ATS completeness. Team invitations and granular job permissions, calendar booking, two-way email and delivery tracking, consent/retention administration, offers and approvals, and cross-role talent rediscovery require subsequent workstreams. No real invitations, rejection emails or hiring decisions are sent during automated tests.

Original files are extracted in the browser. Uploads are limited to 50 CVs per request and 5 MB per file; stored CV text is capped at 50,000 characters. PDF and DOCX text extraction does not provide OCR. The basic scanner matches explicit phrases and a small alias set; semantic interpretation is optional and clearly identified. Existing human review is always available when AI capacity is exhausted.

## Validation and rollout

`npm run test:hiring` uses isolated Postgres and synthetic HTTP fixtures, without production credentials. It exercises publication, upload, scanning, private reviews, optimistic conflicts, cross-tenant access, lease recovery, invalidation, application replay, and atomic feedback. Additional tests challenge short-skill matches, fabricated AI quotes, protected criteria and missing geography. Existing eligibility, JobHive, search, verification and frontend trust checks remain required.

Apply the timestamped employer workspace migration before deploying the API and frontend. Inspect database advisors after applying. The optional `Refresh employer job mirrors` workflow defaults to dry run and can refresh existing open postings through the normal publication writer after release.

PowerShell checks:

```powershell
npm ci; npm run test:hiring; npm run test:eligibility; npm run test:jobhive; npm run test:search; npm run test:verification
Push-Location job-os-ui; npm ci; npm run build; Pop-Location
```

Authenticated live browser verification is a separate release observation; isolated HTTP and schema tests do not establish that a real recruiter's signed-in browser session has passed.
