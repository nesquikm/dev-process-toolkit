# Resolver Fixture: overlapping-prefixes

Tier-3 fixture for M14 (FR-51, AC-51.6 ambiguity path). Both Linear and Jira
declare the `FOO` prefix — `/spec-write FOO-42` must error in NFR-10 shape
naming both `linear:FOO-42` and `jira:FOO-42` candidates.

## Task Tracking

mode: linear
mcp_server: linear
secondary_tracker: jira
secondary_mcp_server: atlassian
jira_ac_field:
