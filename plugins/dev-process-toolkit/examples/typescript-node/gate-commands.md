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

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npx *)",
      "Bash(git *)",
      "Bash(gh *)"
    ]
  }
}
```
