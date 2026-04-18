# Baseline Fixture

Minimal downstream project used to lock pre-M12 `mode: none` behavior.
This file intentionally omits any `## Task Tracking` section — absence
is the canonical form for `mode: none` (FR-29 AC-29.5).

## Tech Stack

- **Language:** TypeScript
- **Framework:** Node
- **Build:** tsc
- **Testing:** Vitest
- **Validation:** Zod

## Architecture

```
src/
├── index.ts
└── util.ts
```

## Key Commands

```bash
npm run typecheck
npm run lint
npm run test
```

**Gating rule:** `npm run typecheck && npm run lint && npm run test`

## Workflows

**Bugfix:** `/debug → /implement → /gate-check → /pr`
**Feature:** `/brainstorm → /spec-write → /implement → /spec-review → /gate-check → /pr`
**Refactor:** `/implement → /simplify → /gate-check → /pr`

## DO NOT

- Do not commit without user approval
- Do not add features not in the spec
