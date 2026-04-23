# Resolver Fixture: linear-and-jira (distinct prefixes)

Tier-3 fixture for M14 (FR-51, AC-51.3 disambiguation-by-prefix). Both Linear
and Jira are configured; prefixes do NOT overlap (`LIN`/`DPT` for Linear,
`PROJ` for Jira). `LIN-1234` resolves to Linear; `PROJ-77` resolves to Jira.

## Task Tracking

mode: linear
mcp_server: linear
secondary_tracker: jira
secondary_mcp_server: atlassian
jira_ac_field:
