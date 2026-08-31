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

## Why nothing enforces this

No scanner can tell an aphorism from a load-bearing sentence, and one that tried would fire on the specifications it was written to improve. The word budgets are the deterministic half — they bound how much prose there is; this rule is the judgment half and bounds what the prose is made of. It is the part of the altitude contract most likely to drift, and it drifts quietly, so it is worth re-reading at review time rather than at gate time.

## Where the budgets themselves live

The numbers are single-sourced in the scanner modules and stated back on the authoring surfaces — never retyped here:

- `adapters/_shared/src/scan_fr_summary_altitude.ts` — `SECTION_RULES` carries the per-section FR word caps.
- `adapters/_shared/src/scan_plan_narrative_altitude.ts` — `PLAN_NARRATIVE_WORD_CAP` and the structural-share threshold that exempts checklist-, table- and fence-heavy subsections.

A number written down in two places is a number that will disagree with itself. That is the NFR-1 line cap's history, and it is why this page states the rule and points at the code for the values.
