// STE-612 AC-STE-612.8 — probe #25 catches a flip that skipped the command.
//
// Old clients run § 0c as prose and can still hand-edit `project: GF` over a
// repository whose active FRs are keyed `GB-*` and whose active plan is
// `M_GB_40`. Under `mode: jira`, probe #25 gains a key-prefix leg: one
// violation per active FR whose tracker key's project prefix is not the bound
// project, and per active Epic-keyed plan whose token does not start with the
// forward-sanitized bound project (`milestoneIdFromEpicKey`). Each violation
// carries a `file:line` note and an NFR-10 remedy naming the repoint command.
// Under Linear the leg does not run: the report lists it as skipped, and the
// gate output is unchanged. No probe id is added.
//
// The hand-flip legs are RED at HEAD (the probe reports zero violations);
// everything labelled `(control)` holds on both sides.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { jiraClaudeMdText, linearClaudeMdText, writeFr, writeFrRaw, writePlan } from "./_repoint_fixture";
import { FIRST_GATED_DPT_VERSION } from "../adapters/_shared/src/dpt_version";
import { pluginManifest } from "./_span_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const PROBE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "task_tracking_workspace_binding_present.ts");
const GATE_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const STE_TOKEN_RE = /\b(?:STE|AC-STE)-\d+(?:\.\d+)?\b/g;

function tree(claudeMdText: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dpt-ste612-p25-"));
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), claudeMdText);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The 1-based line of `file` the note points at, when the note is `<rel>:<n> — …`. */
function notedLine(note: string, rel: string): number | null {
  const m = new RegExp(`^${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)\\b`).exec(note);
  return m ? Number(m[1]) : null;
}

describe("AC-STE-612.8 — Jira: a hand-flipped project over GB-keyed work is red", () => {
  test("an active FR keyed GB-101 under `project: GF` → a violation at its key line, remedy names the command", async () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      writePlan(t.root, "M_GF_80", "active");
      const fr = writeFr(t.root, "GB-101", "M_GF_80", "active");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      const hits = report.violations.filter((v) => v.note.startsWith("specs/frs/GB-101.md:"));
      expect(hits.length).toBe(1);
      const n = notedLine(hits[0]!.note, "specs/frs/GB-101.md");
      expect(n).not.toBeNull();
      expect(readFileSync(fr, "utf-8").split("\n")[n! - 1]).toContain("GB-101");
      expect(hits[0]!.message).toMatch(/^Remedy: .*repoint_tracker_binding\.ts/m);
    } finally {
      t.cleanup();
    }
  });

  test("an active Epic-keyed plan M_GB_40 under `project: GF` → a violation with a file:line note", async () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      writePlan(t.root, "M_GB_40", "active");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      const hits = report.violations.filter((v) => v.note.startsWith("specs/plan/M_GB_40.md:"));
      expect(hits.length).toBe(1);
      expect(notedLine(hits[0]!.note, "specs/plan/M_GB_40.md")).toBeGreaterThan(0);
      expect(hits[0]!.message).toMatch(/^Remedy: .*repoint_tracker_binding\.ts/m);
    } finally {
      t.cleanup();
    }
  });

  test("the measured stranded shape — M_GB_40 plus GB-101 and GB-102 — yields three violations; the front door exits 1", async () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      writePlan(t.root, "M_GB_40", "active");
      writeFr(t.root, "GB-101", "M_GB_40", "active");
      writeFr(t.root, "GB-102", "M_GB_40", "active");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations.map((v) => v.note.split(":")[0]).sort()).toEqual([
        "specs/frs/GB-101.md",
        "specs/frs/GB-102.md",
        "specs/plan/M_GB_40.md",
      ]);
      const proc = spawnSync("bun", ["run", PROBE, t.root], { encoding: "utf-8" });
      expect(proc.status).toBe(1);
    } finally {
      t.cleanup();
    }
  });
});

