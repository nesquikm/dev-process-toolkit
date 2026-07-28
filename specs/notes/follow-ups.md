---
status: live
updated_at: 2026-07-28
---

# Open follow-ups

Items surfaced during implementation or review that are **real but out of scope
for the milestone that found them**. Each one is here because it would otherwise
survive only in an archived FR's `## Implementation notes`, a review transcript,
or a session that has ended — none of which anybody reads again.

**What belongs here.** A defect or gap that is (a) measured, not suspected, (b)
covered by no acceptance criterion in the milestone that found it, and (c) not
urgent enough to widen that milestone's scope. Anything actionable enough to
schedule should become a tracker ticket and be linked from its entry.

**What does not.** Anything already covered by an AC, anything speculative, and
anything a probe already catches — the gate is the durable record for those.

**Convention.** Newest milestone first. When an item ships, delete its entry in
the same change that closes it and note the closure in the shipping FR. Entries
that go stale without shipping are worse than no entry, so an item that no longer
reproduces should be deleted with a one-line reason rather than left to rot.

---

## From the M116 + M117 post-release review (v2.57.1, 2026-07-28)

### 1. The `/spec-write` driver answers block has no `requirement` key

**Only a live `/smoke-test` leg can settle this. Do not guess at it.** A wrong
guess silently changes what the driver answers, which is worse than the gap.

The evidence, all re-measured on 2026-07-28:

- `plugins/dev-process-toolkit/skills/spec-write/SKILL.md` § "Milestone-allocation
  gate" enumerates the § 1–§ 6 FR-content prompts as nine: **Summary, Requirement,
  Acceptance Criteria, Technical Design, Testing, cross-cutting scope, out-of-scope,
  NFRs, risks.** `resolveInterviewAnswer(promptBody, key)` is called once per
  question, *keyed by that question's own answer key*.
- The smoke driver bakes **21** keys across its two `<dpt:answers>v1` blocks
  (`.claude/skills/smoke-test/SKILL.md`). Eight of the nine prompts have an
  obvious key. **`Requirement` has none** — there is no `requirement` key, and
  no key whose name plausibly stands in for it.
- Nothing catches it. The drift pin at
  `plugins/dev-process-toolkit/tests/m116-ste-418-wiring.test.ts:719` runs
  **driver → doc**: every key the driver bakes must be named in the doc. A
  documented prompt with *no* driver key is invisible to it, by construction.

It **might** be benign: if `Requirement` folds into `feature_summary` at runtime,
nothing is missing. But the prompt-to-key vocabulary is **defined nowhere** — no
module maps prompt names to answer keys, so neither reading can be settled from
the tree. If it is not benign, a headless `/spec-write` refuses at the Requirement
question and the chain truncates at step 2 again — the exact failure M116 exists
to close.

**What the next conformance run should look for.** In the `/spec-write` child's
capture: whether a Requirement question is posed at all, and if so whether it
resolves `pre-baked` (benign — some key answered it) or raises
`RequiresInputRefusedError` at gate site `requirement` (not benign — add the key
and the doc entry together, so the drift pin covers it). Either outcome should
then be written into the doc as the prompt-to-key map that does not currently
exist, which closes this item and the whole class with it.

### 2. The PR-body half of a disclosure has no gate

v2.57.1 added the AC-STE-418.4 deferral to the CHANGELOG, where
`tests/m116-ste-418-deferral-disclosure.test.ts` now pins it. The same gap
existed in the PR #54 body's "Recorded limitations" section and was fixed by
hand. Nothing in this repo can assert against a GitHub PR body, so that half is
protected by nothing. Recorded rather than solved: the CHANGELOG is the durable
record and it is now gated; the PR body is a review-time artifact. If PR bodies
start carrying claims the CHANGELOG does not, this becomes worth fixing.

## From M117 — Smoke-Driver Hygiene (2026-07-28)

### 1. Phase 8 `/report-issue` coverage still depends on classifier variance — `STE-431`

**Tracked:** `STE-431` (Backlog, team STE, project "DPT — Dev Process Toolkit").
This is the only item here with a ticket; the rest are recorded but unscheduled.

AC-STE-428.4 shipped a `--dry-run` flag, which works and publishes nothing
outward. Its trailing purpose clause — "so coverage does not depend on classifier
variance" — is not delivered: a `--dry-run` spawn is exactly as deniable as the
spawn denied on 2026-07-27. The flag makes intent legible at the classification
boundary; nothing forces an allow. Full reasoning, including why the standing-
authorization alternative was declined, is in `STE-431` and in
`specs/frs/archive/STE-428.md` § Notes.

### 2. `templates/permissions.json` still ships inert exact rules

`/setup` derives a bootstrapped project's allow-list from
`templates/permissions.json` via `canonicalAllowList` — **not** from
`templates/settings.json`, which M117 fixed and which has no runtime consumer at
all (its only reader in the tree is the M117 test written to assert it).

`templates/permissions.json` deliberately ships exact rules (`Bash(git commit)`,
`Bash(git status)`) per an earlier self-modification finding. Under the matcher
model M117 pinned, a rule without a `:*` suffix matches only the literal string,
so **those entries grant nothing** and every `git` command in a
`/setup`-bootstrapped consumer project falls through to whatever the ambient
permission mode decides. That is the same defect M117 fixed in the smoke
scaffold, still live on the path that reaches real users.

Covered by no AC in M117. Note the interaction before fixing: wherever the
inherited default permission mode is `auto`, the classifier decides each call
regardless, so correcting these entries fixes a *policy artifact* rather than
guaranteeing a runtime fence. Both statements are true and they bound each other.

