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

## A dogfood answers "does this fire?", never "can this be avoided?"

Point a scanner at real content and you learn it measures *something*. You never
learn it measures *all of its subject*, because real material does not evade.

Measured, M137: every rule in this repository that accumulates state across lines
reset its accumulator on a repeated heading, so the same words under two headings
scored clean while one heading flagged. `line_cap` had been evadable since M105 —
32 releases. Five holes across three modules survived four adversarial review
rounds, each of which asked "what is wrong with this code" and none of which asked
"what does this code fail to see". No review can close that gap at any agent count:
a review inspects what exists, and this is a property the suite has to contain.

**The rule: every dogfood ships with an EVASION TWIN** — the same total,
restructured, required to produce the same verdict. Where no twin can be built,
say why in a comment; do not omit it silently.

The taxonomy that tells you where to look: a rule carrying **state across lines**
needs the property; a **per-line predicate** does not. Measured, not assumed —
one heading with three dirty lines fires identically to three headings with one.

## A zero from a wrapped `grep` is not proof of absence

This one outranks the entry below it, and for a reason that makes the entry below
insufficient rather than wrong.

Every other discipline failure recorded here was a BAD COMMAND — the wrong filter,
the wrong subject, a pipe eating the exit status — and every one was findable by
reading the command you had just typed. This is a GOOD COMMAND LYING. There is
nothing to read: `grep -c "x" file` is correct, and the answer is wrong.

Measured, M137, on a tracked and non-ignored file:

    git ls-files          tracked
    git check-ignore      NOT ignored
    python ground truth   8 occurrences
    command grep          8
    wrapped grep          0 — and on another string, no output at all

**The mechanism, so nobody re-verifies the wrong thing.** `grep` here is a shell
function wrapping `ugrep --ignore-files`. ugrep's ignore semantics are NOT git's,
so `git check-ignore` reporting a file as searchable does **not** mean the wrapper
will search it. Confirming the file is tracked and un-ignored, then believing the
zero, is the obvious next mistake.

**A control does not save you.** "Run a control that must match" is the remedy in
the next entry, and it is insufficient here: the skip is PER FILE, so a control on
file A passes while file B — the one the claim is about — is silently skipped. A
control only rescues a *globally* broken search. Selective breakage is invisible to
it.

**The rule.** For any claim that turns on ABSENCE, use `command grep` or a
language-level read. The wrapper is fine for FINDING things and unreliable for
proving they are not there — which is exactly backwards from how this milestone
used it, since every phantom it found was proved by a zero: a formatter that did
not exist, a fixture nothing produced, two citations resolving to comments, a
module with no consumers. Those were right. They were not reliably right.

It surfaced only because a worker said it had edited a file and a grep said the
string was not in it. Two sources disagreeing is what exposed it; one source
would have been believed.

## A rule enforced in one place is followed in one place

`/spec-write` § 7a already says: stage an explicit path list, never `git add -A`.
It is written down, it is correct, and it has been there all along. M137 followed
it on every release commit — where a test enforces it — and reached for `git add
-A` on a fix commit, where nothing does, sweeping another agent's in-flight work
into a commit whose message described something else.

That is not a rule someone failed to know. It is a rule that was real only where it
was mechanised. Which predicts where the next lapse is, and is more useful than
restating the rule: **any rule this repository states in prose and enforces in one
place is being followed in that one place.** Look there first.

The same shape appears as procedures. "The release count must be the last edit on
the branch" was written down twice in this milestone and is a procedure — a thing
that works while someone remembers it. It became a guard only when it was made a
git query at the merge boundary.

## Assert that the command FINDS something, not that it runs

`git log --grep` takes a BASIC regex, and `chore(release):` contains parentheses.
Adding `--extended-regexp` turns them into a group, so `^chore(release):` matches
`chorerelease:`. Measured on this repository:

    plain (BRE)   126 commits
    with -E         0 commits
    exit status     0

Total silence: no error, no non-zero exit, every release commit in the history
invisible. A guard built to stop a stale number would have concluded "no release
commit exists" and passed quietly on every branch forever — disabled by `-E`, which
is the flag a careful person adds.

It was caught by a leg that required the command to FIND the most recent release
commit rather than merely to run. That is the cheapest general form of the
evasion-twin rule, it costs one assertion, and it is the only thing that separates
a guard that works from a guard that is quiet.

## Name the command's actual subject, and run a control

Three false clean zeroes in one session, from two agents, one shape each time:
`grep -v '\.test\.ts'` deleted the very consumer it was hunting; `grep … | head ||
echo NONE` could never reach its fallback because the pipe makes `head` the exit
status; `grep -v test` was described in prose as "test files included". Every one
produced a confident zero from a command whose subject was not what the sentence
around it claimed.

A control is what makes a zero evidence rather than an assertion: run the same
search for something that MUST be found. "Control returns 8, target returns 0" is
checkable; "no matches" is not.

## Re-check the subject you changed yourself

The same rule read from the other end, and the harder one. Verifying the per-name
fix, I read "no Summary violation" and two `line_cap` rows for one section name —
both looking like the fix had failed. Neither had: I had deleted a fixture two
steps earlier and the two rows were one per file. Attributing every violation to
its source file first is what caught it.

A verification whose subject you have not re-checked is not a verification, and
the subject most likely to have moved is the one you moved.

## A pin can be load-bearing for the WRONG property

The familiar failure is a pin that fails to CATCH a defect. This one CAUSED one.

`m137-ste-533:1855` meant to assert that an exempt section may follow the block.
It built its subject by appending the heading to a report that already carried it,
so what it actually asserted was that a DUPLICATE heading must be accepted. A
per-report budget reddened it, so the implementer weakened the budget to
per-occurrence to keep a shipped test green — and said so, which is the only
reason it was findable.

Read a test's construction against its own title before trusting it. When a design
bends to keep a test green, check that the test is asking for what it says.

## Assert what is plausible only after measuring it

Three times in one session I reached for a fact because it was plausible and
asserted it without checking: a discriminator written for the shape I imagined
rather than the shape the renderer emits; a release check that stopped at the
version and could not see the codename beside it; "the tail is one file away",
said of a formatter that did not exist. The plausible ones are the ones that bite,
because nothing about them prompts a check.

## Why nothing enforces this

No scanner can tell an aphorism from a load-bearing sentence, and one that tried would fire on the specifications it was written to improve. The word budgets are the deterministic half — they bound how much prose there is; this rule is the judgment half and bounds what the prose is made of. It is the part of the altitude contract most likely to drift, and it drifts quietly, so it is worth re-reading at review time rather than at gate time.

## Where the budgets themselves live

The numbers are single-sourced in the scanner modules and stated back on the authoring surfaces — never retyped here:

- `adapters/_shared/src/scan_fr_summary_altitude.ts` — `SECTION_RULES` carries the per-section FR word caps.
- `adapters/_shared/src/scan_plan_narrative_altitude.ts` — `PLAN_NARRATIVE_WORD_CAP` and the structural-share threshold that exempts checklist-, table- and fence-heavy subsections.

A number written down in two places is a number that will disagree with itself. That is the NFR-1 line cap's history, and it is why this page states the rule and points at the code for the values.
