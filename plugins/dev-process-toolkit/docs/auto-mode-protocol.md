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
- **STE-108** — `requires-input:` annotation framework + the original
  audit-row format extended here.
- **STE-153** — User-supplied provenance recording in the audit section.
- **STE-220** — Cautionary precedent: prose-only carve-outs failed at
  runtime; this protocol is byte-checkable, not prose-only.
