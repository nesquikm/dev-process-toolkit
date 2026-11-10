// STE-733 (M_b2fdc0) — AC-STE-733.8: every refusal outside the two carve-outs
// stands, measured against v3.3.0 rather than asserted.
//
// The v3.3.0 plugin tree is extracted with `git archive` from a FIXED sha
// (never the moving HEAD ref, which would grade the new bytes against
// themselves) and the SAME legs run out of it:
//   - every twin and every KEPT leg was refused at v3.3.0 and is refused now;
//   - every permit leg was refused at v3.3.0 — so the permits are the carve-outs
//     this FR adds, and nothing else moved.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupTemps,
  commitLegs,
  PLUGIN_ROOT,
  relayLegs,
  tempDir,
  unchangedRefusalLegs,
  type Leg,
} from "./_m_b2fdc0_ste733_fixture";

/** v3.3.0 on main (the merge of PR #134, plugin.json version 3.3.0). */
const V330 = "e9d6c655";
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const T = 600_000;

let BASE_ROOT = "";

beforeAll(() => {
  const dir = tempDir("v330");
  const archive = spawnSync(
    "git",
    ["-C", REPO_ROOT, "archive", "--format=tar", V330, "plugins/dev-process-toolkit/templates", "plugins/dev-process-toolkit/adapters", "plugins/dev-process-toolkit/.claude-plugin"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (archive.status !== 0) throw new Error(`git archive ${V330} failed: ${archive.stderr?.toString() ?? ""}`);
  mkdirSync(dir, { recursive: true });
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
  if (untar.status !== 0) throw new Error(`tar -x failed: ${untar.stderr?.toString() ?? ""}`);
  BASE_ROOT = join(dir, "plugins", "dev-process-toolkit");
});
afterAll(() => cleanupTemps());

const ALL: Leg[] = [...commitLegs(), ...relayLegs(), ...unchangedRefusalLegs()];
const REFUSALS = ALL.filter((l) => l.expect === "refuse");
const PERMITS = ALL.filter((l) => l.expect === "permit");

async function refusedAt(root: string, l: Leg): Promise<boolean> {
  // A refusal leg's check passes exactly when the hook refused.
  if (l.expect === "refuse") return (await l.check(root)) === null;
  // A permit leg's check FAILS when the hook did not permit; at v3.3.0 that is a refusal.
  return (await l.check(root)) !== null;
}

describe("AC-STE-733.8 — every refusal outside the carve-outs, at v3.3.0 and now", () => {
  test("the not-plain commit twins (same-command staging, writing, alternate index) are measured here", () => {
    const plain = REFUSALS.filter((l) => l.name.startsWith("commit TWIN (plain)")).map((l) => l.name);
    expect({
      stages: plain.some((n) => n.includes("git add src/new.ts")),
      writes: plain.some((n) => /writes a code file/.test(n)),
      rewritesTracked: plain.some((n) => /rewrites a tracked code file/.test(n)),
      altIndex: plain.some((n) => n.includes("GIT_INDEX_FILE")),
      configHooksPath: plain.some((n) => n.includes("git -c core.hooksPath=")),
      configWorktree: plain.some((n) => n.includes("git -c core.worktree=")),
      configEnv: plain.some((n) => n.includes("--config-env=")),
    }).toEqual({ stages: true, writes: true, rewritesTracked: true, altIndex: true, configHooksPath: true, configWorktree: true, configEnv: true });
  });

  test("the staged relay twin is measured here", () => {
    expect(REFUSALS.some((l) => l.name === "pr TWIN (clean tree) — a staged, uncommitted change to a tracked file")).toBe(true);
  });

  test("each refused at v3.3.0 AND refused at HEAD", async () => {
    const drift: string[] = [];
    for (const l of REFUSALS) {
      const base = await refusedAt(BASE_ROOT, l);
      const now = await refusedAt(PLUGIN_ROOT, l);
      if (!base || !now) drift.push(`${l.name}: v3.3.0 refused=${base}, HEAD refused=${now}`);
    }
    expect(drift).toEqual([]);
  }, T);

  test("CONTROL — every permit leg was refused at v3.3.0 (the carve-outs are new) and permits now", async () => {
    const drift: string[] = [];
    for (const l of PERMITS) {
      const base = await refusedAt(BASE_ROOT, l);
      const now = (await l.check(PLUGIN_ROOT)) === null;
      if (!base || !now) drift.push(`${l.name}: v3.3.0 refused=${base}, HEAD permits=${now}`);
    }
    expect(drift).toEqual([]);
  }, T);
});
