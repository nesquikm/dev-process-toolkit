// Tracker → local FR importer (FR-52/FR-53 shared helper, technical-spec §9.6).
//
// Called from both `/spec-write` (no-local-FR branch of FR-52) and
// `/implement` (no-local-FR branch of FR-53). Single implementation so the
// two skills cannot drift.
//
// Order of operations (guaranteed, post-STE-76):
//   0. refuse a key a local FR already binds (STE-652) — active or archived,
//      matched by `tracker:` frontmatter whatever the filename; throws before
//      any tracker read, prompt, file write or sync
//   1. provider.getMetadata(trackerKey:trackerId) — throws on tracker error
//   2. promptMilestone() — user picks milestone
//   3. writeFile(specs/frs/<tracker-id>.md, ...) — FR file committed to disk
//   4. provider.sync(spec) — tracker notified of the new binding (if applicable)
//
// STE-76 AC-STE-76.5: the tracker path no longer mints a ULID or emits an
// `id:` frontmatter line. Tracker ID is the canonical identity in tracker
// mode; the resulting FR file frontmatter elides `id:`. `importFromTracker`
// returns the tracker ID so downstream callers (claimLock, resolver) can
// chain without a ULID round-trip.
//
// Any step 0–3 failure means no sync. Step 4 failures (sync throws)
// trigger atomic rollback — we delete the FR file so the working tree
// stays clean. Per M14 plan Phase B verify-bullet: "all error-path tests
// assert no partial file written on failure."

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acPrefix } from "./ac_prefix";
import { escapeYamlScalar } from "./fr_frontmatter";
import { stripLinearACFences } from "../../linear/src/format_description";
import type { FRSpec, Provider } from "./provider";
import { assertListingProject, classifyTicket, isOfferable, normalizeContainerItems, normalizeContainerPage } from "./container_ownership";
import { readLocalFRBindings } from "./reconcile_tracker_local";
import { readTrackerItem } from "./tracker_answer";
import { readWorkspaceBinding } from "./workspace_binding";

/**
 * STE-605 — optional ownership context. With it, a `sibling` or `container`
 * key refuses before any write, and in a shared repository an `unowned`
 * ticket is claimed: its labels are written as the union of its current
 * labels (read from `pages`, or from the one fetched `ticket`) and this
 * repository's tag, on the same sync.
 */
export interface ImportOwnershipContext {
  projectRoot: string;
  /** Parsed container page JSON (the read the ticket's labels come from). */
  pages: unknown[];
  /** One fetched ticket's raw answer (`ticketImportOwnership`), read as an item, never as a page. */
  ticket?: unknown;
}

/**
 * The ownership context for ONE fetched ticket (Jira `getJiraIssue`, Linear
 * `get_issue`) — the join path of `/implement` 0.b′ and `/spec-write` § 0a
 * (STE-606). Passing it to `importFromTracker` is what tags an ADOPTED
 * unowned ticket with this repository's `repo_tag` on the import's own sync;
 * without it the adoption is recorded locally and never on the ticket.
 */
export function ticketImportOwnership(projectRoot: string, ticket: unknown): ImportOwnershipContext {
  return { projectRoot, pages: [], ticket };
}

/** Returns the label set to write on the sync, or undefined to leave labels untouched. Throws on refusal. */
function ownershipLabels(trackerKey: string, trackerId: string, ctx: ImportOwnershipContext): string[] | undefined {
  if (trackerKey !== "jira" && trackerKey !== "linear") {
    throw new Error(`importFromTracker: tracker "${trackerKey}" has no container pages; cannot check ownership of ${trackerId}`);
  }
  const binding = readWorkspaceBinding(join(ctx.projectRoot, "CLAUDE.md"), trackerKey);
  // Strict when shared: a page lacking `labels` must refuse, never read as
  // "no labels" — the claim below writes the union, and an empty read would
  // replace the ticket's real labels with the tag alone.
  // One fetched ticket is read by the shared reader (`tracker_answer.ts`): a
  // plain or wrapped Jira answer, a Linear answer keyed by `id`. An answer in
  // no measured shape refuses before any write.
  const items: Record<string, unknown>[] = [];
  if (ctx.ticket !== undefined) {
    const read = readTrackerItem(trackerKey, ctx.ticket);
    if (!read.ok) throw new Error(`importFromTracker: the fetched ticket ${trackerId} cannot be read: ${read.reason} — refusing`);
    items.push(read.item);
  }
  const tickets = [
    ...ctx.pages.flatMap((p) => normalizeContainerPage(p, trackerKey, binding.shared)),
    ...normalizeContainerItems(items, trackerKey, binding.shared),
  ];
  // STE-653 — in a shared binding, any ticket read from another project (or
  // Linear team) refuses the whole read before any write or sync.
  try {
    assertListingProject(tickets, trackerKey, binding);
  } catch (e) {
    throw new Error(`importFromTracker: ${trackerId} — ${(e as Error).message}`);
  }
  const ticket = tickets.find((t) => t.key === trackerId);
  if (ticket === undefined) {
    if (binding.shared) {
      throw new Error(`importFromTracker: ${trackerId} is not on the pages read; its labels cannot be merged — refusing`);
    }
    return undefined;
  }
  // STE-653 — the listing's own offerable rule: a sibling, a container or a
  // closed ticket is never imported; refuse before any write or sync.
  const cls = classifyTicket(ticket, binding);
  if (!isOfferable(ticket, cls)) {
    const what = cls === "sibling" || cls === "container" ? cls : "closed";
    throw new Error(`importFromTracker: ${trackerId} is a ${what} ticket; refusing to import it`);
  }
  if (cls === "unowned" && binding.repoTag !== undefined) {
    return [...ticket.labels, binding.repoTag];
  }
  return undefined;
}

