// Tracker → local FR importer (FR-52/FR-53 shared helper, technical-spec §9.6).
//
// Called from both `/spec-write` (no-local-FR branch of FR-52) and
// `/implement` (no-local-FR branch of FR-53). Single implementation so the
// two skills cannot drift.
//
// Order of operations (guaranteed, post-STE-76):
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
// Any step 1–3 failure means no sync. Step 4 failures (sync throws)
// trigger atomic rollback — we delete the FR file so the working tree
// stays clean. Per M14 plan Phase B verify-bullet: "all error-path tests
// assert no partial file written on failure."

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acPrefix } from "./ac_prefix";
import type { FRSpec, Provider } from "./provider";

export async function importFromTracker(
  trackerKey: string,
  trackerId: string,
  provider: Provider,
  specsDir: string,
  promptMilestone: () => Promise<string>,
): Promise<string> {
  const metadata = await provider.getMetadata(`${trackerKey}:${trackerId}`);
  const milestone = await promptMilestone();

  // getMetadata extensions (description + acs) are adapter-supplied; the
  // base FRMetadata contract doesn't include them, so we treat the return
  // value as an untyped bag here. Adapters that don't surface these fields
  // will produce an FR with an empty body + TODO AC marker.
  const untyped = metadata as unknown as Record<string, unknown>;
  const description = typeof untyped["description"] === "string"
    ? (untyped["description"] as string)
    : "";
  const acs = Array.isArray(untyped["acs"])
    ? (untyped["acs"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
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
title: ${p.title}
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
