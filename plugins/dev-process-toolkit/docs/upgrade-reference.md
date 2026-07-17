# `/upgrade` reference — the migration registry

Behavioral contract for the consumer-artifact migration registry at
`adapters/_shared/src/migrations/`, and the guide for authoring new entries.

`/dev-process-toolkit:upgrade` owns **no migration list of its own**. It walks
this registry. Adding a migration means adding a registry entry — never editing
the skill.

## Why the registry exists

Roughly half of the toolkit's convention changes heal on an idempotent `/setup`
re-run. The rest shipped forward-only: they changed what *new* projects get, and
left every already-bootstrapped tree carrying the old artifacts. Retired state
folders, orphaned marker files, dead settings entries — state that current
releases no longer read, but that nothing removes either.

The registry is the reversal. Each entry answers two questions about one piece
of legacy state: *is it here?* (`detect`) and *how do we heal it?* (`apply`, or
a documented operator flow).

## The plan-level `migration:` declaration

Every milestone plan declares its migration coverage in frontmatter. The
declaration is a plan-level `migration:` key on each `specs/plan/M<N>.md`, and it
binds that milestone plan to a registry entry by **id**:

- `migration: none` — the release touches no consumer-facing artifacts, so a
  bootstrapped tree has nothing to migrate.
- `migration: <registry entry id>` — the release retired state that an already
  bootstrapped project still carries, and the named entry is the one that heals
  it. The declared id must be a real entry in the `MIGRATIONS` list, and its
  `introduced_in` must equal the version the plan ships.

**The join is plan → entry, by id.** A plan names the entry it depends on; the
registry entry never names the plans that claim it. This direction matters for
the coverage rule below, and it is why the declaration lives on the plan rather
than in the entry module.

### The coverage rule binds plans to entries — not entries to plans

The rule the `/ship-milestone` pre-flight (`assertMigrationDeclared`) and the
`/gate-check` probe #68 (`migration_coverage`) both enforce is one-directional:
**every shipped plan from the coverage epoch onward must declare `none` or a
registry entry id**, and a declared id must resolve to an entry whose
`introduced_in` matches the shipping version. There is no reciprocal obligation
in the other direction.

That asymmetry is deliberate. A **retro-seeded entry** — one added to the
registry to heal state retired by a release that shipped *before* the registry
existed — carries an `introduced_in` older than the registry itself, and no plan
in the archive was ever written to claim it. Such an entry is **legally
unclaimed**: it heals real legacy state, but binds to no plan, and that is not a
violation. The coverage rule asks each plan to name its entry; it never asks each
entry to be named by a plan.

## Layout

| File | Role |
|---|---|
| `index.ts` | The `MigrationEntry` type, the ordered `MIGRATIONS` list, and `validateRegistry` — the load-time invariants |
| `legacy_paths.ts` | Retired-path **single source of truth** — the sole non-test composer of retired literals |
| `entries/<id>.ts` | One migration each: detector + fix |

### `legacy_paths.ts` is the only place retired literals live

It is the retired-path twin of `dpt_paths.ts`: where that module is the sole
composer of every **live** `.dpt` path, this one is the sole composer of the
**retired** strings the registry detects. Entries import from it; they never
spell a retired literal inline.

This is enforced, not merely asked for. The STE-384 path-drift gate fails the
build on any retired literal in the shipped tree, and its carve-out (M108
STE-391) exempts exactly two paths: `migrations/legacy_paths.ts` and
`skills/upgrade/SKILL.md`. An entry that re-spells a retired literal inline —
rather than importing it from `legacy_paths.ts` — still trips the gate, which is
the point: this doc does not spell one either.

Pure composition only: no I/O, no existence checks. Detectors that need the
filesystem own their own reads.

## The entry contract

```ts
export interface MigrationEntry {
  id: string;                          // unique across the registry
  introduced_in: string;               // semver: the release that made it legacy
  title: string;
  kind: "script" | "assisted";
  requires_explicit_approval?: boolean;
  detect(projectRoot: string): DetectResult;   // { applies, evidence }
  apply?(projectRoot: string): ApplyResult;    // { changed, summary }
}
```

### `introduced_in` — the release that made the state legacy

Not the release that adds the entry. `m104-legacy-state` carries `2.46.0`
because v2.46.0 is when the root state folders became legacy — even though the
entry itself ships in v2.49.0. This is what makes the ordering meaningful:
version order is the order the conventions actually changed in, so replaying it
top-to-bottom never lets an older entry undo a newer one.

