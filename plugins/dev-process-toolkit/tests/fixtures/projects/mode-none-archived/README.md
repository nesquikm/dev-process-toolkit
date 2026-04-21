# mode-none-archived fixture

Real-shape `mode: none` baseline with non-trivial `specs/archive/` content.
Locks the invariant that archived milestone material — even when it
mentions the word "tracking" or quotes M12-style structures — does not
perturb mode-none behavior, because the Schema L probe only reads
`CLAUDE.md`, never `specs/`.

## What this fixture is

- A small downstream project whose `CLAUDE.md` has no `## Task Tracking`
  heading.
- An `archive/` directory containing two completed milestones with
  realistic ADR / FR / traceability content, including a deliberate
  mention of the literal string `## Task Tracking` inside an
  archived doc to prove the probe doesn't false-positive on archive content.

## Why this matters

The probe anchor is a literal `^## Task Tracking$` match against
`CLAUDE.md` only. If a future probe variant accidentally widened its
search to all `*.md` files in the repo, this fixture would surface the
regression — the archive doc's quoted heading would flip mode detection
and skill behavior would diverge from `mode: none`.
