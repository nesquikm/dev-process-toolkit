import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// FR-61 conformance — docs/setup-migrate.md must instruct regenerateIndex
// for every migration direction that writes to specs/frs/ frontmatter.
// FR-40 AC-40.4 requires INDEX.md to be rebuilt by any skill that writes
// under specs/frs/; migration writes N frontmatter bindings, so skipping
// regen leaves a stale INDEX that fails /gate-check's v2-conformance probe.

const pluginRoot = join(import.meta.dir, "..");
const migrateDocPath = join(pluginRoot, "docs", "setup-migrate.md");

function readMigrateDoc(): string {
  return readFileSync(migrateDocPath, "utf8");
}

describe("FR-61 — migration calls regenerateIndex after frontmatter writes", () => {
  test("AC-61.1/61.4 — none→tracker procedure has a `regenerateIndex(specsDir)` step", () => {
    const body = readMigrateDoc();
    // The none→tracker section must explicitly call regenerateIndex in an
    // ordered step (before sync-log append per AC-61.4).
    const noneToTrackerMatch = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m);
    expect(noneToTrackerMatch).not.toBeNull();
    expect(noneToTrackerMatch![0]).toContain("regenerateIndex(specsDir)");
  });

  test("AC-61.2 — regenerateIndex wording names the atomicity boundary (AC-36.7)", () => {
    const body = readMigrateDoc();
    // The step must reference atomicity — failure there leaves mode line
    // unwritten, same guarantee as the rest of migration.
    expect(body).toMatch(/regenerateIndex[\s\S]{0,200}atomicity/i);
  });

  test("AC-61.5 — tracker→none procedure calls regenerateIndex", () => {
    const body = readMigrateDoc();
    const trackerToNoneMatch = body.match(/## `<tracker> → none` procedure[\s\S]*?(?=^## )/m);
    expect(trackerToNoneMatch).not.toBeNull();
    expect(trackerToNoneMatch![0]).toContain("regenerateIndex(specsDir)");
  });

  test("AC-61.5 — tracker→other procedure calls regenerateIndex", () => {
    const body = readMigrateDoc();
    const trackerToOtherMatch = body.match(/## `<tracker> → <other>` procedure[\s\S]*?(?=^## )/m);
    expect(trackerToOtherMatch).not.toBeNull();
    expect(trackerToOtherMatch![0]).toContain("regenerateIndex(specsDir)");
  });
});
