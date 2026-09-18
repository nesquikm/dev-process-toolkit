// STE-117 AC-STE-117.8 — task-tracking-workspace-binding-present probe (#25).
//
// Tracker mode requires a populated `### Linear` / `### Jira` sub-section
// under `## Task Tracking`. Vacuous on mode-none. Hard-fails (severity error,
// NFR-10 canonical shape) when the sub-section is absent or any required
// field is missing/empty.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";

function makeProject(claudeMd: string | null): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ws-binding-probe-"));
  if (claudeMd !== null) writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("vacuous: mode-none / no CLAUDE.md", () => {
  test("CLAUDE.md absent → vacuous pass", async () => {
    const ctx = makeProject(null);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("section absent (mode-none canonical) → vacuous pass", async () => {
    const ctx = makeProject("# Project\n\nNo task tracking.\n");
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("explicit mode: none → vacuous pass even with section present", async () => {
    const body = ["## Task Tracking", "", "mode: none", ""].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("happy path", () => {
  test("Linear sub-section with team + project → pass", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "mcp_server: linear",
      "",
      "### Linear",
      "",
      "team: STE",
      "project: DPT — Dev Process Toolkit",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("Jira sub-section with project → pass", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: jira",
      "",
      "### Jira",
      "project: ENG",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("multi-adapter co-presence (linear active, jira binding tolerated) → pass", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT",
      "",
      "### Jira",
      "project: ENG",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("violations: tracker mode without binding", () => {
  test("Linear mode, sub-section absent → fail (NFR-10 shape)", async () => {
    const body = ["## Task Tracking", "", "mode: linear", "mcp_server: linear", ""].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(/### Linear/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toMatch(/probe=task_tracking_workspace_binding_present/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Linear mode, missing team → fail naming team", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "project: DPT",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/team/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Linear mode, missing project → fail naming project", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/project/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Linear mode, empty-string value → fail", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team:",
      "project: DPT",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/team/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Linear mode, whitespace-only value → fail", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team:    ",
      "project: DPT",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/team/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Jira mode, missing project → fail (team not required for jira)", async () => {
    const body = ["## Task Tracking", "", "mode: jira", "", "### Jira", ""].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/project/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Jira mode, sub-section absent → fail", async () => {
    const body = ["## Task Tracking", "", "mode: jira"].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/### Jira/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-139.5 — task-tracking-workspace-binding-present runs clean on this repo's baseline", () => {
  test("runTaskTrackingWorkspaceBindingPresentProbe(repoRoot) returns zero violations", async () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const report = await runTaskTrackingWorkspaceBindingPresentProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});

// ============================================================================
// STE-603 AC-STE-603.6 — probe #25 grades a shared-container declaration.
//
// Three legs, applied only when the sub-section declares a tag: (a) a reader
// refusal, (b) the stop paragraph absent / duplicated / not byte-equal to the
// render, (c) the running version below the floor. A paragraph with no
// declaration is also a violation. Graded through the module itself, imported
// AND spawned (its `import.meta.main` front door). The running version is set
// by pointing `CLAUDE_PLUGIN_ROOT` at a fixture manifest. The fixtures above
// this block are unedited; the last describe replays them against the
// pre-change probe extracted from `ac1f3cb` and demands identical violations.
// ============================================================================

import { execFileSync as ste603Exec } from "node:child_process";
import { claudeMd as ste603ClaudeMd, pluginManifest as ste603Manifest } from "./_span_fixture";
import { readWorkspaceBinding as ste603Read } from "../adapters/_shared/src/workspace_binding";
import { FIRST_GATED_DPT_VERSION as STE603_FLOOR } from "../adapters/_shared/src/dpt_version";

const ste603PluginRoot = join(import.meta.dir, "..");
const ste603RepoRoot = join(ste603PluginRoot, "..", "..");
const ste603ProbePath = join(
  ste603PluginRoot,
  "adapters",
  "_shared",
  "src",
  "task_tracking_workspace_binding_present.ts",
);
const ste603WriterPath = join(
  ste603PluginRoot,
  "adapters",
  "_shared",
  "src",
  "setup",
  "tracker_binding_write.ts",
);
const STE603_TAG = "glacy-be";
const STE603_HIGHER = (() => {
  const [a, b] = STE603_FLOOR.split(".").map(Number) as [number, number, number];
  return `${a}.${b + 1}.0`;
})();

async function ste603Render(project: string, floor: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(ste603WriterPath);
  expect(typeof mod.renderSharedTrackerSentinel).toBe("function");
  return mod.renderSharedTrackerSentinel({
    adapter: "jira",
    project,
    repoTag: STE603_TAG,
    minDptVersion: floor,
  }) as string;
}

interface Ste603Ctx {
  root: string;
  manifests: string;
}

async function ste603With<T>(body: (ctx: Ste603Ctx) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "ws-binding-ste603-"));
  const manifests = mkdtempSync(join(tmpdir(), "ws-binding-ste603-manifest-"));
  try {
    return await body({ root, manifests });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(manifests, { recursive: true, force: true });
  }
}

function ste603ManifestDir(parent: string, version: string): string {
  const dir = join(parent, `m-${version}`);
  ste603Manifest(dir, version);
  return dir;
}

/** Run the probe in-process with the running version set to `running`. */
async function ste603Probe(ctx: Ste603Ctx, running: string) {
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = ste603ManifestDir(ctx.manifests, running);
  try {
    return await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prev;
  }
}

/** Run the probe's front door with the running version set to `running`. */
async function ste603Spawn(
  ctx: Ste603Ctx,
  running: string,
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bun", "run", ste603ProbePath, ctx.root], {
    cwd: ste603PluginRoot,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ste603ManifestDir(ctx.manifests, running) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: stdout + stderr };
}

function ste603Declared(
  root: string,
  floor: string,
  paragraph: string | undefined,
  labels: string[] = [STE603_TAG],
): void {
  ste603ClaudeMd(root, {
    mode: "jira",
    project: "GF",
    defaultLabels: labels,
    repoTag: STE603_TAG,
    minDptVersion: floor,
    ...(paragraph === undefined ? {} : { paragraph }),
  });
}

describe("AC-STE-603.6 — probe #25 permits a well-formed declaration", () => {
  test("declared, paragraph byte-equal, running at the floor → zero violations (imported)", async () => {
    await ste603With(async (ctx) => {
      ste603Declared(ctx.root, STE603_FLOOR, await ste603Render("GF", STE603_FLOOR));
      expect((await ste603Probe(ctx, STE603_FLOOR)).violations).toEqual([]);
      expect((await ste603Probe(ctx, STE603_HIGHER)).violations).toEqual([]);
    });
  });

  test("declared, paragraph byte-equal, running at the floor → exit 0 (spawned)", async () => {
    await ste603With(async (ctx) => {
      ste603Declared(ctx.root, STE603_FLOOR, await ste603Render("GF", STE603_FLOOR));
      const r = await ste603Spawn(ctx, STE603_FLOOR);
      expect(r.code, r.out).toBe(0);
    });
  }, 30_000);
});

describe("AC-STE-603.6 — probe #25 forbids, one violation per leg", () => {
  test("leg (a): a reader refusal is one violation carrying the reader's own text", async () => {
    await ste603With(async (ctx) => {
      // Tag and floor well-formed, paragraph correct — only the tag's membership
      // in default_labels is wrong, so only leg (a) can fire.
      ste603Declared(ctx.root, STE603_FLOOR, await ste603Render("GF", STE603_FLOOR), ["backend"]);
      let readerText = "";
      try {
        ste603Read(join(ctx.root, "CLAUDE.md"), "jira");
      } catch (e) {
        readerText = (e as Error).message.split("\n")[0]!;
      }
      expect(readerText.length, "the fixture must make the reader refuse").toBeGreaterThan(0);
      const report = await ste603Probe(ctx, STE603_FLOOR);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(`${v.reason}\n${v.message}`).toContain(readerText);
      const spawned = await ste603Spawn(ctx, STE603_FLOOR);
      expect(spawned.code, spawned.out).not.toBe(0);
      expect(spawned.out).toContain(readerText);
    });
  }, 30_000);

  test("leg (b): the paragraph absent → one paragraph violation", async () => {
    await ste603With(async (ctx) => {
      ste603Declared(ctx.root, STE603_FLOOR, undefined);
      const report = await ste603Probe(ctx, STE603_FLOOR);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/paragraph/i);
      const spawned = await ste603Spawn(ctx, STE603_FLOOR);
      expect(spawned.code, spawned.out).not.toBe(0);
      expect(spawned.out).toMatch(/paragraph/i);
    });
  }, 30_000);

  test("leg (b): the paragraph present twice → one paragraph violation", async () => {
    await ste603With(async (ctx) => {
      const para = await ste603Render("GF", STE603_FLOOR);
      ste603Declared(ctx.root, STE603_FLOOR, `${para}\n\n${para}`);
      const report = await ste603Probe(ctx, STE603_FLOOR);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/paragraph/i);
    });
  });

  test("leg (b): the paragraph rendered for an older floor → one paragraph violation", async () => {
    await ste603With(async (ctx) => {
      ste603Declared(ctx.root, STE603_HIGHER, await ste603Render("GF", STE603_FLOOR));
      const report = await ste603Probe(ctx, STE603_HIGHER);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/paragraph/i);
    });
  });

  test("leg (c): the running version below the floor → one violation naming both versions", async () => {
    await ste603With(async (ctx) => {
      ste603Declared(ctx.root, STE603_HIGHER, await ste603Render("GF", STE603_HIGHER));
      const report = await ste603Probe(ctx, STE603_FLOOR);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.note).toContain(STE603_HIGHER);
      expect(v.note).toContain(STE603_FLOOR);
      const spawned = await ste603Spawn(ctx, STE603_FLOOR);
      expect(spawned.code, spawned.out).not.toBe(0);
      expect(spawned.out).toContain(STE603_HIGHER);
    });
  }, 30_000);

  test("a paragraph with no declaration → one paragraph violation", async () => {
    await ste603With(async (ctx) => {
      ste603ClaudeMd(ctx.root, {
        mode: "jira",
        project: "GF",
        defaultLabels: [STE603_TAG],
        paragraph: await ste603Render("GF", STE603_FLOOR),
      });
      const report = await ste603Probe(ctx, STE603_FLOOR);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/paragraph/i);
    });
  });
});

describe("AC-STE-603.6 — every pre-existing fixture yields byte-identical violations", () => {
  const FIXTURES: Record<string, string | null> = {
    "CLAUDE.md absent": null,
    "section absent": "# Project\n\nNo task tracking.\n",
    "mode none": ["## Task Tracking", "", "mode: none", ""].join("\n"),
    "linear happy": [
      "## Task Tracking",
      "",
      "mode: linear",
      "mcp_server: linear",
      "",
      "### Linear",
      "",
      "team: STE",
      "project: DPT — Dev Process Toolkit",
      "",
    ].join("\n"),
    "jira happy": ["## Task Tracking", "", "mode: jira", "", "### Jira", "project: ENG", ""].join("\n"),
    "multi-adapter": [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT",
      "",
      "### Jira",
      "project: ENG",
    ].join("\n"),
    "linear sub-section absent": ["## Task Tracking", "", "mode: linear", "mcp_server: linear", ""].join(
      "\n",
    ),
    "linear missing team": ["## Task Tracking", "", "mode: linear", "", "### Linear", "project: DPT"].join(
      "\n",
    ),
    "linear missing project": ["## Task Tracking", "", "mode: linear", "", "### Linear", "team: STE"].join(
      "\n",
    ),
    "linear empty value": [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team:",
      "project: DPT",
    ].join("\n"),
    "linear whitespace value": [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team:    ",
      "project: DPT",
    ].join("\n"),
    "jira missing project": ["## Task Tracking", "", "mode: jira", "", "### Jira", ""].join("\n"),
    "jira sub-section absent": ["## Task Tracking", "", "mode: jira"].join("\n"),
  };

  test("new probe == pre-change probe (ac1f3cb) on each fixture", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "ws-binding-ste603-old-"));
    try {
      for (const file of ["workspace_binding.ts", "task_tracking_workspace_binding_present.ts"]) {
        const src = ste603Exec(
          "git",
          [
            "-C",
            ste603RepoRoot,
            "show",
            `ac1f3cb:plugins/dev-process-toolkit/adapters/_shared/src/${file}`,
          ],
          { encoding: "utf-8" },
        );
        writeFileSync(join(scratch, file), src);
      }
      const old = await import(join(scratch, "task_tracking_workspace_binding_present.ts"));
      for (const [name, body] of Object.entries(FIXTURES)) {
        const ctx = makeProject(body);
        try {
          const before = await old.runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
          const now = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
          expect(now, name).toEqual(before);
        } finally {
          ctx.cleanup();
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