It also drives the stale-plugin advisory: an install older than the newest
`introduced_in` is running code that can re-create the very state the migration
just cleaned.

### Load-time invariants

`validateRegistry` runs on module load and throws on the first violation:

- **Unique `id`s** — the id is the entry's handle in commit messages and
  summaries.
- **Ascending `introduced_in`** — enforced, not conventional. Equal versions are
  allowed (two entries can heal state retired by the same release); a descending
  pair is a bug.

A malformed `introduced_in` throws rather than sorting arbitrarily.

## Detector purity

**A detector must be pure, deterministic, synchronous, network-free, and must
never mutate anything.**

This is load-bearing, not stylistic. The detector walk runs in step 3 of the
skill — *before any approval has been asked for*. An operator who runs
`/upgrade` and declines everything must be left with a byte-identical tree. If a
detector writes, that guarantee is gone and the skill's central promise with it.

Concretely:

- **Never mutates** — no writes, no `mkdir`, no "just normalizing this while
  I'm here". Anything that writes belongs in `apply`.
- **Deterministic** — same tree in, same result out. No clocks, no randomness,
  no ordering that depends on `readdir` sequence.
- **Network-free** — no fetches, no registry lookups, no version probes. The
  filesystem under `projectRoot` is the whole world.
- **Synchronous** — the walk is a plain loop; entries are not async.

A detector that throws is a **bug, not a detection**. The skill surfaces the
throw naming the entry id and refuses the run, rather than silently treating the
entry as not-applicable — a swallowed throw would report a dirty tree clean.

### `evidence` is the operator's receipt

`DetectResult.evidence` is a list of concrete, checkable facts — the paths found,
the offending lines. It is what the detected-set table shows before asking for
anything. "applies: true" with empty evidence asks the operator to take the
migration's word for it; don't.

## Kind semantics — `script` vs `assisted`

| | `script` | `assisted` |
|---|---|---|
| Carries `apply` | yes | **no** |
| Approval | one batch approval covers all script entries | its own flow, its own commit |
| Runs | step 4 | step 5, after the script batch commits |
| Use when | the fix is a mechanical, previewable file operation | the transform needs operator judgment |

**`script`** — the fix is deterministic and the diff tells the whole story.
`apply` returns `{changed, summary}`: every path it touched, and one line for the
commit body. All four seed entries are `script`.

**`assisted`** — no `apply` exists, because no correct one *could*: the transform
needs judgment a script cannot supply. Its flow lives in skill prose and is named
in the entry's registry module. Assisted entries never join the batch commit —
they run one at a time after it, so each starts from a clean tree and lands its
own reviewable commit. (`monolith-split` is the first; its walkthrough is below.)

When the detected set is assisted-only there is no batch: step 4 is skipped
entirely rather than committing an empty change.

## Approval rails

Four guarantees, in the order an operator meets them:

1. **Clean-tree refusal** — a dirty tree makes "what did the upgrade change?"
   unanswerable, so the run refuses before touching anything.
2. **Diff preview before any approval** — one aggregated preview for the batch,
   grouped by entry id. Every changed path appears. Nothing is committed
   sight-unseen.
3. **One approval, one commit, no push** — the script entries are independent
   file operations against a tree that was clean a moment ago; per-entry commits
   would fragment one logical upgrade across N reviews. The operator pushes.
4. **Decline leaves no residue** — the tree is restored to its pre-apply state.

### `requires_explicit_approval` — the never-auto-apply rail

An entry carrying `requires_explicit_approval: true` gets **its own** prompt,
naming exactly what it rewrites, **even when the auto-approve marker
`<dpt:auto-approve>v1</dpt:auto-approve>` is present**. The marker
pre-authorizes the batch commit; it never relaxes this flag — the same principle
by which the marker is read but never relaxes a `requires-input:` gate.

Today exactly one entry carries it: `permission-shapes`, because it rewrites the
user's **security** configuration (the `permissions.allow` allowlist and MCP
server entries). Treat the flag as the general rail, not a special case for
today's single entry.

Declining a flagged entry drops that one entry from the batch and leaves the rest
intact; the run continues.

### Idempotency comes from detection

There is no state-marker file, no backup tag, no dry-run flag. Re-running on a
current tree finds an empty detected set and exits with `Nothing to do.` That is
why step 6 re-runs every applied entry's `detect` and confirms it now returns
`applies: false` — **a migration that still detects after applying is a bug in
the entry**, and the summary says so loudly rather than reporting success.

## The `monolith-split` walkthrough