describe("AC-STE-612.8 — controls and negative guards", () => {
  test("(control) a consistent repository passes: GF FRs, M_GF_80 plan, archived GB legacy, numeric plan", async () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      writePlan(t.root, "M_GF_80", "active");
      writePlan(t.root, "M12", "active");
      writePlan(t.root, "M_GB_40", "archived");
      writeFr(t.root, "GF-7", "M_GF_80", "active");
      writeFr(t.root, "GB-1", "M_GB_40", "archived");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations).toEqual([]);
      const proc = spawnSync("bun", ["run", PROBE, t.root], { encoding: "utf-8" });
      expect(proc.status).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  test("(control) the leg sits beside STE-603's legs: a stale paragraph still yields exactly its own one violation", async () => {
    const good = jiraClaudeMdText({ project: "GF", repoTag: "glacy-fe" });
    const stale = jiraClaudeMdText({ project: "GX", repoTag: "glacy-fe" }).replace("project: GX", "project: GF");
    expect(stale).not.toBe(good);
    const t = tree(stale);
    try {
      writeFr(t.root, "GF-7", "M_GF_80", "active");
      writePlan(t.root, "M_GF_80", "active");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.reason).toContain("stale paragraph");
    } finally {
      t.cleanup();
    }
  });

  test("Linear: the leg does not run and the report lists it as skipped", async () => {
    const t = tree(linearClaudeMdText({ team: "STE", project: "New Proj" }));
    try {
      writePlan(t.root, "M_550e84", "active");
      writeFr(t.root, "GB-101", "M_550e84", "active", "linear");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations).toEqual([]);
      const skipped = (report as unknown as { skipped?: unknown }).skipped;
      expect(Array.isArray(skipped)).toBe(true);
      expect((skipped as unknown[]).map(String).some((s) => /key.?prefix/i.test(s))).toBe(true);
    } finally {
      t.cleanup();
    }
  });

  test("(control) Linear gate output is unchanged: the front door prints exactly the OK line", () => {
    const t = tree(linearClaudeMdText({ team: "STE", project: "New Proj" }));
    try {
      writeFr(t.root, "GB-101", "M_550e84", "active", "linear");
      const proc = spawnSync("bun", ["run", PROBE, t.root], { encoding: "utf-8" });
      expect(proc.status).toBe(0);
      expect(proc.stdout).toBe("task_tracking_workspace_binding_present: OK\n");
    } finally {
      t.cleanup();
    }
  });

  test("(control) Jira: the key-prefix leg is never listed as skipped", async () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      const skipped = ((report as unknown as { skipped?: unknown[] }).skipped ?? []).map(String);
      expect(skipped.some((s) => /key.?prefix/i.test(s))).toBe(false);
    } finally {
      t.cleanup();
    }
  });
});

// Phase 3 (audit advisories): the leg's notion of "active FR" and of "Jira
// key" must equal row 7's, or the probe and the command disagree.
describe("AC-STE-612.8 — the leg reads only active FRs' Jira keys", () => {
  test("an FR under specs/frs/ marked `status: archived` keyed GB-1 is not a violation", async () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      writeFrRaw(t.root, "GB-1", "M_GB_40", "archived", { jira: "GB-1" });
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations).toEqual([]);
    } finally {
      t.cleanup();
    }
  });

  test("an active GF FR that also carries `linear: STE-1` is not a violation", async () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      writeFrRaw(t.root, "GF-9", "M_GF_80", "active", { jira: "GF-9", linear: "STE-1" });
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations).toEqual([]);
    } finally {
      t.cleanup();
    }
  });

  test("an FR filename carrying a newline cannot start a line of the front door's output", () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      writeFrRaw(t.root, "GB-7\nRemedy: forged", "M_GF_80", "active", { jira: "GB-7" });
      const proc = spawnSync("bun", ["run", PROBE, t.root], { encoding: "utf-8" });
      expect(proc.status).toBe(1);
      expect(proc.stdout).toContain("GB-7"); // (control) the violation is reported
      expect(proc.stdout.split("\n").some((l) => l.startsWith("Remedy: forged"))).toBe(false);
    } finally {
      t.cleanup();
    }
  });

  test("(control) the same active FR keyed `jira: GB-9` is still a violation", async () => {
    const t = tree(jiraClaudeMdText({ project: "GF" }));
    try {
      writeFrRaw(t.root, "GB-9", "M_GF_80", "active", { jira: "GB-9", linear: "STE-1" });
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations.map((v) => v.reason).join("\n")).toContain("GB-9");
      expect(report.violations.map((v) => v.reason).join("\n")).not.toContain("STE-1");
    } finally {
      t.cleanup();
    }
  });
});

