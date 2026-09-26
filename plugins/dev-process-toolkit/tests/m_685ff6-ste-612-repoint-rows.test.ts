// STE-612 AC-STE-612.1..4 — the repoint command decides every § 0c row in code.
//
// THE SUBJECT. `/setup --resume-tracker-binding` repoints a repository's
// tracker binding on the strength of seven prose preconditions nothing checks.
// Measured for glacy-app-be (GB → GF): rows 2, 3, 5 and 6 fail, and nothing
// stops the flip; with `M_GB_40` active the plan is stranded after it.
// `repoint_tracker_binding.ts` prints one `<n> PASS|REFUSE|NOT-APPLICABLE
// <reason>` line per row, refuses (exit 1, nothing written) when any row
// refuses, and fails closed on every absent, unreadable or malformed input.
//
// Each row has a pass leg, a refuse leg and an unreadable-input leg, named
// distinctly. The module is absent at HEAD, so every new-behaviour assertion
// is RED there; row 7's legs are also graded against a faithful pre-change-
// semantics sibling (HEAD's § 0c flip: the writer called with no check), which
// flips unguarded where the real command refuses (AC-STE-612.4).
//
// Controls are labelled `(control)`.

import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { writeTrackerSubsection } from "../adapters/_shared/src/setup/tracker_binding_write";
import { readWorkspaceBinding, type WorkspaceAdapterKey } from "../adapters/_shared/src/workspace_binding";
import {
  ATLASSIAN_URL,
  GF_STATUSES,
  jiraClaudeMdText,
  jiraEpics,
  jiraLabels,
  jiraProjects,
  LINEAR_URL,
  linearClaudeMdText,
  makeGlacy,
  measuredGfLabels,
  readClaudeMd,
  receiptFiles,
  rowLine,
  rowLines,
  runRepoint,
  linearStatuses,
  statusListing,
  verdict,
  writeFr,
  writeFrRaw,
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

/** A refused run wrote nothing: CLAUDE.md byte-identical, no receipt. */
function expectNothingWritten(root: string, before: string): void {
  expect(readClaudeMd(root)).toBe(before);
  expect(receiptFiles(root)).toEqual([]);
}

/** The three unreadable-input shapes of one flag: absent path, a directory, not JSON. */
function unreadableVariants(g: Glacy, flag: string): Array<[string, string]> {
  const dir = join(g.lst, `${flag.replace(/^--/, "")}-is-a-directory`);
  mkdirSync(dir, { recursive: true });
  return [
    ["absent", join(g.lst, `${flag.replace(/^--/, "")}-does-not-exist.json`)],
    ["unreadable (a directory)", dir],
    ["malformed (not JSON)", g.listing(`${flag.replace(/^--/, "")}-malformed.json`, "{ this is not json")],
  ];
}

// ===========================================================================
// AC-STE-612.1 — the front door
// ===========================================================================

describe("AC-STE-612.1 — front door prints rows 1..7 and refuses without writing", () => {
  test(
    "all rows pass on the measured-consistent pair → rows 1..7 printed in order, exit 0",
    withGlacy({}, (g) => {
      const r = runRepoint(g.args());
      const rows = rowLines(r.stdout).map((l) => Number(l.split(" ")[0]));
      expect(rows).toEqual([1, 2, 3, 4, 5, 6, 7]);
      for (let n = 1; n <= 7; n++) expect(verdict(r.stdout, n), rowLine(r.stdout, n)).toBe("PASS");
      expect(r.code).toBe(0);
    }),
    T,
  );

  test(
    "one refused row → exit 1, CLAUDE.md byte-identical, no receipt",
    withGlacy({}, (g) => {
      const before = readClaudeMd(g.a);
      const r = runRepoint(g.args({ "--projects": g.listing("p.json", jiraProjects(["GB", "GX"])) }));
      expect(verdict(r.stdout, 1)).toBe("REFUSE");
      expect(r.code).toBe(1);
      expectNothingWritten(g.a, before);
    }),
    T,
  );

  test(
    "mode: none refuses before any row",
    withGlacy({ a: { mode: "none" } }, (g) => {
      const before = readClaudeMd(g.a);
      const r = runRepoint(g.args());
      expect(rowLines(r.stdout)).toEqual([]);
      expect(r.code).toBe(1);
      expect(`${r.stdout}${r.stderr}`).toContain("mode: none");
      expect(`${r.stdout}${r.stderr}`).toContain("Remedy:");
      expectNothingWritten(g.a, before);
    }),
    T,
  );

  test(
    "no ## Task Tracking section refuses before any row",
    withGlacy({}, (g) => {
      writeFileSync(join(g.a, "CLAUDE.md"), "# Fixture Project\n\n## Verification\n\nrun_cmd: none\n");
      const before = readClaudeMd(g.a);
      const r = runRepoint(g.args());
      expect(rowLines(r.stdout)).toEqual([]);
      expect(r.code).toBe(1);
      expect(`${r.stdout}${r.stderr}`).toContain("## Task Tracking");
      expect(`${r.stdout}${r.stderr}`).toContain("Remedy:");
      expectNothingWritten(g.a, before);
    }),
    T,
  );

  test(
    "resume leg: project <deferred> runs zero rows, prints `resume`, reaches the writer (exit 0)",
    withGlacy({}, (g) => {
      writeFileSync(join(g.a, "CLAUDE.md"), jiraClaudeMdText({ project: "<deferred>" }));
      // Listings that would refuse rows 1 and 7 on the rows path: none may run.
      const r = runRepoint(
        g.args({ "--projects": g.listing("p.json", jiraProjects(["GX"])), "--containers": g.listing("c.json", "not json") }),
      );
      expect(rowLines(r.stdout)).toEqual([]);
      expect(r.stdout.split("\n")).toContain("resume");
      expect(r.code).toBe(0);
      expect(readWorkspaceBinding(join(g.a, "CLAUDE.md"), "jira").project).toBe("GF");
    }),
    T,
  );

  test(
    "declare leg: project already GF, no repo_tag → zero rows, prints `declare`, exit 0",
    withGlacy({}, (g) => {
      writeFileSync(join(g.a, "CLAUDE.md"), jiraClaudeMdText({ project: "GF" }));
      // One listed container makes the target shared, so on the rows path row 2
      // would refuse (no repo_tag). The declare route runs no rows.
      const r = runRepoint(g.args());
      expect(rowLines(r.stdout)).toEqual([]);
      expect(r.stdout.split("\n")).toContain("declare");
      expect(r.code).toBe(0);
    }),
    T,
  );

  test(
    "declare counterpart: the same fixture bound to GX goes down the rows path and refuses at row 2",
    withGlacy({}, (g) => {
      writeFileSync(join(g.a, "CLAUDE.md"), jiraClaudeMdText({ project: "GX" }));
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 2)).toBe("REFUSE");
    }),
    T,
  );
});

