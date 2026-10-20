# Explicit Philippine-based work-location tags

Expanded-source QA found a title ending `(Philippine-based)` with only Remote
in its location field. The existing title-country gate recognized Philippines
but missed the adjectival form of this explicit work-location label.

Normalize only the complete bracketed `(Philippine-based)` / `[Philippine based]`
tag for the existing title-country gate. The country requirement excludes
foreign applicants and accepts a Philippines applicant, subject to all earlier
hard requirements. Client-market prose and office descriptions are untouched.

Six adversarial scenarios were added before the change. This changes a
runtime title check, not persisted signal extraction or model inference, so the
signal and inference versions remain unchanged. Search and ingestion use the
same deterministic authority; stored records need no direct data edit.
