---
milestone: M_ESMJFJ
status: archived
archived_at: 2026-09-08T14:10:00Z
kickoff_branch: fix/gb-20-docs-full-empty-corpus-and-gist-flag
frozen_at: null
migration: none
shipped_in: v2.80.7
---

# Implementation Plan

## M_ESMJFJ — Never Regenerate From Nothing {#M_ESMJFJ}

**Goal:** Three defects reported from a consumer project stop being reachable — a full docs regeneration that reads an empty corpus and rewrites the whole tree from it, a run whose outcome cannot be told from a failure, and a publish command built on a flag that does not exist.

**Prerequisites:** None. Ships after M_a8e09a.

**Release target:** the next patch after v2.80.6 — verify against `CHANGELOG.md` rather than trusting this line.

Reported upstream as Jira `GB-20` and as a secret triage gist from the glacy projects, and re-verified against this working copy on 2026-09-08. These FRs were never minted in this repository's tracker: the report arrived from a consumer repo whose tracker is a different Jira project, and the fixes were cut directly. The table records what shipped, keyed to the upstream ticket rather than to `STE-` ids that do not exist.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| GB-20.1 | `/docs --full` must never regenerate from an empty spec corpus | jira:`GB-20` |
| GB-20.2 | A `/docs` run states which terminal outcome it reached | jira:`GB-20` |
| GB-20.3 | `/report-issue` publishes with a flag `gh` actually has | jira:`GB-20` |

### The one that is latently destructive

GB-20.1 is the reason this shipped as its own release. `/docs --full` gathered "every active spec under `specs/frs/*.md` and `specs/plan/*.md` (skip `archive/`)", and a project that has shipped its backlog has archived every FR it ever completed — so that set is empty exactly when the project is most mature. This repository is the case in point: zero active FRs against 484 archived, zero active plans against 148. An all-archived tree is the normal steady state of a mature project, not a degenerate one, and every such tree was exposed.

The failure mode is what makes it expensive. Regenerating from nothing does not error. It produces a plausible diff across the entire canonical tree, with the FR-derived narrative silently dropped or invented, presented behind an approval prompt spanning more files than anyone can read. The approval gate is not a defence here — it is the surface the damage arrives through, because a large plausible diff is precisely what a gate is least able to reject.

Both available remedies ship together, because either alone leaves a hole. The archives are read alongside the active specs, so an all-archived project regenerates from its real history; and the zero case is refused outright, so a genuinely spec-less project is never handed a diff instead of an error.

### The half-wire this milestone refused to ship

GB-20.2 is a producer/consumer pair, and shipping only the producer would have reproduced a defect this repository has measured before. Emitting an outcome line that nothing reads is not legibility; it is a second thing to keep in sync. Both consumers were changed in the same commit: `/ship-milestone` step 5 routes a release on the outcome, and `/implement` Phase 4b stops reporting a documentation fragment as `added` when the run deliberately wrote none — a false row that existed for as long as the exit code was the only signal.

### The repair that would have been worse than the defect

GB-20.3's `-s` never worked: `gh` 2.95.0 exits 1 with `unknown shorthand flag: s in -s`, so the documented publish had simply never run. The danger is in the fix. `-p` / `--public` is the only visibility flag left in the help output, so it is what a hurried reader substitutes for a failing `-s` — and it does the exact opposite of what `-s` was written to mean, turning a curated bug report carrying settings files and an optional session transcript into a publicly listed gist. The correct change is to drop the flag, since secret is already the default. The substitution is named and forbidden at the site where it would be made, and the test asserts the publish command lines carry neither flag.

### Tasks

- [x] Read the archives in `/docs --full` and refuse an empty corpus
- [x] Give every `/docs` terminal path a `docs-run:` outcome line
- [x] Wire both consumers to read the outcome instead of the exit code
- [x] Drop `-s` from `/report-issue` and forbid the `-p` substitution
- [x] Repoint the test that pinned the old `-s -d` form; add regression guards
- [x] Mutation-test every new guard against the pre-fix content
