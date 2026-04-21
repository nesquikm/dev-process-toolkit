# M1–M2: Shipped (archived)

Historical record of the first two milestones. Archived per the
`/spec-archive` flow once acceptance was complete.

## M1: Skeleton

- AC-1.1: `uvicorn` boots the app with no warnings.
- AC-1.2: `/` returns 200 with build SHA in body.

## M2: Auth

- AC-2.1: Bearer token middleware rejects missing tokens with 401.
- AC-2.2: Valid token populates `request.state.principal`.

## ADR-1: Bearer auth at the edge

- **Context:** Downstream gateway already terminates TLS; bearer is enough.
- **Decision:** Edge auth in app middleware, no per-route decorators.
- **Superseded-by:** none (still in force at M3).

## Notes on tracker tooling (historical)

This project predates any tracker integration. The `## Task Tracking`
heading is **not** present in `CLAUDE.md` and never was — ACs lived in
`specs/requirements.md` throughout. This archive doc deliberately
mentions the literal heading text to prove the Schema L probe only
reads `CLAUDE.md`, never archive content. If a future probe variant
ever widened to all `*.md` files, this line would flip mode detection
and the regression gate would catch it.
