---
name: report-issue
description: Capture a structured bug report — narrative + redacted curated context (and optional session transcript) — and publish to a secret GitHub gist for triage by the maintainer or self-debug via /brainstorm.
argument-hint: '[--full]'
---

# Report Issue

Capture a structured incident report for the dev-process-toolkit plugin and publish it to a secret GitHub gist. Default mode is privacy-first: curated repo state + dev narrative only, no transcript. The `--full` flag (or an in-flow `[y/N]` prompt during preview) opts the JSONL transcript in for high-signal cases.

The gist URL goes back to the dev for sharing with the plugin maintainer or for self-debugging via `/dev-process-toolkit:brainstorm <gist-url>` in a fresh session.

> **"Secret" gist semantics.** GitHub secret/unlisted gists are URL-shareable, **not** truly private — anyone with the link can read. The redaction pass below (per AC-STE-229.6) is the privacy guarantee, **not** the gist's privacy flag. The dev sees the preview before any upload so the publish step is opt-in.
> **FIRST ACTION (under non-interactive stdin) — STE-251 AC-STE-251.1.** When `process.stdin.isTTY === false` (e.g., `claude -p`), the first tool call this skill emits MUST be `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise (via `requireOrRefuse(...)` from `adapters/_shared/src/requires_input.ts`). `Write` / `Edit` / `NotebookEdit` are forbidden before that ask/refusal — they produce silent scaffolding that bypasses the Socratic Loop Contract. Read-only orientation (`Read` / `Grep` / `Glob` / `Bash`-read-only) is allowed. Interactive (tty) sessions are byte-identical to v2.17.0 — non-tty stdin only. See `docs/auto-mode-protocol.md § Socratic Loop Contract`.

## When to Use This

- A toolkit user hits an unexpected behaviour and wants the maintainer to see structured repo state + narrative.
- The dev wants to self-debug a sticky issue by handing the captured context back to `/brainstorm` in a fresh session.

For one-off questions or trivial behaviour, just file a GitHub issue manually.

## Branch-gate exemption

`/report-issue` writes nothing under VCS — the only outbound operation is `gh gist create -s` against the secret gist endpoint, and every working file lives under `mktemp -d` (deleted on every exit path via `trap … EXIT` / `finally`). The skill never invokes `git commit`, never edits a tracked file, and is therefore exempt from STE-228's `commit_producing_skill_branch_gate` probe. The exemption is enforced by the `NON_COMMIT_PRODUCING_SKILLS` allowlist in `adapters/_shared/src/commit_producing_skill_branch_gate.ts` — `report-issue` is on that list.

## Process

### 1. Probe `gh auth status`

Before any data collection, run `gh auth status` (no args). On non-zero exit, refuse with the canonical NFR-10 shape and exit non-zero — write nothing, create no temp directory:

```
/report-issue refused — `gh auth status` returned non-zero exit (gh CLI is unauthenticated).
Remedy: run `gh auth login` and re-invoke /report-issue.
Context: probe=gh_auth_status, skill=report-issue
```

This is the hard prerequisite per AC-STE-229.2. The skill performs zero side effects on this path.

### 2. Collect dev narrative — Socratic, one prompt at a time

Ask the **four canonical prompts in this exact order**. One at a time, wait for the answer, then ask the next (composes with `docs/patterns.md § Pattern 26: Socratic Prompting`):

1. "What happened? (one or two sentences describing the unexpected behaviour)"
2. "What did you expect to happen instead?"
3. "Severity? (low / medium / high)"
4. "Reproducible? If so, list the steps. If not, type 'unsure'."

Do not batch. The order is asserted by the doc-conformance test; reordering breaks the test contract.

**Socratic Loop Contract (STE-237).** Each of the four canonical prompts above MUST be emitted as an `AskUserQuestion` tool call (closed-form options for #3 severity; open-ended with the always-on `"Other"` free-form fallback for #1 / #2 / #4), regardless of the autonomous-mode reminder, the auto-approve marker, or pre-baked `<command-args>` prose. Bare-prose Qs are forbidden. The first-turn contract additionally forbids `Write` / `Edit` / `NotebookEdit` tool calls before the first `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise; `Read` / `Grep` / `Glob` / `Bash`-read-only orientation is allowed (the temp-directory `mktemp -d` in § 3 fires AFTER the four-prompt loop completes). See `docs/auto-mode-protocol.md § Socratic Loop Contract` for the full contract.

