# Resolver Entry Reference (M14)

> Canonical behavior for the `resolveFRArgument` dispatch used at the entry of
> `/spec-write`, `/implement`, and `/spec-archive`. Keeps skill files under the
> NFR-1 358-line cap. See `technical-spec.md` §3 Cross-Skill Schema Definitions for the data model and
> algorithm; `docs/patterns.md` § Pattern: Tracker-ID Auto-Resolution for the
> user-facing story.

## When to run

**Every invocation of `/spec-write`, `/implement`, `/spec-archive`.**
Runs, for `/implement`, *before* `Provider.claimLock`. Free-form argument
shapes (milestone codes, task descriptions, GitHub issue numbers) route
through the `fallthrough` branch of `resolveFRArgument` per NFR-18.

## Inputs

- `arg` — the raw `$ARGUMENTS` value (ULID, tracker ID, URL, or free-form).
- `config: ResolverConfig` — built from `CLAUDE.md` `## Task Tracking` section:
  for each configured tracker, load the adapter's Schema W `resolver:` block
  (`id_pattern`, `url_host`, `url_path_regex`, plus optional `prefixes` inferred
  from `ticket_id_regex`).

## Decision table

| `kind` | Next step in `/spec-write` | Next step in `/implement` | Next step in `/spec-archive` |
|--------|----------------------------|---------------------------|------------------------------|
| `ulid` | Open the FR via `Provider.filenameFor(spec)` for editing | Proceed to `Provider.claimLock(ulid, branch)` | Archive via `git mv` + frontmatter flip |
| `tracker-id` or `url`, find-by-tracker-ref hit | Open that existing FR for editing. **No network call.** Single-pattern direct-filename lookup at `specs/frs/<tracker-id>.md` (+ `archive/` when `includeArchive`). Filename ↔ frontmatter disagreement returns null. **Mode-aware:** tracker mode uses `findFRPathByTrackerRef` (path-returning; tracker-mode FRs have no `id:` line so `findFRByTrackerRef` cannot match). `mode: none` uses `findFRByTrackerRef` (ULID-returning). | Proceed to `Provider.claimLock(<id>, branch)` on the resolved ID — tracker ID in tracker mode, ULID in `mode: none`. | Archive via `git mv` + frontmatter flip on the resolved FR (O(1) direct-filename lookup). |
| `tracker-id` or `url`, find-by-tracker-ref miss | Tracker mode: first run the § 0a ownership sequence — `decide`, then the confirmation — and only then run `importFromTracker` — mints the new FR file with tracker ACs auto-accepted (**no per-AC bidirectional prompts**). The file lands at `specs/frs/<Provider.filenameFor(spec)>`. | Tracker mode: run `decide` and the confirmation at 0.b′ (§ 0a), then `importFromTracker`, then `Provider.claimLock` on the new identity. | **Refuse** with NFR-10 shape: `"No local FR mapped to <tracker>:<id>. Archival never auto-imports. To dismiss the tracker ticket, close it in the tracker directly."` Non-zero exit, no side effects. |
| `milestone` (STE-202 AC-STE-202.3) | Free-form-argument contract — milestone code (e.g., `M13`, `M54`). | Read the milestone plan file at `specs/plan/<milestone>.md` and run the milestone-scope flow per `skills/implement/SKILL.md` § Invocation forms. | Run the milestone-group archival flow per `skills/spec-archive/SKILL.md` § Process step 3 (or the plan-only branch when the FR set is empty). |
| `fallthrough` | Handle per the free-form-argument contract (`all`, `requirements`, `technical-spec`, `testing-spec`, `plan`). Literal `FR-<N>` arguments land here. | Handle per the free-form-argument contract (GitHub issue number, task description). Literal `FR-<N>` arguments land here. Milestone codes are routed through `milestone` above (no longer fall through). | Handle per the free-form-argument contract (anchor `{#M3}`, heading text). Literal `FR-<N>` arguments land here. Milestone codes route through `milestone` above. |

## § 0a Ownership sequence (tracker mode, before `importFromTracker`)

`/spec-write` § 0a **Miss** and `/implement` 0.b′ run these steps, in order,
before any write:

1. Fetch the ticket read-only (`getJiraIssue` / `get_issue`) and save it as `<ticket.json>`.
2. Run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/ticket_ownership.ts" decide <projectRoot> <ticket.json>`.
   A refused verdict (`container`, `foreign-project`, `foreign-repo`) exits with
   zero tracker writes and zero files.
3. Print the mandatory confirmation `Operating on ticket <ID>: <title> — proceed? [y/N]`
   (`docs/ticket-binding.md` § Mandatory confirmation); anything but yes exits cleanly.
4. When the verdict is `unowned`, ask the adopt question (`Adopt <KEY>` / `Skip <KEY>`);
   Skip exits cleanly.
5. Run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/ticket_ownership.ts" confirm <projectRoot> <KEY> <ticket.json>`
   (`--adopt` after an Adopt). Only a zero exit reaches
   `importFromTracker(…, ticketImportOwnership(<projectRoot>, <ticket JSON>))`
   (or, for `/implement`, the hit path's 0.c claim). The ownership context is
   what writes this repository's `repo_tag` onto an adopted ticket, as the union
   with its current labels, on the import's own sync.

## Ambiguity & disambiguation

The resolver throws `AmbiguousArgumentError` when an argument matches the
`id_pattern` of multiple configured trackers *and* prefix-based disambiguation
cannot pick a single winner. Each skill catches this and renders per NFR-10:

```
Argument "FOO-42" is ambiguous across configured trackers (linear, jira).
Remedy: retry with the explicit <tracker>:<id> form, e.g., linear:FOO-42 or jira:FOO-42.
Context: mode=<mode>, ticket=unbound, skill=<skill-name>
```

The explicit `<tracker>:<id>` form is case-insensitive (`LINEAR:FOO-42` works)
and always wins over inference — use it as the documented escape hatch.

## Branch-name interop (/implement only)

If the branch name contains a ticket ID via the adapter's `ticket_id_regex`
AND the argument resolves to a different ticket ID, the argument wins.
Emit an NFR-10-shape warning naming both IDs; implementation proceeds on the
argument's ticket unless the user cancels the confirmation prompt.

## What the resolver never does

- **No network I/O.** Pure string parsing plus config lookup (NFR-17, NFR-19).
  Anything networked happens downstream via `Provider.getMetadata`.
- **No URL fetching.** Host allowlist + path regex only.
- **No silent winner-picking on ambiguity.** Always throws; skill surfaces the
  disambiguation remedy (NFR-20).
- **No auto-import in `/spec-archive`.** Archival requires a local FR to exist.

## Error shapes

All resolver-derived errors conform to NFR-10:

```
<one-line verdict>
Remedy: <actionable next step>
Context: mode=<mode>, ticket=<ticket-id-or-unbound>, skill=<skill-name>
```

Happy-path invocations never surface resolver output to the user — the resolver
is internal plumbing.
