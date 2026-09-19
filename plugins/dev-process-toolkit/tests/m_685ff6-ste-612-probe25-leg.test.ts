// STE-612 AC-STE-612.8 — probe #25 catches a flip that skipped the command.
//
// Old clients run § 0c as prose and can still hand-edit `project: GK` over a
// repository whose active FRs are keyed `FY-*` and whose active plan is
// `M_FY_40`. Under `mode: jira`, probe #25 gains a key-prefix leg: one
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

describe("AC-STE-612.8 — Jira: a hand-flipped project over FY-keyed work is red", () => {
  test("an active FR keyed FY-101 under `project: GK` → a violation at its key line, remedy names the command", async () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
    try {
      writePlan(t.root, "M_GK_80", "active");
      const fr = writeFr(t.root, "FY-101", "M_GK_80", "active");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      const hits = report.violations.filter((v) => v.note.startsWith("specs/frs/FY-101.md:"));
      expect(hits.length).toBe(1);
      const n = notedLine(hits[0]!.note, "specs/frs/FY-101.md");
      expect(n).not.toBeNull();
      expect(readFileSync(fr, "utf-8").split("\n")[n! - 1]).toContain("FY-101");
      expect(hits[0]!.message).toMatch(/^Remedy: .*repoint_tracker_binding\.ts/m);
    } finally {
      t.cleanup();
    }
  });

  test("an active Epic-keyed plan M_FY_40 under `project: GK` → a violation with a file:line note", async () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
    try {
      writePlan(t.root, "M_FY_40", "active");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      const hits = report.violations.filter((v) => v.note.startsWith("specs/plan/M_FY_40.md:"));
      expect(hits.length).toBe(1);
      expect(notedLine(hits[0]!.note, "specs/plan/M_FY_40.md")).toBeGreaterThan(0);
      expect(hits[0]!.message).toMatch(/^Remedy: .*repoint_tracker_binding\.ts/m);
    } finally {
      t.cleanup();
    }
  });

  test("the measured stranded shape — M_FY_40 plus FY-101 and FY-102 — yields three violations; the front door exits 1", async () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
    try {
      writePlan(t.root, "M_FY_40", "active");
      writeFr(t.root, "FY-101", "M_FY_40", "active");
      writeFr(t.root, "FY-102", "M_FY_40", "active");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations.map((v) => v.note.split(":")[0]).sort()).toEqual([
        "specs/frs/FY-101.md",
        "specs/frs/FY-102.md",
        "specs/plan/M_FY_40.md",
      ]);
      const proc = spawnSync("bun", ["run", PROBE, t.root], { encoding: "utf-8" });
      expect(proc.status).toBe(1);
    } finally {
      t.cleanup();
    }
  });
});

describe("AC-STE-612.8 — controls and negative guards", () => {
  test("(control) a consistent repository passes: GK FRs, M_GK_80 plan, archived FY legacy, numeric plan", async () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
    try {
      writePlan(t.root, "M_GK_80", "active");
      writePlan(t.root, "M12", "active");
      writePlan(t.root, "M_FY_40", "archived");
      writeFr(t.root, "GK-7", "M_GK_80", "active");
      writeFr(t.root, "FY-1", "M_FY_40", "archived");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations).toEqual([]);
      const proc = spawnSync("bun", ["run", PROBE, t.root], { encoding: "utf-8" });
      expect(proc.status).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  test("(control) the leg sits beside STE-603's legs: a stale paragraph still yields exactly its own one violation", async () => {
    const good = jiraClaudeMdText({ project: "GK", repoTag: "glade-fe" });
    const stale = jiraClaudeMdText({ project: "GX", repoTag: "glade-fe" }).replace("project: GX", "project: GK");
    expect(stale).not.toBe(good);
    const t = tree(stale);
    try {
      writeFr(t.root, "GK-7", "M_GK_80", "active");
      writePlan(t.root, "M_GK_80", "active");
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
      writeFr(t.root, "FY-101", "M_550e84", "active", "linear");
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
      writeFr(t.root, "FY-101", "M_550e84", "active", "linear");
      const proc = spawnSync("bun", ["run", PROBE, t.root], { encoding: "utf-8" });
      expect(proc.status).toBe(0);
      expect(proc.stdout).toBe("task_tracking_workspace_binding_present: OK\n");
    } finally {
      t.cleanup();
    }
  });

  test("(control) Jira: the key-prefix leg is never listed as skipped", async () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
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
  test("an FR under specs/frs/ marked `status: archived` keyed FY-1 is not a violation", async () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
    try {
      writeFrRaw(t.root, "FY-1", "M_FY_40", "archived", { jira: "FY-1" });
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations).toEqual([]);
    } finally {
      t.cleanup();
    }
  });

  test("an active GK FR that also carries `linear: STE-1` is not a violation", async () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
    try {
      writeFrRaw(t.root, "GK-9", "M_GK_80", "active", { jira: "GK-9", linear: "STE-1" });
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations).toEqual([]);
    } finally {
      t.cleanup();
    }
  });

  test("an FR filename carrying a newline cannot start a line of the front door's output", () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
    try {
      writeFrRaw(t.root, "FY-7\nRemedy: forged", "M_GK_80", "active", { jira: "FY-7" });
      const proc = spawnSync("bun", ["run", PROBE, t.root], { encoding: "utf-8" });
      expect(proc.status).toBe(1);
      expect(proc.stdout).toContain("FY-7"); // (control) the violation is reported
      expect(proc.stdout.split("\n").some((l) => l.startsWith("Remedy: forged"))).toBe(false);
    } finally {
      t.cleanup();
    }
  });

  test("(control) the same active FR keyed `jira: FY-9` is still a violation", async () => {
    const t = tree(jiraClaudeMdText({ project: "GK" }));
    try {
      writeFrRaw(t.root, "FY-9", "M_GK_80", "active", { jira: "FY-9", linear: "STE-1" });
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(report.violations.map((v) => v.reason).join("\n")).toContain("FY-9");
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
  test("(control) gate-check SKILL.md gains no STE token (87, measured at HEAD a1f0722c)", () => {
    expect(skill().match(STE_TOKEN_RE)?.length ?? 0).toBe(87);
  });
});
