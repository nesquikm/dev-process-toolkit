# TypeScript/Node Gate Commands

## Gate Check Commands

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . (with --fix for auto-fix)
npm run test         # vitest run (or jest)
npm run build        # vite build / tsc / esbuild
```

## Typical package.json scripts

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "build": "vite build",
    "dev": "vite"
  }
}
```

## TDD Patterns

- **Test runner:** Vitest or Jest
- **Mocking:** `vi.mock()` / `vi.fn()` / `vi.spyOn()`
- **Fake timers:** `vi.useFakeTimers()` with `vi.setSystemTime(new Date('2025-01-01'))` (pick a fixed date for deterministic tests)
- **Deterministic data:** Seeded PRNG (e.g., mulberry32)
- **Schema validation:** Zod (`z.infer<>` for types)
- **Test location:** `tests/` or `__tests__/` or colocated `*.test.ts`

## Settings Example

> Cross-reference: the canonical-shape probe at `adapters/_shared/src/setup_permissions_shape.ts` empirically rejects glob-form `Bash(<cmd> *)` rules; the canonical allowlist lives in `templates/permissions.json` — both are the source of truth for the block below.

```json
{
  "permissions": {
    "allow": [
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(git log)",
      "Bash(git show)",
      "Bash(git rev-parse)",
      "Bash(git ls-files)",
      "Bash(git branch)",
      "Bash(git blame)",
      "Bash(gh pr list)",
      "Bash(gh pr view)",
      "Bash(gh issue list)",
      "Bash(gh issue view)",
      "Bash(gh repo view)",
      "Bash(gh api)",
      "Bash(ls)",
      "Bash(mkdir)",
      "Bash(npm install)",
      "Bash(npm test)",
      "Bash(npm run)",
      "Bash(npm audit)",
      "Bash(npx)"
    ]
  }
}
```