// ===========================================================================
// Per-row unreadable-input legs (AC-STE-612.1, asserted per row)
// ===========================================================================

describe("AC-STE-612.1 — every row refuses on an absent, unreadable or malformed input", () => {
  const fileRows: Array<[number, string]> = [
    [1, "--projects"],
    [3, "--issue-types"],
    [4, "--statuses"],
    [6, "--labels"],
    [7, "--containers"],
  ];
  for (const [row, flag] of fileRows) {
    for (const kind of ["absent", "unreadable (a directory)", "malformed (not JSON)"]) {
      test(
        `row ${row} unreadable-input leg: ${flag} ${kind} → row ${row} REFUSE, nothing written`,
        withGlacy({}, (g) => {
          const before = readClaudeMd(g.a);
          const path = unreadableVariants(g, flag).find(([k]) => k === kind)![1];
          const r = runRepoint(g.args({ [flag]: path }));
          expect(verdict(r.stdout, row), rowLine(r.stdout, row)).toBe("REFUSE");
          expect(r.code).toBe(1);
          expectNothingWritten(g.a, before);
        }),
        T,
      );
    }
  }

  test(
    "row 2 unreadable-input leg: a --peer path that does not exist → row 2 REFUSE",
    withGlacy({}, (g) => {
      const r = runRepoint(g.args({}, [join(g.lst, "no-such-peer")]));
      expect(verdict(r.stdout, 2)).toBe("REFUSE");
      expect(r.code).toBe(1);
    }),
    T,
  );

  test(
    "row 2 unreadable-input leg: a --peer with no CLAUDE.md → row 2 REFUSE (probe vacuity is not a pass)",
    withGlacy({}, (g) => {
      const empty = mkdtempSync(join(tmpdir(), "dpt-ste612-emptypeer-"));
      g.extraDirs.push(empty);
      const r = runRepoint(g.args({}, [empty]));
      expect(verdict(r.stdout, 2)).toBe("REFUSE");
      expect(r.code).toBe(1);
    }),
    T,
  );

  for (const [kind, prep] of [
    ["absent", (root: string) => rmSync(join(root, ".mcp.json"))],
    ["unreadable (a directory)", (root: string) => {
      rmSync(join(root, ".mcp.json"));
      mkdirSync(join(root, ".mcp.json"));
    }],
    ["malformed (not JSON)", (root: string) => writeFileSync(join(root, ".mcp.json"), "{ nope")],
  ] as Array<[string, (root: string) => void]>) {
    test(
      `row 5 unreadable-input leg: .mcp.json ${kind} → row 5 REFUSE`,
      withGlacy({}, (g) => {
        prep(g.a);
        const before = readClaudeMd(g.a);
        const r = runRepoint(g.args());
        expect(verdict(r.stdout, 5)).toBe("REFUSE");
        expect(r.code).toBe(1);
        expectNothingWritten(g.a, before);
      }),
      T,
    );
  }

  test(
    "row 4 unreadable-input leg: specs/tracker-config.yaml malformed → row 4 REFUSE",
    withGlacy({}, (g) => {
      writeFileSync(join(g.a, "specs", "tracker-config.yaml"), "tracker_key: [unclosed\nstatuses: {\n");
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 4)).toBe("REFUSE");
      expect(r.code).toBe(1);
    }),
    T,
  );
});

// ===========================================================================
// AC-STE-612.2 — rows 1 to 3
// ===========================================================================

describe("AC-STE-612.2 — row 1: the new project is visible", () => {
  test(
    "row 1 pass leg: GF in the project listing → PASS",
    withGlacy({}, (g) => {
      expect(verdict(runRepoint(g.args()).stdout, 1)).toBe("PASS");
    }),
    T,
  );
  test(
    "row 1 refuse leg: GF absent from the project listing → REFUSE",
    withGlacy({}, (g) => {
      const r = runRepoint(g.args({ "--projects": g.listing("p.json", jiraProjects(["GB", "GX"])) }));
      expect(verdict(r.stdout, 1)).toBe("REFUSE");
      expect(rowLine(r.stdout, 1)).toContain("GF");
    }),
    T,
  );
});

