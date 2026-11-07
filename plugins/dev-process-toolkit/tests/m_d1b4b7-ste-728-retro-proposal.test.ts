// STE-728 (M_d1b4b7) — a retrospective can propose a settings change the
// operator must approve.
//
//   AC-STE-728.1   PROPOSABLE_SETTINGS holds exactly the three rows, each with
//                  its key, value and trigger (each trigger graded through
//                  propose on a report carrying that skip alone).
//   AC-STE-728.16  sessionTranscriptPath finds the transcript from where the
//                  session runs: own slug, ancestor walk (nearest first), then
//                  the folder scan; null for none, two, or an unsafe id.
//   AC-STE-728.17  live approval, on the shape a running call sees: a child
//                  `apply` with no line for itself writes; a recorded `apply`
//                  result consumes; the receipt consumes on a restored tree;
//                  and a temp copy re-adding the old own-line step refuses.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  GATE_OUTCOMES_OFF,
  MODULE,
  TOKEN_STATS_OFF,
  TOOL_CALLS_OFF,
  apply,
  applyApproved,
  applyCommand,
  approve,
  cleanupTemps,
  expectRefusal,
  git,
  makeTree,
  pluginCopy,
  printedLines,
  propose,
  proposalMod,
  retroApplyReceipts,
  rewrite,
  sessionMod,
  settingsPath,
  sid,
  slugOf,
  snapshot,
  tempDir,
  writeReport,
} from "./_m_d1b4b7_ste728_fixture";

afterAll(cleanupTemps);

// ------------------------------------------------------------------ AC.1

describe("AC-STE-728.1 PROPOSABLE_SETTINGS is the closed three-row table", () => {
  test("exactly three rows: the three tracking switches, each proposing true", async () => {
    const { PROPOSABLE_SETTINGS } = await proposalMod();
    expect(Array.isArray(PROPOSABLE_SETTINGS)).toBe(true);
    expect(PROPOSABLE_SETTINGS.map((r: any) => [r.key, r.value])).toEqual([
      ["tracking.token_stats.enabled", true],
      ["tracking.tool_calls.enabled", true],
      ["tracking.gate_outcomes.enabled", true],
    ]);
  });

  test("every row carries a trigger", async () => {
    const { PROPOSABLE_SETTINGS } = await proposalMod();
    for (const r of PROPOSABLE_SETTINGS) {
      expect(Object.keys(r)).toContain("trigger");
      expect(r.trigger === null || r.trigger === undefined).toBe(false);
    }
  });

  const triggers: [string, () => any[], string][] = [
    ["tracking.token_stats.enabled", TOKEN_STATS_OFF, "cost_per_changed_line"],
    ["tracking.tool_calls.enabled", TOOL_CALLS_OFF, "zero_yield_round"],
    ["tracking.gate_outcomes.enabled", GATE_OUTCOMES_OFF, "slow_gate_run"],
  ];
  for (const [key, rows, rule] of triggers) {
    test(`trigger of ${key}: a report whose only skip is ${rule}'s names that row alone`, async () => {
      const root = makeTree(`ac1-${rule}`);
      const report = await writeReport(`ac1-${rule}`, rows());
      const r = propose(root, report);
      expect(r.status).toBe(0);
      const sets = printedLines(r.stdout).filter((l) => l.startsWith("set "));
      expect(sets).toEqual([`set ${key}: true`]);
      expect(printedLines(r.stdout).filter((l) => l.startsWith(`because ${rule} `))).toHaveLength(1);
    });
  }

  test("a slow_gate_run skip naming tracking.tool_calls off (not gate_outcomes) does not propose gate_outcomes", async () => {
    const root = makeTree("ac1-gate-not-triggered");
    const { rules, skipped, TOOL_CALLS_REASON } = await import("./_m_d1b4b7_ste728_fixture");
    const report = await writeReport("ac1-gate-not-triggered", rules([skipped("slow_gate_run", TOOL_CALLS_REASON)]));
    const r = propose(root, report);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("tracking.gate_outcomes.enabled");
  });
});

// ----------------------------------------------------------------- AC.16

const SID = sid(41);

