---
name: best-practices
description: Manage the project best-practices manifest at `specs/best-practices.yaml`. Add, edit, delete, or list entries cataloguing house best-practices docs with scope globs and topics that feed guidance retrieval into planning and implementation.
argument-hint: '<subcommand> [args...]'
---

# Best Practices

User-invocable management surface for the best-practices manifest at `specs/best-practices.yaml`. The manifest catalogues repo-tracked best-practices documents — each entry names a document by repo-relative `path`, with optional `scope` glob list, `topics` list, and free-form `notes` — so house rules can be retrieved by scope and topic instead of rediscovered per session (M124).

This skill writes to `specs/best-practices.yaml`. It is **commit-producing** — the normal commit-producing branch gate applies.

## Subcommand router

Parse `<command-args>` (substituted in as `$ARGUMENTS`) and route on the first token:

- `add` → § add
- `list` → § list
- `edit <name>` → § edit
- `delete <name>` → § delete

If `<command-args>` is empty or the first token is not one of the four above, refuse with the canonical NFR-10 shape:

```
best-practices: unknown subcommand '<token>'. Supported: add | edit | delete | list.
Usage: /dev-process-toolkit:best-practices <subcommand> [args...]
```

Exit non-zero. Do not silently default to a subcommand — the operator must name what they want.

All four subcommands operate through the shared helpers in `adapters/_shared/src/best_practices_manifest.ts` (`readManifest`, `writeManifest`, `addEntry`, `removeEntry`, `findEntry`). Never author `specs/best-practices.yaml` YAML by hand — the helpers enforce the canonical CLOSED schema (unknown entry keys refuse) and throw `BestPracticesManifestShapeError` (NFR-10 canonical refusal) on malformed input. The skill surfaces the thrown message **verbatim** to the operator; do not re-template.

## add

Socratic flow. One `AskUserQuestion` per step, wait for the answer before asking the next. Bare-prose questions are forbidden — every operator-facing prompt below MUST be an `AskUserQuestion` `tool_use`. The `Other` free-form fallback is always available.

### Step 1 — Prompt for document path

Issue `AskUserQuestion`:

- Question: `Repo-relative path of the best-practices document to register?`
- Options: `docs/best-practices/<topic>.md` shape and `docs/<name>.md` shape as exemplar choices. `Other` is always present for free-form input.

