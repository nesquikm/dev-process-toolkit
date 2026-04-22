# Resolver Fixture: fr-code-lookup

Tier-3 fixture for M15 FR-69. Demonstrates `FR-N` AC-prefix scan:

- `FR-1` → unambiguous single match
- `FR-2` → unambiguous single match (different FR)
- `FR-99` → ambiguous across two FR files (throws `AmbiguousArgumentError`)
- `FR-404` → miss (returns `null`)

## Task Tracking

mode: none
mcp_server:
active_ticket:
jira_ac_field:
