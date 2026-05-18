---
name: deps
description: Manage the sibling-package dependency manifest at `specs/deps.yaml`. Add, edit, delete, list, or sync entries that feed topic-aware retrieval into /brainstorm and /spec-write via the deps-researcher fork.
argument-hint: '<subcommand> [args...]'
---

# Deps

User-invocable management surface for the sibling-package dependency manifest at `specs/deps.yaml`. The manifest catalogues sibling-directory checkouts (typical for a mobile app with internal SDKs) whose `/docs --full` Diátaxis tree should feed topic-aware retrieval into `/brainstorm` and `/spec-write` via the forked `deps-researcher` subagent.

This skill writes to `specs/deps.yaml` (and may invoke `git clone` to populate sibling-directory checkouts under `add` / `sync`). It is **commit-producing** — the normal commit-producing branch gate applies. The read-only retrieval fork (`/dev-process-toolkit:deps-research`) is the exempt sibling.

## Subcommand router

Parse `<command-args>` (substituted in as `$ARGUMENTS`) and route on the first token:

- `add` → § add
- `list` → § list
- `edit <name>` → § edit
- `delete <name>` → § delete
- `sync` → § sync

If `<command-args>` is empty or the first token is not one of the five above, refuse with the canonical NFR-10 shape:

```
deps: unknown subcommand '<token>'. Supported: add | edit | delete | list | sync.
Usage: /dev-process-toolkit:deps <subcommand> [args...]
```

Exit non-zero. Do not silently default to a subcommand — the operator must name what they want.

All five subcommands operate through the shared helpers in `adapters/_shared/src/deps_manifest.ts` (`readManifest`, `writeManifest`, `addEntry`, `removeEntry`, `findEntry`, `resolveSiblingPath`). Never author `specs/deps.yaml` YAML by hand — the helpers enforce the canonical schema and throw `DepsManifestShapeError` (NFR-10 canonical refusal) on malformed input.

## add

Socratic flow. One `AskUserQuestion` per step, wait for the answer before asking the next. Bare-prose questions are forbidden — every operator-facing prompt below MUST be an `AskUserQuestion` `tool_use`. The `Other` free-form fallback is always available.

### Step 1 — Prompt for origin

Issue `AskUserQuestion`:

- Question: `Origin of the package to add (GitHub URL or local clone path)?`
- Options: at minimum `git@github.com:<org>/<repo>.git` shape, `https://github.com/<org>/<repo>.git` shape, and `../<local-checkout>` shape as exemplar choices. `Other` is always present for free-form input.

Capture the answer as `origin`. Detect whether `origin` is a URL (`git@…:…` or `https?://…`) or a local path (anything else).

### Step 2 — Derive default name and path

Compute defaults from `origin`:

- For URLs: strip any `.git` suffix, take the path basename. Examples:
  - `git@github.com:acme/my-internal-sdk.git` → `my-internal-sdk`
  - `https://github.com/acme/shared-models.git` → `shared-models`
  - `https://github.com/acme/widgets` → `widgets`
- For local paths: take the trailing path segment (`../my-sdk` → `my-sdk`, `/Users/me/code/foo` → `foo`).

Resulting defaults: `name = <basename>`, `path = ../<basename>` (sibling-directory convention; `path` MUST start with `../` — that is the schema invariant enforced by the helpers).

### Step 3 — Confirm name and path

Issue `AskUserQuestion`:

- Question: `Confirm manifest entry name and sibling path?`
- Options: the computed `name=<default-name> path=<default-path>` pair as the default choice, plus the explicit `Other` option for operator override (e.g., when the package is checked out under a non-default sibling directory).

If the operator picks `Other`, follow up with a second `AskUserQuestion` collecting the explicit `name` and `path` values. Validate that the chosen `path` starts with `../` before continuing — if not, surface the NFR-10 canonical refusal text from `DepsManifestShapeError` (`Refusing: … must start with ../ …`) and abort.

If the chosen `name` collides with an existing manifest entry, **do not proceed to clone or validation** — short-circuit to the refusal in Step 6 below so the operator is not asked to wait on a clone whose entry will be rejected.

### Step 4 — Reconcile local checkout (clone vs. reuse vs. skip)

Resolve the absolute sibling path via `resolveSiblingPath(consumerRepoRoot, {name, path, kind: "toolkit-docs"})`. Then branch on what exists on disk:

**Case A — sibling path is missing AND origin is a URL.** Issue `AskUserQuestion`:

- Question: `Clone <origin> into <relative-path>?`
- Options: `Yes, clone now`, `No, I will clone manually before retrying`, and `Other` (free-form).

On `Yes`, shell out via `Bash` to `git clone -- "<origin>" "<relative-path>"`. **Quote both arguments and pass `--` before them** — operator-supplied origin URLs may contain shell metacharacters (`;`, backtick, `$(…)`); the `--` terminator + double-quoting prevents shell-injection and accidental flag parsing. Authentication relies on the operator's existing `git` / `gh` credentials — no token handling, no credential prompt. On clone success, emit the `deps_add_cloned` capability row in the closing summary. On clone failure (non-zero exit), surface the error, do not append the entry, and abort.

On `No`, abort without writing the manifest — the operator must clone first, then re-invoke `/deps add`.

**Case B — sibling path is missing AND origin is a local path.** No clone is possible (there is no remote to clone from). Surface a refusal naming the missing path as remedy (`clone <local-origin> to <path> manually, then re-run /deps add`) and abort.

**Case C — sibling path exists AND is a git repo whose `origin` remote matches the operator-supplied `origin`.** Auto-detected existing sibling checkout. Skip the clone and issue `AskUserQuestion` to confirm reuse:

- Question: `Existing checkout found at <relative-path> with matching origin <origin>. Record manifest entry without cloning?`
- Options: `Yes, reuse existing checkout`, `No, cancel /deps add`, and `Other`.

On `Yes`, do not clone; proceed to Step 5 with the existing checkout. (Detect git origin via `git -C <relative-path> remote get-url origin` — empty stdout or non-zero exit means "no origin remote", which counts as not-a-match.) When reusing an existing checkout, do not emit `deps_add_cloned` — that capability row is reserved for the actual clone path. The closing-summary status table records the entry's outcome column as `added, reused checkout` (table prose only — no separate capability row).

**Case D — sibling path exists but is NOT a matching git repo** (different `origin` remote, or not a repo at all). Refuse with NFR-10 shape: `Refusing: <relative-path> exists but does not match origin <origin>` / `Remedy: move the existing directory aside or pick a different path` / `Context: mode=deps-add, name=<name>`. Abort.

**Case E — sibling path exists AND origin is a local path that resolves to the same directory.** Treat as Case C confirmation (reuse without clone, no `deps_add_cloned` row).

### Step 5 — Validate Diátaxis layout

After the local checkout is in place (whether freshly cloned in Case A or reused in Case C / E), verify the package's `docs/` tree matches the `/docs --full` Diátaxis layout that `deps-researcher` will read from. Required:

1. `docs/README.md` exists (the Diátaxis index file `/docs --full` emits).
2. At least one of `docs/reference/`, `docs/explanation/`, `docs/how-to/` exists as a directory.

Use `Read` / `Glob` / `Bash` (`test -f`, `test -d`) to probe — no Write/Edit. On validation failure, emit the `deps_add_diataxis_missing` capability row in the closing summary, surface a refusal naming what is missing (`Refusing: <path>/docs/README.md not found` or `Refusing: <path>/docs/ has none of reference|explanation|how-to subdirectories`) with the remedy `run /docs --full inside <path> to generate the Diátaxis tree, then re-run /deps add`. Do not append the manifest entry.

### Step 6 — Append manifest entry

When all prior steps pass, build the entry and persist:

```ts
const entry = {
  name,
  path,           // already validated to start with `../`
  origin,         // optional but typically present from Step 1
  ref,            // optional; omit unless the operator explicitly provided one
  kind: "toolkit-docs" as const,
};
addEntry(manifest, entry);
writeManifest(specsDir, manifest);
```

`addEntry` is the single authority for the name-collision invariant — it throws `DepsManifestShapeError` (NFR-10 canonical refusal shape: `Refusing: cannot add entry \`<name>\` — name already present in manifest` / `Remedy: pick a different name, or run /deps edit <name> to update the existing entry.` / `Context: …`). The skill surfaces the thrown message **verbatim** to the operator; do not re-template. This is the canonical NFR-10 refusal hook for name collisions in `/deps add`.

### Step 7 — Commit gate

