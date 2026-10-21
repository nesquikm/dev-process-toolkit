# Requirements

## 1. Overview

**Project:** Dev Process Toolkit — a Claude Code plugin that bootstraps Spec-Driven Development (SDD) + TDD workflows into any project.
**Users:** Claude Code plugin users running SDD/TDD workflows.
**Latest shipped release:** **v2.100.0 ("Golden Path")**.

### Shipped milestones

Per-milestone plan files under `specs/plan/archive/`; archived FRs under `specs/frs/archive/`. The full release chronology lives in `CHANGELOG.md`; this overview only names the live context.

## 3. Non-Functional Requirements

### NFR-1: Skill Size

- No single skill file shall exceed 358 lines
- **Overflow rule:** If a skill approaches 358 lines during implementation, extract detailed reference material (long example tables, multi-stack examples) into a companion file at `docs/<skill-name>-reference.md` and reference it from the skill with a one-line pointer: `See docs/<skill-name>-reference.md for full examples.`
- **Bump rationale (STE-252, STE-305):** the cap raised from 300 → 350 in v2.19.0 to acknowledge spec-write's contract-locked prose pressure (~26 tests assert verbatim prose strings); STE-305 (v2.28.0) bumped to the canonical 351 to align with the actual `wc -l` headroom; it was later raised 351 → 352 (STE-373) → 354 (STE-374) for spec-write's § 7 capability rows, and now stands at 358 — the number `tests/skill-nfr-1-length.test.ts` enforces. This line states the cap, that test enforces it, and the two had drifted apart until STE-536 re-aligned them.

