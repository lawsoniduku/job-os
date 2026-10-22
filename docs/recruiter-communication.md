# Recruiter stage updates and interview invitations

From the candidate review desk, a recruiter can advance an application and email
the applicant, or choose an interview time, duration and meeting link/location.
Scheduling, rescheduling and cancellation send an iCalendar attachment. Calendar
clients may require acceptance/import; this does not create video rooms, inspect
free/busy information or silently write to a personal calendar.

The recruiter explicitly confirms an imported candidate's email. Direct applicants
use their account email, never an address supplied by the employer. Notes are
shared only when entered in the candidate-message field. Private review notes,
scorecards and CVs are never copied into the outgoing message.

Stage changes and an immutable message payload are committed together. A request
ID prevents repeated stage changes after network timeouts. A service-only outbox
leases pending messages; retries use the same Resend idempotency key. Retries stop
before the provider's 24-hour deduplication window expires. Uncertain old deliveries
require checking the provider, rather than risking an automatic duplicate.
Reschedules keep the event UID and increment SEQUENCE; cancellations use CANCEL.
Unsent superseded invitations are replaced. The UI distinguishes queued, sending,
provider-accepted, replaced and failed messages. Provider acceptance is not a claim
of inbox delivery or attendance. Every hiring outcome is initiated by a recruiter.

## API deployment configuration

Set these in the Render API service environment, never the browser or GitHub source:

- `RESEND_API_KEY`: the existing email provider's scoped sending key.
- `HIRING_FROM_ADDRESS`: e.g. `JobCopilot <hiring@your-verified-domain>`.
  An explicitly configured `DIGEST_FROM_ADDRESS` can be reused instead.

No fallback test sender is used for real applicants. Without both settings, email
actions are visibly unavailable while CV review and private stage updates work.
The authenticated `/employer/communications/status` endpoint reports readiness;
`/health` exposes only the boolean `recruiter_email_configured`, never credentials.
Provider errors remain visible and recoverable after configuration is corrected.

No real applicant email was sent during automated testing. Tests use synthetic
addresses, an isolated Postgres database and a mocked Resend transport.

References checked during implementation:
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://www.rfc-editor.org/rfc/rfc5545
