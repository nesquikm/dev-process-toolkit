// STE-302 AC-STE-302.6 — `mode: none` vacuous: LocalProvider callers skip
// the tracker-config loader entirely.
//
// The AC.6 contract is "pattern (b)" from the FR plan: LocalProvider does
// NOT invoke `readTrackerConfig` / `resolveStatusMapping`. The existing
// `local-no-tracker` sentinel (STE-54.5, STE-87.1, STE-101.5) is the
// carve-out — probes that would otherwise compare against a tracker
// vocabulary short-circuit BEFORE the status-mapping resolver fires.
//
// Two structural invariants make this byte-checkable:
//
//   1. `local_provider.ts` source does NOT import the loader modules.
//   2. The `local-no-tracker` sentinel string is shared between
//      `LocalProvider.getTicketStatus` and the probes that branch on it.
//
// If a future refactor accidentally wires LocalProvider into
// `resolveStatusMapping` (e.g., by threading it through the constructor
// or a helper), invariant #1 fires and forces the change to confront the
// vacuous-mode contract explicitly.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocalProvider } from "../adapters/_shared/src/local_provider";

const LOCAL_PROVIDER_SRC = join(
  import.meta.dir,
  "..",
  "adapters",
  "_shared",
  "src",
  "local_provider.ts",
);

describe("AC-STE-302.6 — mode: none vacuous (LocalProvider skips loader)", () => {
  test("local_provider.ts does not import the tracker-config loader", () => {
    const source = readFileSync(LOCAL_PROVIDER_SRC, "utf8");
    // The loader module path — relative import from `_shared/src/`.
    expect(source).not.toMatch(/from\s+["']\.\/tracker_config["']/);
    expect(source).not.toMatch(/from\s+["']\.\/resolve_status_mapping["']/);
    // Bare symbol references would also indicate accidental wiring.
    expect(source).not.toMatch(/\breadTrackerConfig\b/);
    expect(source).not.toMatch(/\bresolveStatusMapping\b/);
  });

  test("LocalProvider.getTicketStatus returns the local-no-tracker sentinel without reading tracker-config", async () => {
    // No specsDir, no adaptersDir, no tracker-config.yaml on disk — the
    // provider must answer purely from its own carve-out.
    const provider = new LocalProvider({ repoRoot: "/nonexistent/repo/path" });
    const result = await provider.getTicketStatus("STE-1");
    expect(result.status).toBe("local-no-tracker");
  });

  test("LocalProvider mode is 'none' (signals to callers that the loader is vacuous)", () => {
    const provider = new LocalProvider({ repoRoot: "/nonexistent/repo/path" });
    expect(provider.mode).toBe("none");
  });
});
