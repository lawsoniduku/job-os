# Candidate pipeline: explicit intent

Opening an employer posting is browsing evidence, not an application. The
existing `applied_intent` record can support a bounded return question, but
does not appear in the candidate's Pipeline or its column counts.

| Action | Pipeline result |
| --- | --- |
| Open a posting, dismiss the prompt or close a modal | No new card |
| Not applying, for any reason including a broken form | No card; retain feedback |
| Save for later | Saved |
| Yes, applied / Mark as applied | Applied, with the confirmation date |
| Explicitly move forward | In progress, then Offer |
| Remove an unsent Saved role | Off the board, not Closed |
| Close a real application | Closed history |

Reopening a Saved role preserves Saved. Saving or marking an already advanced
application from search must preserve its current stage and original applied
date. A stale return prompt cannot override a newer explicit save or confirmed
application. Answers update outcome and stage in one conditional write; failed
writes do not announce success.

Older Closed/Archived/Rejected rows without an applied date or confirmed
application outcome are not application history and are hidden. No production
record deletion, manual data repair or schema migration is required. A deliberate
new Save or Mark as applied can reuse such a row rather than create duplicates.
Pipeline rows always use `job_id` when reopening; an orphaned job snapshot must
never substitute its application ID as the job ID.

Regression checks exercise the actual persistence functions against isolated
Postgres and mount the actual Pipeline and ReturnNudge components with synthetic
fixtures. No production authentication or user records are used. The DOM test
checks interactions, not a real browser session or live email delivery.

PowerShell:

```powershell
npm ci; Push-Location job-os-ui; npm ci; Pop-Location
node --test job-os-ui/src/lib/applyIntent.test.mjs job-os-ui/tests/pipeline-interactions.test.mjs
```
