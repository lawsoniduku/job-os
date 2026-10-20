# Reconcile legacy Canonical ownership

The source policy excludes the obsolete `remote_company` label. The native
Canonical board fetch could not repair its own matching rows because the writer
treated the old label as an independent source owner.

The normal native refresh now adopts a legacy row only when both records name
Canonical, its ATS identity is absent, and the current Greenhouse connector
returns the identical HTTPS `job-boards.greenhouse.io/canonical/jobs/<id>` URL.
IDs, application references, saved records and independent verification survive.
Source ordering, complete descriptions and concurrent ownership checks still
apply. Employer-authored, JobHive and other ATS records retain ownership.

Rollout uses `Refresh Job Listings`; no manual data update or blanket source
enablement is required. Rows absent from the live board remain excluded.

Validation: regression tests reproduce the former collision, verify the exact
adoption and preservation, reject other owners/hosts/companies/ATS identities,
and exercise a concurrent ownership change.