`/deps add` is commit-producing (it writes `specs/deps.yaml`). After the manifest write, trigger the universal pre-commit branch gate via `requireCommittableBranch` (`adapters/_shared/src/commit_producing_skill_branch_gate.ts`) and capture the `branch_gate_*` outcome row. Then prompt:

```
Apply commit "chore(specs): add deps entry <name>"? [y / n / edit]
```

On `y`, stage `specs/deps.yaml` and create the commit with the exact subject above (Conventional Commits scope `specs`). On `edit`, surface the suggested commit message for operator-supplied tweaks. On `n`, leave the manifest written but uncommitted (the operator can commit manually later).

### Capability rows summary (closing-summary contract)

`/deps add` MAY emit, depending on which branches fired:

- `deps_add_cloned` — Case A clone succeeded.
- `deps_add_diataxis_missing` — Step 5 validation failed (entry not appended).
- `branch_gate_*` — one of the universal pre-commit branch-gate outcomes from Step 7.

All capability tokens MUST appear as backticked literal tokens in the closing summary — `/gate-check`'s `closing_summary_capability_keys` probe greps the exact strings. Reuse-without-clone (Case C / E) is reflected in the tabular status block's outcome column, not as a separate capability row.

## list

Print a tabular summary of every manifest entry to stdout. Read-only: no prompts, no writes, no branch gate.

### Procedure

1. **Read** the manifest via `readManifest(specsDir)` (helper from `adapters/_shared/src/deps_manifest.ts`). On `DepsManifestShapeError`, surface the thrown message verbatim and abort — the schema is malformed and the operator must fix `specs/deps.yaml` by hand before retrying.
2. **Resolve** each entry's sibling path with `resolveSiblingPath(consumerRepoRoot, entry)`, then probe disk with `existsSync(absPath)`. Render the `local-status` column as the literal `present` when the path exists, `missing` otherwise. The probe is purely an `existsSync` check — no `git` introspection, no content validation (that is `/deps sync`'s concern).
3. **Render** a Markdown table with the exact column order `name | path | origin | ref | local-status`. Use the literal em-dash `—` for absent `origin` or `ref` fields (both are optional in the schema). The table is the primary stdout payload — do not wrap it in prose, do not collapse columns, do not reorder them.
4. **Empty-manifest case.** When the manifest contains zero entries (either because `specs/deps.yaml` is absent → `readManifest` returns an empty manifest, or the file exists with `deps: []`), skip the table and emit the literal line `(no manifest entries — use /deps add to register a sibling package)`. The closing-summary contract still fires with `<N> = 0`.
5. **Closing summary.** Emit the capability row `deps_list_<N>_entries` where `<N>` is the entry count (including 0). The token MUST appear as a backticked literal in the closing summary so `/gate-check`'s `closing_summary_capability_keys` probe greps it byte-for-byte. Narrative paraphrase (e.g., "listed 3 entries") is insufficient — the literal `deps_list_3_entries` token is required.

### Capability rows summary (closing-summary contract)

`/deps list` emits exactly one capability row:

- `deps_list_<N>_entries` — entry count, including 0. Fires unconditionally on every successful invocation.

No `branch_gate_*` row — `/deps list` is read-only and skips the universal pre-commit branch gate per the closing-summary contract below.

## edit

Operate on the manifest entry whose `name` matches the `<name>` positional argument parsed from `<command-args>` (i.e., the second token after `edit`). Socratic flow: one `AskUserQuestion` per step, wait for the answer before asking the next. Bare-prose questions are forbidden — every operator-facing prompt MUST be an `AskUserQuestion` `tool_use`.

### Step 1 — Resolve target entry

Read the manifest via `readManifest(specsDir)`. Look up the entry via `findEntry(manifest, name)`. If the helper returns `undefined`, surface the NFR-10 canonical refusal shape:

```
Refusing: no manifest entry named `<name>`
Remedy: pick one of: <comma-separated list of existing entry names> — or run `/dev-process-toolkit:deps add` to register it
Context: mode=deps-edit, name=<name>, manifest=specs/deps.yaml
```

Exit non-zero. Do not prompt for the field-to-change when the target is absent — the refusal is terminal.

### Step 2 — Prompt for which field to change

Issue `AskUserQuestion`:

- Question: `Which field of entry '<name>' would you like to change?`
- Options: `path` (sibling-directory path; must start with `../`), `origin` (GitHub URL or local-path source), `ref` (opaque git ref / branch / tag); `Other` is always present for free-form input but the field name MUST be one of the three canonical schema fields — anything else is rejected with NFR-10 canonical refusal (`Refusing: '<field>' is not an editable manifest field — pick one of path|origin|ref`).

