// STE-612 AC-STE-612.5..7 — the repoint write, its verification, and row 8.
//
// AC.5: when no row refuses, the command edits CLAUDE.md only through STE-603's
// `writeTrackerSubsection`: the byte diff is the project (and team) line plus
// the stop paragraph re-rendered for the new project; every other byte is
// preserved; probe #25 is green on the written tree; one `repoint` receipt is
// written through the STE-602 store and announced.
// AC.6: `--verify` re-reads specs/tracker-config.yaml against the receipt's
// status snapshot (step 7f may have clobbered it).
// AC.7: row 8 names every stale branch and worktree, prints `0 branches` when
// there are none, and counts the archived FRs still bound to the old project.
//
// The module is absent at HEAD, so every assertion on its output is RED there.
// Controls are labelled `(control)`.

import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { renderSharedTrackerSentinel, writeTrackerSubsection } from "../adapters/_shared/src/setup/tracker_binding_write";
import { runningDptVersion } from "../adapters/_shared/src/dpt_version";
import { announceReceipt, parseReceiptAnnouncement } from "../adapters/_shared/src/tracker_receipts";
import {
  FRONT_DOOR,
  GB_CONFIG_STATUSES,
  GF_STATUSES,
  LINEAR_URL,
  linearClaudeMdText,
  makeGlacy,
  readClaudeMd,
  receiptFiles,
  runRepoint,
  SESSION_ID,
  statusListing,
  writeMcpJson,
  writePlan,
  writeTrackerConfig,
  type Glacy,
  type GlacyOpts,
} from "./_repoint_fixture";
import { commitAll, git, makeSpanFixture } from "./_span_fixture";

const T = 60_000;

function withGlacy(opts: GlacyOpts, body: (g: Glacy) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const g = makeGlacy(opts);
    try {
      await body(g);
    } finally {
      g.cleanup();
    }
  };
}

/** A key the writer does not own, declared by hand before the flip (key-preservation witness). */
const FREE_KEY = "board_filter: glacy-be-board";

function withFreeKey(root: string): void {
  const md = readClaudeMd(root).replace("jira_issue_type: Task", `jira_issue_type: Task\n${FREE_KEY}`);
  writeFileSync(join(root, "CLAUDE.md"), md);
}

// ===========================================================================
// AC-STE-612.5 — one line changes, through one writer
// ===========================================================================