/**
 * STE-652 — refuse a key a local FR already binds. Fails OPEN on an FR whose
 * file cannot be read or whose frontmatter does not parse: such a file yields
 * no tracker ids (the shared reader's contract), so it cannot block an import
 * of a key it may not even hold; gate-check's frontmatter probes own it.
 */
function refuseIfLocallyBound(trackerId: string, specsDir: string): void {
  const hit = readLocalFRBindings(specsDir, { includeArchive: true }).find((b) => b.trackerIds.includes(trackerId));
  if (hit === undefined) return;
  if (hit.filename.startsWith("archive/")) {
    throw new Error(
      `importFromTracker: ${trackerId} is already archived at \`${join(specsDir, "frs", hit.filename)}\` — refusing to import a duplicate active FR; ` +
        `to reopen it, git mv it back to specs/frs/ and set status: active and archived_at: null, or file a new ticket.`,
    );
  }
  throw new Error(`importFromTracker: ${trackerId} is already bound by \`${join(specsDir, "frs", hit.filename)}\` — refusing to overwrite it; edit that FR (\`/spec-write ${trackerId}\`) instead.`);
}

export async function importFromTracker(
  trackerKey: string,
  trackerId: string,
  provider: Provider,
  specsDir: string,
  promptMilestone: () => Promise<string>,
  ownership?: ImportOwnershipContext,
): Promise<string> {
  // STE-652: a key a local FR already binds — active or archived, matched by
  // frontmatter whatever the filename — refuses before any tracker read,
  // prompt, ownership read or file write.
  refuseIfLocallyBound(trackerId, specsDir);
  const claimLabels = ownership === undefined ? undefined : ownershipLabels(trackerKey, trackerId, ownership);
  const metadata = await provider.getMetadata(`${trackerKey}:${trackerId}`);
  const milestone = await promptMilestone();

  // getMetadata extensions (description + acs) are adapter-supplied; the
  // base FRMetadata contract doesn't include them, so we treat the return
  // value as an untyped bag here. Adapters that don't surface these fields
  // will produce an FR with an empty body + TODO AC marker.
  const untyped = metadata as unknown as Record<string, unknown>;
  const rawDescription = typeof untyped["description"] === "string"
    ? (untyped["description"] as string)
    : "";
  const rawAcs = Array.isArray(untyped["acs"])
    ? (untyped["acs"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  // STE-211 AC-STE-211.3 / AC-STE-211.4: strip Linear-side AC-prefix
  // wrappers (backticks + legacy <issue id> XML) on import. Linear-only
  // — Jira / custom adapters' descriptions pass through unchanged.
  const stripFences = trackerKey === "linear" ? stripLinearACFences : (s: string) => s;
  const description = stripFences(rawDescription);
  const acs = rawAcs.map(stripFences);
  const createdAt = new Date().toISOString();

  const body = renderFRFile({
    title: metadata.title,
    milestone,
    trackerKey,
    trackerId,
    createdAt,
    description,
    acs,
  });

  const spec: FRSpec = {
    frontmatter: {
      title: metadata.title,
      milestone,
      status: "active",
      tracker: { [trackerKey]: trackerId },
      created_at: createdAt,
    },
    body,
    ...(claimLabels !== undefined ? { labels: claimLabels } : {}),
  };
  // M18 STE-60 AC-STE-60.3 — use Provider.filenameFor for FR creation.
  const path = join(specsDir, "frs", provider.filenameFor(spec));
  writeFileSync(path, body);

  try {
    await provider.sync(spec);
  } catch (err) {
    try {
      unlinkSync(path);
    } catch {
      // best-effort; if we can't delete it, rethrow the original sync error below
    }
    throw err;
  }
  return trackerId;
}

interface RenderParams {
  title: string;
  milestone: string;
  trackerKey: string;
  trackerId: string;
  createdAt: string;
  description: string;
  acs: string[];
}

function renderFRFile(p: RenderParams): string {
  // acPrefix in tracker mode keys off the tracker binding — no id: needed.
  const prefix = acPrefix({
    frontmatter: {
      tracker: { [p.trackerKey]: p.trackerId },
    },
    body: "",
  });
  const acsBlock = p.acs.length === 0
    ? "- TODO: AC list from tracker was empty. Add ACs here or in the tracker; FR-39 sync will reconcile.\n"
    : p.acs.map((ac, i) => `- AC-${prefix}.${i + 1}: ${ac}\n`).join("");
  return `---
title: ${escapeYamlScalar(p.title)}
milestone: ${p.milestone}
status: active
archived_at: null
tracker:
  ${p.trackerKey}: ${p.trackerId}
created_at: ${p.createdAt}
---

## Requirement

${p.description}

## Acceptance Criteria

${acsBlock}
## Technical Design

*(fill in during implementation)*

## Testing

*(fill in during implementation)*

## Notes

Imported from ${p.trackerKey}:${p.trackerId} on ${p.createdAt}.
`;
}