Capture the answer as `field`. `name` and `kind` are immutable in this milestone — `name` is the manifest's primary key (changing it would orphan downstream references) and `kind` is fixed at `toolkit-docs`. To rename, delete + re-add.

### Step 3 — Prompt for new value

Issue a second `AskUserQuestion` whose Question text shows the current value plus a request for the new value:

- Question: `New value for '<field>' (current: '<current-value-or-—>')?`
- Options: the current value as the default-choice exemplar plus `Other` for free-form input. For `path`, include `../<entry-name>` as a sibling-default exemplar. For `origin`, include both `git@github.com:…` and `https://github.com/…` shape exemplars.

Capture the answer as `newValue`.

### Step 4 — Validate new value

Validate per the canonical schema (`adapters/_shared/src/deps_manifest.ts`):

- **`field === "path"`** — MUST start with `../` (sibling-directory invariant). A non-`../`-prefixed value fails the `writeManifest` shape check; pre-validate before the write so the operator sees a single clean refusal rather than a deep-stack `DepsManifestShapeError`. On violation, surface `Refusing: path must start with '../' (got '<newValue>')` / remedy `pick a sibling-directory path like ../<entry-name>` / context `mode=deps-edit, field=path, name=<name>`. Abort.
- **`field === "origin"`** — MUST be either a URL (`git@…:…` or `https?://…`) or a local path (anything else not starting with `git@`/`http`). Empty string clears the origin (set to `undefined`). No further structural validation — `origin` is descriptive metadata for `/deps sync`'s clone branch.
- **`field === "ref"`** — opaque string. Empty clears the ref (set to `undefined`). No structural validation — `ref` is a label the operator interprets (`main`, `v1.2.3`, a commit SHA, etc.); the manifest never resolves it.

### Step 5 — Mutate entry in place and persist

Update `entry[field] = newValue` (or `delete entry[field]` when `newValue` is empty for the optional `origin` / `ref` fields). Call `writeManifest(specsDir, manifest)` — the helper re-runs the full schema validation, so a stale local edit that bypassed Step 4 still fails closed. The local sibling checkout is **never** touched — `/deps edit` is manifest-only. If the operator changes `path` to point at a different sibling directory, they must move or re-clone the checkout manually (the existing checkout is left at its old path).

### Step 6 — Commit gate

`/deps edit` is commit-producing. Trigger the universal pre-commit branch gate via `requireCommittableBranch` and capture the `branch_gate_*` outcome row. Then prompt:

```
Apply commit "chore(specs): edit deps entry <name>"? [y / n / edit]
```

On `y`, stage `specs/deps.yaml` and create the commit with the exact subject above. On `edit`, surface the subject for operator-supplied tweaks. On `n`, leave the manifest written but uncommitted.

### Capability rows summary (closing-summary contract)

`/deps edit` emits:

- `deps_edit_<name>` — fires unconditionally on every successful edit (i.e., the write reached `writeManifest`). The byte-checkable token is the structural signal `/gate-check`'s `closing_summary_capability_keys` probe greps for; narrative paraphrase is insufficient.
- `branch_gate_*` — one of the universal pre-commit branch-gate outcomes from Step 6.

Validation refusals (Step 1 missing-name, Step 2 non-canonical field, Step 4 schema violation) abort before the write and emit no `deps_edit_<name>` row.

## delete

Operate on the manifest entry whose `name` matches the `<name>` positional argument parsed from `<command-args>` (i.e., the second token after `delete`). Socratic flow: one `AskUserQuestion`, wait for the answer.

### Step 1 — Resolve target entry

Read the manifest via `readManifest(specsDir)`. Look up via `findEntry(manifest, name)`. If `undefined`, surface the same NFR-10 canonical refusal shape as `/deps edit` Step 1, substituting `mode=deps-delete`:

```
Refusing: no manifest entry named `<name>`
Remedy: pick one of: <comma-separated list of existing entry names>
Context: mode=deps-delete, name=<name>, manifest=specs/deps.yaml
```

Exit non-zero. No confirmation prompt fires when the target is absent — the refusal is terminal.

### Step 2 — Confirmation prompt

Issue `AskUserQuestion`:

