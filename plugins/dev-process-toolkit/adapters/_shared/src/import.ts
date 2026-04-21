// Tracker → local FR importer (FR-52/FR-53 shared helper, technical-spec §9.6).
//
// Called from both `/spec-write` (no-local-FR branch of FR-52) and
// `/implement` (no-local-FR branch of FR-53). Single implementation so the
// two skills cannot drift.
//
// Order of operations (guaranteed):
//   1. provider.getMetadata(trackerKey:trackerId) — throws on tracker error
//   2. promptMilestone() — user picks milestone
//   3. provider.mintId() — ULID minted
//   4. writeFile(specs/frs/<ulid>.md, ...) — FR file committed to disk
//   5. provider.sync(spec) — tracker notified of the new binding (if applicable)
//   6. regenerateIndex(specsDir) — INDEX.md refreshed
//
// Any step 1–4 failure means no sync and no INDEX regen. Step 5 failures
// (sync throws) trigger atomic rollback — we delete the FR file so the
// working tree stays clean. Per M14 plan Phase B verify-bullet: "all
// error-path tests assert no partial file written on failure."

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { regenerateIndex } from "./index_gen";
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
  const ulid = provider.mintId();

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
    id: ulid,
    title: metadata.title,
    milestone,
    trackerKey,
    trackerId,
    createdAt,
    description,
    acs,
  });

  const path = join(specsDir, "frs", `${ulid}.md`);
  writeFileSync(path, body);

  const spec: FRSpec = {
    frontmatter: {
      id: ulid,
      title: metadata.title,
      milestone,
      status: "active",
      tracker: { [trackerKey]: trackerId },
      created_at: createdAt,
    },
    body,
  };
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
  await regenerateIndex(specsDir, { now: createdAt });
  return ulid;
}

interface RenderParams {
  id: string;
  title: string;
  milestone: string;
  trackerKey: string;
  trackerId: string;
  createdAt: string;
  description: string;
  acs: string[];
}

function renderFRFile(p: RenderParams): string {
  const acsBlock = p.acs.length === 0
    ? "- TODO: AC list from tracker was empty. Add ACs here or in the tracker; FR-39 sync will reconcile.\n"
    : p.acs.map((ac) => `- ${ac}\n`).join("");
  return `---
id: ${p.id}
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