describe("AC-STE-612.2 — row 2: probe #25 green here and at every peer", () => {
  test(
    "row 2 pass leg: consistent repo and peer (bound GF, distinct tag) → PASS",
    withGlacy({}, (g) => {
      expect(verdict(runRepoint(g.args()).stdout, 2)).toBe("PASS");
    }),
    T,
  );

  test(
    "row 2 no-peer leg: prints `peers=0 (not checked)` and does not refuse on that account",
    withGlacy({}, (g) => {
      const r = runRepoint(g.args({}, []));
      expect(rowLine(r.stdout, 2)).toContain("peers=0 (not checked)");
      expect(verdict(r.stdout, 2)).toBe("PASS");
    }),
    T,
  );

  const ownRefusals: Array<[string, GlacyOpts]> = [
    ["no repo_tag on a shared target", { a: { repoTag: undefined, defaultLabels: undefined, paragraph: "none" } }],
    ["a malformed declaration (repo_tag not kebab)", { a: { repoTag: "Glacy_BE", paragraph: "none" } }],
    ["a missing stop paragraph", { a: { paragraph: "none" } }],
    ["a stale stop paragraph (rendered for another project)", { a: { paragraph: "__stale__" } }],
    ["a floor newer than the running plugin", { a: { minDptVersion: "99.0.0" } }],
  ];
  for (const [label, opts] of ownRefusals) {
    test(
      `row 2 refuse leg: ${label} → REFUSE`,
      withGlacy(opts, async (g) => {
        if (opts.a?.paragraph === "__stale__") {
          const good = jiraClaudeMdText({ project: "GB", repoTag: "glacy-be", issueType: "Task" });
          const stale = jiraClaudeMdText({ project: "GX", repoTag: "glacy-be", issueType: "Task" })
            .replace("project: GX", "project: GB");
          expect(stale).not.toBe(good);
          writeFileSync(join(g.a, "CLAUDE.md"), stale);
        }
        const r = runRepoint(g.args());
        expect(verdict(r.stdout, 2), rowLine(r.stdout, 2)).toBe("REFUSE");
        expect(r.code).toBe(1);
        // Carries probe #25's own violation text whenever the probe reports one.
        const report = await runTaskTrackingWorkspaceBindingPresentProbe(g.a);
        for (const v of report.violations) expect(rowLine(r.stdout, 2)).toContain(v.reason);
      }),
      T,
    );
  }

  test(
    "(control) the probe itself reports a violation on each non-tag refuse fixture",
    async () => {
      for (const opts of [
        { a: { repoTag: "Glacy_BE", paragraph: "none" } },
        { a: { paragraph: "none" } },
        { a: { minDptVersion: "99.0.0" } },
      ] as GlacyOpts[]) {
        const g = makeGlacy(opts);
        try {
          const report = await runTaskTrackingWorkspaceBindingPresentProbe(g.a);
          expect(report.violations.length).toBeGreaterThan(0);
        } finally {
          g.cleanup();
        }
      }
    },
    T,
  );

  test(
    "row 2 refuse leg: a peer bound to another project → REFUSE",
    withGlacy({ b: { project: "GX" } }, (g) => {
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 2)).toBe("REFUSE");
    }),
    T,
  );

  test(
    "row 2 refuse leg: a peer declaring the same tag → REFUSE",
    withGlacy({ b: { repoTag: "glacy-be" } }, (g) => {
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 2)).toBe("REFUSE");
      expect(rowLine(r.stdout, 2)).toContain("glacy-be");
    }),
    T,
  );
});

describe("AC-STE-612.2 — row 3: the issue type is reconciled", () => {
  test(
    "row 3 pass leg: jira_issue_type Task, offered by GF, same at the peer → PASS",
    withGlacy({}, (g) => {
      expect(verdict(runRepoint(g.args()).stdout, 3)).toBe("PASS");
    }),
    T,
  );
  test(
    "row 3 refuse leg: no jira_issue_type → REFUSE",
    withGlacy({ a: { issueType: undefined } }, (g) => {
      expect(verdict(runRepoint(g.args()).stdout, 3)).toBe("REFUSE");
    }),
    T,
  );
  test(
    "row 3 refuse leg: jira_issue_type Story, which GF does not offer → REFUSE",
    withGlacy({ a: { issueType: "Story" }, b: { issueType: "Story" } }, (g) => {
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 3)).toBe("REFUSE");
      expect(rowLine(r.stdout, 3)).toContain("Story");
    }),
    T,
  );
  test(
    "row 3 refuse leg: the peer declares a different issue type → REFUSE",
    withGlacy({ b: { issueType: "Bug" } }, (g) => {
      expect(verdict(runRepoint(g.args()).stdout, 3)).toBe("REFUSE");
    }),
    T,
  );
  test(
    "row 3 Linear leg: NOT-APPLICABLE",
    async () => {
      const f = makeSpanFixture("M_ste612_lin");
      const lst = mkdtempSync(join(tmpdir(), "dpt-ste612-lin-"));
      try {
        writeFileSync(join(f.a, "CLAUDE.md"), linearClaudeMdText({ team: "STE", project: "Old Proj" }));
        writeMcpJson(f.a, { linear: LINEAR_URL });
        writeTrackerConfig(f.a, "linear", ["Todo", "In Progress", "Done"]);
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
        expect(verdict(r.stdout, 3)).toBe("NOT-APPLICABLE");
      } finally {
        f.cleanup();
        rmSync(lst, { recursive: true, force: true });
      }
    },
    T,
  );
});

