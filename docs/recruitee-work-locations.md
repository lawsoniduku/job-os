# Recruitee published work locations

The employer offer API separates its public `locations` from application-form
location-question flags. A hidden application question does not erase the
posting's work location. Previously a generic `Remote job` string replaced that
geography, making a US-based vacancy look geographically unconfirmed.

Verifier version 6 uses published offer locations when the free-text location is
generic and full posting text supplies no explicit worldwide hiring evidence.
Visible mandatory location choices still take priority. Optional office choices
cannot narrow explicit worldwide hiring. The deterministic eligibility engine
continues to decide the resulting country eligibility; no engine rule changed.

Tests first reproduced the reported Hard Rock Digital shape: remote work, a
hidden application location question, and a published Florida/United States
location. The compact persisted evidence must exclude Nigeria and survive
search ranking. Mixed Nigeria/foreign locations and existing explicit worldwide
fixtures guard recall. The version increment makes older observations due for
normal scheduled revalidation rather than requiring manual production edits.
