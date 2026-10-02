---
milestone: M_6c25dd
status: archived
archived_at: 2026-10-02T16:53:23Z
kickoff_branch: null
frozen_at: null
migration: none
codename: Unasked
---

# Implementation Plan

## M_6c25dd — Milestone names are chosen, never asked {#M_6c25dd}

**Goal:** No surface of the toolkit asks the operator what a milestone should be called. `/spec-write` composes the plan heading title and a new `codename:` plan frontmatter key when it writes the plan, both checked by one shared validator; `/ship-milestone` reads the codename from the plan instead of prompting, keeps `--codename` as an explicit override, and composes one through the same validator only for a plan written before the key existed; a gate probe keeps a name prompt from coming back.

**Prerequisites:** v2.93.0 ("Own Side Only", M_a85e46) merged at 8ff8b19a. Load-bearing existing machinery: STE-73's codename rules (non-empty, at most 32 characters, no backticks, no newlines), STE-554's release writer and its refuse-rather-than-placeholder rule, STE-415's em-dash canonical plan heading, STE-539's human-title Linear mint.

**Release target:** v2.94.0, one minor above v2.93.0: a new plan frontmatter key, a retired interactive prompt and a new gate probe. Validate against the shipped versions and `specs/requirements.md` before shipping.

**Operator rulings.** Brainstorm 2026-10-02: both names are automatic (the release codename and the plan title); `--codename` stays as the only override, and the release approval gate displays the codename without asking about it; approach 2 — name at spec time, record in the plan, compose at ship time only when the key is absent. This milestone's own title and codename were chosen automatically under that ruling.

**Migration:** none. The key is optional on read: a plan without it ships through the compose fallback, so no consumer artifact must change.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-657 | Plans carry a validated codename composed at spec time | linear:`STE-657` |
| STE-658 | /ship-milestone reads the codename instead of asking | linear:`STE-658` |
| STE-659 | A gate probe keeps milestone-name prompts out of the skills | linear:`STE-659` |

### Order

STE-657 → STE-658 → STE-659. STE-657 ships the shared validator and plan reader that STE-658 calls at ship time and STE-659's probe calls on every active plan.

### Collision map

`skills/ship-milestone/SKILL.md` step 3 is rewritten by STE-658; `tests/ship-milestone-shape.test.ts` and `tests/m141-ste-545-release-writer-door.test.ts` pin the old prompt text and move with it. `skills/spec-write/SKILL.md`'s plan.md section is edited by STE-657 only. The new probe in STE-659 raises the gate-check probe count and every pin on it.

**Tasks:**

- [x] Add the shared codename validator and plan reader with its command front door — STE-657
  verify: the validator suite accepts every shipped CHANGELOG codename and rejects empty, 33-character, backtick and newline values.
- [x] Add `codename:` to the plan template and make /spec-write compose the title and codename without asking — STE-657
  verify: the template and spec-write prose tests pin the key, the composition rule and the absence of a name question.
- [x] Retire the codename prompt: flag, then plan key, then composed fallback, all through the validator — STE-658
  verify: the ship-milestone shape and release-writer-door tests pin the new precedence and no longer find the prompt.
- [x] Refuse an invalid codename in the release writer through the shared validator — STE-658
  verify: release_config tests refuse each invalid shape with the NFR-10 envelope and write nothing.
- [x] Add the milestone-name probe over skill prose and active plans' codename keys — STE-659
  verify: the probe goes red on a planted name prompt and on an invalid plan codename, green on the tree, and every probe-count pin moves with it.
