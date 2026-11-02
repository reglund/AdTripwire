# Benign-browsing evaluation protocol (false-positive measurement)

Purpose: measure how often rules produce misleading alerts during ordinary browsing.
This is separate from synthetic coverage and must be reported separately.

1. Fresh Firefox profile, production build, default settings, Enhanced Tracking
   Protection at its default ("Standard").
2. 30 minutes of ordinary browsing across ≥ 20 distinct ad-supported sites (news,
   sports, recipes, forums), including scrolling and a few clicks on non-ad links.
3. Afterwards export evidence (default profile) and record, per rule id: count,
   severity, and a manual verdict (expected exposure / benign / misleading).
4. Any `elevated` or `high_priority` detection during benign browsing is a defect to
   triage: either the rule logic, the indicator classification, or a genuine exposure.
5. Report format: table of rule id → count → verdict, plus total events observed
   (dashboard → Overview) and session duration.

Results are recorded in `docs/evaluations/<date>-benign.md`. None exist yet for Phase 1.
