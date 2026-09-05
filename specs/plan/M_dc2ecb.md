---
milestone: M_dc2ecb
status: active
archived_at: null
kickoff_branch: null
frozen_at: null
migration: none
---

# Implementation Plan

## M_dc2ecb — Release ceremony integrity {#M_dc2ecb}

**Goal:** The release ceremony writes every surface it claims to write, and fails loudly rather than silently when it cannot.

**Prerequisites:** None. Ships after M143.

**Release target:** the next patch after v2.80.0 — all three FRs are fix-class, so `inferBump` should return a patch. Verify against `CHANGELOG.md` rather than trusting this line; three plans have already contended for a number this program.

**First milestone minted under M139's tracker-first scheme.** The identity `M_dc2ecb` was derived by `milestoneIdFromLinearMilestone` from the Linear milestone's own UUID, not chosen. That makes this milestone a live exercise of the one-way door M139 shipped, and the first plan in the tree whose filename is not `M<N>.md`.

Eight defects, every one measured by executing the module rather than by reading it. Two of them cost a hand-edit on all five releases of the 2026-09-04 program, which is what promoted them from folklore to scope.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-554 | The release writer writes every surface it claims to write | linear:`STE-554` |
| STE-555 | The release writer fails loudly rather than silently | linear:`STE-555` |
| STE-556 | The guards read what the writers write, and the docs stop overclaiming | linear:`STE-556` |

### The eight, as measured

| Defect | Measured outcome |
|---|---|
| `bumpFile` drops `opts.codename` on the regex arm | a v2.81.0 dry-run produced `v2.81.0 — "Onward"` with M143's whole paragraph attached |
| `specs/requirements.md` is in no writer's set | `requirements` appears zero times in `ship-milestone/SKILL.md`; probe #9b reds every release commit |
| `optional: true` only guards a missing file | fixture with a non-matching pattern: `Refusing: … bumpRegex: pattern did not match`, manifest unwritten |
| `bumpChangelog` has no duplicate guard | identical argv twice, rc=0 both, two identical `## [1.1.0]` sections |
| `bumpRegex` builds `RegExp` with no flags | second occurrence of the version survived untouched, writer reported success |
| `bumpRegex` passes its template as a replacement string | a template containing `$&` produced the matched text inline |
| probe #9b consumes the codename in `[^\n]*` | mutated codename → drifts `[]`, byte-identical to the unmutated run |
| `version_bump.ts` reuses the total FR count | `[Added, Fixed, Fixed, Removed]` → "shipped 4 additive FRs" |

### Tasks

- [ ] STE-554 — pass the codename through the regex arm and render it
  verify: a bump whose template names the codename rewrites it; a template without one is byte-unchanged
- [ ] STE-554 — give `specs/requirements.md` a writer, and put it where the ceremony can see it
  verify: a release run rewrites the line unaided, and probe #9b passes on the release commit with no hand edit
- [ ] STE-555 — an optional entry whose pattern does not match is skipped, not fatal
  verify: the fixture above completes the release and reports the skip; a non-optional miss still refuses
- [ ] STE-555 — refuse a second insertion of a version the CHANGELOG already carries
  verify: the double-run fixture exits non-zero on the second run and leaves one section
- [ ] STE-555 — bump every occurrence, and write the template literally
  verify: two-occurrence fixture bumps both; a `$&` template lands as the four characters
- [ ] STE-556 — probe #9b compares the codename as well as the version
  verify: the mutated-codename fixture reds, and the unmutated one stays green
- [ ] STE-556 — the two "cannot happen" claims say what is actually true
  verify: both sites are asserted, and a tripwire fails if the absolute wording returns
- [ ] STE-556 — the minor rationale counts additive FRs
  verify: the mixed-category fixture reports 1, and an all-additive milestone is unchanged

### Gate

`cd plugins/dev-process-toolkit && bun test`

### Dependency graph

STE-554 lands first: it decides what the writers produce, which is what STE-556's guards then read. STE-555 is independent of both and may land in either position. Sequencing the guards ahead of the writers would pin assertions against output still in motion.

### Follow-ups carried into M_dc2ecb

The 2026-09-05 sweep confirmed **86** items still unfixed across the tree; the full ranked list with per-item proofs is the sweep artifact, and these eight are the release-path cluster drawn from it. The next cluster — probe #81's pin coupling and the two M143 scanners with no `/gate-check` consumer — is scoped as the following milestone, not this one.
