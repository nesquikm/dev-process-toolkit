# Project-Authored Verification Skills

How to write a project-local "check skill" that verifies your app actually
runs — and how to wire it into `/implement` so it runs automatically after the
deterministic gates pass.

> **New here?** Skim the philosophy below, then jump to *Author your own check
> skill*. The fastest start is to let `/setup` or `/implement` scaffold a stub
> for your stack and fill in the TODOs.

## Why a passing gate is not a working app

The toolkit's deterministic gates — compile, lint, unit/widget tests — are the
first and final word on *code-level* correctness. They are fast, binary, and
they always win over LLM judgment. But they share a blind spot: **a green gate
proves the code type-checks and the tests you wrote pass; it does not prove the
app boots, renders, or completes a real user journey.**

Concrete gaps a green gate routinely misses:

- The service compiles and every unit test passes, but the process crashes on
  startup because a required env var is unset.
- Every widget test is green, but the running app throws a runtime exception on
  the first screen and shows a red error box.
- The HTTP handler has 100% line coverage in isolation, but the end-to-end
  request path 500s because a middleware ordering bug never surfaces in a unit
  test.

A **verification skill** (also called a *check skill*) closes that gap. It
drives the *actual running artifact* — a CLI, a server, a device, a browser —
through a user journey and asserts the observed outcome. It is the runtime
counterpart to the compile-time gate: the gate says "the code is well-formed,"
the check says "the thing actually works."

Two motivating shapes, both stack-specific but generalizable:

- A **`glacy-drive`-style** check boots the running app, reads its live UI,
  taps and types through a journey, then confirms the expected screen with no
  runtime errors. (For Flutter that means the Dart Tooling Daemon + widget-tree
  MCP tools; the *shape* — connect, drive, assert — is stack-neutral.)
- A **`glacy-progress-e2e`-style** check brings a service up, fires a real
  request sequence against its HTTP surface, and asserts the end-to-end
  response and side effects.

You do not need any of that specific plumbing to start. What matters is the
pattern: **bring the artifact up → drive a real journey → assert the observed
result → tear down.**

## The `## Verification` config contract

A project opts in by declaring a `## Verification` section in its CLAUDE.md.
The section is optional; when it is absent, no check is declared and
`/implement` simply reports "no verification configured."

```markdown
## Verification

verify_skill: visual-check
verify_mode: advisory
```

The key set is **closed** — exactly these two keys. Any other key inside the
section is a config error.

