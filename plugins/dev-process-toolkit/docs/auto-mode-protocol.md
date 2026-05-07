# Auto-Mode Refusal Protocol

> **Single source of truth.** Every toolkit skill that gates on operator
> approval cites this doc instead of redefining the rule. STE-232 closes the
> refusal side; STE-226 closed the default-apply side.

## The Rule

The harness-injected system reminder *"The user has asked you to work without
stopping for clarifying questions"* is **not** an override of any
`requires-input:` annotation. The reminder turns down the chattiness of the
session, not the structural correctness of skill gates. A `requires-input:`
step refuses without a real answer regardless of the reminder.

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
relaxes only gates that have a safe default; per-step refusal contracts
(`requires-input: <reason>`) declare explicitly that no safe default exists,
so the marker cannot relax them. This is the load-bearing distinction the
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
`.claude/skills/*/SKILL.md`; for every skill body containing a non-comment
`requires-input:` annotation, it asserts (a) a `requireOrRefuse(...)`
reference and (b) a relative-path citation of `docs/auto-mode-protocol.md`.
Either missing ⇒ separate violation, surfaced as
`requires_input_sentinel_coverage_violation` capability rows in the
`/gate-check` report.

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