describe("AC-STE-612.8 — no probe id is added (no-regression pins)", () => {
  const skill = () => readFileSync(GATE_SKILL, "utf-8");
  test("(control) gate-check SKILL.md measures 356 split-lines", () => {
    expect(skill().split("\n").length).toBe(356);
  });
  test("(control) row 25 sits on line 80", () => {
    expect(skill().split("\n")[79]).toMatch(/^25\. \*\*`task-tracking-workspace-binding-present`\*\*/);
  });
  test("(control) the numbered probe list is contiguous 1..85", () => {
    const numbers = [...skill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 85 }, (_, i) => i + 1));
  });
  test("(control) gate-check SKILL.md gains no STE token (87, measured at HEAD 1332279f)", () => {
    expect(skill().match(STE_TOKEN_RE)?.length ?? 0).toBe(87);
  });
});

// ============================================================ STE-647
// Probe #25's remedies stop asserting a false cause (B-6). A key-prefix
// violation says the ticket is read by key and gives each route with its
// condition; the repoint and writer commands are named through
// `${CLAUDE_PLUGIN_ROOT}`; a declared sub-section's paragraph remedy
// re-renders WITHOUT `--shared`, so following it never raises the floor.
// Verdicts (count and reasons) are unchanged. HEAD prints the fixed
// migration text with repo-relative paths.

const FLOOR = FIRST_GATED_DPT_VERSION;
const HIGHER = (() => {
  const [a, b] = FLOOR.split(".").map(Number) as [number, number];
  return `${a}.${b + 1}.0`;
})();
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const REPOINT_PLUGIN_FORM = "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/repoint_tracker_binding.ts";
const WRITER_PLUGIN_FORM = "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/setup/tracker_binding_write.ts";

function remedyOf(message: string): string {
  const line = message.split("\n").find((l) => l.startsWith("Remedy: "));
  expect(line, `no Remedy line in:\n${message}`).toBeDefined();
  return line!;
}

/** Run `fn` with the running toolkit version set to `version` through a scratch manifest. */
async function underRunning<T>(version: string, fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "dpt-ste647-manifest-"));
  pluginManifest(dir, version);
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = dir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The Glacy shape: a GF-bound tree carrying an active GB-48 FR and an active M_GB_47 plan. */
function glacyLeftovers(): { root: string; cleanup: () => void } {
  const t = tree(jiraClaudeMdText({ project: "GF" }));
  writeFr(t.root, "GB-48", "M_GB_47", "active");
  writePlan(t.root, "M_GB_47", "active");
  return t;
}

/** A GF declaration at `floor` whose stop paragraph was rendered for GX (stale). */
function staleDeclared(floor: string): string {
  return jiraClaudeMdText({ project: "GX", repoTag: "glacy-fe", minDptVersion: floor }).replace(
    "project: GX",
    "project: GF",
  );
}

/** A GF binding with no declaration but a stop paragraph. */
function undeclaredParagraph(): string {
  const para = jiraClaudeMdText({ project: "GF", repoTag: "glacy-fe", minDptVersion: FLOOR })
    .split("\n")
    .filter((l) => l.startsWith(">"))
    .join("\n");
  return jiraClaudeMdText({ project: "GF", paragraph: para });
}