describe("AC-STE-612.5 — the write changes one line, through one writer", () => {
  test(
    "byte diff: only `project:` and the re-rendered stop paragraph change; every other key is preserved",
    withGlacy({}, (g) => {
      withFreeKey(g.a);
      const before = readClaudeMd(g.a);
      const floor = runningDptVersion();
      const paraGB = renderSharedTrackerSentinel({ adapter: "jira", project: "GB", repoTag: "glacy-be", minDptVersion: floor });
      const paraGF = renderSharedTrackerSentinel({ adapter: "jira", project: "GF", repoTag: "glacy-be", minDptVersion: floor });
      expect(before).toContain(paraGB); // (control) the fixture carries GB's paragraph
      const expected = before.replace("project: GB\n", "project: GF\n").replace(paraGB, paraGF);

      const r = runRepoint(g.args());
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      const after = readClaudeMd(g.a);
      expect(after).toBe(expected);
      for (const kept of [
        "repo_tag: glacy-be",
        "default_labels: [glacy-be]",
        `min_dpt_version: ${floor}`,
        "jira_issue_type: Task",
        FREE_KEY,
        "mcp_server: atlassian",
      ]) {
        expect(after).toContain(kept);
      }
    }),
    T,
  );

  test(
    "the written bytes equal writeTrackerSubsection's own output on a pre-write copy (no second editor)",
    withGlacy({}, (g) => {
      withFreeKey(g.a);
      const copyDir = mkdtempSync(join(tmpdir(), "dpt-ste612-copy-"));
      g.extraDirs.push(copyDir);
      copyFileSync(join(g.a, "CLAUDE.md"), join(copyDir, "CLAUDE.md"));
      const viaWriter = writeTrackerSubsection(join(copyDir, "CLAUDE.md"), "jira", { project: "GF" }).after;

      const r = runRepoint(g.args());
      expect(r.code).toBe(0);
      expect(readClaudeMd(g.a)).toBe(viaWriter);
    }),
    T,
  );

  test("the command source imports the writer and carries no file-write primitive of its own", () => {
    const src = readFileSync(FRONT_DOOR, "utf-8");
    expect(src).toMatch(/import\s*\{[^}]*\bwriteTrackerSubsection\b[^}]*\}\s*from\s*["']\.\/setup\/tracker_binding_write["']/);
    for (const primitive of [
      /\bwriteFileSync\s*\(/,
      /\bappendFileSync\s*\(/,
      /\bBun\.write\s*\(/,
      /\brenameSync\s*\(/,
      /\bcopyFileSync\s*\(/,
      /\bcreateWriteStream\s*\(/,
      /\bopenSync\s*\(/,
      /\bfs\.promises\b/,
      /from\s*["']node:fs\/promises["']/,
    ]) {
      expect(src, String(primitive)).not.toMatch(primitive);
    }
  });

  test(
    "probe #25 on the written tree reports zero violations",
    withGlacy({}, async (g) => {
      const r = runRepoint(g.args());
      expect(r.code).toBe(0);
      expect(readClaudeMd(g.a)).toContain("project: GF");
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(g.a);
      expect(report.violations).toEqual([]);
    }),
    T,
  );

  test(
    "one `repoint` receipt: old project, new project, the row-4 status snapshot; announced by its dpt-receipt line",
    withGlacy({}, (g) => {
      const r = runRepoint(g.args());
      expect(r.code).toBe(0);
      const files = receiptFiles(g.a);
      expect(files.length).toBe(1);
      const receipt = JSON.parse(readFileSync(files[0]!, "utf-8"));
      expect(receipt.kind).toBe("repoint");
      expect(receipt.sessionId).toBe(SESSION_ID);
      const evidence = JSON.stringify(receipt.evidence);
      expect(evidence).toContain('"GB"');
      expect(evidence).toContain('"GF"');
      for (const s of GB_CONFIG_STATUSES) expect(evidence).toContain(JSON.stringify(s));

      const lines = r.stdout.split("\n").filter((l) => l.startsWith("dpt-receipt: "));
      expect(lines.length).toBe(1);
      const parsed = parseReceiptAnnouncement(lines[0]!);
      expect(parsed).not.toBeNull();
      expect(realpathSync(parsed!.path)).toBe(realpathSync(files[0]!));
      expect(lines[0]).toBe(announceReceipt(parsed!.path));
    }),
    T,
  );

  test(
    "Linear with --team: exactly the team and project lines change",
    async () => {
      const f = makeSpanFixture("M_ste612_lw");
      const lst = mkdtempSync(join(tmpdir(), "dpt-ste612-lw-"));
      try {
        writeFileSync(join(f.a, "CLAUDE.md"), linearClaudeMdText({ team: "STE", project: "Old Proj" }));
        writeMcpJson(f.a, { linear: LINEAR_URL });
        writeTrackerConfig(f.a, "linear", ["Todo", "In Progress", "Done"]);
        commitAll(f.a, "linear fixture");
        const before = readClaudeMd(f.a);
        const w = (n: string, c: unknown) => {
          const p = join(lst, n);
          writeFileSync(p, JSON.stringify(c));
          return p;
        };
        const r = runRepoint([
          f.a, "linear", "New Proj",
          "--projects", w("p.json", { projects: [{ id: "p-1", name: "New Proj" }] }),
          "--containers", w("c.json", { milestones: [] }),
          "--statuses", w("s.json", statusListing(["Todo", "In Progress", "Done"])),
          "--team", "NEW",
        ]);
        expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
        expect(readClaudeMd(f.a)).toBe(before.replace("team: STE\n", "team: NEW\n").replace("project: Old Proj\n", "project: New Proj\n"));
      } finally {
        f.cleanup();
        rmSync(lst, { recursive: true, force: true });
      }
    },
    T,
  );
});

// ===========================================================================
// AC-STE-612.6 — post-flip verification
// ===========================================================================

describe("AC-STE-612.6 — `--verify` checks the config against the receipt's snapshot", () => {
  test(
    "intact config after the flip → exit 0",
    withGlacy({}, (g) => {
      expect(runRepoint(g.args()).code).toBe(0);
      const v = runRepoint([g.a, "--verify"]);
      expect(v.code, `${v.stdout}\n${v.stderr}`).toBe(0);
    }),
    T,
  );

  test(
    "step 7f clobbered the config (In Review dropped) → exit 1 naming the dropped status",
    withGlacy({}, (g) => {
      expect(runRepoint(g.args()).code).toBe(0);
      writeTrackerConfig(g.a, "jira", GF_STATUSES); // 7f rewrote it from GF alone
      const v = runRepoint([g.a, "--verify"]);
      expect(v.code).toBe(1);
      expect(`${v.stdout}${v.stderr}`).toContain("In Review");
    }),
    T,
  );

  test(
    "no repoint receipt → refuses: it cannot verify what was not recorded",
    withGlacy({}, (g) => {
      const v = runRepoint([g.a, "--verify"]);
      expect(v.code).not.toBe(0);
      expect(`${v.stdout}${v.stderr}`).toMatch(/receipt/i);
    }),
    T,
  );
});

// ===========================================================================
// AC-STE-612.7 — row 8, the report
// ===========================================================================

describe("AC-STE-612.7 — row 8 names stale branches and worktrees, and counts legacy bindings", () => {
  test(
    "one stale branch and one worktree are both named; removed, the report prints `0 branches`",
    withGlacy({}, (g) => {
      git(g.a, "branch", "feat/stale-binding");
      const wtParent = mkdtempSync(join(tmpdir(), "dpt-ste612-wt-"));
      g.extraDirs.push(wtParent);
      const wt = join(wtParent, "glacy-be-wt");
      git(g.a, "worktree", "add", "-q", "--detach", wt);
      expect(readFileSync(join(wt, "CLAUDE.md"), "utf-8")).toContain("project: GB"); // (control)

      const r = runRepoint(g.args());
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("feat/stale-binding");
      const wtReal = realpathSync(wt);
      expect(r.stdout.includes(wt) || r.stdout.includes(wtReal), r.stdout).toBe(true);
      expect(r.stdout).not.toMatch(/^8 0 branches/m);

      // Same fixture, stale refs removed, binding restored to GB.
      git(g.a, "worktree", "remove", "--force", wt);
      git(g.a, "branch", "-D", "feat/stale-binding");
      git(g.a, "checkout", "--", "CLAUDE.md");
      const r2 = runRepoint(g.args());
      expect(r2.code, `${r2.stdout}\n${r2.stderr}`).toBe(0);
      expect(r2.stdout).toContain("0 branches");
      expect(r2.stdout).not.toContain("feat/stale-binding");
    }),
    T,
  );

  test(
    "the archived-FR count line: computed count of GB-keyed archived FRs, and the old project is never archived or deleted",
    withGlacy({}, (g) => {
      const archivedGb = git(g.a, "ls-files", "specs/frs/archive")
        .split("\n")
        .filter((p) => /\/GB-\d+\.md$/.test(p)).length;
      expect(archivedGb).toBe(3); // (control) the fixture's three legacy bindings
      const r = runRepoint(g.args());
      expect(r.code).toBe(0);
      const line = r.stdout.split("\n").find((l) => new RegExp(`\\b${archivedGb}\\b`).test(l) && /archived FR/i.test(l)) ?? "";
      expect(line, r.stdout).not.toBe("");
      expect(line).toContain("GB");
      expect(line).toMatch(/(must not|never)[\s\S]*archiv[\s\S]*delet/i);
    }),
    T,
  );

  test(
    "the archived-FR count reads only the Jira key: an archived FR keyed `linear: GB-42` is not counted",
    withGlacy({}, (g) => {
      writeFileSync(
        join(g.a, "specs", "frs", "archive", "OLD-1.md"),
        ["---", "title: Fixture FR", "milestone: M_GB_40", "status: archived", "archived_at: 2026-09-10T00:00:00Z", "tracker:", "  linear: GB-42", "---", "", "# Fixture FR", ""].join("\n"),
      );
      commitAll(g.a, "a Linear-keyed archived FR");
      const r = runRepoint(g.args());
      expect(r.code, r.stdout).toBe(0);
      const line = r.stdout.split("\n").find((l) => /archived FR/i.test(l)) ?? "";
      expect(line, r.stdout).toMatch(/\b3\b/); // the fixture's three legacy GB-* Jira bindings, and no more
    }),
    T,
  );

  test(
    "Linear: the line counts archived plans instead",
    async () => {
      const f = makeSpanFixture("M_ste612_l8");
      const lst = mkdtempSync(join(tmpdir(), "dpt-ste612-l8-"));
      try {
        writeFileSync(join(f.a, "CLAUDE.md"), linearClaudeMdText({ team: "STE", project: "Old Proj" }));
        writeMcpJson(f.a, { linear: LINEAR_URL });
        writeTrackerConfig(f.a, "linear", ["Todo", "In Progress", "Done"]);
        writePlan(f.a, "M_111aaa", "archived");
        writePlan(f.a, "M_222bbb", "archived");
        commitAll(f.a, "linear fixture");
        const w = (n: string, c: unknown) => {
          const p = join(lst, n);
          writeFileSync(p, JSON.stringify(c));
          return p;
        };
        const r = runRepoint([
          f.a, "linear", "New Proj",
          "--projects", w("p.json", { projects: [{ id: "p-1", name: "New Proj" }] }),
          "--containers", w("c.json", { milestones: [] }),
          "--statuses", w("s.json", statusListing(["Todo", "In Progress", "Done"])),
        ]);
        expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
        const line = r.stdout.split("\n").find((l) => /\b2\b/.test(l) && /archived plan/i.test(l)) ?? "";
        expect(line, r.stdout).not.toBe("");
        expect(line).toMatch(/(must not|never)[\s\S]*archiv[\s\S]*delet/i);
      } finally {
        f.cleanup();
        rmSync(lst, { recursive: true, force: true });
      }
    },
    T,
  );
});