| Key | Meaning |
|-----|---------|
| `verify_skill` | Slug of a project-local `.claude/skills/<name>` skill, **or** the literal `visual-check` (the toolkit's built-in web-UI check). This is the skill `/implement` runs. |
| `verify_mode` | One of `advisory` \| `blocking` \| `manual`. Absent key ⇒ default `advisory`. |

### `verify_mode` semantics

- **`advisory`** (the default) — the check runs and its pass/fail outcome is
  reported, but a failing check **never blocks** the commit. The human decides
  whether to proceed. This is the safe default: verification informs, it does
  not gate.
- **`blocking`** — a failing check **gates** the commit-approval step. The
  commit is not offered until the check passes or the operator explicitly types
  an override. Use this when the runtime journey is load-bearing enough that a
  failure should stop the line.
- **`manual`** — `/implement` does **not** auto-run the skill. It prints a
  one-line reminder naming the resolved skill and how to run it yourself. Use
  this when the check needs a device, credentials, or a human in the loop that
  an autonomous run cannot supply.

### How `/implement` discovers and runs the skill

`/implement`'s **Phase 4b″ (Project Verification)** runs after the gate check is
green and after the doc-fragment / cross-cutting-spec hooks, but *before* the
step-14 report and step-15 commit approval. It resolves the check skill through
a fixed discovery precedence:

1. **Declared** — if `## Verification` sets `verify_skill`, use it verbatim.
2. **Discover (fallback)** — otherwise scan `.claude/skills/*/SKILL.md` for a
   candidate whose slug looks like a check (`*drive*` / `*check*` / `*verify*`)
   or whose frontmatter carries `verify: true`. Exactly one candidate ⇒
   `/implement` *offers to adopt* it and writes `verify_skill` into your
   CLAUDE.md on accept. It never silently runs an undeclared skill.
3. **None** — zero candidates and no declared skill ⇒ `/implement` *offers to
   scaffold* a stub (see below), or to adopt the built-in `visual-check` for a
   small web project. Decline ⇒ it proceeds with a "no verification
   configured" note.

Unless the mode is `manual`, the resolved skill runs in Phase 4b″ and its
outcome becomes a row in the step-14 report.

## The `.claude/skills/<name>` + `disable-model-invocation` convention

A check skill is an ordinary Claude Code skill that lives in your project at
`.claude/skills/<name>/SKILL.md`. Two conventions make it a *check* skill:

1. **It lives under `.claude/skills`** in the consuming project (not in the
   toolkit). That is what the discovery scan in Phase 4b″ looks at, and it is
   the path `verify_skill` names by slug.
2. **Its frontmatter carries `disable-model-invocation: true`.** This is the
   load-bearing convention: it makes the skill **opt-in**. A check skill boots
   servers, drives devices, and can have side effects, so you do **not** want
   the model auto-invoking it because a prompt happened to mention
   "verify." The marker means the skill runs *only* when a workflow explicitly
   invokes it through `verify_skill` (or when you run it by hand). Verification
   is deliberate, never incidental.

A minimal check-skill frontmatter:

```markdown
---
name: my-app-e2e
description: Drive the running app end-to-end and assert the real user journey.
disable-model-invocation: true
allowed-tools: Bash, Read
---
```

Widen `allowed-tools` to whatever the procedure actually uses — an HTTP client,
a browser MCP, a device driver — but keep it as narrow as the check allows.

## Author your own check skill

### Fast path — scaffold, then fill the TODOs

When `/implement` reaches Phase 4b″ with no check declared or discovered, it
offers to scaffold one. You can also invoke the scaffold from `/setup`. The
generator writes a stack-appropriate stub into `.claude/skills/<name>/SKILL.md`
using the templates under `templates/check-skill/` (Flutter, web, Python, and a
stack-neutral generic fallback). Then:

1. **Accept the offer.** The stub lands with correct frontmatter — the right
   `name`, `disable-model-invocation: true`, and a starter `allowed-tools`.
2. **Fill `## What this checks`.** Describe, in one or two sentences, the real
   end-to-end behavior your gates cannot see, then enumerate the concrete
   assertions as a checklist.
3. **Fill `## How to run`.** Replace each TODO with the exact commands or MCP
   tool calls for your stack: bring the artifact up, drive the journey step by
   step, tear down anything the run created, and report a pass/fail line per
   step.
4. **Delete every remaining TODO** and the trailing Notes block once the steps
   are project-specific.
5. **Wire it in.** Confirm `verify_skill: <your-slug>` is set in the
   `## Verification` block (the scaffold offer writes this for you on accept),
   and choose a `verify_mode`.

### From scratch

If you would rather write the skill from scratch (no generator), the shape is
small:

1. **Create `.claude/skills/<name>/SKILL.md`.** Pick a slug that reads as a
   check — e.g. `<app>-e2e`, `<app>-drive`, `smoke-check`.
2. **Write the frontmatter** with `disable-model-invocation: true` and an
   `allowed-tools` list covering the tools your check uses (see the convention
   section above).
3. **Write two sections:**
   - `## What this checks` — the journey and the concrete, observable
     assertions.
   - `## How to run` — the exact bring-up → drive → assert → tear-down steps,
     each producing a `✓`/`✗` line.
4. **Declare it** in CLAUDE.md:

   ```markdown
   ## Verification

   verify_skill: <your-slug>
   verify_mode: advisory
   ```

5. **Choose the mode deliberately.** Start with `advisory` while you build
   confidence in the check; promote to `blocking` once it is stable and the
   journey is critical; use `manual` if the check needs a human, a device, or
   credentials that an autonomous run cannot provide.

That is the whole contract. Keep the check focused on one real journey, make
every assertion observable, and let the deterministic gates keep owning the
code-level correctness they are good at — the check skill only has to prove the
thing runs.

## See also

- `templates/check-skill/` — the per-stack stub templates the scaffold uses.
- `skills/visual-check/SKILL.md` — the toolkit's built-in generic web-UI check,
  usable directly as `verify_skill: visual-check`.
- `docs/patterns.md` — *Project-Authored Verification Skills* (this pattern),
  *Visual Verification via MCP*, and *Verification-Before-Completion*.
- `skills/implement/SKILL.md` § Phase 4b″ — the full discovery-and-run
  decision table (precedence, run placement, failure classify + propose).
