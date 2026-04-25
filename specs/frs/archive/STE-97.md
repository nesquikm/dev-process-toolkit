---
title: Final-state prose sweep — pre-M* framing + probe-title cruft (D5 + L10)
milestone: M26
status: archived
archived_at: 2026-04-25T07:10:08Z
tracker:
  linear: STE-97
created_at: 2026-04-25T06:42:14Z
---

## Requirement

26 occurrences of "pre-M12", "pre-M13", "pre-M14", "pre-M18" framing across `plugins/dev-process-toolkit/docs` and `plugins/dev-process-toolkit/skills`. Each one only carries meaning if a reader knows the project's milestone chronology — which no first-time reader does. Plus probe titles #1, #2, #6, #9 embed historical "supersedes / pre-M<N>" cruft.

Sample locations:
- `docs/patterns.md` — Pattern 9 "Backward-compat invariant (pre-M12)" appears 5+ times.
- `docs/ticket-binding.md:8`, `docs/gate-check-tracker-mode.md:6`, `docs/implement-tracker-mode.md:6`, `docs/pr-tracker-mode.md:6`, `docs/spec-review-tracker-mode.md:13`, `docs/setup-tracker-mode.md:9`, `docs/tracker-adapters.md:7,32` — "In `mode: none`, this document is unused — the pre-M12 body runs unchanged."
- `docs/resolver-entry.md:13,29,32`, `docs/patterns.md:457,460,475`, `skills/implement/SKILL.md:28`, `skills/spec-write/SKILL.md:35` — "pre-M14 by-ULID code path / pre-M14 free-form handling / pre-M14 contract".
- `skills/gate-check/SKILL.md` probes #1, #2, #6, #9 — historical "supersedes / pre-M<N>" cruft baked into titles.

## Acceptance Criteria

- AC-STE-97.1: `grep -rn "pre-M1[0-9]" plugins/dev-process-toolkit/docs plugins/dev-process-toolkit/skills` returns zero matches in live prose. CHANGELOG entries are exempt (historical). {#AC-STE-97.1}
- AC-STE-97.2: Every "In `mode: none`, … pre-M12 body runs unchanged" instance is rewritten as "In `mode: none`, this document is unused — the `mode: none` branch runs unchanged." {#AC-STE-97.2}
- AC-STE-97.3: Every "pre-M14 free-form handling / by-ULID code path / contract" instance is rewritten in functional terms (e.g., "free-form argument handling for `all`, `requirements`, `technical`, `testing`, `plan`"). {#AC-STE-97.3}
- AC-STE-97.4: Pattern 9 in `docs/patterns.md` is renamed and reframed — drop the "pre-M12 backward-compat invariant" framing; re-title around the live `mode: none` branch contract. {#AC-STE-97.4}
- AC-STE-97.5: `skills/gate-check/SKILL.md` probe titles #1, #2, #6, #9 are rewritten as final-state assertions with no historical "supersedes" or "pre-M<N>" embedding. The probe-narrative bodies retain references to relevant tests (per the M24 STE-87 contract) but drop chronology. {#AC-STE-97.5}
- AC-STE-97.6: `tests/probe-parity.test.ts` passes — Schema L probe-prose parity across the 7 mode-aware skills holds after the rewrites (the new prose must be byte-identical across the 7 skills). {#AC-STE-97.6}
- AC-STE-97.7: `bun test` green; all 16 gate-check probes still pass. {#AC-STE-97.7}

## Technical Design

This is a prose sweep across ~26 locations + 4 probe titles. Approach:

1. **Pre-write a 5-line style guide** (in this Notes section, finalized at /implement Phase 1) covering the 3 rewrite patterns:
   - "pre-M12 body runs unchanged" → "`mode: none` branch runs unchanged"
   - "pre-M14 free-form handling" → "free-form argument handling"
   - "Pattern 9 pre-M12 backward-compat invariant" → "Pattern 9 mode-none branch contract"
2. **Probe-parity guard.** The 7 mode-aware skills (`implement`, `gate-check`, `spec-write`, `spec-archive`, `pr`, `tdd`, `debug`) carry byte-identical Schema L probe prose. Any rewrite to one of these must be applied to all 7 in the same commit, or `tests/probe-parity.test.ts` will fail.
3. **Search-and-replace, but verify each match in context.** Some "pre-M12" mentions might legitimately be historical references in narrative essays (audit L2 lists `docs/patterns.md:491-510` as one such case — Pattern 25 dogfooding essay). Those stay. Use grep for the candidate set; manual review per file decides keep-vs-rewrite.

Probe-title rewrites for `skills/gate-check/SKILL.md`:
- #1: `Filename ↔ frontmatter convention (M18 STE-61 AC-STE-61.5, strict)` → `Filename ↔ frontmatter convention (strict)` — drop the historical citation.
- #2: similar — drop "enforced by probe 13 `identity_mode_conditional`" if prose-cruft (or keep if it's a substantive cross-reference).
- #6, #9: drop "Superseded-by" / "pre-M<N>" embeds.

## Testing

No new tests. `tests/probe-parity.test.ts` is the safety net for the mode-aware skill rewrites; existing 15 (or 16, post-M25) probe tests cover the gate-check rewrites.

## Notes

Style guide draft (pre-/implement, finalized at Phase 1):
1. Present tense over historical chronology.
2. Functional framing (`mode: none` branch) over chronological framing (pre-M12 body).
3. Drop "supersedes" paragraphs entirely — git history records what happened.
4. Drop probe-title chronology (M<N> STE-<N> AC-STE-<N>.<M>) — the body's first paragraph carries the test cross-reference.
5. CHANGELOG entries are sacrosanct — never rewrite.

Audit M2 was REFUTED — only 1 "Superseded-by" note exists in patterns.md, not 5+. STE-97's AC-STE-97.5 still covers it; the cumulative scope was just smaller than initially flagged.

Origin: PR #4 audit D5 + L10.
