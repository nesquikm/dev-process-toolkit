# Fixture Project — mode: none on v2 layout

Minimal downstream project used to lock FR-56 Pattern 9 behavior: `mode: none`
canonical form (no `## Task Tracking` section) on a v2-layout `specs/` tree.

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
