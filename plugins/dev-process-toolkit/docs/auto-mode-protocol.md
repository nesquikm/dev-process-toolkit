# Auto-Mode Refusal Protocol

> **Single source of truth.** Every toolkit skill that gates on operator
> approval cites this doc instead of redefining the rule. STE-232 closes the
> refusal side; STE-226 closed the default-apply side.

## The Rule

The harness-injected system reminder *"The user has asked you to work without
stopping for clarifying questions"* is **not** an override of any annotation
of the `requires-input:` kind. The reminder turns down the chattiness of the
session, not the structural correctness of skill gates. Such a step refuses
without a real answer regardless of the reminder.

<!-- Keep every `requires-input:` mention in this file mid-sentence and
     reason-free. A line-leading occurrence, or one inside a code span that
     also carries a reason, DECLARES a gate under the recognizer this document
     describes — which would scope any skill that copies the prose into its
     own SKILL.md. A hard wrap alone is enough to do it, so re-flow with care;
     a test pins this. -->


Three (and only three) sources count as a real answer for a gated step:

1. **User-supplied** — captured live from a TTY interactive prompt.
2. **Pre-baked** — supplied via a documented CLI flag (e.g.,
   `--tracker=linear`, `--commit`, `--release`).
3. **Default-applied** — the auto-approve marker
   `<dpt:auto-approve>v1</dpt:auto-approve>` is observed AND the gate has a
   documented safe default. `requires-input:` steps have no safe default and
   cannot be default-applied.