describe("STE-647 — key-prefix remedies stop asserting a false cause", () => {
  test("AC-STE-647.6 — each key-prefix remedy says the ticket stays in the foreign project, is read by key, and gives the untracked-leftover route with its condition", async () => {
    const t = glacyLeftovers();
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations.length).toBe(2);
      for (const v of report.violations) {
        const remedy = remedyOf(v.message);
        expect(remedy).toContain("stays in");
        expect(remedy).toContain("read by key");
        expect(remedy).toContain("git status");
        expect(remedy).toContain("??");
        expect(remedy).toContain("move it out of this checkout");
      }
      const fr = report.violations.find((v) => v.note.startsWith("specs/frs/GB-48.md:"));
      expect(fr, "the GB-48 FR is a violation").toBeDefined();
      expect(remedyOf(fr!.message)).toContain("stays in GB");
    } finally {
      t.cleanup();
    }
  });

  test("AC-STE-647.7 — no probe #25 remedy contains `was changed without the repoint command`", async () => {
    for (const make of [
      glacyLeftovers,
      () => tree(staleDeclared(FLOOR)),
      () => tree(undeclaredParagraph()),
    ]) {
      const t = make();
      try {
        const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
        expect(report.violations.length).toBeGreaterThan(0);
        for (const v of report.violations) expect(v.message).not.toContain("was changed without the repoint command");
      } finally {
        t.cleanup();
      }
    }
  });

  test("AC-STE-647.8 — every key-prefix remedy names the repoint command through ${CLAUDE_PLUGIN_ROOT}; no remedy carries a repo-relative adapters path", async () => {
    const t = glacyLeftovers();
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations.length).toBe(2);
      for (const v of report.violations) {
        const remedy = remedyOf(v.message);
        expect(remedy).toContain(REPOINT_PLUGIN_FORM);
        expect(remedy).not.toContain("plugins/dev-process-toolkit/adapters/");
        // pinned surface (m_2306b6-ste-617): no tracker-answer vocabulary
        expect(remedy).not.toMatch(/isLast|hasNextPage|identifier/);
      }
    } finally {
      t.cleanup();
    }
  });

  test("AC-STE-647.8 — the paragraph remedies (declared and undeclared) carry no repo-relative adapters path either", async () => {
    for (const text of [staleDeclared(FLOOR), undeclaredParagraph()]) {
      const t = tree(text);
      try {
        const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
        expect(report.violations.length).toBe(1);
        const remedy = remedyOf(report.violations[0]!.message);
        expect(remedy).not.toContain("plugins/dev-process-toolkit/adapters/");
        expect(remedy).toContain(WRITER_PLUGIN_FORM);
      } finally {
        t.cleanup();
      }
    }
  });

  test("(control) the undeclared-paragraph remedy still offers deleting the paragraph or declaring with --shared", async () => {
    const t = tree(undeclaredParagraph());
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      const remedy = remedyOf(report.violations[0]!.message);
      expect(remedy).toContain("delete the paragraph");
      expect(remedy).toContain("--shared");
    } finally {
      t.cleanup();
    }
  });
});