### 3. Make a temp working directory

Allocate a working directory via `mktemp -d` (e.g., `TMPDIR_VAR=$(mktemp -d)`). Every artifact below lands inside it. Install a `trap 'rm -rf "$TMPDIR_VAR"' EXIT` (or equivalent `finally` block) so the directory is removed on every exit path — success, decline, error.

### 4. Gather curated context (default mode)

Collect the following into the working directory. Pass every text artifact through `scrubSecrets` from `plugins/dev-process-toolkit/adapters/_shared/src/scrub_secrets.ts` before writing it to disk — settings files are scrubbed even if they parse as YAML/JSON.

- **Plugin version** — read `plugins/dev-process-toolkit/.claude-plugin/plugin.json` and extract the `version` field.
- **`git rev-parse HEAD`** — the current commit SHA.
- **`git status --porcelain`** — uncommitted changes.
- **`git log -10 --oneline`** — last 10 commits.
- **Last `/gate-check` log** if discoverable. Probe `.claude/last-gate-check.log` and the equivalents from the toolkit's gate-check skill output convention; skip silently if absent — do not fail the skill.
- **Redacted `.claude/settings.json`** and **`.claude/settings.local.json`** — read each, run through `scrubSecrets`, capture both the redacted body and the per-pattern match counts. Settings are scrubbed even if they parse as YAML/JSON; the regex passes treat them as plain text to avoid leaking via key-substring match.
- **List of skills invoked in the current session** — call `findCurrentSession(cwd)` from `adapters/_shared/src/find_current_session.ts` to locate the current session's JSONL, parse each tool-use record, and extract the `name` field of every `Skill` invocation.
- **Dev narrative** — the four answers from step 2.

### 5. Add full transcript (`--full` mode only)

When `--full` is passed on the CLI, additionally bundle the current session's JSONL into the working directory before composing the gist payload below. When `--full` was **not** passed, do not collect the transcript here — the operator gets a `[y/N]` opt-in inside the preview gate (step 7) instead, so the file list + sizes are visible before any transcript-inclusion decision.

- Source path: `<config-dir>/projects/<cwd-slug>/<session>.jsonl` where `<config-dir>` is `process.env.CLAUDE_CONFIG_DIR` when set (operators running Claude Code with a non-default root — e.g., `~/.claude-st` — fall under this path), otherwise `~/.claude`. `<cwd-slug>` is `pwd` with every `/` replaced by `-`. The current session is selected as the most-recent-mtime JSONL under that directory — `findCurrentSession(cwd)` returns the resolved path, or `null` when no candidate exists. Mtime is the deterministic best-known proxy for the live session UUID; if Claude Code later exposes `CLAUDE_SESSION_ID`, the helper SHOULD prefer that and fall back to mtime (call signature unchanged).
- Run the full JSONL body through `scrubSecrets` before writing.

When the resolved path is `null`, surface a one-line note in the preview ("transcript unavailable — session JSONL not found") and continue without the transcript file. Do not fail the skill — the curated payload is still useful.

### 6. Compose the gist payload

Three files maximum, written into the temp working directory:

- **`report.md`** — narrative + curated context inline; markdown for human readability. Sections, in this order:
  - `## Narrative`
  - `## Severity`
  - `## Reproducibility`
  - `## Curated Context`
  - `## Redaction Summary`
- **`metadata.json`** — machine-readable shape:
  ```json
  {
    "timestamp": "<ISO-8601 UTC>",
    "plugin_version": "<x.y.z>",
    "git_head": "<sha>",
    "severity": "<low|medium|high>",
    "redaction_summary": [{ "pattern": "<key>", "count": <n> }, ...],
    "full_transcript_included": <boolean>
  }
  ```
- **`transcript.jsonl`** — full mode only; the scrubbed transcript verbatim.

### 7. Preview gate

Print a preview block listing each file with its byte size + the redaction summary. **When the skill was invoked without `--full`**, also prompt `Include full transcript? [y/N]` **at this step** (default `N` interactively; auto-`N` in auto-mode unless the marker below is present, in which case the marker drives the answer); on `y`, collect and add the transcript file to the working directory before continuing. Then prompt the publish gate:

```
Push to gist? [y / n / edit]
```

