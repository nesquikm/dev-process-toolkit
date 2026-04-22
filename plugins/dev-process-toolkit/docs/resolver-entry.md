# Resolver Entry Reference (M14)

> Canonical behavior for the `resolveFRArgument` dispatch used at the entry of
> `/spec-write`, `/implement`, and `/spec-archive`. Keeps skill files under the
> NFR-1 300-line cap. See `technical-spec.md` §9 for the data model and
> algorithm; `docs/patterns.md` § Pattern: Tracker-ID Auto-Resolution for the
> user-facing story.

## When to run

**Every v2-layout invocation of `/spec-write`, `/implement`, `/spec-archive`.**
Runs *after* the layout version gate (STE-29) and, for `/implement`, *before*
`Provider.claimLock`. In v1 projects (`specs/.dpt-layout` absent) the resolver
step is skipped entirely — pre-M14 argument handling is preserved byte-for-byte
per NFR-18.

## Inputs

- `arg` — the raw `$ARGUMENTS` value (ULID, tracker ID, URL, or free-form).
- `config: ResolverConfig` — built from `CLAUDE.md` `## Task Tracking` section:
  for each configured tracker, load the adapter's Schema W `resolver:` block
  (`id_pattern`, `url_host`, `url_path_regex`, plus optional `prefixes` inferred
  from `ticket_id_regex`).

## Decision table

| `kind` | Next step in `/spec-write` | Next step in `/implement` | Next step in `/spec-archive` |
|--------|----------------------------|---------------------------|------------------------------|
| `ulid` | Open `specs/frs/<ulid>.md` for editing (pre-M14 path) | Proceed to `Provider.claimLock(ulid, branch)` | Archive via `git mv` + frontmatter flip (pre-M14 path) |
| `tracker-id` or `url`, find-by-tracker-ref hit | Open that existing FR for editing. **No network call.** | Proceed to `Provider.claimLock(ulid, branch)` on the resolved ULID | Archive via `git mv` + frontmatter flip on the resolved ULID |
| `tracker-id` or `url`, find-by-tracker-ref miss | Run `importFromTracker` — mints ULID, writes new FR file with tracker ACs auto-accepted (**no STE-17 per-AC prompts**, AC-STE-31.5), regenerates INDEX | Run `importFromTracker` then `Provider.claimLock` on the new ULID | **Refuse** with NFR-10 shape: `"No local FR mapped to <tracker>:<id>. Archival never auto-imports. To dismiss the tracker ticket, close it in the tracker directly."` Non-zero exit, no side effects. |
| `fallthrough` | Handle per pre-M14 contract (`all`, `requirements`, `technical-spec`, `testing-spec`, `plan`). Literal `FR-<N>` arguments land here post-STE-52. | Handle per pre-M14 contract (milestone code like `M13`, GitHub issue number, task description). Literal `FR-<N>` arguments land here post-STE-52. | Handle per pre-M14 contract (anchor `{#M3}`, heading text, milestone id `M12`). Literal `FR-<N>` arguments land here post-STE-52. |

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
(STE-27) AND the argument resolves to a different ticket ID, the argument wins.
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