- Question: `Delete manifest entry '<name>'? The local checkout at <path> will not be touched (manifest-only deletion).`
- Options: `Yes, delete entry` (proceeds to Step 3), `No, cancel` (aborts cleanly with no write), `Other` (free-form fallback).

The question text MUST surface the entry's `path` so the operator can verify they're deleting the right entry (helpful when manifest names diverge from sibling-directory basenames).

### Step 3 — Apply or abort

On confirmation (`Yes`):

1. Call `removeEntry(manifest, name)` (idempotent — does nothing when the entry is already absent, but Step 1 guarantees presence at this point).
2. Call `writeManifest(specsDir, manifest)` to persist the shortened entry list.
3. The on-disk sibling checkout at `<path>` is **never** removed. Manifest-only deletion is the contract. Operators who want to reclaim disk space remove the checkout manually (`rm -rf ../<name>`).
4. Proceed to Step 4 (commit gate).

On decline (`No`):

1. Do not call `removeEntry` or `writeManifest`. No filesystem mutation occurs.
2. Skip the commit gate (nothing to commit).
3. Emit the `deps_delete_declined_<name>` capability row and exit cleanly.

### Step 4 — Commit gate (only on confirmation)

`/deps delete` (confirmed branch) is commit-producing. Trigger the universal pre-commit branch gate via `requireCommittableBranch` and capture the `branch_gate_*` outcome row. Then prompt:

```
Apply commit "chore(specs): delete deps entry <name>"? [y / n / edit]
```

On `y`, stage `specs/deps.yaml` and create the commit with the exact subject above. On `edit`, surface the subject for tweaks. On `n`, leave the manifest written but uncommitted.

### Capability rows summary (closing-summary contract)

`/deps delete` emits one of two mutually-exclusive rows depending on the operator's confirmation answer:

- `deps_deleted_<name>` — fires when Step 2 returned `Yes` and the `writeManifest` write completed (i.e., the entry was actually removed).
- `deps_delete_declined_<name>` — fires when Step 2 returned `No` (operator aborted the delete).

Plus, on the confirmed branch only:

- `branch_gate_*` — one of the universal pre-commit branch-gate outcomes from Step 4.

Validation refusal (Step 1 missing-name) aborts before the prompt and emits neither row — the operator gets the canonical refusal text only.

## sync

