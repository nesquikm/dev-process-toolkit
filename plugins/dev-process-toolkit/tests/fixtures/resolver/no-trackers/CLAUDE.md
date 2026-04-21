# Resolver Fixture: no-trackers (mode: none)

Tier-3 fixture for M14 (FR-51 fallthrough baseline, Pattern 9 / NFR-18).
No tracker configured — every tracker-shaped argument (`LIN-1234`,
`https://linear.app/...`, `42`) must return `{kind: 'fallthrough'}` from the
resolver so each skill handles it via its pre-M14 contract.

No `## Task Tracking` section below — absence equals `mode: none`.
