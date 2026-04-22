import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// FR-67 AC-67.4 — doc-conformance test asserts adapters/linear.md carries
// the canonical markers so the LLM reaches for the right MCP tool and
// parameter names, and so the silent-no-op warning is co-located with the
// operation table.
//
// These assertions lock four invariants:
//   1. The adapter references `save_issue` (not the earlier-incorrect
//      `create_issue` / `update_issue` pair).
//   2. The `state:` parameter name appears — the canonical key for status
//      transitions, distinct from Linear's silent-ignore `status` and
//      `stateId` variants.
//   3. The `assignee:` parameter name appears — the canonical key for
//      ownership writes, distinct from the silent-ignore `assigneeEmail` /
//      `assigneeId` variants.
//   4. The canonical silent-no-op warning phrase is present, spelling out
//      that unknown keys silently no-op and that callers MUST verify
//      updatedAt advanced before treating the call as successful.

const pluginRoot = join(import.meta.dir, "..");
const linearDocPath = join(pluginRoot, "adapters", "linear.md");
const trackerAdaptersDocPath = join(pluginRoot, "docs", "tracker-adapters.md");

function readLinearDoc(): string {
  return readFileSync(linearDocPath, "utf8");
}

describe("FR-67 AC-67.1 — adapters/linear.md uses save_issue", () => {
  test("references save_issue", () => {
    const body = readLinearDoc();
    expect(body).toContain("save_issue");
  });

  test("no longer references the incorrect create_issue / update_issue MCP tool names", () => {
    const body = readLinearDoc();
    // Match the specific Linear MCP tool forms, not incidental English text.
    expect(body).not.toMatch(/mcp__linear__create_issue/);
    expect(body).not.toMatch(/mcp__linear__update_issue/);
  });

  test("MCP tool-names table names save_issue explicitly", () => {
    const body = readLinearDoc();
    // The table rewrite routes transition_status + upsert_ticket_metadata
    // through save_issue — sanity-check the expected rows exist.
    expect(body).toMatch(/\| `transition_status` \| `mcp__linear__save_issue`/);
    expect(body).toMatch(/\| `upsert_ticket_metadata` \| `mcp__linear__save_issue`/);
  });
});

describe("FR-67 AC-67.1 — canonical parameter names state / assignee", () => {
  test("state: parameter name is documented", () => {
    const body = readLinearDoc();
    expect(body).toContain("`state`");
    expect(body).toMatch(/accepts state type, name, or ID/);
  });

  test("assignee: parameter name is documented with accepted value forms", () => {
    const body = readLinearDoc();
    expect(body).toContain("`assignee`");
    expect(body).toMatch(/accepts user ID, name, email, or `"me"`/);
  });
});

describe("FR-67 AC-67.2 — Silent no-op trap section", () => {
  test("dedicated Silent no-op trap subsection exists", () => {
    const body = readLinearDoc();
    expect(body).toMatch(/###?\s+Silent no-op trap/i);
  });

  test("warning phrase explains save_issue silently ignores unknown keys", () => {
    const body = readLinearDoc();
    // Canonical silent-no-op warning phrase — also checked in test below
    // via a single anchor string so /gate-check drift detection is tight.
    expect(body).toMatch(/save_issue.*(silently|ignores).*unknown/is);
  });

  test("canonical caller rule names updatedAt / startedAt / completedAt verification", () => {
    const body = readLinearDoc();
    expect(body).toContain("updatedAt");
    expect(body).toContain("startedAt");
    expect(body).toContain("completedAt");
  });

  test("references TrackerWriteNoOpError as the enforcement mechanism", () => {
    const body = readLinearDoc();
    expect(body).toContain("TrackerWriteNoOpError");
  });
});

describe("FR-67 AC-67.3 — docs/tracker-adapters.md cross-references Linear guidance", () => {
  test("tracker-adapters.md points at adapters/linear.md § Silent no-op trap", () => {
    const body = readFileSync(trackerAdaptersDocPath, "utf8");
    expect(body).toContain("Silent no-op trap");
    expect(body).toContain("adapters/linear.md");
    // The cross-ref must describe the silent-no-op symptom so cross-adapter
    // readers don't have to click through just to learn why it matters.
    expect(body).toMatch(/updatedAt/);
    expect(body).toContain("TrackerWriteNoOpError");
  });
});
