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
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { renderSharedTrackerSentinel, writeTrackerSubsection } from "../adapters/_shared/src/setup/tracker_binding_write";
import { runningDptVersion } from "../adapters/_shared/src/dpt_version";
import { announceReceipt, parseReceiptAnnouncement } from "../adapters/_shared/src/tracker_receipts";
import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
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
  linearStatuses,
  PLUGIN_ROOT,
  rowLines,
  verdict,
  writeMcpJson,
  writePlan,
  writeTrackerConfig,
  type Glacy,
  type GlacyOpts,
} from "./_repoint_fixture";
import { commitAll, git, GIT_ENV, makeSpanFixture } from "./_span_fixture";

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
      // AC-STE-645.8: the rows route is the one caller that re-points, so the
      // pre-write copy is written the way it writes: `repoint: true`.
      const viaWriter = writeTrackerSubsection(join(copyDir, "CLAUDE.md"), "jira", { project: "GF", repoint: true }).after;

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
          "--projects", w("p.json", { projects: [{ id: "p-1", name: "New Proj" }], hasNextPage: false }),
          "--containers", w("c.json", { milestones: [] }),
          "--statuses", w("s.json", linearStatuses(["Todo", "In Progress", "Done"])),
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


// M_163656 (STE-646) — `--verify` tells an untouched config from a rewritten one.
// The snapshot is a copy of the config it is compared with, so on the no-7f
// route HEAD's PASS was vacuous (B-4).

/** The config file's bytes, sha256 hex. */
function configSha(root: string): string {
  return createHash("sha256").update(readFileSync(join(root, "specs", "tracker-config.yaml"))).digest("hex");
}

/** Write a `repoint` receipt by hand into this session's receipt dir, under `name` (sorted order = age). */
function handReceipt(root: string, name: string, evidence: Record<string, unknown>): string {
  const dir = receiptsDir(root, SESSION_ID);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(
    path,
    `${JSON.stringify({
      v: 1,
      kind: "repoint",
      sessionId: SESSION_ID,
      root,
      adapter: "jira",
      container: "GF",
      subject: join(root, "CLAUDE.md"),
      decision: "repoint",
      evidence,
      createdAt: "2026-09-30T00:00:00.000Z",
    })}\n`,
  );
  return path;
}

const LEGACY_PASS = "verify PASS specs/tracker-config.yaml carries every status in the repoint snapshot";