The registry's first `kind: "assisted"` entry, and the worked example the
contracts above build to. `monolith-split` carries `introduced_in: 1.16.0` — the
release that retired the monolithic layout, in which every FR lived as a heading
section inside one `specs/requirements.md` and its AC state lived in a flat
`specs/plan.md` beside it. The entry carries **no `apply`**, because no correct
one could exist: deciding which of those sections still describes open work is a
judgment call about the operator's own history, not a file operation. The flow
itself is skill prose — `skills/upgrade/SKILL.md` — and this is the map of it.

Six legs, in order: **detect → backup → triage → split → freeze →
commit/advisory.** Each leg's refusal is terminal; nothing downstream runs on a
partial upstream.

### 1. detect

Fires on a conjunction: `specs/requirements.md` carries live FR-heading sections
**and** `specs/frs/` is absent or empty. The `evidence` names the FR numbers
found, which side of that conjunction it saw, and whether a flat plan is present
to reconcile AC state against. Both limbs are load-bearing — the second is what
gives the entry its re-run semantics, below.

### 2. backup

`backupSpecsTree` copies the whole `specs/` tree, nested paths included, to a
timestamped sibling directory at the project root — before the operator is
prompted for anything, and before a single byte is rewritten. The name is
collision-suffixed, so a second backup taken inside the same second appends a
counter rather than clobbering the first.

Mandatory **regardless of VCS state**, and this is the one place the registry's
"no backup tag" rule does not reach. The script batch's undo is the clean-tree
gate plus `git checkout -- .`, which reaches a tracked tree only. A git-ignored
`specs/` tree has no index entry, no diff, and no undo at all — and this flow
rewrites the operator's specs in place. A copy on disk is the only net that holds
either way, so it is never optional and never flag-gated.

### 3. triage

Dispositions are **derived, then confirmed** — never either one alone. The
entry's module parses the monolith's FR sections and the flat plan's checkbox
rows and pairs them into one `open`/`shipped` verdict per FR, with the evidence
that decided it. The flow puts that table to the operator via `AskUserQuestion`
with a **per-FR override** on every row.

There is **no silent classification**, because the pre-pivot layout is
split-brain by construction: checkbox state lives only in the plan, the AC
bullets live only in the monolith, and the two drift. The classifier is
deliberately conservative — an FR the plan never mentions reads `open` — since
burying work that cannot be proven done costs far more than carrying one
already-shipped FR through, which the operator can archive in one command.

### 4. split

Every FR confirmed open becomes a file under `specs/frs/`, written through the
canonical helpers the `/spec-write` § 0b creation path already calls — never
hand-rolled frontmatter, AC prefixes, or filenames. Identity is
**mode-dependent**: `mode: none` mints a ULID locally, while tracker mode routes
each FR through that same creation path and lets the allocator own the number,
taking **no claim on create** — claiming belongs to `/implement`, not to a
migration. Legacy dotted AC ids are re-keyed to the derived prefix rather than
carried across, and each split file keeps a one-line provenance note naming the
legacy FR number it was cut from.

### 5. freeze

The legacy requirements and plan relocate **byte-for-byte** into the specs
archive as read-only legacy documents — `git mv` when the file is tracked, a
plain filesystem move when it is not. A fresh cross-cutting `requirements.md` is
then scaffolded from the shipped `requirements.md.template` verbatim, carrying a
pointer line that names the archive the history moved to. Plan stubs are minted
for the **open-work milestones only**; a fully-shipped milestone gets none.

Freeze-everything is a **legal outcome, not an error path**. A triage that
confirms every AC really did ship freezes the whole monolith and splits nothing:
zero per-FR files, zero plan stubs, and the flow reports it as success.

### 6. commit / advisory

Which rail this leg takes turns on whether the specs tree is tracked, so the flow
establishes that with `git check-ignore` rather than inferring it from a rule
that looks close enough.

- **Tracked `specs/`** — everything the flow produced is one logical change, so
  it lands the way the script batch does: one aggregated diff preview, **one**
  approval, one commit. The operator pushes.
- **Git-ignored `specs/`** — there is no index entry to stage, so the commit leg
  is **skipped** entirely rather than asked for or committed empty, and a loud
  advisory names the offending rule and the backup directory. The advisory
  **never edits the consumer's `.gitignore`**: keeping the tree out of git was
  the operator's own decision about their own repo, and a migration is licensed
  to argue with that, not to overrule it.

### Re-running, and recovery