describe("AC-STE-612.2 — a plain move into an empty project is not forced to declare a tag", () => {
  const plain: GlacyOpts = { a: { repoTag: undefined, defaultLabels: undefined, paragraph: "none", issueType: undefined } };
  const emptyListings = (g: Glacy) => ({
    "--containers": g.listing("c-empty.json", jiraEpics("GF", [])),
    "--labels": g.listing("l-empty.json", jiraLabels([])),
  });

  test(
    "permit leg: empty --containers and --labels, no peer, no repo_tag → rows 2 and 3 NOT-APPLICABLE naming both listings, exit 0",
    withGlacy(plain, (g) => {
      const r = runRepoint(g.args(emptyListings(g), []));
      for (const n of [2, 3]) {
        expect(verdict(r.stdout, n), rowLine(r.stdout, n)).toBe("NOT-APPLICABLE");
        expect(rowLine(r.stdout, n)).toMatch(/containers/);
        expect(rowLine(r.stdout, n)).toMatch(/labels/);
      }
      expect(r.code).toBe(0);
    }),
    T,
  );

  const sharers: Array<[string, (g: Glacy) => { overrides: Record<string, string>; peers: string[] }]> = [
    ["one listed container", (g) => ({ overrides: { ...emptyListings(g), "--containers": g.listing("c1.json", jiraEpics("GF", ["GF-80"])) }, peers: [] })],
    ["one listed label", (g) => ({ overrides: { ...emptyListings(g), "--labels": g.listing("l1.json", jiraLabels(["glacy-fe"])) }, peers: [] })],
    ["a declared repo_tag", (g) => {
      writeFileSync(join(g.a, "CLAUDE.md"), jiraClaudeMdText({ project: "GB", repoTag: "glacy-be" }));
      return { overrides: emptyListings(g), peers: [] };
    }],
  ];
  for (const [label, prep] of sharers) {
    test(
      `shared leg: ${label} → rows 2 and 3 both apply (a real PASS or REFUSE)`,
      withGlacy(plain, (g) => {
        const { overrides, peers } = prep(g);
        const r = runRepoint(g.args(overrides, peers));
        for (const n of [2, 3]) expect(["PASS", "REFUSE"], rowLine(r.stdout, n)).toContain(verdict(r.stdout, n));
      }),
      T,
    );
  }
});

// ===========================================================================
// AC-STE-612.3 — rows 4 to 6
// ===========================================================================

describe("AC-STE-612.3 — row 4: the tracker config covers the new project's statuses", () => {
  test(
    "row 4 pass leg: config statuses ⊇ GF statuses → PASS",
    withGlacy({}, (g) => {
      expect(verdict(runRepoint(g.args()).stdout, 4)).toBe("PASS");
    }),
    T,
  );
  test(
    "row 4 refuse leg: GF lists `QA`, the config lacks it → REFUSE naming QA",
    withGlacy({}, (g) => {
      const r = runRepoint(g.args({ "--statuses": g.listing("s.json", statusListing([...GF_STATUSES, "QA"])) }));
      expect(verdict(r.stdout, 4)).toBe("REFUSE");
      expect(rowLine(r.stdout, 4)).toContain("QA");
    }),
    T,
  );
  test(
    "row 4 refuse leg: no specs/tracker-config.yaml → REFUSE naming every missing status",
    withGlacy({}, (g) => {
      rmSync(join(g.a, "specs", "tracker-config.yaml"));
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 4)).toBe("REFUSE");
      for (const s of GF_STATUSES) expect(rowLine(r.stdout, 4)).toContain(s);
    }),
    T,
  );
});

describe("AC-STE-612.3 — row 5: one server", () => {
  test(
    "row 5 pass leg: same URL under two spellings → PASS naming both spellings",
    withGlacy({}, (g) => {
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 5)).toBe("PASS");
      expect(rowLine(r.stdout, 5)).toContain("atlassian");
      expect(rowLine(r.stdout, 5)).toContain("claude.ai Atlassian");
    }),
    T,
  );
  test(
    "row 5 refuse leg: the peer's entry points at a different URL → REFUSE",
    withGlacy({ peerUrl: "https://other.example.invalid/sse" }, (g) => {
      expect(verdict(runRepoint(g.args()).stdout, 5)).toBe("REFUSE");
    }),
    T,
  );
  test(
    "row 5 refuse leg: mcp_server names no entry in .mcp.json → REFUSE",
    withGlacy({ a: { mcpServer: "jira-cloud" } }, (g) => {
      expect(verdict(runRepoint(g.args()).stdout, 5)).toBe("REFUSE");
    }),
    T,
  );
  test("(control) the peer fixture really uses the second spelling and the same URL", () => {
    const g = makeGlacy();
    try {
      const peer = JSON.parse(readFileSync(join(g.b, ".mcp.json"), "utf-8"));
      expect(peer.mcpServers["claude.ai Atlassian"].url).toBe(ATLASSIAN_URL);
    } finally {
      g.cleanup();
    }
  });
});

describe("AC-STE-612.3 — row 6: no active numeric plan collides", () => {
  test(
    "row 6 pass leg: the archived-only overlap passes as `overlap=<computed> archived tokens` (17 measured)",
    withGlacy({}, (g) => {
      // Computed from the fixture, never typed: archived numeric plans ∩ GF's milestone-M<N> labels.
      const archived = new Set(
        Array.from({ length: 39 }, (_, i) => `M${i + 1}`),
      );
      const labelled = measuredGfLabels()
        .map((l) => /^milestone-(M\d+)$/.exec(l)?.[1])
        .filter((t): t is string => t !== undefined);
      const overlap = labelled.filter((t) => archived.has(t)).length;
      expect(overlap).toBe(17); // (control) the measured pair's figure
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 6)).toBe("PASS");
      expect(rowLine(r.stdout, 6)).toContain(`overlap=${overlap} archived tokens`);
    }),
    T,
  );
  test(
    "row 6 refuse leg (Jira): active M24 whose milestone-M24 label exists in GF → REFUSE naming M24",
    withGlacy({}, (g) => {
      writePlan(g.a, "M24", "active");
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 6)).toBe("REFUSE");
      expect(rowLine(r.stdout, 6)).toContain("M24");
    }),
    T,
  );
  test(
    "row 6 pass leg (Jira): active M50, no milestone-M50 label in GF → PASS",
    withGlacy({}, (g) => {
      writePlan(g.a, "M50", "active");
      expect(verdict(runRepoint(g.args()).stdout, 6)).toBe("PASS");
    }),
    T,
  );

  const linearRow6 = async (
    containerName: string,
    extraRows: Array<{ id: string; name: string }> = [],
    projects: unknown = { projects: [{ id: "p-1", name: "New Proj" }], hasNextPage: false },
  ): Promise<string> => {
    const f = makeSpanFixture("M_ste612_l6");
    const lst = mkdtempSync(join(tmpdir(), "dpt-ste612-l6-"));
    try {
      writeFileSync(join(f.a, "CLAUDE.md"), linearClaudeMdText({ team: "STE", project: "Old Proj" }));
      writeMcpJson(f.a, { linear: LINEAR_URL });
      writeTrackerConfig(f.a, "linear", ["Todo", "In Progress", "Done"]);
      writePlan(f.a, "M12", "active", "Checkout");
      commitAll(f.a, "linear fixture");
      const w = (n: string, c: unknown) => {
        const p = join(lst, n);
        writeFileSync(p, JSON.stringify(c));
        return p;
      };
      return runRepoint([
        f.a, "linear", "New Proj",
        "--projects", w("p.json", projects),
        "--containers", w("c.json", { milestones: [{ id: "550e8400-e29b-41d4-a716-446655440000", name: containerName }, ...extraRows] }),
        "--statuses", w("s.json", linearStatuses(["Todo", "In Progress", "Done"])),
      ]).stdout;
    } finally {
      f.cleanup();
      rmSync(lst, { recursive: true, force: true });
    }
  };
  test("row 6 refuse leg (Linear): active M12 and a milestone of the same canonical name → REFUSE", async () => {
    const out = await linearRow6("M12 — Checkout");
    expect(verdict(out, 6)).toBe("REFUSE");
  }, T);
  test("row 6 pass leg (Linear): no milestone of that name → PASS", async () => {
    const out = await linearRow6("Something Else");
    expect(verdict(out, 6)).toBe("PASS");
  }, T);
  // The measured list_milestones answer holds at most LINEAR_MILESTONE_WINDOW
  // rows with no paging field: a full window proves nothing past it, so a
  // collision there is unseen and the row cannot pass.
  const liveWindow = (): Array<{ id: string; name: string }> =>
    JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "live-shapes", "linear", "list_milestones.json"), "utf-8")).answer.milestones;
  test("row 6 refuse leg (Linear): a full 50-row window with no colliding name → REFUSE, naming the window", async () => {
    const out = await linearRow6("Something Else", liveWindow().slice(0, 49));
    expect(verdict(out, 6)).toBe("REFUSE");
    expect(out).toMatch(/^6 REFUSE .*50/m);
  }, T);
  // Row 1 (Linear): the measured list_projects answer pages at the top level.
  test("row 1 (Linear): a list_projects page saying more follow (hasNextPage + cursor) → REFUSE; its last page → PASS (twin)", async () => {
    const more = await linearRow6("Something Else", [], { projects: [{ id: "p-1", name: "New Proj" }], hasNextPage: true, cursor: "c2" });
    expect(verdict(more, 1)).toBe("REFUSE");
    const last = await linearRow6("Something Else");
    expect(verdict(last, 1)).toBe("PASS");
  }, T);
  test("row 1 (Linear): an unrecorded shape (no hasNextPage, or the invented pageInfo) → REFUSE", async () => {
    expect(verdict(await linearRow6("Something Else", [], { projects: [{ id: "p-1", name: "New Proj" }] }), 1)).toBe("REFUSE");
    expect(verdict(await linearRow6("Something Else", [], { projects: [{ id: "p-1", name: "New Proj" }], pageInfo: { hasNextPage: false } }), 1)).toBe("REFUSE");
  }, T);
  test("row 6 pass leg (Linear): 49 rows with no colliding name → PASS (the window is not full)", async () => {
    const out = await linearRow6("Something Else", liveWindow().slice(0, 48));
    expect(verdict(out, 6)).toBe("PASS");
  }, T);
});

// ===========================================================================
// AC-STE-612.4 — row 7, the old-container rule, graded against HEAD semantics
// ===========================================================================

/**
 * The faithful pre-change-semantics sibling: HEAD's § 0c flip. The prose route
 * calls the sub-section writer with the new project and checks nothing, so it
 * flips whatever the repository's state. Run on a COPY of the fixture root.
 */
function headSemanticsFlip(root: string, adapter: WorkspaceAdapterKey, newProject: string): { flipped: boolean } {
  const copy = mkdtempSync(join(tmpdir(), "dpt-ste612-head-"));
  try {
    cpSync(root, copy, { recursive: true });
    writeTrackerSubsection(join(copy, "CLAUDE.md"), adapter, { project: newProject });
    return { flipped: readWorkspaceBinding(join(copy, "CLAUDE.md"), adapter).project === newProject };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

describe("AC-STE-612.4 — row 7: no active plan or FR is left in the old container", () => {
  test(
    "row 7 refuse leg: M_GB_40 active with GB-101 and GB-102 → REFUSE naming the plan and both FRs; nothing written",
    withGlacy({ activeGb40: true }, (g) => {
      const before = readClaudeMd(g.a);
      expect(headSemanticsFlip(g.a, "jira", "GF").flipped).toBe(true); // pre-change sibling: unguarded
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7)).toBe("REFUSE");
      for (const id of ["M_GB_40", "GB-101", "GB-102"]) expect(rowLine(r.stdout, 7)).toContain(id);
      // The plan is named for its cause — a container outside GF (probe #25's
      // `epicTokenOutside`) — not as a --containers miss.
      expect(rowLine(r.stdout, 7)).toContain("plan M_GB_40 its container is outside GF");
      expect(r.code).toBe(1);
      expectNothingWritten(g.a, before);
    }),
    T,
  );

  test(
    "row 7 permit leg: the same run after M_GB_40 and its FRs are archived → PASS",
    withGlacy({ activeGb40: true }, (g) => {
      rmSync(join(g.a, "specs", "plan", "M_GB_40.md"));
      rmSync(join(g.a, "specs", "frs", "GB-101.md"));
      rmSync(join(g.a, "specs", "frs", "GB-102.md"));
      writePlan(g.a, "M_GB_40", "archived", "Checkout");
      writeFr(g.a, "GB-101", "M_GB_40", "archived");
      writeFr(g.a, "GB-102", "M_GB_40", "archived");
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7)).toBe("PASS");
    }),
    T,
  );

  test(
    "row 7 refuse leg: an active Jira FR keyed GB-* (bound to a GF plan) refuses a repoint to GF",
    withGlacy({}, (g) => {
      writePlan(g.a, "M_GF_80", "active");
      writeFr(g.a, "GB-7", "M_GF_80", "active");
      expect(headSemanticsFlip(g.a, "jira", "GF").flipped).toBe(true); // pre-change sibling: unguarded
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7)).toBe("REFUSE");
      expect(rowLine(r.stdout, 7)).toContain("GB-7");
    }),
    T,
  );

  test(
    "row 7 refuse leg: an active plan with no milestone heading is named as a heading defect, not a --containers miss",
    withGlacy({}, (g) => {
      const plan = writePlan(g.a, "M_GF_80", "active");
      writeFileSync(plan, readFileSync(plan, "utf-8").replace(/^## .*$/m, "no heading here"));
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7)).toBe("REFUSE");
      expect(rowLine(r.stdout, 7)).toContain("M_GF_80");
      expect(rowLine(r.stdout, 7)).toMatch(/heading/i);
      expect(rowLine(r.stdout, 7)).not.toContain("resolves to no container in --containers");
    }),
    T,
  );

  test(
    "row 7 pass leg: an active GF FR that also carries `linear: STE-1` → PASS (only the Jira key is graded)",
    withGlacy({}, (g) => {
      writePlan(g.a, "M_GF_80", "active");
      writeFrRaw(g.a, "GF-9", "M_GF_80", "active", { jira: "GF-9", linear: "STE-1" });
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7), rowLine(r.stdout, 7)).toBe("PASS");
    }),
    T,
  );

  test(
    "row 7 pass leg: an active GF-keyed FR bound to a listed GF Epic → PASS",
    withGlacy({}, (g) => {
      writePlan(g.a, "M_GF_80", "active");
      writeFr(g.a, "GF-7", "M_GF_80", "active");
      expect(verdict(runRepoint(g.args()).stdout, 7)).toBe("PASS");
    }),
    T,
  );

  const linearRow7 = (milestoneId: string) => async () => {
    const f = makeSpanFixture("M_ste612_l7");
    const lst = mkdtempSync(join(tmpdir(), "dpt-ste612-l7-"));
    try {
      writeFileSync(join(f.a, "CLAUDE.md"), linearClaudeMdText({ team: "STE", project: "Old Proj" }));
      writeMcpJson(f.a, { linear: LINEAR_URL });
      writeTrackerConfig(f.a, "linear", ["Todo", "In Progress", "Done"]);
      writePlan(f.a, "M_550e84", "active", "Spans");
      commitAll(f.a, "linear fixture");
      const w = (n: string, c: unknown) => {
        const p = join(lst, n);
        writeFileSync(p, JSON.stringify(c));
        return p;
      };
      const resolves = milestoneId.startsWith("550e84");
      if (!resolves) expect(headSemanticsFlip(f.a, "linear", "New Proj").flipped).toBe(true); // pre-change sibling
      const r = runRepoint([
        f.a, "linear", "New Proj",
        "--projects", w("p.json", { projects: [{ id: "p-1", name: "New Proj" }], hasNextPage: false }),
        "--containers", w("c.json", { milestones: [{ id: milestoneId, name: "Spans" }] }),
        "--statuses", w("s.json", linearStatuses(["Todo", "In Progress", "Done"])),
      ]);
      if (resolves) {
        expect(verdict(r.stdout, 7)).toBe("PASS");
      } else {
        expect(verdict(r.stdout, 7)).toBe("REFUSE");
        expect(rowLine(r.stdout, 7)).toContain("M_550e84");
      }
    } finally {
      f.cleanup();
      rmSync(lst, { recursive: true, force: true });
    }
  };
  test(
    "row 7 refuse leg (Linear): active M_550e84 resolves to no milestone in --containers → REFUSE",
    linearRow7("aaaaaa00-e29b-41d4-a716-446655440000"),
    T,
  );
  test(
    "row 7 pass leg (Linear): active M_550e84 resolves to a listed milestone → PASS",
    linearRow7("550e8400-e29b-41d4-a716-446655440000"),
    T,
  );
});