describe("AC-STE-612.6 / STE-646 — `--verify` separates UNCHANGED from a rewritten config", () => {
  test(
    "AC-STE-646.11 — config byte-identical to the one the repoint recorded → a line beginning `verify UNCHANGED`, exit 0",
    withGlacy({}, (g) => {
      expect(runRepoint(g.args()).code).toBe(0);
      const v = runRepoint([g.a, "--verify"]);
      expect(v.code, `${v.stdout}\n${v.stderr}`).toBe(0);
      expect(v.stdout.split("\n").some((l) => l.startsWith("verify UNCHANGED")), v.stdout).toBe(true);
      expect(v.stdout).not.toMatch(/^verify PASS/m);
    }),
    T,
  );

  test(
    "AC-STE-646.12 — config rewritten keeping every snapshot status (roles reordered) → `verify PASS`, exit 0",
    withGlacy({}, (g) => {
      expect(runRepoint(g.args()).code).toBe(0);
      const path = join(g.a, "specs", "tracker-config.yaml");
      const old = readFileSync(path, "utf-8");
      const reordered = old.replace(/roles:\n([\s\S]*)$/, (_m, body: string) => {
        const lines = body.split("\n").filter((l) => l.length > 0);
        return `roles:\n${lines.reverse().join("\n")}\n`;
      });
      expect(reordered, "(control) the bytes changed").not.toBe(old);
      writeFileSync(path, reordered);
      const v = runRepoint([g.a, "--verify"]);
      expect(v.code, `${v.stdout}\n${v.stderr}`).toBe(0);
      expect(v.stdout).toMatch(/^verify PASS/m);
      expect(v.stdout).not.toContain("UNCHANGED");
    }),
    T,
  );

  test(
    "AC-STE-646.13 — config rewritten dropping a status → `verify FAIL` naming it, exit 1",
    withGlacy({}, (g) => {
      expect(runRepoint(g.args()).code).toBe(0);
      writeTrackerConfig(g.a, "jira", GF_STATUSES);
      const v = runRepoint([g.a, "--verify"]);
      expect(v.code).toBe(1);
      const line = v.stdout.split("\n").find((l) => l.startsWith("verify FAIL")) ?? "";
      expect(line, v.stdout).toContain("In Review");
    }),
    T,
  );

  test(
    "AC-STE-646.14 — a legacy receipt (no trackerConfigSha256) keeps today's PASS wording",
    withGlacy({}, (g) => {
      handReceipt(g.a, "2026-09-30T00-00-00-000Z-legacy.json", { oldProject: "GB", newProject: "GF", statusSnapshot: GB_CONFIG_STATUSES });
      const v = runRepoint([g.a, "--verify"]);
      expect(v.code, `${v.stdout}\n${v.stderr}`).toBe(0);
      expect(v.stdout.split("\n")).toContain(LEGACY_PASS);
    }),
    T,
  );

  test(
    "AC-STE-646.14 — snapshot and sha come from the SAME latest receipt: a later legacy receipt after a sha-carrying one reads as legacy",
    withGlacy({}, (g) => {
      expect(runRepoint(g.args()).code).toBe(0);
      handReceipt(g.a, "9999-zz-later-legacy.json", { oldProject: "GB", newProject: "GF", statusSnapshot: GB_CONFIG_STATUSES });
      const v = runRepoint([g.a, "--verify"]);
      expect(v.code, `${v.stdout}\n${v.stderr}`).toBe(0);
      expect(v.stdout.split("\n")).toContain(LEGACY_PASS);
      expect(v.stdout).not.toContain("UNCHANGED");
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
          "--projects", w("p.json", { projects: [{ id: "p-1", name: "New Proj" }], hasNextPage: false }),
          "--containers", w("c.json", { milestones: [] }),
          "--statuses", w("s.json", linearStatuses(["Todo", "In Progress", "Done"])),
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

// ===========================================================================
// M_163656 (STE-646) — one outcome or none: the session precondition, the
// restore, the receipt's config digest
// ===========================================================================

/** Spawn the front door with CLAUDE_CODE_SESSION_ID removed, or set to `sessionId` when given. */
function runRepointSession(args: string[], sessionId?: string): { code: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...GIT_ENV };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sessionId !== undefined) env.CLAUDE_CODE_SESSION_ID = sessionId;
  const proc = spawnSync("bun", ["run", FRONT_DOOR, ...args], { cwd: PLUGIN_ROOT, env, encoding: "utf-8", timeout: 60_000 });
  return { code: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

describe("STE-646 — the rows route checks the session before any row and restores on a failed receipt", () => {
  for (const [label, sid] of [
    ["unset", undefined],
    ["empty", ""],
    ["path-unsafe `../x`", "../x"],
  ] as const) {
    test(
      `AC-STE-646.7 — CLAUDE_CODE_SESSION_ID ${label} → exit 1 before any row, naming it; CLAUDE.md, git status and .dpt/ unchanged`,
      withGlacy({}, (g) => {
        const before = readClaudeMd(g.a);
        expect(git(g.a, "status", "--porcelain"), "(control) a clean tree").toBe("");
        expect(existsSync(join(g.a, ".dpt")), "(control) no .dpt yet").toBe(false);
        const r = runRepointSession(g.args(), sid);
        expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(1);
        expect(rowLines(r.stdout)).toEqual([]);
        expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
        // Review: an NFR-10 refusal like every other pre-row refusal, with a Remedy.
        expect(r.stderr).toMatch(/^Refusing: /m);
        expect(r.stderr).toMatch(/^Remedy: .*CLAUDE_CODE_SESSION_ID/m);
        expect(readClaudeMd(g.a)).toBe(before);
        expect(git(g.a, "status", "--porcelain")).toBe("");
        expect(existsSync(join(g.a, ".dpt"))).toBe(false);
      }),
      T,
    );
  }

  test(
    "AC-STE-646.8 — `.dpt` is a regular file: rows pass, the receipt write fails, CLAUDE.md is restored byte for byte, exit 1, the refusal says restored",
    withGlacy({}, (g) => {
      writeFileSync(join(g.a, ".dpt"), "not a directory\n");
      const before = readClaudeMd(g.a);
      const r = runRepoint(g.args());
      // (control) the run reached the write: every row passed.
      for (let n = 1; n <= 7; n++) expect(verdict(r.stdout, n), r.stdout).toBe("PASS");
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(1);
      expect(readClaudeMd(g.a)).toBe(before);
      expect(r.stderr).toContain("CLAUDE.md was restored byte for byte");
      expect(r.stdout).not.toContain("dpt-receipt:");
    }),
    T,
  );

  test(
    "AC-STE-646.9 + AC-STE-646.14 — a successful repoint leaves exactly one `repoint` receipt carrying the config's sha256, and the flipped binding",
    withGlacy({}, (g) => {
      const sha = configSha(g.a);
      const r = runRepoint(g.args());
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      expect(readClaudeMd(g.a)).toContain("project: GF\n");
      const files = receiptFiles(g.a);
      expect(files.length).toBe(1);
      const receipt = JSON.parse(readFileSync(files[0]!, "utf-8"));
      expect(receipt.kind).toBe("repoint");
      expect(receipt.evidence.trackerConfigSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.evidence.trackerConfigSha256).toBe(sha);
      expect(receipt.evidence.statusSnapshot).toEqual(GB_CONFIG_STATUSES);
    }),
    T,
  );

  test("AC-STE-646.10 — repoint_tracker_binding.ts contains none of writeFileSync, appendFileSync, renameSync, copyFileSync, openSync, Bun.write", () => {
    const src = readFileSync(FRONT_DOOR, "utf-8");
    for (const name of ["writeFileSync", "appendFileSync", "renameSync", "copyFileSync", "openSync", "Bun.write"]) {
      expect(src.includes(name), name).toBe(false);
    }
  });
});