Capture the answer as `path`. `path` MUST be repo-relative — no absolute paths, no `..` traversal (the exact inverse of the deps manifest's sibling-only convention; the helpers enforce it). Pre-validate before continuing — on violation, surface the `BestPracticesManifestShapeError` refusal text verbatim and abort.

### Step 2 — Derive default name and confirm

Compute the default `name` from `path`: take the file basename, strip the `.md` suffix (`docs/best-practices/error-handling.md` → `error-handling`). Issue `AskUserQuestion`:

- Question: `Confirm manifest entry name?`
- Options: the computed `<default-name>` as the default choice, plus the explicit `Other` option for operator override.

If the chosen `name` collides with an existing manifest entry, **do not proceed to the optional-field prompts** — short-circuit to the refusal in Step 5 below so the operator is not asked questions whose entry will be rejected.

### Step 3 — Prompt for scope and topics

Issue `AskUserQuestion`:

- Question: `Which file scopes does this document govern (comma-separated globs, empty for repo-wide)?`
- Options: `src/**` shape and `**/*.ts` shape as exemplar choices, an explicit `Repo-wide (omit scope)` choice, and `Other`.

Then issue a second `AskUserQuestion`:

- Question: `Which topics does this document cover (comma-separated, empty to omit)?`
- Options: exemplar topic lists (e.g. `errors, logging`), an explicit `Omit topics` choice, and `Other`.

Capture the answers as the optional `scope` and `topics` string lists. Empty answers omit the field.

### Step 4 — Prompt for notes

Issue `AskUserQuestion`:

- Question: `One-line notes for this entry (empty to omit)?`
- Options: an explicit `Omit notes` choice plus `Other` for free-form input.

Capture the answer as the optional `notes` scalar.

### Step 5 — Append manifest entry

Verify the document exists on disk (`Read` / `Bash` `test -f`) — a missing `path` gets a refusal naming the file as remedy (`create <path> first, or fix the path, then re-run add`); do not append the entry. When all prior steps pass, build the entry and persist:

```ts
const entry = { name, path, scope, topics, notes }; // optional fields omitted when empty
addEntry(manifest, entry);
writeManifest(specsDir, manifest);
```

`addEntry` is the single authority for the name-collision invariant — it throws `BestPracticesManifestShapeError` on a duplicate `name`. Surface the thrown message verbatim and abort. The write path fails closed — validation refusals abort before `writeManifest`; an invalid entry is never written.

### Step 6 — Commit gate

`add` is commit-producing (it writes `specs/best-practices.yaml`). After the manifest write, trigger the universal pre-commit branch gate via `requireCommittableBranch` (`adapters/_shared/src/commit_producing_skill_branch_gate.ts`) and capture the `branch_gate_*` outcome row. Then prompt:

```
Apply commit "chore(specs): add best-practices entry <name>"? [y / n / edit]
```

On `y`, stage `specs/best-practices.yaml` and create the commit with the exact subject above (Conventional Commits scope `specs`). On `edit`, surface the suggested commit message for operator-supplied tweaks. On `n`, leave the manifest written but uncommitted (the operator can commit manually later).

## list

Print a tabular summary of every manifest entry to stdout. Read-only: no prompts, no writes, no branch gate.

### Procedure

1. **Read** the manifest via `readManifest(specsDir)` (helper from `adapters/_shared/src/best_practices_manifest.ts`). On `BestPracticesManifestShapeError`, surface the thrown message verbatim and abort — the schema is malformed and the operator must fix `specs/best-practices.yaml` by hand before retrying.
2. **Probe** each entry's document with `existsSync(join(repoRoot, entry.path))`. Render the `doc-status` column as the literal `present` when the file exists, `missing` otherwise. The probe is purely an existence check — no content validation.
3. **Render** a Markdown table with the exact column order `name | path | scope | topics | doc-status`. Use the literal em-dash `—` for absent `scope` / `topics` / `notes` fields (all optional in the schema).
4. **Empty-manifest case.** When the manifest contains zero entries (either because `specs/best-practices.yaml` is absent → `readManifest` returns an empty manifest, or the file exists with `best_practices: []`), skip the table and emit the literal line `(no manifest entries — use /best-practices add to register a document)`. The closing-summary contract still fires with `<N> = 0`.
5. **Closing summary.** Emit the capability row `best_practices_list_<N>_entries` where `<N>` is the entry count (including 0), as a backticked literal token — narrative paraphrase is insufficient.

## edit

Operate on the manifest entry whose `name` matches the `<name>` positional argument parsed from `<command-args>` (i.e., the second token after `edit`). Socratic flow: one `AskUserQuestion` per step, wait for the answer before asking the next. Bare-prose questions are forbidden — every operator-facing prompt MUST be an `AskUserQuestion` `tool_use`.

### Step 1 — Resolve target entry

Read the manifest via `readManifest(specsDir)`. Look up the entry via `findEntry(manifest, name)`. If the helper returns `undefined`, surface the NFR-10 canonical refusal shape:

```
Refusing: no manifest entry named `<name>`
Remedy: pick one of: <comma-separated list of existing entry names> — or run `/dev-process-toolkit:best-practices add` to register it
Context: mode=best-practices-edit, name=<name>, manifest=specs/best-practices.yaml
```

Exit non-zero. Do not prompt for the field-to-change when the target is absent — the refusal is terminal.

### Step 2 — Prompt for which field to change

Issue `AskUserQuestion`:

- Question: `Which field of entry '<name>' would you like to change?`
- Options: `path` (repo-relative document path), `scope` (glob list), `topics` (topic list), `notes` (free-form scalar); `Other` is always present for free-form input but the field name MUST be one of the four editable schema fields — anything else is rejected with the NFR-10 canonical refusal (`Refusing: '<field>' is not an editable manifest field — pick one of path|scope|topics|notes`).

Capture the answer as `field`. `name` is immutable — it is the manifest's primary key (changing it would orphan downstream references). To rename, delete + re-add.

### Step 3 — Prompt for new value

Issue a second `AskUserQuestion` whose Question text shows the current value plus a request for the new value:

- Question: `New value for '<field>' (current: '<current-value-or-—>')?`
- Options: the current value as the default-choice exemplar plus `Other` for free-form input. For `path`, include a `docs/best-practices/<name>.md` shape exemplar. For `scope` / `topics`, accept comma-separated lists.

Capture the answer as `newValue`.

### Step 4 — Validate new value

Validate per the canonical schema (`adapters/_shared/src/best_practices_manifest.ts`):

- **`field === "path"`** — MUST be repo-relative: no leading `/`, no `..` traversal. Pre-validate before the write so the operator sees a single clean refusal rather than a deep-stack `BestPracticesManifestShapeError`. Also verify the file exists on disk; a missing target gets a refusal naming the file as remedy.
- **`field === "scope"` / `field === "topics"`** — comma-separated string list. Empty clears the field (set to `undefined`).
- **`field === "notes"`** — opaque scalar. Empty clears the field (set to `undefined`).

### Step 5 — Mutate entry in place and persist

Update `entry[field] = newValue` (or `delete entry[field]` when `newValue` is empty for the optional `scope` / `topics` / `notes` fields). Call `writeManifest(specsDir, manifest)` — the helper re-runs the full schema validation, so a stale local edit that bypassed Step 4 still fails closed. The document on disk is **never** touched — `edit` is manifest-only.

### Step 6 — Commit gate

`edit` is commit-producing. Trigger the universal pre-commit branch gate via `requireCommittableBranch` and capture the `branch_gate_*` outcome row. Then prompt:

```
Apply commit "chore(specs): edit best-practices entry <name>"? [y / n / edit]
```

On `y`, stage `specs/best-practices.yaml` and create the commit with the exact subject above. On `edit`, surface the subject for operator-supplied tweaks. On `n`, leave the manifest written but uncommitted.

Validation refusals (Step 1 missing-name, Step 2 non-canonical field, Step 4 schema violation) abort before the write — no `best_practices_edit_<name>` capability row fires.

## delete

Operate on the manifest entry whose `name` matches the `<name>` positional argument parsed from `<command-args>` (i.e., the second token after `delete`). Socratic flow: one `AskUserQuestion`, wait for the answer.

### Step 1 — Resolve target entry

Read the manifest via `readManifest(specsDir)`. Look up via `findEntry(manifest, name)`. If `undefined`, surface the same NFR-10 canonical refusal shape as `edit` Step 1, substituting `mode=best-practices-delete`:

```
Refusing: no manifest entry named `<name>`
Remedy: pick one of: <comma-separated list of existing entry names>
Context: mode=best-practices-delete, name=<name>, manifest=specs/best-practices.yaml
```

Exit non-zero. No confirmation prompt fires when the target is absent — the refusal is terminal.

### Step 2 — Confirmation prompt

Issue `AskUserQuestion`:

- Question: `Delete manifest entry '<name>'? The document at <path> will not be touched (manifest-only deletion).`
- Options: `Yes, delete entry` (proceeds to Step 3), `No, cancel` (aborts cleanly with no write), `Other` (free-form fallback).

The question text MUST surface the entry's `path` so the operator can verify they're deleting the right entry.

### Step 3 — Apply or abort

On confirmation (`Yes`):

1. Call `removeEntry(manifest, name)` (idempotent — does nothing when the entry is already absent, but Step 1 guarantees presence at this point).
2. Call `writeManifest(specsDir, manifest)` to persist the shortened entry list.
3. The document at `<path>` is **never** removed. Manifest-only deletion is the contract.
4. Proceed to Step 4 (commit gate).

On decline (`No`): do not call `removeEntry` or `writeManifest` — no filesystem mutation occurs. Skip the commit gate (nothing to commit), emit the `best_practices_delete_declined_<name>` capability row, and exit cleanly.

### Step 4 — Commit gate (only on confirmation)

`delete` (confirmed branch) is commit-producing. Trigger the universal pre-commit branch gate via `requireCommittableBranch` and capture the `branch_gate_*` outcome row. Then prompt:

```
Apply commit "chore(specs): delete best-practices entry <name>"? [y / n / edit]
```

On `y`, stage `specs/best-practices.yaml` and create the commit with the exact subject above. On `edit`, surface the subject for tweaks. On `n`, leave the manifest written but uncommitted.

## Closing-summary contract

Every successful invocation MUST emit a closing summary on the quiet path. The status block below **supersedes** the shape this contract formerly mandated; the rows it names now ride inside the fence. For reference, that shape was ≥ 100 bytes on stdout and must include:

1. A tabular status block reflecting the subcommand's effect:
   - `add` / `edit` / `delete` → before/after row for the affected manifest entry plus the resulting `specs/best-practices.yaml` change line.
   - `list` → the full manifest table (or the empty-manifest literal line). **BOUNDED, and inside the fence.** The markdown table is superseded for the CLOSING report — it is reference material to render inline when the operator asks for the manifest, not verbatim content the report reproduces above the fence, and a header + separator + one row per entry cannot fit any budget. `list` emits a `manifest entries: <M>` `summary:` row inside the block, then **at most the first 3** entries as `first 3 of <M>` rows. The total `<M>` is always stated, so the bound is never a silent truncation — `specs/best-practices.yaml` still holds every entry. Authoring shape: `docs/stage-status-block.md` § How a stage FITS.
2. The capability rows the subcommand fired, one row per fired capability, as backticked literal tokens:
   - `best_practices_added_<name>` — `add` reached `writeManifest`.
   - `best_practices_list_<N>_entries` — `list`, entry count including 0.
   - `best_practices_edit_<name>` — `edit` reached `writeManifest`.
   - `best_practices_deleted_<name>` / `best_practices_delete_declined_<name>` — `delete`'s mutually-exclusive outcomes.
3. The branch-gate row from `requireCommittableBranch` (any of the `branch_gate_*` literal-token outcomes) for `add` / `edit` / `delete` runs that committed. `list` is read-only and skips the gate.

The `Next:` line varies by subcommand — `list` recommends `add`; `add` / `edit` / `delete` recommend `list`.

**Closing summary — the status block.** `/best-practices` closes with **exactly one** `stage-status-block` fence as the LAST thing in its report, with at most 12 lines of prose lead-in above it — the block **replaces** the narration this contract formerly mandated rather than riding beneath it. Fixed section order, the `- (none found)` fallback and the caps live in `docs/stage-status-block.md`; adoption is graded by `adapters/_shared/src/stage_block_adoption.ts`. Skip this block when the invocation body carries the driven-run marker: the orchestrator drives the next step in the same turn.

```stage-status-block
stage: best-practices   # then milestone, status, summary, gate, drive, e2e, follow_ups in fixed order — docs/stage-status-block.md
```

## Rules

- Ask one clarifying question per turn via `AskUserQuestion`. Wait for the answer before asking the next. Bare-prose questions are forbidden. See `docs/patterns.md § Pattern 26: Socratic Prompting {#pattern-socratic-prompting}` for the canonical rule and `docs/auto-mode-protocol.md § Socratic Loop Contract` for the full contract.
- Never author `specs/best-practices.yaml` YAML by hand — always route through the `readManifest` / `writeManifest` / `addEntry` / `removeEntry` helpers.
- `path` is repo-relative — no absolute paths, no `..` traversal (the inverse of the deps manifest's sibling-only convention). The helpers enforce this; a hand-edited manifest with traversing paths fails `readManifest`.
- The schema is CLOSED — unknown entry keys refuse. Surface every `BestPracticesManifestShapeError` verbatim; do not re-template (NFR-10).
- The write path fails closed — validation refusals abort before `writeManifest`; an invalid entry is never written.
- `delete` and `edit` are manifest-only — the referenced document is **never** created, moved, or removed by this skill.
- Closing summary is unconditional — fires even on `claude -p` quiet-mode runs.
