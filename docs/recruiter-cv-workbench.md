# Recruiter CV workbench

The role workspace combines a short role brief, actual applicant/stage counts,
one ranked list for imported/direct CVs, source/stage filters and a document
review desk. The overview highlights open roles, current stages and next steps.
The warm, light recruiter design is scoped to this workspace; candidate search
does not load the employer bundle or ZIP parser.

ZIP import accepts up to 50 PDF/DOCX/TXT CVs, 5 MB each, with a 25 MB archive
and 100 MB expansion limit. Paths, entry counts, encryption, declared and actual
expansion sizes are checked before/during extraction. Unsupported files and
unreadable/scanned documents are reported; OCR is not claimed. Original bytes
are retained. Duplicate CV imports are serialized per posting in a transaction,
so retrying a partially failed batch does not create duplicate applications.

Originals live in a private Supabase bucket. Document metadata is service-only
with RLS, a composite application/company foreign key, and immutable file hashes.
Recruiter reads are tenant-scoped. Candidate uploads are scoped to their own
submitted application. PDF links expire after five minutes; PDFs can be reviewed
in the desk or opened separately, and DOCX/TXT originals can be downloaded.
Legacy text-only applications are labelled honestly rather than reconstructed.

New direct applicants can attach an original document on the application page.
A failed original upload does not lose their received application and offers retry.
Both routes feed the same grounded role assessment queue. The backend pages
applicants instead of silently stopping at Supabase's default row limit, and role
counts are computed server-side. The browser initially renders 50 candidates.

Validation uses synthetic files and an isolated Postgres database: exact original
bytes, duplicate recovery, immutable attachments, tenant/candidate access, archive
limits, ranking order, the complete API journey, frontend checks and build.

Google OAuth keeps Supabase's existing root callback, then restores an employer
or application page from a short-lived, allowlisted local path. Callback tokens
remain in the URL fragment for the client library and are never put in the
return-intent record. Ordinary candidate homepage visits do not redirect, and
blocked browser storage does not break the landing page.
