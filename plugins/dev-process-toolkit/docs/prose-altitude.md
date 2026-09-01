# Prose altitude — the anti-decoration rule

The word budgets on FR sections and plan subsections say how much prose is allowed. This page says what the allowance is *for*. Extracted here on the shipped `docs/deliver-reference.md` precedent — the operating rule stays on the authoring surface, the reference detail lives here — because `skills/spec-write/SKILL.md` sits at the NFR-1 line cap and cannot absorb it.

The rule in one line: **no aphorisms, and no restating a point in a second register.** It is stated where the writing happens — the `## Summary` guidance line in `skills/spec-write/SKILL.md` § 0b, and § Task Sizing in `templates/spec-templates/plan.md.template` — and not only here, because a rule that lives only in a document about the rule is not in front of the person writing.

## Half A — no aphorisms

An aphorism is a sentence built to be memorable rather than to be acted on. It reads as insight, survives review because nobody disagrees with it, and tells an implementer nothing they can do differently tomorrow.

- Decoration — "Specs are the contract, and a contract nobody reads is a wish."
- Load-bearing — "The scanner reads the cap from `SECTION_RULES`, so a surface that states its own number drifts silently."

The test is falsifiability, not tone: if the sentence could not be wrong, it is not carrying information. A vivid sentence that names a mechanism, a failure mode, or a number is not an aphorism — vividness is not the defect, emptiness is.

## Half B — no restating a point in a second register

The same claim, said twice, in two voices: once plainly and once with flourish, or once in prose and once as a bolded slogan. The second copy adds no fact and doubles the surface that has to stay true when the first copy changes.

```
The archive step runs before the gate, so the gate sees the moved file.
Archive first — the gate only ever measures what is already in place.
```

Two sentences, one fact. Keep the first, delete the second. This also covers a section that re-explains, in its own words, what the section above it already established. If a reader must be reminded, link the place that owns the claim rather than paraphrasing it into a second owner.

## Counting a rule set

A numbered claim about a rule set — "the four altitude rules", "three clauses per stage" — is true on the day it is written and wrong the moment the set grows, because nothing ties the numeral to the set. M137 corrected four of them: probe #67's "four altitude rules", the header of its colocated test, `docs/stage-status-block.md`'s "The four adoption rules" (`verifyStageReportAdoption` grades six), and the header of `adapters/_shared/src/stage_block_adoption.ts`, which said "four REPORT-LEVEL rules" over a list of six — the same file the third correction was about, one surface over, found only because a test compared the two lists item for item instead of reading either numeral.

State the count **from the set** wherever a reader is not the only consumer: read `RULES.length`, render the word from an index, or let a numbered list be its own count. Where prose genuinely needs the numeral — a heading, a sentence — name the binding beside it so a reader checking the claim knows which array to count, and expect to re-check it whenever that array changes.

## When the guard has the blind spot it exists to catch

`tests/m137-archive-blind-spot-class.test.ts` was written to close the archival blind spot as a CLASS: it scans every test source and fails any that reaches a live spec file without naming its archived twin. It shipped seeing only the FILE form — `join(REPO_ROOT, "specs", "frs", "STE-533.md")` — and not the DIRECTORY form — `mdFilesIn(join(repoRoot, "specs", "frs"))`. Two of the same milestone's own dogfoods reached the active tree by the second shape, and the class-closing guard reported clean over both.

The two forms fail differently, which is why one shape hid behind the other. A hardcoded file path throws ENOENT at the archive commit: loud, immediate, unmissable. A hardcoded directory path throws nothing — the walk returns `[]`, the suite measures an empty subject and reports a pass. The quiet half is the one worth the guard, and it was the half the guard could not see.

This is the sixth recorded instance of *a fix reaches only the clause you name*, and the first where the thing not reached was the guard itself.

**Before writing a guard, enumerate the forms the defect takes, and prove the guard sees each one.** Write the enumeration down where the guard lives, and give every form its own falsifiability leg on a fixture built to break it — a leg that passes on one shape and is silent on the others is the shipped defect, one level up. Where two forms need two different verdicts — here the file form is a violation and the directory form is merely seen, because a vacuous walk is not an ENOENT — say which rule each takes, or conflating them becomes the next bug.

## Why nothing enforces this

No scanner can tell an aphorism from a load-bearing sentence, and one that tried would fire on the specifications it was written to improve. The word budgets are the deterministic half — they bound how much prose there is; this rule is the judgment half and bounds what the prose is made of. It is the part of the altitude contract most likely to drift, and it drifts quietly, so it is worth re-reading at review time rather than at gate time.

## Where the budgets themselves live

The numbers are single-sourced in the scanner modules and stated back on the authoring surfaces — never retyped here:

- `adapters/_shared/src/scan_fr_summary_altitude.ts` — `SECTION_RULES` carries the per-section FR word caps.
- `adapters/_shared/src/scan_plan_narrative_altitude.ts` — `PLAN_NARRATIVE_WORD_CAP` and the structural-share threshold that exempts checklist-, table- and fence-heavy subsections.

A number written down in two places is a number that will disagree with itself. That is the NFR-1 line cap's history, and it is why this page states the rule and points at the code for the values.
