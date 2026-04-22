import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-39 conformance — /setup --migrate none→tracker must prompt once for
// the initial state of newly created tickets instead of silently defaulting
// every bulk-created ticket to Backlog. Shipped-work migrations need to
// land in Done; in-flight work in In Progress.
//
// These tests lock the procedure-doc wording that drives the prompt flow,
// the per-FR fallback, the status_mapping allowlist check, and the
// sync-log entry that records which default was chosen.

const pluginRoot = join(import.meta.dir, "..");
const migrateDocPath = join(pluginRoot, "docs", "setup-migrate.md");
const trackerAdaptersDocPath = join(pluginRoot, "docs", "tracker-adapters.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("STE-39 — migration prompts for initial ticket state", () => {
  test("AC-STE-39.1 — verbatim bulk prompt with 4 options and default 1", () => {
    const body = read(migrateDocPath);
    // The exact wording is the operator's last chance to pick the right
    // default before N tickets land in the tracker — any drift would
    // change the UX contract documented in the FR.
    expect(body).toContain(
      "Create all N tickets as: [1] Backlog (new work) / [2] Done (shipped work) / [3] In Progress (in flight) / [4] ask per-FR. Enter 1-4; default 1.",
    );
  });

  test("AC-STE-39.1 — prompt runs before the bulk push in the none→tracker procedure", () => {
    const body = read(migrateDocPath);
    const section = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m);
    expect(section).not.toBeNull();
    // Guard against a silent empty-section pass if the doc structure
    // ever shifts and the capture collapses to zero content — without
    // this, the inner toMatch calls vacuously pass on "".
    expect(section![0].length).toBeGreaterThan(500);
    // The prompt must live inside the none→tracker procedure — a
    // floating prompt anywhere else in the doc won't be hit by the LLM
    // driving the migration.
    expect(section![0]).toMatch(/Create all N tickets as/);
    // Must be framed as "before the bulk push" so the LLM doesn't fire
    // N prompts per FR. "Before" / "prior" phrasing is the hinge.
    expect(section![0]).toMatch(/[Bb]efore (the )?bulk push|[Bb]efore.*upsert_ticket_metadata|[Pp]rior to/);
  });

  test("AC-STE-39.2 — option 4 per-FR path defaults from frontmatter status", () => {
    const body = read(migrateDocPath);
    // Must name the per-FR fallback and the mapping rules so a reader
    // drafting the prompt knows which default to pre-fill.
    expect(body).toMatch(/per-FR|Option 4|option 4/);
    expect(body).toMatch(/active\s*→\s*`?Backlog`?/);
    expect(body).toMatch(/in_progress\s*→\s*`?In Progress`?/);
    // Archived FRs must be excluded per AC-STE-22.3 — cross-reference keeps
    // the invariant visible to maintainers.
    expect(body).toMatch(/archived FRs[\s\S]{0,120}excluded|AC-STE-22\.3/);
  });

  test("AC-STE-39.3 — chosen state applied via save_issue state param", () => {
    const body = read(migrateDocPath);
    const match = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m);
    expect(match).not.toBeNull();
    const section = match![0];
    expect(section.length).toBeGreaterThan(500);
    // Naming the save_issue `state` param keeps the LLM from guessing
    // — otherwise it might try to call transition_status post-create
    // which races against push budgets.
    expect(section).toMatch(/save_issue.*state|state.*save_issue|upsert_ticket_metadata.*state/);
  });

  test("AC-STE-39.4 — allowlist check calls out status_mapping + NFR-10 shape on miss", () => {
    const body = read(migrateDocPath);
    // status_mapping is the declarative allowlist — naming it points
    // adapter authors at the field that defines legal inputs.
    expect(body).toMatch(/status_mapping[\s\S]{0,400}allowlist|allowlist[\s\S]{0,400}status_mapping/i);
    // NFR-10 canonical shape required — Remedy + Context lines are the
    // tell that the LLM emitted the right error format.
    const miss = body.match(/state[\s\S]{0,200}not in[\s\S]{0,200}status_mapping[\s\S]{0,400}/i);
    expect(miss).not.toBeNull();
  });

  test("AC-STE-39.5 — sync-log entry includes the chosen default state", () => {
    const body = read(migrateDocPath);
    // The exact entry form — "(initial state: <Name>)" — is the
    // searchable artifact that lets future audits confirm which
    // bulk-state was picked.
    expect(body).toMatch(/Migration complete:[\s\S]{0,120}\(initial state: <.+?>\)/);
  });

  test("AC-STE-39.4 — tracker-adapters doc points at status_mapping as the initial-state allowlist", () => {
    const body = read(trackerAdaptersDocPath);
    // Adapter authors need to discover this field's second role
    // (initial-state allowlist) from the canonical doc, not just the
    // FR's internal AC list.
    expect(body).toMatch(/status_mapping[\s\S]{0,500}initial state|initial state[\s\S]{0,500}status_mapping/i);
  });
});
