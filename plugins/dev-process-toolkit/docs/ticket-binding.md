# Ticket Binding (Pattern 6 + STE-27)

Every skill that mutates the tracker (`/implement`, `/spec-write`, `/gate-check`,
`/pr`) resolves and **confirms** the active ticket before any side effect.
Silent mutation on a misidentified ticket is the #1 duck-council trust risk
(DD-12.10); STE-27 makes confirmation mandatory.

In `mode: none`, this entire document is unused — the pre-M12 path runs
unchanged.

## 2-Tier resolution (Pattern 6, post-STE-62)

Tiers run in order. **First hit wins silently.** Prior to M18 STE-62 there was
a third tier that read a CLAUDE.md fallback key; the key was never wired to
code and was retired in v1.21.0 (see `CHANGELOG.md`).

### Tier 1 — Branch-name regex

Each adapter declares `ticket_id_regex:` in its Schema M frontmatter
(e.g., Linear: `^(?:[A-Z]{2,10})-([0-9]+)$`). The skill runs:

```bash
git rev-parse --abbrev-ref HEAD
```

and applies the adapter's regex. If the regex captures an ID, use it.

### Tier 2 — Interactive prompt

If Tier 1 misses, prompt the user:

```
No ticket ID resolvable for branch <branch>.
Paste the ticket ID (<prefix>-<number>) or tracker URL:
```

Custom adapters whose ticket IDs don't fit a branch-name convention can set
`ticket_id_source: ticket-url-paste` in their Schema M frontmatter to route
resolution through this Tier 2 prompt directly, bypassing Tier 1.

## Branch-regex mismatch (AC-STE-27.3)

If the branch name contains a ticket-ID-shaped token that *doesn't* match
the adapter's `ticket_id_regex` (e.g., the regex requires `STE-<N>` but the
branch is `feat/ste_99`), fail loudly rather than fall through to Tier 2
— branch-name-encoded tickets are unambiguous evidence of user intent and
silent fallthrough would surface as "wrong ticket bound" downstream.

```
Branch-regex mismatch: branch <branch> contains a ticket-shaped token that
doesn't match adapter <tracker>'s ticket_id_regex. Refusing to guess.
Remedy: rename the branch to match the adapter's regex, or pass the
ticket ID explicitly (e.g., /implement <ID>).
```

## Mandatory confirmation (AC-STE-27.1, AC-STE-27.4)

After resolving the ID, **every** mutating skill prints:

```
Operating on ticket <ID>: <title> — proceed? [y/N]
```

The skill fetches `<title>` via the active adapter's `pull_acs(ticket_id)`
(which also returns Schema O `TicketMetadata` implicitly — title is bundled).
`[y/N]` defaults to no; any answer other than `y` / `yes` / `Y` / `Yes`
exits the skill cleanly with zero side effects (AC-STE-27.4).

## Where this applies

| Skill | When binding runs | Side-effect guard |
|-------|-------------------|-------------------|
| `/implement` | Pre-flight (step 0.1, before any AC extraction) | No `pull_acs` before the user confirms. |
| `/spec-write` | Pre-flight when the user opens an FR that maps to a ticket | No `upsert_ticket_metadata` before confirm. |
| `/gate-check` | Pre-flight before the re-fetch for `updatedAt` | No `push_ac_toggle` before confirm. |
| `/pr` | Pre-flight before status transition | No `transition_status` before confirm. |

## Mismatch examples

- **Tier 1 matches** → clean hit; silent win (Pattern 6).
- **Tier 1 misses (no ticket-shaped token on the branch)** → prompt user (Tier 2).
- **Tier 1 encounters a ticket-shaped token that doesn't match the adapter's regex** → fail loudly per AC-STE-27.3 above.
- **Tier 2 prompt declined** → skill exits cleanly; nothing written.

## Mode-transition FR rename (M18 STE-60 AC-STE-60.6)

When `/setup --migrate` flips `mode:` between `none` and a tracker (or between two trackers), every active FR under `specs/frs/*.md` is re-named to the target mode's `Provider.filenameFor(spec)` in the migration commit. Archive is untouched. This is the *only* place skills rename FR files — `/spec-write`, `/implement`, and `/spec-archive` all preserve stems.

## URL paste fallback (AC-STE-27.5)

When `ticket_id_source: ticket-url-paste` is declared by a custom adapter:

1. Tier 1 is effectively disabled (the tracker's IDs don't live in branch names).
2. Tier 2's prompt accepts the tracker's URL form; the adapter owns the
   URL→ID extraction regex (Schema P pure helper).
3. On successful extraction, treat the resolved ID identically to any other
   tracker ID — confirmation is still mandatory (AC-STE-27.1).