**Default-apply rule.** When the prompt body contains the literal line `<dpt:auto-approve>v1</dpt:auto-approve>` (byte-grep, no inference per STE-226's marker contract), default-apply `y` and emit the `report_issue_default_applied` capability row in the closing summary. The marker is the single deterministic mechanism — legacy `Auto Mode Active` system-reminder detection is **not** used.

**Decline (`n`).** Emit `report_issue_declined`, run the `trap` cleanup (`rm -rf "$TMPDIR_VAR"`), exit non-zero. Do not call `gh gist create`.

**Edit (`edit`).** Re-open narrative collection with the previous four answers pre-filled. The transcript and curated context are not editable — the preview is the dev's last chance to abort before upload. After re-collection, return to step 7 (preview gate).

### 8. Publish via `gh gist create`

When the preview gate accepts `y`, shell out:

```bash
gh gist create -s -d "<title>" report.md metadata.json [transcript.jsonl]
```

- `-s` is the secret/unlisted flag.
- Title format: `dev-process-toolkit issue: <severity> — <one-line narrative head, ≤72 chars>` (truncate at 72 with ellipsis if longer).
- Capture stdout (the gist URL) and the exit code. Non-zero exit ⇒ surface as the canonical NFR-10 shape naming the underlying `gh` stderr (e.g., rate-limited / network-error / auth-revoked-mid-flight).

### 9. Closing summary (≥100 bytes)

On every successful run, emit a closing summary that satisfies the per-skill console-status contract (used by `/spec-write`, `/setup`, `/implement`, `/gate-check`, `/spec-review`, `/simplify`). The summary must include, on stdout:

- The rendered gist URL.
- File list with byte sizes.
- Redaction-match counts grouped by pattern key.
- Severity (echoed from the narrative).
- The `report_issue_redacted_payload` capability row, fired unconditionally so operators see the scrub summary in console regardless of match count.
- The `report_issue_default_applied` capability row when the marker drove auto-push (per step 7).
- A `Next:` block offering both paths verbatim:

```
Next:
  - Share this URL with the plugin maintainer for triage.
  - Or run /dev-process-toolkit:brainstorm <gist-url> to self-debug from the captured context.
```

The `>=100 byte` floor is the regression signal that the summary fired at all (an earlier prose form silently skipped under `-p` mode and left stdout at 1 byte). Emit the full block, do not collapse.

### 10. Cleanup

`trap` (or the equivalent `finally` block) runs `rm -rf "$TMPDIR_VAR"` on every exit path. Verify no payload artifact persists on disk after the skill exits.

## Capability rows

Three capability rows are registered in the static plain-language map at `/spec-write` § 7. They are emitted by this skill into the closing summary per the rules above:

- `report_issue_default_applied` — fires when the auto-approve marker drove the publish step.
- `report_issue_declined` — fires when the operator declined the preview gate.
- `report_issue_redacted_payload` — fires unconditionally on every successful publish so operators see the per-pattern match count without having to open `metadata.json`.

## Rules

- Do NOT shell out to `gh gist create` before the preview gate accepts.
- Do NOT skip `scrubSecrets` on any text artifact — settings files, transcript, narrative copies all pass through it.
- Do NOT write outside `mktemp -d`. The working directory is removed on every exit path.
- Do NOT invoke `git commit` from this skill; the branch-gate exemption depends on the skill not producing VCS writes (per the `NON_COMMIT_PRODUCING_SKILLS` allowlist in `adapters/_shared/src/commit_producing_skill_branch_gate.ts`, STE-228 / STE-229).
- Do NOT prompt for transcript inclusion before the preview block — the `[y/N]` transcript opt-in fires INSIDE step 7 (the preview gate), not before, so the dev sees the file list + sizes before deciding.
- The four Socratic prompts MUST be asked in canonical order, one at a time. Do not batch.

## Round-trip with `/brainstorm`

`/dev-process-toolkit:brainstorm` accepts a gist URL as its first positional argument when it matches `^https://gist\.github\.com/[^/]+/[a-f0-9]{8,}/?$`. The skill fetches each file via `gh gist view <id-or-url> --raw -f <filename>` (or `gh gist view <id-or-url>` for the full payload), treats the combined text as the brainstorm seed, and proceeds with the existing Socratic flow. The cross-skill round-trip closes the design loop in two operator gestures.
