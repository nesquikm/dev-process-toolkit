# Ticket Binding (Pattern 6 + STE-27)

Every skill that mutates the tracker (`/implement`, `/spec-write`, `/gate-check`,
`/pr`) resolves and **confirms** the active ticket before any side effect.
Silent mutation on a misidentified ticket is the #1 duck-council trust risk
(DD-12.10); STE-27 makes confirmation mandatory.

In `mode: none`, this entire document is unused — the pre-M12 path runs
unchanged.

## 3-Tier resolution (Pattern 6)

Tiers run in order. **First hit wins silently.** Conflicts between two tiers
fail loudly (never pick one arbitrarily).

### Tier 1 — Branch-name regex

Each adapter declares `ticket_id_regex:` in its Schema M frontmatter
(e.g., Linear: `^(?:[A-Z]{2,10})-([0-9]+)$`). The skill runs:

```bash
git rev-parse --abbrev-ref HEAD
```

and applies the adapter's regex. If the regex captures an ID, use it.

### Tier 2 — `active_ticket:` in CLAUDE.md

If Tier 1 misses (no branch name match), read `active_ticket:` from the
`## Task Tracking` section (Schema L). Blank value = unbound; move to Tier 3.

### Tier 3 — Interactive prompt

If both Tier 1 and Tier 2 miss, prompt the user:

```
No ticket ID resolvable for branch <branch> and CLAUDE.md active_ticket is unset.
Paste the ticket ID (<prefix>-<number>) or tracker URL:
```

Custom adapters whose ticket IDs don't fit a branch-name convention can set
`ticket_id_source: ticket-url-paste` in their Schema M frontmatter to route
resolution through this Tier 3 prompt directly, bypassing Tier 1.

## Conflict handling (AC-STE-27.3)

If Tier 1 captures an ID **and** Tier 2 has a different `active_ticket:`, the
skill fails loudly rather than silently picking one:

```
Ticket-binding conflict: branch <branch> resolves to <tier1-id>, but CLAUDE.md
active_ticket is <tier2-id>. Refusing to guess.
Remedy: set active_ticket: <intended> in CLAUDE.md, or rename the branch to match.
Context: mode=<mode>, ticket=unbound, skill=<skill>
```

Equal IDs between tiers is a clean hit; move to confirmation.

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

- **Tier 1 matches, Tier 2 blank** → use Tier 1; silent win (Pattern 6).
- **Tier 1 misses, Tier 2 set** → use Tier 2; silent win.
- **Tier 1 matches, Tier 2 set, equal IDs** → clean hit; silent win.
- **Tier 1 matches, Tier 2 set, different IDs** → fail loudly (AC-STE-27.3).
- **Tier 1 misses, Tier 2 blank** → prompt user (AC-STE-27.2 Tier 3).
- **Tier 3 prompt declined** → skill exits cleanly; nothing written.

## URL paste fallback (AC-STE-27.5)

When `ticket_id_source: ticket-url-paste` is declared by a custom adapter:

1. Tier 1 is effectively disabled (the tracker's IDs don't live in branch names).
2. Tier 2 still runs — if `active_ticket: <id>` is set, use it.
3. Tier 3's prompt accepts the tracker's URL form; the adapter owns the
   URL→ID extraction regex (Schema P pure helper).
4. On successful extraction, treat the resolved ID identically to any other
   tracker ID — confirmation is still mandatory (AC-STE-27.1).