function transcriptFile(configDir: string, folder: string, session = SID): string {
  const dir = join(configDir, "projects", slugOf(folder));
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${session}.jsonl`);
  writeFileSync(p, `${JSON.stringify({ type: "user", sessionId: session, message: { role: "user", content: "hi" } })}\n`);
  return p;
}

describe("AC-STE-728.16 sessionTranscriptPath finds the transcript from where the session runs", () => {
  test("a session launched in a subdirectory: found under the slug of <root>/plugins/x with cwd that subdirectory", async () => {
    const { sessionTranscriptPath } = await sessionMod();
    const root = tempDir("ac16-sub");
    const cwd = join(root, "plugins", "x");
    const config = tempDir("ac16-sub-config");
    const p = transcriptFile(config, cwd);
    expect(sessionTranscriptPath(SID, cwd, config)).toBe(p);
  });

  test("a transcript under the checkout root's slug, cwd a subdirectory of it: found through the ancestor walk", async () => {
    const { sessionTranscriptPath } = await sessionMod();
    const root = tempDir("ac16-ancestor");
    const config = tempDir("ac16-ancestor-config");
    const p = transcriptFile(config, root);
    expect(sessionTranscriptPath(SID, join(root, "a", "b"), config)).toBe(p);
  });

  test("a nearer ancestor's copy is preferred over a farther one", async () => {
    const { sessionTranscriptPath } = await sessionMod();
    const root = tempDir("ac16-nearer");
    const config = tempDir("ac16-nearer-config");
    transcriptFile(config, root);
    const near = transcriptFile(config, join(root, "plugins"));
    expect(sessionTranscriptPath(SID, join(root, "plugins", "x"), config)).toBe(near);
  });

  test("a transcript under another folder only: found by the folder scan", async () => {
    const { sessionTranscriptPath } = await sessionMod();
    const config = tempDir("ac16-scan-config");
    const other = join(tempDir("ac16-scan-other"), "repo-b");
    const p = transcriptFile(config, other);
    expect(sessionTranscriptPath(SID, join(tempDir("ac16-scan-here"), "repo-a"), config)).toBe(p);
  });

  test("null when no folder holds it", async () => {
    const { sessionTranscriptPath } = await sessionMod();
    const config = tempDir("ac16-none-config");
    transcriptFile(config, tempDir("ac16-none-other"), sid(42));
    expect(sessionTranscriptPath(SID, tempDir("ac16-none-here"), config)).toBeNull();
  });

  test("null when two unrelated folders hold it", async () => {
    const { sessionTranscriptPath } = await sessionMod();
    const config = tempDir("ac16-two-config");
    transcriptFile(config, tempDir("ac16-two-a"));
    transcriptFile(config, tempDir("ac16-two-b"));
    expect(sessionTranscriptPath(SID, tempDir("ac16-two-here"), config)).toBeNull();
  });

  for (const bad of ["../x", "a/b", ""]) {
    test(`null for the session id ${JSON.stringify(bad)}`, async () => {
      const { sessionTranscriptPath } = await sessionMod();
      const config = tempDir("ac16-bad-config");
      const cwd = tempDir("ac16-bad-cwd");
      // A file the crafted id would reach if it were joined unchecked.
      mkdirSync(join(config, "projects", slugOf(cwd)), { recursive: true });
      writeFileSync(join(config, "projects", "x.jsonl"), "{}\n");
      mkdirSync(join(config, "projects", slugOf(cwd), "a"), { recursive: true });
      writeFileSync(join(config, "projects", slugOf(cwd), "a", "b.jsonl"), "{}\n");
      writeFileSync(join(config, "projects", slugOf(cwd), ".jsonl"), "{}\n");
      expect(sessionTranscriptPath(bad, cwd, config)).toBeNull();
    });
  }

  test("the configDir parameter defaults to defaultConfigDir() (CLAUDE_CONFIG_DIR)", async () => {
    const { sessionTranscriptPath } = await sessionMod();
    const config = tempDir("ac16-default-config");
    const cwd = tempDir("ac16-default-cwd");
    const p = transcriptFile(config, cwd);
    const saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      expect(sessionTranscriptPath(SID, cwd)).toBe(p);
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = saved;
    }
  });
});

describe("AC-STE-728.16 apply locates its transcript through sessionTranscriptPath", () => {
  test("subdirectory launch: transcript under <root>/plugins/x, cwd that subdirectory, projectRoot the root — apply writes", async () => {
    const root = makeTree("ac16-apply-sub");
    const report = await writeReport("ac16-apply-sub", TOKEN_STATS_OFF());
    const cwd = join(root, "plugins", "x");
    mkdirSync(cwd, { recursive: true });
    const a = approve("ac16-apply-sub", root, report, { cwd });
    const r = applyApproved(a, { cwd });
    expect(r.status).toBe(0);
    expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/token_stats:\n {4}enabled: true/);
  });

  test("another worktree's slug: transcript under worktree B, cwd and projectRoot worktree A — found by the scan, apply writes", async () => {
    const root = makeTree("ac16-apply-wt");
    const other = join(tempDir("ac16-apply-wt-b"), "wt-b");
    git(root, "worktree", "add", "-q", "-b", "wt-b", other);
    const report = await writeReport("ac16-apply-wt", TOKEN_STATS_OFF());
    const a = approve("ac16-apply-wt", root, report, { folder: other });
    const r = applyApproved(a, { cwd: root });
    expect(r.status).toBe(0);
    expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/token_stats:\n {4}enabled: true/);
  });

  test("control: the old cwdToSlug(projectRoot) path holds no file for either fixture", async () => {
    const { cwdToSlug } = await sessionMod();
    const { existsSync } = await import("node:fs");
    // subdirectory launch
    const root = makeTree("ac16-ctl-sub");
    const report = await writeReport("ac16-ctl-sub", TOKEN_STATS_OFF());
    const cwd = join(root, "plugins", "x");
    mkdirSync(cwd, { recursive: true });
    const a = approve("ac16-ctl-sub", root, report, { cwd });
    expect(existsSync(a.path)).toBe(true);
    expect(existsSync(join(a.configDir, "projects", cwdToSlug(root), `${a.session}.jsonl`))).toBe(false);
    // other worktree
    const root2 = makeTree("ac16-ctl-wt");
    const other = join(tempDir("ac16-ctl-wt-b"), "wt-b");
    git(root2, "worktree", "add", "-q", "-b", "wt-b", other);
    const b = approve("ac16-ctl-wt", root2, report, { folder: other });
    expect(existsSync(b.path)).toBe(true);
    expect(existsSync(join(b.configDir, "projects", cwdToSlug(root2), `${b.session}.jsonl`))).toBe(false);
  });

  const nullRows: [string, (label: string) => Promise<{ root: string; run: () => any }>][] = [
    [
      "no copy of the transcript",
      async (label) => {
        const root = makeTree(label);
        const report = await writeReport(label, TOKEN_STATS_OFF());
        const a = approve(label, root, report, { folder: join(root, "elsewhere-not-cwd") });
        // Move it out of reach: rename the session so no file carries this id.
        const { renameSync } = await import("node:fs");
        renameSync(a.path, a.path.replace(a.session, sid(43)));
        return { root, run: () => applyApproved(a) };
      },
    ],
    [
      "two copies in two unrelated folders",
      async (label) => {
        const root = makeTree(label);
        const report = await writeReport(label, TOKEN_STATS_OFF());
        const a = approve(label, root, report, { folder: tempDir(`${label}-f1`) });
        rewrite(a, tempDir(`${label}-f2`));
        return { root, run: () => applyApproved(a) };
      },
    ],
    ...(["../x", "a/b", ""] as const).map(
      (bad) =>
        [
          `the session id ${JSON.stringify(bad)}`,
          async (label: string) => {
            const root = makeTree(label);
            const report = await writeReport(label, TOKEN_STATS_OFF());
            const a = approve(label, root, report);
            return { root, run: () => apply(root, report, a.digest, { cwd: root, configDir: a.configDir, session: bad }) };
          },
        ] as [string, (label: string) => Promise<{ root: string; run: () => any }>],
    ),
  ];
  nullRows.forEach(([name, build], i) => {
    test(`a null transcript lookup (${name}) makes apply refuse in NFR-10 shape and write nothing`, async () => {
      const { root, run } = await build(`ac16-null-${i}`);
      const before = snapshot(root);
      const r = run();
      expectRefusal(r);
      expect(snapshot(root)).toEqual(before);
    });
  });

  test("source scan: retro_proposal.ts holds no cwdToSlug(projectRoot)", () => {
    const src = readFileSync(MODULE, "utf-8");
    expect(src).not.toMatch(/cwdToSlug\(\s*projectRoot\s*\)/);
  });
});

// ----------------------------------------------------------------- AC.17

describe("AC-STE-728.17 live approval, graded on the shape a running call sees", () => {
  test("a child apply against a transcript with the propose result, the answer and no apply line writes", async () => {
    const root = makeTree("ac17-live");
    const report = await writeReport("ac17-live", TOKEN_STATS_OFF());
    const a = approve("ac17-live", root, report);
    expect(a.transcript.text()).not.toContain(" apply ");
    const r = applyApproved(a);
    expect(r.status).toBe(0);
    expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/token_stats:\n {4}enabled: true/);
  });

  test("the same child against the same transcript plus a recorded apply result after the answer refuses and writes nothing", async () => {
    const root = makeTree("ac17-recorded");
    const report = await writeReport("ac17-recorded", TOKEN_STATS_OFF());
    const a = approve("ac17-recorded", root, report);
    a.transcript.bash(applyCommand(root, report, a.digest), "applied");
    rewrite(a);
    const before = snapshot(root);
    const r = applyApproved(a);
    expectRefusal(r);
    expect(snapshot(root)).toEqual(before);
  });

  test("after a first child wrote, a second child on the tree restored to the approved bytes refuses through the receipt", async () => {
    const root = makeTree("ac17-receipt");
    const report = await writeReport("ac17-receipt", TOKEN_STATS_OFF());
    const a = approve("ac17-receipt", root, report);
    const approvedBytes = readFileSync(settingsPath(root));
    expect(applyApproved(a).status).toBe(0);
    expect(retroApplyReceipts(root, a.session)).toHaveLength(1);
    writeFileSync(settingsPath(root), approvedBytes);
    const before = snapshot(root);
    const r = applyApproved(a);
    expectRefusal(r);
    expect(snapshot(root)).toEqual(before);
    expect(retroApplyReceipts(root, a.session)).toHaveLength(1);
  });

  // The old step 3, re-added in a temp copy: refuse unless the transcript
  // records a Bash line for this apply call itself.
  const OWN_LINE_STEP = [
    'if (import.meta.main && process.argv[2] === "apply") {',
    '  const { sessionTranscriptPath } = await import("./find_current_session");',
    "  const p = sessionTranscriptPath(process.env.CLAUDE_CODE_SESSION_ID ?? \"\", process.cwd());",
    '  const text = p === null ? "" : (await import("node:fs")).readFileSync(p, "utf-8");',
    "  const own = text.split(\"\\n\").some((l) => l.includes('\"tool_use\"') && l.includes(\"retro_proposal\") && l.includes(\" apply \") && l.includes(process.argv[5] ?? \"\\u0000\"));",
    "  if (!own) {",
    '    process.stderr.write("Refusing: the transcript records no line for this apply call\\nRemedy: re-run propose and ask again\\nContext: verb=apply\\n");',
    "    process.exit(1);",
    "  }",
    "}",
  ].join("\n");

  function ownLineCopy(label: string, mutate: boolean): string {
    const door = pluginCopy(label);
    if (mutate) {
      const text = readFileSync(door, "utf-8");
      const at = text.search(/^if \(import\.meta\.main\)/m);
      if (at < 0) throw new Error("retro_proposal.ts has no `if (import.meta.main)` guard to inject before");
      writeFileSync(door, `${text.slice(0, at)}${OWN_LINE_STEP}\n${text.slice(at)}`);
    }
    return door;
  }

  async function liveFixtureWrites(module: string, label: string): Promise<boolean> {
    const root = makeTree(label);
    const report = await writeReport(label, TOKEN_STATS_OFF());
    const a = approve(label, root, report, { module });
    const r = applyApproved(a, { module });
    return r.status === 0 && /token_stats:\n {4}enabled: true/.test(readFileSync(settingsPath(root), "utf-8"));
  }

  test("control: the unmutated temp copy writes on the live fixture", async () => {
    expect(await liveFixtureWrites(ownLineCopy("ac17-copy-control", false), "ac17-copy-control-tree")).toBe(true);
  });

  test("the copy re-adding the own-line step refuses the live fixture", async () => {
    expect(await liveFixtureWrites(ownLineCopy("ac17-copy-mutant", true), "ac17-copy-mutant-tree")).toBe(false);
  });
});