### 3. `phaseASlice` truncates at a fenced heading in 4 of 7 test files

`harness-driver-abort-reap-parity.test.ts`,
`m112-ste-414-nontty-hard-gate.test.ts`,
`m98-ste-365-fire-and-exit-guard.test.ts` and
`smoke-driver-m96-wait-discipline.test.ts` each define
`phaseASlice = sectionSlice(body, "### Phase A — …", "## Findings")` with a
non-fence-aware `indexOf`. The only occurrence of `## Findings` in
`.claude/skills/conformance-loop/SKILL.md` is **inside a fenced report
template**, so those four slices stop early and exclude the tail of Phase A —
including the transient-retry contract M117 added there.

The three remaining definitions end at `"### Phase B"` and do include it.
Consequence: a future parity test written against the shared helper would pass
vacuously over the region it was written to check. M117's own tests are immune
(they use a fence-aware `headingSections`), which is why this is latent rather
than failing.

### 4. `parseArgs` duplicated byte-for-byte in two CLI shims

`adapters/_shared/src/smoke_verdict.ts` and
`adapters/_shared/src/smoke_fixture_groups.ts` carry semantically identical
copies — the only two in the tree.

**Deliberately not extracted, and the reasoning should be respected rather than
re-litigated at two copies:** a new shared module in this repo is not free. It
acquires the per-module meta-test surface (the STE-token ceiling, the
dot-anchored path-drift pin) and adds an import hop to files whose whole purpose
is that a driver SKILL can run `bun <one-file>.ts` from a bash fence. Extract
when a **third** `import.meta.main` shim wants it.

### 5. ~20 pre-existing `tsc` errors block any typecheck gate step

`bunx tsc --noEmit` over `adapters/_shared/src/**` + `tests/**` surfaces roughly
twenty errors in modules unrelated to M117 — a cast in `tracker_config.ts`,
null-narrowing in `tracker_tolerance.ts`, a TS5097 in a bundled hook, plus
several test-file overload and `delete` errors.

Consequence, and the reason this matters more than it looks: the gate is
`bun test` with **no typecheck step**, so a type break surfaces only at review
time. M117 added a required field to an exported interface
(`ReconcileItem.side`) and had to verify by hand that no other constructor
exists. Cleaning these up is the precondition for adding a typecheck step, which
is what would make that class of change safe by construction.

### 6. Pre-flight #10 refuses a whole run over a non-operative gate — judgment call

`/smoke-test` pre-flight #10 (and its `/conformance-loop` mirror, refusal (f))
hard-refuses a run when `Bash(claude:*)` is absent from the tracked allow-list.
M117 established by measurement that wherever the inherited default permission
mode is `auto` — the environment the driver actually runs in, since every spawn
exports `CLAUDE_CONFIG_DIR=~/.claude-st` — the classifier decides spawns and the
allow-list's contents guarantee nothing at runtime.

The probe was **kept and re-justified** on two surviving merits: it holds the
scaffold in sync with the tracked list, and the allow-list *is* the operative
gate in any checkout that has not opted into `auto`. Both are real. But the first
is already enforced fail-closed by gate-check probe #62, and the second is
hypothetical for this driver. So a *run-refusing* gate may be stronger than the
remaining justification supports. Not a defect — a deliberate call worth
revisiting with fresh eyes rather than inheriting silently.

---

## Carried forward from M116 — Headless Conformance Unblock (2026-07-27)

Recovered from the archived FRs' `## Implementation notes` and from review of the
shipped modules. M116 did not record these as a single list, so this section is a
reconstruction — treat it as such, and prefer the archived FRs as the primary
source where they disagree.

### 7. `capability_row_assert.ts` scores a MISSING capture as an empty one

The CLI shim reads
`const ndjson = (await file.exists()) ? await file.text() : ""`, so a capture
that **never existed** is scored identically to one that exists and is empty.

This matters because several smoke fixtures are **absence-only** assertions
(fixture 1b, fixture 5b): under `absent`, a spawn that produced no log at all
scores PASS. That is the same can't-fail class STE-421 was written to close —
relocated rather than eliminated.

The module's own comment defends it deliberately ("a missing capture is a real
smoke signal, not a crash… chain-integrity detection is `assertChainIntegrity`'s
job, not this runner's"), and that division of labour is defensible — **but only
if every absence assertion is paired with a chain-integrity check on the same
path.** Nothing currently enforces that pairing. Either enforce it, or have the
runner distinguish missing from empty and let the caller decide.

### 8. AC-STE-418.4 shipped deferred

The recorded six-capture replay through `assertChainIntegrity` landed in both
directions, but the live `/smoke-test` leg was not run in the implementation
session. Retroactive validation was deferred to the next conformance run — which
has not happened yet, and M117 did not run one either.

### 9. Three FRs undercounted their own defect

M116's FRs named "eight raw-grep sites" (nine existed), "four occurrences" of an
unscoped pidfile glob (five literals across four lines), and a self-check that
"already computes both abort triggers" (it computed one).

Not actionable on its own. Recorded because it is a **pattern**, and it repeated
in M117: STE-426 called all ten scaffold entries glob-shaped when nine were, and
STE-430 attributed a denial to heredoc parsing when the real cause was an inert
exact rule. The lesson worth carrying: an FR's own count of its defect is a
hypothesis, and implementation should re-measure it before building on it.

### 10. `specs/frs/archive/STE-417.md` was edited under a spec-authorized exception

AC-STE-424.5 required editing an already-archived FR, which the archive-frozen
convention normally forbids. The AC named the file and line explicitly, so it was
treated as authorized. Recorded so a future reader who finds an archived file
with a post-archival edit has the reason rather than a mystery.
