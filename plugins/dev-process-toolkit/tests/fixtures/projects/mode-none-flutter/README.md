# mode-none-flutter fixture

Real-shape `mode: none` baseline using a Flutter project layout. Complements
`mode-none-baseline` (Node/TypeScript) so Pattern 9 byte-diff coverage isn't
gated on a single stack.

## What this fixture is

- A Flutter app with `CLAUDE.md` + `specs/` that does **not** contain a
  `## Task Tracking` section.
- Different `Key Commands` block (`flutter analyze`, `flutter test`),
  different generated-file DO-NOT list, different architecture diagram.
- Stack-independence guarantee: every mode-aware skill behaves identically
  to pre-M12 regardless of language / framework, as long as no
  `## Task Tracking` heading is present.

## Scope

Same as `mode-none-baseline` — file-state determinism only. See that
fixture's README for the captured/not-captured boundary.