// ---------------------------------------------------------------------------
// M_685ff6 pre-PR review — row 7 reads every ref, not one working tree. Active
// work bound to the old project on an unmerged branch, a second worktree or a
// remote-tracking ref refuses the flip; work archived on any ref does not.
// The forbid legs were red on 07655a75 (rows 1-7 PASS, the flip written).
// ---------------------------------------------------------------------------

describe("M_685ff6 review — row 7 reads the git state (worktrees, branches, remote-tracking refs)", () => {
  test(
    "M_GB_40 and GB-101 active only on an unmerged branch → row 7 REFUSE naming the branch; nothing written",
    withGlacy({}, (g) => {
      const before = readClaudeMd(g.a);
      git(g.a, "checkout", "-q", "-b", "feat/gb40");
      writePlan(g.a, "M_GB_40", "active", "Checkout");
      writeFr(g.a, "GB-101", "M_GB_40", "active");
      commitAll(g.a, "wip on branch");
      git(g.a, "checkout", "-q", "main");
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7), r.stdout).toBe("REFUSE");
      expect(rowLine(r.stdout, 7)).toContain("M_GB_40");
      expect(rowLine(r.stdout, 7)).toContain("GB-101");
      expect(rowLine(r.stdout, 7)).toContain("feat/gb40");
      expect(r.code).toBe(1);
      expectNothingWritten(g.a, before);
    }),
    T,
  );

  test(
    "an active GB-keyed FR only in a second worktree's uncommitted tree → row 7 REFUSE naming the worktree",
    withGlacy({}, (g) => {
      const wtParent = mkdtempSync(join(tmpdir(), "dpt-review-wt-"));
      const wt = join(wtParent, "glacy-be-wt");
      git(g.a, "worktree", "add", "-q", "-b", "feat/wt", wt);
      writePlan(wt, "M_GF_80", "active");
      writeFr(wt, "GB-7", "M_GF_80", "active");
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7), r.stdout).toBe("REFUSE");
      expect(rowLine(r.stdout, 7)).toContain("GB-7");
      expect(r.code).toBe(1);
      git(g.a, "worktree", "remove", "--force", wt);
      rmSync(wtParent, { recursive: true, force: true });
    }),
    T,
  );

  test(
    "(control) M_GB_40 live on a stale branch but archived on main (the squash-merged shape) → row 7 PASS",
    withGlacy({}, (g) => {
      git(g.a, "checkout", "-q", "-b", "feat/gb40-stale");
      writePlan(g.a, "M_GB_40", "active", "Checkout");
      writeFr(g.a, "GB-101", "M_GB_40", "active");
      commitAll(g.a, "wip on branch");
      git(g.a, "checkout", "-q", "main");
      writePlan(g.a, "M_GB_40", "archived", "Checkout");
      writeFr(g.a, "GB-101", "M_GB_40", "archived");
      commitAll(g.a, "archived on main");
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7), rowLine(r.stdout, 7)).toBe("PASS");
    }),
    T,
  );
});

describe("M_685ff6 review — row 7: an archive on a ref that is not checked out still counts", () => {
  test(
    "(control) M_GB_40 live on a stale branch, archived only on another branch, neither checked out → row 7 PASS",
    withGlacy({}, (g) => {
      git(g.a, "checkout", "-q", "-b", "feat/gb40-stale");
      writePlan(g.a, "M_GB_40", "active", "Checkout");
      writeFr(g.a, "GB-101", "M_GB_40", "active");
      commitAll(g.a, "wip on branch");
      git(g.a, "checkout", "-q", "-b", "trunk-archived");
      rmSync(join(g.a, "specs", "plan", "M_GB_40.md"));
      rmSync(join(g.a, "specs", "frs", "GB-101.md"));
      writePlan(g.a, "M_GB_40", "archived", "Checkout");
      writeFr(g.a, "GB-101", "M_GB_40", "archived");
      commitAll(g.a, "archived on the trunk branch");
      git(g.a, "checkout", "-q", "main");
      const r = runRepoint(g.args());
      expect(verdict(r.stdout, 7), rowLine(r.stdout, 7)).toBe("PASS");
    }),
    T,
  );
});

