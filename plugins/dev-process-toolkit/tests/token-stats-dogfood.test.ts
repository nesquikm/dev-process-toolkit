// STE-378 AC-STE-378.5 — dogfood: this repo opts in.
//
// The toolkit's own repo-root CLAUDE.md (NOT the template) carries a
// `## Token Stats` section with `enabled: true`, so the toolkit keeps
// recording + rendering its OWN token stats after default-off ships in
// STE-379. The template default stays `false`; only this repo opts in.
//
// repoRoot = two levels up from the plugin dir — computed the same way as
// m84-ste-320-code-reviewer-scope-registry.test.ts (tests/ → plugin → repo).

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readTokenStatsConfig } from "../adapters/_shared/src/token_stats_config";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

describe("AC-STE-378.5 — repo dogfoods token stats (enabled: true)", () => {
  test("readTokenStatsConfig(<repoRoot>/CLAUDE.md) returns { enabled: true }", () => {
    const cfg = readTokenStatsConfig(join(repoRoot, "CLAUDE.md"));
    expect(cfg).toEqual({ enabled: true });
  });
});