Anything else (model-imputed, "I'll pick a sensible value", "the description
suggests…") is a **refusal-side bug**. The protocol's job is to make those
bugs structurally impossible: every gated step routes through
`requireOrRefuse(...)`, every audit row carries `imputed: true|false`, and
the `/gate-check` probe `requires_input_sentinel_coverage` enforces the
contract across every skill in scope.

## Default-Apply Mechanism

The byte-checkable marker
[`<dpt:auto-approve>v1</dpt:auto-approve>`](../skills/spec-write/SKILL.md)
(STE-226) is the canonical pre-authorization token. Parent skills that spawn
`claude -p` children with prompt-bearing heredocs inject the marker as the
first body line of the heredoc; child skills check for the marker on its own
line and, when present **AND** the gate has a documented safe default,
default-apply the gate.

The `/smoke-test` Phase 2 driver heredoc-injects the marker for every
canonical child spawn — that is the canonical worked example of the
mechanism. See `.claude/skills/smoke-test/SKILL.md` § Phase 2.

`/gate-check` probe `auto_approve_marker_in_canonical_spawns` (STE-226 AC.5)
hard-fails any prompt-bearing `claude -p` heredoc spawn that does not carry
the marker line — the read-side companion to the write-side discipline of
this section.

**Marker presence is informational for `requires-input:` steps.** The marker
relaxes only gates that have a safe default; a per-step refusal contract —
the annotation plus its reason — declares explicitly that no safe default
exists, so the marker cannot relax them. This is the load-bearing distinction the
v2.13.0 incident exposed (model-imputed `tracker_mode=none` despite step 7b
being `requires-input:`).

## Refusal Mechanism

The canonical helper `requireOrRefuse(spec, key, sentinel)` at
`adapters/_shared/src/requires_input.ts` consolidates the four-outcome
decision. Callers materialize the spec upstream (by resolving CLI flags,
prompting interactively, observing the marker) and pass the resolved values
in.

```
Outcome  | Trigger
---------+--------------------------------------------------------------
user-    | userSuppliedValue !== undefined && !== sentinel
supplied |
pre-     | preBakedValue   !== undefined && !== sentinel
baked    |
default- | markerPresent && defaultValue !== undefined
applied  |
refused  | otherwise → throws RequiresInputRefusedError (NFR-10 shape)
```

Precedence is top-to-bottom (user-supplied wins over pre-baked wins over
default-applied). The **sentinel-still-placeholder** check protects against
the upstream-resolver pattern where a deferred placeholder (`<deferred>`,
`<unset>`, etc.) is returned in lieu of `undefined`; a value matching the
sentinel does NOT count as a real answer.

`RequiresInputRefusedError`'s message follows NFR-10 canonical shape — the
operator sees `Verdict:` (what happened, what the requires-input reason was),
`Remedy:` (how to unblock — pre-bake the flag or run interactively), and
`Context:` (skill / step / key / marker observation) on three separate lines.

## Sanctioned Answers Block

A child spawned under `claude -p` has no `AskUserQuestion` tool registered, so
an interview step has no way to obtain an answer and correctly refuses. That
refusal is right, but on its own it leaves an autonomous driver with no
legitimate way to drive an interview-bearing skill at all. The sanctioned
answers block supplies the missing half: an explicit, operator-authored
transport for **source #2** (pre-baked) above. It is **not** a fourth answer
source, and it is not a gate relaxation — the interview is ANSWERED, never
skipped.

**Shape and contract.** The block is delimited by the literal byte-strings
`<dpt:answers>v1` and `</dpt:answers>`, carrying one `key: value` pair per
line between them (split on the FIRST colon, so a value may hold its own
colons). The implementation is `adapters/_shared/src/auto_answers.ts`:
`extractAutoAnswers(promptBody)` lifts the whole block, and
`resolveInterviewAnswer(promptBody, key)` returns one answer — or `undefined`
when the body is unmarked, the block is absent or malformed, or the block
simply does not answer that key. That return value is exactly what a caller
hands to `requireOrRefuse(...)`'s `preBakedValue` slot, so a hit resolves as
**pre-baked** and a miss lets the ordinary refusal fire untouched — the block
never reaches the `default-applied` slot, which stays reserved for gates that
have a documented safe default. **The marker is a hard precondition:**
`extractAutoAnswers` byte-greps the same body for
`<dpt:auto-approve>v1</dpt:auto-approve>` first and returns an inert result
when it is absent, however well-formed the block.
**A malformed block fails closed** — an unterminated block, or a close
delimiter that precedes its open, yields the same inert result rather than a
best-effort partial parse, because a partial answer set silently satisfying an
interview is strictly worse than a visible refusal.
And unmarked prose is **never an answer source**: harness
`<system-reminder>` text, "work without stopping" paraphrases, pre-baked
`<command-args>` flag prose, and `claude -p` non-interactive stdin inference
are not triggers, and none of them become answers by being verbose.

Producer / consumer worked example: the `/smoke-test` Phase 2 driver emits the
marker as the first body line of its `/spec-write` child heredoc and a
`<dpt:answers>v1` block beneath it, one key per clarifying question the child
will reach; `/spec-write` names the resolver, the module, and both branch
directions at its milestone-allocation gate and, in the same wiring paragraph,
across the § 1–§ 6 FR-content interview.

**Consumers.** Two skills read this block today, through the identical call
shape, so an absent ask tool means the same thing in both:

- `/spec-write` — at its milestone-allocation gate (§ 7a), alongside that
  gate's `defaultValue` recommendation, **and at every clarifying question of
  the § 1–§ 6 FR-content interview**, which has no safe default anywhere and so
  refuses rather than default-applies. The interview keys a driver may supply
  are `feature_summary`, `acceptance_criteria`, `implementation_file`,
  `test_file`, `changelog_category`, `milestone`, `technical_design`,
  `testing`, `cross_cutting_requirements`, `out_of_scope`,
  `non_functional_requirements` and `risks` — each read via
  `resolveInterviewAnswer(promptBody, key)` from
  `adapters/_shared/src/auto_answers.ts` and handed to `requireOrRefuse(...)`'s
  `preBakedValue` slot, the identical call shape `/setup` uses below. The
  question is still emitted as an `AskUserQuestion` call and answered from the
  block; a key the block omits refuses individually and is never invented, and
  the rest are unaffected.
- `/setup` — at every `requires-input:` step (the step contract in
  `skills/setup/SKILL.md`, covering step 7b's `tracker_mode` and step 7f's
  tracker-config write). `/setup` has no safe default at those gates, so the
  block is the *only* way an autonomous driver can answer them; without it the
  `setup-socratic` gate site in `adapters/_shared/src/gate_marker_refusal.ts`
  refuses, and the refusal is the correct outcome. The interview keys a driver
  may supply are the Schema L resolutions `/setup` performs — `stack`,
  `tracker_mode`, `branch_template`, `user_facing_mode`, `packages_mode`,
  `changelog_ci_owned`, `token_stats_enabled`, `create_specs` — each read via
  `resolveInterviewAnswer(promptBody, key)` from
  `adapters/_shared/src/auto_answers.ts` and handed to `requireOrRefuse(...)`'s
  `preBakedValue` slot. A key the block omits refuses individually; the rest
  are unaffected.

## Socratic Loop Contract

STE-232's per-step refusal closed the **per-gate** side of the autonomous-mode
contract. STE-237 closes the symmetric **whole-loop** side: a model running
under the autonomous-mode reminder + verbose pre-baked-args prose can skip the
entire Socratic clarification loop *before* any gated step fires (the magpie
incident, gist
`https://gist.github.com/nesquikm/2904e50c7213b6aa392b998d4137f609`, 2026-05-07,
v2.16.0). Pattern 26 prose alone is insufficient — STE-220 cautionary
precedent applies. Structural enforcement closes the loop.

**(a) The rule — universal `AskUserQuestion` mandate.** Every clarifying
question in a Pattern-26-tagged skill body MUST be emitted as an
`AskUserQuestion` tool call (closed-form options OR open-ended; the always-on
`"Other"` free-form fallback covers the open-ended case). The mandate holds
**regardless of**:

- the harness-injected autonomous-mode reminder ("work without stopping for
  clarifying questions"),
- the auto-approve marker (`<dpt:auto-approve>v1</dpt:auto-approve>`),
- pre-baked `<command-args>` prose that *appears* to answer every question.

The marker only relaxes gates that have a documented safe default; it does
not relax the Socratic loop, because clarifying questions have no "safe
default" — guessing at user intent is the regression class STE-237 closes.
Bare-prose questions (`"which mode do you want?"` rendered as plain
markdown) are forbidden in Pattern-26-tagged skill bodies; the model running
the skill cannot fabricate answers when the question itself is structured as
a tool call the harness brokers.

**(b) The first-turn contract.** `Write`, `Edit`, and `NotebookEdit` tool
calls are forbidden before the **first** of (i) an `AskUserQuestion`
`tool_use` block in the response stream, OR (ii) a
`RequiresInputRefusedError` raise. Read-only orientation tools (`Read`,
`Grep`, `Glob`, `Bash`-read-only) are allowed pre-ask; free-form `text`
entries are allowed pre-ask. The arbiter is the pure-I/O helper
`assertFirstTurnShape(transcript)` at
`adapters/_shared/src/socratic_first_turn.ts` — the single source of truth
for the contract, consumed by `/smoke-test` Phase 8 and any future runtime
detector. Violation throws `SocraticFirstTurnViolationError` (NFR-10
canonical shape) naming the offending tool name + zero-based index in the
response stream.

**(b′) STE-270 clarification.** Pre-baked `<command-args>` prose, autonomous-mode harness reminders, and auto-approve marker absence are NOT acceptable triggers to skip the first `AskUserQuestion` under non-tty stdin. The first tool call MUST be `AskUserQuestion` or `RequiresInputRefusedError` raise — there is no inferred-permission carve-out. The companion `/gate-check` probe `spec_write_first_turn_drift_scan` (STE-270 AC-STE-270.2) byte-checks `/spec-write` SKILL.md for alternate-trigger paraphrases of this rule and hard-fails on any match.

**(b″) STE-262 clarification.** The harness's `Auto Mode` system reminder is NOT a marker substitute; only the literal byte-string `<dpt:auto-approve>v1</dpt:auto-approve>` triggers gate auto-apply. No conversational hint, autonomy framing, or `claude -p` non-interactive inference is an acceptable trigger. At `/spec-write` § 0b step 4 (draft gate) and § 7a (commit gate), the runtime byte-grep helper `adapters/_shared/src/check_marker_runtime.ts` is the single deterministic gate decision — the LLM running the skill invokes the helper via Bash and branches strictly on its `PRESENT` / `ABSENT` stdout, never on its own context inference. The companion `/gate-check` probe `spec_write_marker_alternate_trigger_scan` (STE-262 AC-STE-262.4) byte-checks `/spec-write` SKILL.md for alternate-trigger paraphrases of this rule and hard-fails on any match outside the canonical negation/historical carve-out signatures.

**(c) Skills in scope (initial set).** The contract applies to every skill
body that (i) cites `Pattern 26` (substring match) OR (ii) carries a
`socratic: true` Schema-K frontmatter key. Initial scope:

| Skill              | Site                                                          |
|--------------------|---------------------------------------------------------------|
| `/setup`           | Steps 1–6 stack-detection / Schema-L resolution clarifiers    |
| `/brainstorm`      | Step 1 goals + Step 2 approaches Q&A                          |
| `/spec-write`      | § 1–§ 6 requirement / AC / technical / testing interview      |
| `/report-issue`    | scope + redaction-confirmation prompts                        |

**Forward-extension hook.** Any new skill that ships `Pattern 26` prose or
a `socratic: true` frontmatter key is automatically picked up by
`/gate-check` probe `socratic_loop_uses_ask_user_question` — no manual list
maintenance. The probe asserts (i) the body references the
`AskUserQuestion` tool primitive (substring match) AND (ii) the body cites
this protocol doc by relative path.

**(d) Cross-references.**

- **STE-226** (default-apply marker): the Socratic loop has no analog —
  clarifying Qs lack safe defaults by definition. The marker relaxes
  approval gates; it does not relax loop entry.
- **STE-232** (per-step refusal): closed the gate-level contract via
  `requireOrRefuse(...)`. STE-237 is the symmetric loop-level layer.
  `imputed:` flags model-imputed values for gates that *did* fire;
  `loop_entered:` flags loops that *never* fired.
- **STE-220** (prose-only failure precedent): the cautionary lesson —
  prose-only carve-outs failed at runtime; the fix must be byte-checkable.
  STE-237 satisfies that lesson via `AskUserQuestion` (B-side, structural)
  + `/smoke-test` Phase 8 (C-side, behavioral) + the
  `socratic_loop_uses_ask_user_question` probe (C-side, source-level).

## Audit Trail

Every Schema L resolution writes a row to CLAUDE.md's `## /setup audit`
section via `appendAuditRow(...)` at `adapters/_shared/src/setup/audit_log.ts`.
The row format gained an `imputed: true|false` column under STE-232:

```
- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"user-supplied" imputed:false
- 2026-05-07 step:7c (branch_template) value:"feat/{ticket-id}-{slug}" reason:"default applied" imputed:true
```

`imputed` is derived from the helper's `source` parameter:

| `source` value     | Derived `imputed:` | Canonical `reason:` rendering |
|--------------------|---------------------|-------------------------------|
| `user-supplied`    | `false`             | `"user-supplied"`             |
| `pre-baked`        | `true`              | `"pre-baked"`                 |
| `default-applied`  | `true`              | `"default applied"`           |
| `model-imputed`    | `true`              | `"model-imputed"`             |

`imputed: false` is the **only** clean signal. Any other value indicates the
operator did not directly confirm the resolution; the column makes the
distinction structurally inspectable from outside the skill body. This
closes the v2.13.0 detection gap — a model-imputed answer no longer renders
as a user-confirmed one.

**Legacy rows** (no `imputed:` column) pre-date STE-232 and are tolerated by
`parseAuditRow(...)`; they parse with `imputed: undefined`. New writes always
emit the column. There is no automatic upgrade of on-disk legacy rows — the
parser tolerance is forward-compatibility, not retrofit.

**STE-237 extension — `loop_entered:` column.** Rows additionally carry an
optional `loop_entered: true|false` column rendered when the caller passes
`loopEntered` to `appendAuditRow(...)`. `true` means /setup Steps 1–6
emitted at least one `AskUserQuestion` clarifier (the model entered the
Socratic loop); `false` means the model proceeded without entering it. The
two columns are orthogonal: `imputed:` flags model-imputed values for gates
that *did* fire; `loop_entered: false` flags loops that *never* fired —
the magpie regression class. Both columns must be inspected together to
reason about a /setup run's structural correctness. Pre-STE-237 rows omit
the column; the parser tolerates both shapes (`loopEntered: undefined`).

## Skills In Scope

The protocol applies to every toolkit skill carrying a `requires-input:`
annotation in its body OR consuming the auto-approve marker for a gate.
Initial scope (audited by `/gate-check` probe `requires_input_sentinel_coverage`):

| Skill              | Gate                              | Refusal site                                        |
|--------------------|-----------------------------------|-----------------------------------------------------|
| `/setup`           | step 7b tracker mode              | `requires-input:` annotation; `requireOrRefuse(...)` (STE-232 AC.3) |
| `/spec-write`      | draft + commit                    | STE-226 marker (default-apply); `requireOrRefuse(...)` for any `requires-input:` step added later |
| `/implement`       | Phase 4 step 15 commit approval   | STE-226 marker (default-apply)                      |
| `/ship-milestone`  | release approval                  | STE-226 marker (default-apply)                      |
| `/smoke-test`      | Phase 0 acceptance                | Cites this doc (STE-232 AC.6); marker-aware default-apply when stdin is non-interactive AND marker observed |
| `/report-issue`    | gist push                         | STE-226 marker (default-apply)                      |

The probe globs `plugins/dev-process-toolkit/skills/*/SKILL.md` and
`.claude/skills/*/SKILL.md`. Scope is decided per occurrence, not per file: a
skill is in scope only when some non-comment line DECLARES a gate. A line
declares a gate when the annotation owns that line (after blockquote /
table-cell / heading / list / emphasis decoration and one optional backtick),
or when an inline-code span carries the annotation together with a concrete
reason. Naming the contract mid-sentence in running prose — as the
"Marker presence is informational" disclaimer above does, and as every
marker-consuming skill is asked to — is a mention, not a declaration, and
never pulls the citing skill into scope.

**Annotation form is the contract.** Write a gate as its own line, or supply
its reason inside the same inline-code span; a bare token buried mid-sentence
is indistinguishable from prose and will not be audited. For every in-scope
skill the probe asserts (a) a `requireOrRefuse(...)` reference and (b) a
relative-path citation of `docs/auto-mode-protocol.md`. Either missing ⇒
separate violation, surfaced as
`requires_input_sentinel_coverage_violation` capability rows in the
`/gate-check` report. The recognizer `isRequiresInputDeclaration(line)` in
`adapters/_shared/src/requires_input_sentinel_coverage.ts` is the single
source of truth for the distinction; prose that DESCRIBES the rule must be run
through it before committing, or the describing skill scopes itself in.

## Related FRs

- **STE-226** — Default-apply mechanism: the canonical marker, the
  `auto_approve_marker_in_canonical_spawns` `/gate-check` probe.
- **STE-232** — Per-step refusal contract: `requireOrRefuse(...)` and
  the `imputed:` audit column.
- **STE-237** — Socratic Loop Contract: universal `AskUserQuestion`
  mandate + first-turn contract + `loop_entered:` audit column +
  `socratic_loop_uses_ask_user_question` /gate-check probe +
  `/smoke-test` Phase 8.
- **STE-108** — `requires-input:` annotation framework + the original
  audit-row format extended here.
- **STE-153** — User-supplied provenance recording in the audit section.
- **STE-220** — Cautionary precedent: prose-only carve-outs failed at
  runtime; this protocol is byte-checkable, not prose-only.