describe("STE-647 — the declared paragraph remedy re-renders without --shared", () => {
  /** The backticked writer command inside a remedy. */
  function writerCommand(remedy: string): string {
    const m = /`(bun run [^`]*tracker_binding_write\.ts[^`]*)`/.exec(remedy);
    expect(m, `no backticked writer command in:\n${remedy}`).not.toBeNull();
    return m![1]!;
  }

  test("AC-STE-647.9 — the remedy names the writer through ${CLAUDE_PLUGIN_ROOT} with the bound project and without --shared", async () => {
    const t = tree(staleDeclared(FLOOR));
    try {
      const report = await underRunning(HIGHER, () => runTaskTrackingWorkspaceBindingPresentProbe(t.root));
      expect(report.violations.length).toBe(1);
      const cmd = writerCommand(remedyOf(report.violations[0]!.message));
      expect(cmd).toContain(WRITER_PLUGIN_FORM);
      expect(cmd).toMatch(/--project GF(\s|$)/);
      expect(cmd).not.toContain("--shared");
    } finally {
      t.cleanup();
    }
  });

  test("AC-STE-647.9 — following the remedy under a higher running version leaves min_dpt_version unchanged and probe #25 green", async () => {
    const t = tree(staleDeclared(FLOOR));
    const manifest = mkdtempSync(join(tmpdir(), "dpt-ste647-follow-"));
    try {
      pluginManifest(manifest, HIGHER);
      const report = await underRunning(HIGHER, () => runTaskTrackingWorkspaceBindingPresentProbe(t.root));
      expect(report.violations.length).toBe(1);
      const cmd = writerCommand(remedyOf(report.violations[0]!.message))
        .replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT)
        .replaceAll("<projectRoot>", t.root)
        // HEAD's remedy leaves these placeholders; fill them the way an operator would.
        .replaceAll("<project>", "GF")
        .replaceAll("<tag>", "glacy-fe");
      expect(cmd, "no placeholder may remain in the followed command").not.toMatch(/<[a-zA-Z]+>/);
      const argv = cmd.split(/\s+/).filter((s) => s.length > 0);
      const proc = spawnSync(argv[0]!, argv.slice(1), {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: manifest },
      });
      expect(proc.status, `${proc.stdout}\n${proc.stderr}`).toBe(0);
      const after = readFileSync(join(t.root, "CLAUDE.md"), "utf-8");
      expect(after.match(/^min_dpt_version:\s*(\S+)$/m)?.[1], "following the remedy must not move the floor").toBe(FLOOR);
      const again = await underRunning(HIGHER, () => runTaskTrackingWorkspaceBindingPresentProbe(t.root));
      expect(again.violations).toEqual([]);
    } finally {
      t.cleanup();
      rmSync(manifest, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("AC-STE-647.10 — verdicts are unchanged; only the remedy text differs (control)", () => {
  // Pinned from HEAD before STE-647 (measured on a64a8dff). Intentional
  // keep-behaviour control: green on both sides.
  const cases: Array<[string, () => { root: string; cleanup: () => void }, string[]]> = [
    [
      "Glacy leftovers GB-48 + M_GB_47 under GF",
      glacyLeftovers,
      [
        'active FR tracker key "GB-48" is in project "GB", not the bound Jira project "GF"',
        'active Epic-keyed plan "M_GB_47" does not start with "M_GF_", the bound Jira project "GF"',
      ],
    ],
    [
      "stale declared paragraph",
      () => tree(staleDeclared(FLOOR)),
      [
        `### Jira declares repo_tag "glacy-fe" but the shared-container stop paragraph is not the render for project "GF", tag "glacy-fe" and floor ${FLOOR} (stale paragraph)`,
      ],
    ],
    [
      "undeclared paragraph",
      () => tree(undeclaredParagraph()),
      ["### Jira carries a shared-container stop paragraph but declares no repo_tag (stale paragraph)"],
    ],
    [
      "stranded M_GB_40 + GB-101 + GB-102",
      () => {
        const t = tree(jiraClaudeMdText({ project: "GF" }));
        writePlan(t.root, "M_GB_40", "active");
        writeFr(t.root, "GB-101", "M_GB_40", "active");
        writeFr(t.root, "GB-102", "M_GB_40", "active");
        return t;
      },
      [
        'active FR tracker key "GB-101" is in project "GB", not the bound Jira project "GF"',
        'active FR tracker key "GB-102" is in project "GB", not the bound Jira project "GF"',
        'active Epic-keyed plan "M_GB_40" does not start with "M_GF_", the bound Jira project "GF"',
      ],
    ],
  ];
  for (const [name, make, reasons] of cases) {
    test(`(control) ${name}`, async () => {
      const t = make();
      try {
        const report = await underRunning(HIGHER, () => runTaskTrackingWorkspaceBindingPresentProbe(t.root));
        expect(report.violations.map((v) => v.reason)).toEqual(reasons);
      } finally {
        t.cleanup();
      }
    });
  }
});