Walk every manifest entry once and reconcile local checkout presence. `/deps sync` is **clone-only** — no `git pull` / `git fetch` / auto-update. One `AskUserQuestion` per missing-with-origin entry; bare-prose questions forbidden.
**Step 1 — Read manifest.** Read via `readManifest(specsDir)`. On `DepsManifestShapeError`, surface the thrown message verbatim and abort. Empty manifest → emit `(no manifest entries — use /deps add to register a sibling package)` and skip to Step 4 (capability rows still fire with `<N> = 0`).
**Step 2 — Walk entries.** Maintain counters `cloned`, `missing_no_origin`, `ok` (initialised to zero). For each entry in declaration order, resolve the sibling path via `resolveSiblingPath(consumerRepoRoot, entry)`, probe with `existsSync(absPath)`, then branch on Step 3.
**Step 3 — Reconcile per-entry cases.**
- **Case A — present.** Increment `ok`; status `present`. Optional ref-drift warning: when `entry.ref` is set, compare `git -C <relative-path> rev-parse HEAD` against `git -C <relative-path> rev-parse <entry.ref>`. On mismatch, status `present, ref drift: HEAD=<short-sha> ref=<entry.ref>` — informational; entry still counts toward `ok`. Never auto-fix.
- **Case B — missing AND `origin` present.** Issue `AskUserQuestion` (Question: `Clone <origin> into <relative-path>?`; Options: `Yes, clone now`, `No, skip this entry`, `Other`). On `Yes`, shell out via `Bash` to `git clone -- "<origin>" "<relative-path>"` (quote both arguments and pass `--` to prevent shell-injection / accidental flag parsing on operator-supplied origins; operator's existing `git` / `gh` credentials). On clone success, validate Diátaxis layout per `/deps add` Step 5 (`<relative-path>/docs/README.md` exists AND at least one of `docs/reference/`, `docs/explanation/`, `docs/how-to/` is a dir). Success → increment `cloned`, status `cloned`. Clone failure → status `clone failed: <stderr-excerpt>`, do NOT increment. Diátaxis failure → status `cloned, Diátaxis missing`, do NOT increment. On `No` → status `missing, skipped by operator`, no counter incremented.
- **Case C — missing AND no `origin`.** No `AskUserQuestion` (cannot clone without origin). Increment `missing_no_origin`; status `missing, no origin — run /deps edit <name> to add one, then re-run /deps sync`.

**Step 4 — Status table.** Print a Markdown table with column order `name | path | status`, one row per manifest entry in declaration order, `status` carrying Step 3 outcomes verbatim.
**Step 5 — Commit gate.** `/deps sync` is commit-producing (clones land new sibling checkouts). Trigger `requireCommittableBranch` (`adapters/_shared/src/commit_producing_skill_branch_gate.ts`) and capture the `branch_gate_*` outcome row unconditionally. When ≥ 1 clone succeeded, prompt `Apply commit "chore(specs): sync deps checkouts"? [y / n / edit]`; otherwise skip the prompt (the `branch_gate_*` row still fires). All three `deps_sync_*` rows fire unconditionally with running counters substituted into `<N>` (including 0); plus the `branch_gate_*` row. Byte-checkable literals — narrative paraphrase insufficient.
- MUST emit `deps_sync_cloned_<N>` — Case B entries that completed clone + Diátaxis validation.
- MUST emit `deps_sync_missing_no_origin_<N>` — Case C entries.
- MUST emit `deps_sync_ok_<N>` — Case A entries (including `ref drift` warnings).

## Closing-summary contract

Every successful `/deps` invocation MUST emit a closing summary on the quiet path — same firing rule as `/spec-write` § 7. The summary must be ≥ 100 bytes on stdout and must include:

1. A tabular status block reflecting the subcommand's effect:
   - `add` / `edit` / `delete` → before/after row for the affected manifest entry plus the resulting `specs/deps.yaml` change line.
   - `list` → the full manifest table (or `(no deps registered)`).
   - `sync` → one row per manifest entry with the reconciled `local-status` column.
2. The capability rows the subcommand fired (one row per fired capability). Capability keys for this skill all share the `deps_*` prefix and are registered in `adapters/_shared/src/closing_summary_capability_keys.ts` under the `CANONICAL_CAPABILITY_KEYS` registry — never invent ad-hoc keys at runtime. The byte-checkable literal tokens are what `/gate-check`'s `closing_summary_capability_keys` probe greps for; narrative paraphrase is insufficient.
3. The branch-gate row from `requireCommittableBranch` (any of the `branch_gate_*` literal-token outcomes) for `add` / `edit` / `delete` / `sync` runs that committed. `list` is read-only and skips the gate.

Reference shape:

```
## /deps summary

| Subcommand | Entry name  | Outcome          |
|------------|-------------|------------------|
| add        | my-sdk      | added, cloned    |

| specs/deps.yaml | Change                     |
|-----------------|----------------------------|
| +1 entry        | name=my-sdk path=../my-sdk |

Capability rows (literal tokens, backticked):
- `deps_add_cloned`
- `branch_gate_created`

Next: Run `/dev-process-toolkit:deps list` to inspect the manifest, or `/dev-process-toolkit:deps sync` to reconcile sibling checkouts.
```

The two-table-plus-prose shape clears the byte floor naturally; do not collapse to a single line. The `Next:` line varies by subcommand — `list` recommends `add`/`sync`; `add`/`edit`/`delete` recommend `list`; `sync` recommends `list`.

## Rules

- Ask one clarifying question per turn via `AskUserQuestion`. Wait for the answer before asking the next. Bare-prose questions are forbidden.
- Never author `specs/deps.yaml` YAML by hand — always route through `readManifest` / `writeManifest` / `addEntry` / `removeEntry` helpers.
- `path` must start with `../` (sibling-directory convention). The helper enforces this; a hand-edited manifest with absolute paths fails `readManifest`.
- `kind: toolkit-docs` is the only supported entry kind in this milestone. The helper rejects other values.
- `/deps add` and `/deps sync` may invoke `git clone`. Authentication is the operator's existing `git` / `gh` credentials — no token handling, no credential prompt.
- `/deps delete` is manifest-only — the local sibling checkout is **never** removed by this skill.
- `/deps sync` is clone-only — no `git pull`, no `git fetch`, no auto-update. Operator-driven updates only.
- Closing summary is unconditional — fires even on `claude -p` quiet-mode runs.