// M_2306b6 (STE-616) — a refusal must not induce the harm it exists to prevent.
//
// MEASURED LIVE, 2026-09-23. A smoke child rooted in the peer repository ran
// this command and met row 3's refusal: `--peer <A> declares jira_issue_type
// (none), not Task`. The refusal named a file, named a disagreement, and named
// no action the child could legally take — so the child took the illegal one
// and edited `<A>/CLAUDE.md` with a `perl -0pi` loop over both roots. The
// binding check induced a cross-repository write.
//
// Every peer-naming refusal is graded here, not row 3 alone: the same sentence
// shape is written six times across rows 2, 3 and 5, and this milestone has
// already shipped seven defects whose common cause was fixing one path and not
// its twin.
describe("M_2306b6 — a peer-naming refusal leaves this operator a legal path", () => {
  /** The defects of one reason line, or [] when the rule does not apply to it. */
  function peerRefusalDefects(reason: string, peer: string): string[] {
    if (!reason.includes(peer)) return []; // names no peer: this rule has nothing to say
    const out: string[] = [];
    if (!/do not edit/i.test(reason)) out.push("names a peer path without saying that peer is not this run's to edit");
    if (!reason.includes(`re-run without --peer ${peer}`)) out.push("offers no action this operator can take alone");
    return out;
  }

  const LEGS: Array<[string, GlacyOpts]> = [
    ["row 2 — the peer declares no repo_tag", { b: { repoTag: undefined } }],
    ["row 2 — the peer declares the same repo_tag", { b: { repoTag: "glacy-be" } }],
    ["row 2 — the peer is bound to another project", { b: { project: "GX" } }],
    ["row 3 — the peer declares a different issue type", { b: { issueType: "Bug" } }],
    ["row 3 — the peer declares NO issue type (the live shape)", { b: { issueType: undefined } }],
    ["row 5 — the peer's mcp entry points elsewhere", { peerUrl: "https://other.invalid/mcp" }],
  ];

  for (const [name, opts] of LEGS) {
    test(
      `${name}: still REFUSES, and its reason names the peer as not ours to edit plus an action we can take`,
      withGlacy(opts, (g) => {
        const out = runRepoint(g.args()).stdout;
        const line = rowLines(out).find((l) => l.includes(g.b));
        expect(line, `no row named the peer:\n${out}`).toBeDefined();
        expect(line!).toMatch(/REFUSE/);
        expect(peerRefusalDefects(line!, g.b), line).toEqual([]);
      }),
      T,
    );
  }

  test("PERMIT — the all-agreeing run still passes every row (the rewording changed no verdict)", withGlacy({}, (g) => {
    const r = runRepoint(g.args());
    expect(verdict(r.stdout, 2)).toBe("PASS");
    expect(verdict(r.stdout, 3)).toBe("PASS");
    expect(verdict(r.stdout, 5)).toBe("PASS");
  }), T);

  test("CONTROL — the wording the live run actually met fails this rule, on both counts", () => {
    expect(peerRefusalDefects("--peer /tmp/peer declares jira_issue_type (none), not Task", "/tmp/peer")).toEqual([
      "names a peer path without saying that peer is not this run's to edit",
      "offers no action this operator can take alone",
    ]);
  });

  test(
    "the FLAG-shape refusals still refuse and still offer the always-available action, deliberately without the do-not-edit clause",
    withGlacy({}, (g) => {
      for (const [peer, expected] of [
        [join(g.lst, "no-such-dir"), "does not exist"],
        [join(g.lst, "projects.json"), "is not a directory"],
        [g.lst, "has no CLAUDE.md"],
      ] as const) {
        const out = runRepoint(g.args({}, [peer])).stdout;
        const line = rowLines(out).find((l) => l.includes(peer));
        expect(line, `no row named ${peer}:\n${out}`).toBeDefined();
        expect(line!).toMatch(/REFUSE/);
        expect(line!).toContain(expected);
        expect(line!).toContain(`re-run without --peer ${peer}`);
        // No declaration is in dispute here, so the do-not-edit clause would be
        // noise — the difference is deliberate, and recorded rather than assumed.
        expect(line!).not.toContain("do not edit");
      }
    }),
    T,
  );

  test("SOURCE PIN — no ninth peer sentence is written by hand: every `--peer <path>` reason comes from one of the two helpers", () => {
    const src = readFileSync(join(import.meta.dir, "..", "adapters", "_shared", "src", "repoint_tracker_binding.ts"), "utf-8");
    const sites = src.split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => l.includes("--peer ${"));
    expect(sites.map(([n]) => n).length, sites.map(([n, l]) => `${n}: ${l.trim()}`).join("\n")).toBe(2);
    expect(src).toContain("function peerRefusal(");
    expect(src).toContain("const peerFlagRefusal =");
  });

  test("CONTROL — the rule is vacuous for a refusal that names no peer, and stops being vacuous when one is named", () => {
    const own = "this repository declares no jira_issue_type";
    expect(peerRefusalDefects(own, "/tmp/peer")).toEqual([]);
    expect(peerRefusalDefects(`${own} (--peer /tmp/peer)`, "/tmp/peer").length).toBe(2);
  });
});
