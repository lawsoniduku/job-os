# Academic appointments in analyst search

Ordinary BI analyst searches could include lecturer/professor appointments
because the subject in their titles matched Data Analytics aliases. The live
title gate now excludes explicit academic appointment titles from ordinary
Data Analytics searches unless the query itself asks for teaching work.

The guard recognizes academic title prefixes and explicit subject/instructor
forms. It retains analyst roles serving education/teacher products. It does
not change taxonomy classification, eligibility, inference, or stored signals.

Tests first reproduce the reported lecturer/professor/instructor false matches
despite a stale Data Analytics label, then verify ordinary analyst and explicit
academic queries remain available. Search uses the gate on every candidate,
so no production data rewrite is needed.
