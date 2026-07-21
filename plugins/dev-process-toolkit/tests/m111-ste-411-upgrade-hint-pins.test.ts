// M111 STE-411 — /upgrade Step 0: monolithic-layout hint on the never-bootstrapped path.
//
// AC map:
//   AC-STE-411.1 — `upgrade_staleness.ts` gains an `import.meta.main` CLI guard:
//                  `bun run adapters/_shared/src/upgrade_staleness.ts <projectRoot>`
//                  awaits `runUpgradeStalenessProbe` and prints `report.notes`
//                  joined by newlines — non-empty (the `monolith-split` row +
//                  LEGACY_MONOLITH_HINT) on an unmanaged monolithic tree, EMPTY
//                  on a clean managed tree, exit 0 in both cases. Spawn-tested
//                  here because the CLI is the deterministic, spawnable half.
//   AC-STE-411.2 — the ownership invariant sentence survives verbatim; the path
//                  stays terminal (the byte-pinned refusal block first line is
//                  unchanged).
//   AC-STE-411.3 — a meta-test pins that skills/upgrade/SKILL.md carries the
//                  LEGACY_MONOLITH_HINT literal byte-equal to the exported
//                  constant, plus the Step 0 CLI invocation line.
//
// The TEST file may spawn a subprocess; only the module SOURCE must stay
// spawn-free (the CLI guard runs the probe in-process).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LEGACY_MONOLITH_HINT } from "../adapters/_shared/src/upgrade_staleness";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const upgradeSkillPath = join(SKILLS_DIR, "upgrade", "SKILL.md");
const upgradeStalenessPath = join(SRC_DIR, "upgrade_staleness.ts");

const read = (path: string): string => readFileSync(path, "utf-8");

interface Fixture {
  root: string;
  cleanup: () => void;
}

/** Run the deterministic CLI against `fixtureRoot`, cwd = the plugin working root. */
function runCli(fixtureRoot: string): { stdout: string; stderr: string; exitCode: number } {
  const r = Bun.spawnSync({
    cmd: ["bun", "run", upgradeStalenessPath, fixtureRoot],
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    exitCode: r.exitCode ?? -1,
  };
}

/**
 * An UNMANAGED (never-bootstrapped) tree carrying the retired monolithic layout:
 * a hand-written `CLAUDE.md` with NO toolkit-managed section, plus a monolith
 * `specs/requirements.md` with live `### FR-N:` heading blocks and no `specs/frs/`.
 * This is exactly the shape the STE-410 monolith-split sniff fires on.
 */
function makeUnmanagedMonolithFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste-411-monolith-"));
  writeFileSync(
    join(root, "CLAUDE.md"),
    ["# My Legacy Project", "", "Hand-maintained notes; this tree was never bootstrapped.", "", "## Overview", "", "Just prose — no toolkit-managed sections here.", ""].join("\n"),
  );
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(
    join(root, "specs", "requirements.md"),
    [
      "# Requirements",
      "",
      "## 1. Overview",
      "",
      "The pre-v1.16.0 monolithic layout.",
      "",
      "### FR-1: First feature {#FR-1}",
      "",
      "Some background.",
      "",
      "- [ ] AC-1.1 — does a thing",
      "- [ ] AC-1.2 — does another thing",
      "",
      "### FR-2: Second feature {#FR-2}",
      "",
      "More background.",
      "",
      "- [ ] AC-2.1 — does yet another thing",
      "",
    ].join("\n"),
  );
  // Deliberately NO specs/frs/ — an absent frs dir is what makes monolith-split apply.
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * A clean, toolkit-managed, current tree: `CLAUDE.md` carries the `## Task
 * Tracking` managed section (so the probe walks the registry rather than the
 * unmanaged sniff), and nothing legacy is on disk. Every detector reports
 * `applies: false`, so the report's notes — and therefore the CLI's stdout — are
 * empty.
 */
function makeCleanManagedFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste-411-clean-"));
  writeFileSync(join(root, "CLAUDE.md"), "## Task Tracking\n\nmode: none\n");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC-STE-411.1 — the deterministic CLI half (spawn tests)
// ---------------------------------------------------------------------------

describe("AC-STE-411.1 — `bun run …/upgrade_staleness.ts <root>` prints report.notes", () => {
  test("unmanaged monolithic tree ⇒ the monolith-split row + LEGACY_MONOLITH_HINT, exit 0", () => {
    const fx = makeUnmanagedMonolithFixture();
    try {
      const { stdout, exitCode } = runCli(fx.root);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).not.toBe("");
      expect(stdout).toContain("monolith-split (1.16.0): ");
      expect(stdout).toContain(LEGACY_MONOLITH_HINT);
    } finally {
      fx.cleanup();
    }
  });

  test("clean managed-current tree ⇒ empty stdout, exit 0", () => {
    const fx = makeCleanManagedFixture();
    try {
      const { stdout, exitCode } = runCli(fx.root);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-411.2 + AC-STE-411.3 — the SKILL.md pins (read the file directly)
// ---------------------------------------------------------------------------

describe("AC-STE-411.3 — skills/upgrade/SKILL.md carries the shared literal + CLI invocation", () => {
  test("the SKILL embeds LEGACY_MONOLITH_HINT byte-equal to the exported constant", () => {
    expect(read(upgradeSkillPath)).toContain(LEGACY_MONOLITH_HINT);
  });

  test("Step 0 names the deterministic CLI invocation verbatim (portable ${CLAUDE_PLUGIN_ROOT}/ form per AC-STE-53)", () => {
    // The invocation must be portable — bare `bun run adapters/...` trips the
    // skill-path-portability gate (AC-STE-53.1/.3); shipped skills resolve the
    // adapters tree via ${CLAUDE_PLUGIN_ROOT}/ so the CWD need not be the plugin root.
    expect(read(upgradeSkillPath)).toContain(
      "bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/upgrade_staleness.ts",
    );
  });
});

describe("AC-STE-411.2 — the ownership invariant + terminal refusal survive verbatim", () => {
  test("the ownership invariant sentence is unchanged", () => {
    expect(read(upgradeSkillPath)).toContain("Never migrate a file the toolkit does not own.");
  });

  test("the byte-pinned refusal block first line is unchanged", () => {
    expect(read(upgradeSkillPath)).toContain(
      "Nothing to migrate: this project has never been bootstrapped (no toolkit-managed CLAUDE.md sections).",
    );
  });
});