**Re-running is safe, and the detector is what makes it so** — the same
detection-is-idempotency rule the rest of the registry runs on, with no state
marker to consult. A second run over a split tree finds `specs/frs/` populated,
so the conjunction fails, the detector goes quiet, and the entry simply drops out
of the detected set. It stays quiet on a *half*-migrated tree too — per-FR files
already written, the monolith not yet frozen — because that tree belongs to an
operator who is mid-flow, and re-proposing a split over the flow's own output is
how one tree gets split twice.

**Recovery is restore-from-backup, then re-run.** There is deliberately no
bespoke rollback machinery: make `specs/` the backup again and the tree is a
pre-split tree — which is precisely the tree the detector fires on. So
re-running *is* the recovery path, and it re-enters at detect with the triage
table proposed fresh.

**Replace `specs/`, do not copy over it.** The restore must be
delete-then-restore:

```sh
rm -rf specs && cp -r specs-backup-<ISO-ts> specs
```

Copying the backup *over* a half-migrated `specs/` does not recover — it
silently no-ops. The backup was taken while `specs/frs/` was absent-or-empty
(that is the detector's own precondition), so it contains no `frs/` entries, and
an overlay copy only adds files: the split's `specs/frs/*.md` and the freeze's
`specs/frs/archive/legacy/` both survive it. `specs/frs/` stays non-empty, the
detector's second limb goes false, and the re-run the operator started in order
to recover prints `Nothing to do.` instead. Removing the directory first is what
makes the tree genuinely pre-split.

Any partial failure resolves the same way, which is also why the backup is
unconditional and why the closing summary names its directory verbatim whatever
the outcome: it is the operator's only restore path, and a summary that omits it
strands them.

## Authoring a new entry

1. **Add the retired literal to `legacy_paths.ts`** — if the state you are
   healing is identified by a path, folder, heading, or config shape, that string
   goes here with a doc comment naming the release that retired it and what
   superseded it. Nowhere else.

2. **Create `entries/<id>.ts`.** Export one `MigrationEntry`. Import every
   retired literal from `../legacy_paths`.

3. **Write `detect` first.** Pure, deterministic, network-free, no mutation.
   Return concrete `evidence`. Prefer a shared helper between `detect` and
   `apply` that computes *what would change* — so "did this fire?" and "what gets
   spliced?" can never disagree. (`v1_orphans.ts` does this with its line-span
   helper.)

4. **Match the exact retired shape, not an approximation.** The operator's own
   prose must survive byte-for-byte. `v1_orphans` splices its sync-log
   subsection only when the heading *and* its enclosing `##` section both match
   the shape the retired writer emitted; a same-named subsection anywhere else
   is the operator's and is left alone. An over-eager detector is worse than a
   missing one.

5. **Project replacements from the shipped templates — never invent them.**
   `permission_shapes` reads its replacement rules out of the same
   `templates/permissions.json` that `/setup` writes from, so a migrated tree
   lands on exactly the allowlist a fresh bootstrap would produce. A shape the
   template knows nothing about has no projection, and the entry says so rather
   than guessing.

6. **Pick `kind`.** Can a script produce the correct result unaided? `script`,
   and write `apply` returning `{changed, summary}`. Does it need judgment?
   `assisted`, no `apply`, and document the flow in the skill prose.

7. **Set `requires_explicit_approval: true`** if the entry rewrites security
   configuration or anything else an operator would want to approve on its own
   terms.

8. **Insert into `MIGRATIONS` in `introduced_in` order** with a trailing
   `// <version>` comment, matching the existing rows. `validateRegistry` will
   reject a descending insert at module load.

9. **Test the detector's polarity both ways.** A detector only ever run against
   a tree that has the legacy state is indistinguishable from one that returns
   `true` unconditionally. Prove it stays quiet on a current tree, and prove
   re-applying is a no-op.

### Checklist

- [ ] Retired literals live only in `legacy_paths.ts`
- [ ] `detect` is pure, deterministic, network-free, mutation-free
- [ ] `evidence` names concrete, checkable facts
- [ ] Exact-shape match — operator prose survives
- [ ] `apply` present iff `kind: "script"`
- [ ] `introduced_in` = the release that made the state legacy, inserted in order
- [ ] Detect-after-apply returns `applies: false`
- [ ] Polarity tested both ways

## See also

- `skills/upgrade/SKILL.md` — the runner and its step-by-step rails
- `docs/layout-reference.md` — the live `.dpt/` layout these migrations land on
- `docs/setup-reference.md` — the idempotent bootstrap that covers the other half
