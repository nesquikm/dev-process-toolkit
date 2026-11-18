// STE-756 (M_d1e7b1) — one probe runner prints a fixed row per probe, and the
// smoke fixtures grade that row instead of the prose around it.
//
// The expected values here are anchored on what the test controls: literal
// rows, staged fixture projects, committed captures, and the numbered
// registrations in skills/gate-check/SKILL.md parsed by this file's own
// pattern (never by the runner's table).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const RUNNER = join(SHARED, "gate_probe_runner.ts");
const ROWS = join(SHARED, "gate_probe_rows.ts");
const CAP_ASSERT = join(SHARED, "capability_row_assert.ts");
const GATE_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");
const CAPTURES = join(PLUGIN_ROOT, "tests", "fixtures", "m_d1e7b1-ste-756");
const M127_CAPTURES = join(PLUGIN_ROOT, "tests", "fixtures", "m127-falsifiability");

// ---------------------------------------------------------------------------
// The SKILL registry, parsed independently of the runner.
// ---------------------------------------------------------------------------

interface Registration {
  n: number;
  /** The backticked id in the bold label, when the registration has one. */
  id: string | null;
  /** The function named by the registration's `call `fn(args)``, if any. */
  fn: string | null;
  args: string | null;
  /** The first `**Severity: …**` text on the registration line, if any. */
  severityText: string | null;
}

function readRegistrations(): Registration[] {
  const lines = readFileSync(GATE_SKILL, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("## Conformance Probes"));
  const end = lines.findIndex((l, i) => i > start && /^#{2,3} /.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const out: Registration[] = [];
  for (const line of lines.slice(start + 1, end)) {
    const reg = parseRegistrationLine(line); // Amended by AC-STE-756.5 (M_d1e7b1)
    if (reg) out.push(reg); // Amended by AC-STE-756.5 (M_d1e7b1)
  }
  return out;
}

/**
 * One numbered registration line, read from its CALL SHAPE: the first
 * backticked `fn(args)` token anywhere on the line (the identifier may carry
 * dots, e.g. `Provider.getTicketStatus(<tracker-ref>)`), not only the one
 * after the verb "call". Amended by AC-STE-756.5 (M_d1e7b1).
 */
function parseRegistrationLine(line: string): Registration | null {
  const head = /^(\d+)\. /.exec(line);
  if (!head) return null;
  const id = /^\d+\. \*\*`([^`]+)`\*\*/.exec(line)?.[1] ?? null;
  const call = /`([A-Za-z_][A-Za-z0-9_.]*)\(([^)`]*)\)`/.exec(line); // Amended by AC-STE-756.5 (M_d1e7b1)
  const sev = /\*\*Severity: ([^*]+)\*\*/.exec(line)?.[1] ?? null;
  return {
    n: Number(head[1]),
    id,
    fn: call?.[1] ?? null,
    args: call ? call[2]!.trim() : null,
    severityText: sev,
  };
}

function projectRootOnly(): Registration[] {
  return readRegistrations().filter((r) => r.args === "projectRoot");
}

/** Map a registration's `Severity:` text onto the runner's severity classes. */
function declaredSeverity(text: string): "error" | "warning" | "note" | null {
  const t = text.trim().toLowerCase();
  if (t.startsWith("error")) return "error";
  if (t.startsWith("warning")) return "warning";
  if (/^(notes?|info|advisory)\b/.test(t)) return "note";
  return null; // e.g. "routed per file": the report carries its own severity
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runBun(args: string[], cwd = PLUGIN_ROOT, timeoutMs = 120_000) {
  const proc = Bun.spawnSync(["bun", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function probeRow(capture: string, n: number, ...verdicts: string[]) {
  return runBun([CAP_ASSERT, "probe-row", capture, String(n), ...verdicts]);
}

function stagedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-756-"));
  mkdirSync(join(dir, "specs"), { recursive: true });
  // A bare directory-tree fence carrying a path-shaped leaf that does not
  // exist: probe #37 reports exactly one violation for it.
  writeFileSync(
    join(dir, "specs", "technical-spec.md"),
    "# T\n\n```\nsrc/staleref-fixture-756.ts\n```\n",
  );
  return dir;
}

type Entry = {
  n: number;
  id: string;
  severity: "error" | "warning" | "note";
  run: (projectRoot: string) => unknown;
  vacuityNotes?: true; // Amended by AC-STE-756.3 (M_d1e7b1)
};

async function rowsMod() {
  return await import(ROWS);
}
async function runnerMod() {
  return await import(RUNNER);
}

// ---------------------------------------------------------------------------
// AC-STE-756.2 — the row grammar, defined once
// ---------------------------------------------------------------------------

describe("AC-STE-756.2 row grammar (gate_probe_rows.ts)", () => {
  test("renderProbeRow renders `probe #<N> <probe-id>: <verdict> (<count>)`", async () => {
    const { renderProbeRow } = await rowsMod();
    expect(
      renderProbeRow({ n: 37, id: "cross-cutting-spec-stale-file-refs", verdict: "notes", count: 1 }),
    ).toBe("probe #37 cross-cutting-spec-stale-file-refs: notes (1)");
  });

  test("renderProbeRow renders a vacuous zero-count row", async () => {
    const { renderProbeRow } = await rowsMod();
    expect(renderProbeRow({ n: 73, id: "plan_identity_mode_conditional", verdict: "vacuous", count: 0 })).toBe(
      "probe #73 plan_identity_mode_conditional: vacuous (0)",
    );
  });

  test("parseProbeRows reads every row and nothing else from mixed text", async () => {
    const { parseProbeRows } = await rowsMod();
    const text = [
      "## Gate Check",
      "probe #13 identity_mode_conditional: fail (2)",
      "Probe #37 found a stale ref — NOTES",
      "probe #37 cross-cutting-spec-stale-file-refs: notes (1)",
      "#26 tracker-project-milestone-attached: NOTES",
      "probe #26 tracker-project-milestone-attached: ADVISORY (1)",
      "probe #12 docs-nav-contract: warning (1)",
      "probe #81 module_reachability: pass (0)",
      "conformance-probes pass: 2/3 [3 active, 0 vacuous]",
    ].join("\n");
    const rows = parseProbeRows(text).map((r: any) => [r.n, r.id, r.verdict, r.count]);
    expect(rows).toEqual([
      [13, "identity_mode_conditional", "fail", 2],
      [37, "cross-cutting-spec-stale-file-refs", "notes", 1],
      [81, "module_reachability", "pass", 0],
    ]);
  });

  test("parseProbeRows reads an error row as a fail of that probe", async () => {
    const { parseProbeRows } = await rowsMod();
    const rows = parseProbeRows("probe #20 bun-zero-match-placeholder: fail (error: ENOENT: no such file)");
    expect(rows.length).toBe(1);
    expect([rows[0].n, rows[0].id, rows[0].verdict]).toEqual([20, "bun-zero-match-placeholder", "fail"]);
  });

  test("parseProbeRows returns no rows for free prose", async () => {
    const { parseProbeRows } = await rowsMod();
    const prose = [
      "GATE PASSED WITH NOTES",
      "#37 cross-cutting-spec-stale-file-refs — NOTES",
      "note #37 about a stale reference",
      "probe #37: notes (1)",
      "probe 37 cross-cutting-spec-stale-file-refs: notes (1)",
    ].join("\n");
    expect(parseProbeRows(prose)).toEqual([]);
  });

  test("the runner and the assert import the grammar rather than restating it", () => {
    const runner = readFileSync(RUNNER, "utf8");
    const assert = readFileSync(CAP_ASSERT, "utf8");
    expect(runner).toMatch(/from\s+["']\.\/gate_probe_rows(\.ts)?["']/);
    expect(assert).toMatch(/from\s+["']\.\/gate_probe_rows(\.ts)?["']/);
    // The row literal lives in gate_probe_rows.ts only.
    expect(runner.includes("`probe #")).toBe(false);
    expect(assert.includes("`probe #")).toBe(false);
    expect(/probe #\\d|probe #\(\\d/.test(runner)).toBe(false);
    expect(/probe #\\d|probe #\(\\d/.test(assert)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-756.3 — the verdict is derived, never chosen
// ---------------------------------------------------------------------------

describe("AC-STE-756.3 verdict rule", () => {
  test("zero violations → pass", async () => {
    const { deriveVerdict } = await rowsMod();
    expect(deriveVerdict({ count: 0, vacuous: false, severity: "error" })).toBe("pass");
  });

  test("zero violations on a vacuous report → vacuous", async () => {
    const { deriveVerdict } = await rowsMod();
    expect(deriveVerdict({ count: 0, vacuous: true, severity: "error" })).toBe("vacuous");
  });

  test("violations on a warning-severity probe → notes", async () => {
    const { deriveVerdict } = await rowsMod();
    expect(deriveVerdict({ count: 2, vacuous: false, severity: "warning" })).toBe("notes");
  });

  test("violations on a note-severity probe → notes", async () => {
    const { deriveVerdict } = await rowsMod();
    expect(deriveVerdict({ count: 1, vacuous: false, severity: "note" })).toBe("notes");
  });

  test("violations on an error-severity probe → fail", async () => {
    const { deriveVerdict } = await rowsMod();
    expect(deriveVerdict({ count: 1, vacuous: false, severity: "error" })).toBe("fail");
  });

  test("the report's own severity field decides over the declared one (error declared, warning reported)", async () => {
    const { deriveVerdict } = await rowsMod();
    expect(
      deriveVerdict({ count: 1, vacuous: false, severity: "error", reportSeverity: "warning" }),
    ).toBe("notes");
  });

  test("the report's own severity field decides over the declared one (warning declared, error reported)", async () => {
    const { deriveVerdict } = await rowsMod();
    expect(
      deriveVerdict({ count: 1, vacuous: false, severity: "warning", reportSeverity: "error" }),
    ).toBe("fail");
  });

  test("the runner derives each row from the probe's own report (violations, vacuous, severity)", async () => {
    const { runGateProbes } = await runnerMod();
    const table: Entry[] = [
      { n: 1, id: "p-pass", severity: "error", run: async () => ({ violations: [] }) },
      { n: 2, id: "p-vacuous", severity: "error", run: async () => ({ violations: [], vacuous: true }) },
      { n: 3, id: "p-notes", severity: "warning", run: async () => ({ violations: [{}, {}] }) },
      { n: 4, id: "p-routed", severity: "error", run: async () => ({ violations: [{}], severity: "warning" }) },
      { n: 5, id: "p-fail", severity: "error", run: () => ({ violations: [{}, {}, {}] }) },
    ];
    const out = await runGateProbes("/nonexistent-ste-756", table);
    expect(out.rows).toEqual([
      "probe #1 p-pass: pass (0)",
      "probe #2 p-vacuous: vacuous (0)",
      "probe #3 p-notes: notes (2)",
      "probe #4 p-routed: notes (1)",
      "probe #5 p-fail: fail (3)",
    ]);
  });

  test("the declared severity table equals each registration's Severity: text", async () => {
    const { GATE_PROBES } = await runnerMod();
    const byN = new Map<number, Entry>((GATE_PROBES as Entry[]).map((e) => [e.n, e]));
    const mismatches: string[] = [];
    for (const r of projectRootOnly()) {
      if (!r.severityText) continue;
      const want = declaredSeverity(r.severityText);
      if (want === null) continue;
      const e = byN.get(r.n);
      if (!e) continue; // completeness is AC.5's test
      if (e.severity !== want) mismatches.push(`#${r.n} ${r.id}: runner=${e.severity} SKILL=${r.severityText.trim()}`);
    }
    expect(mismatches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-756.4 — a probe that throws
// ---------------------------------------------------------------------------

describe("AC-STE-756.4 throw path and exit code", () => {
  test("a throwing probe renders `fail (error: <message>)` and the runner continues", async () => {
    const { runGateProbes } = await runnerMod();
    const table: Entry[] = [
      { n: 7, id: "x-probe", severity: "warning", run: async () => { throw new Error("boom"); } },
      { n: 8, id: "y-probe", severity: "error", run: async () => ({ violations: [] }) },
    ];
    const out = await runGateProbes("/nonexistent-ste-756", table);
    expect(out.rows).toEqual(["probe #7 x-probe: fail (error: boom)", "probe #8 y-probe: pass (0)"]);
  });

  test("a multi-line error message renders as one line", async () => {
    const { runGateProbes } = await runnerMod();
    const table: Entry[] = [
      { n: 9, id: "z-probe", severity: "error", run: () => { throw new Error("first line\nsecond line"); } },
    ];
    const out = await runGateProbes("/nonexistent-ste-756", table);
    expect(out.rows.length).toBe(1);
    expect(out.rows[0]).not.toContain("\n");
    expect(out.rows[0].startsWith("probe #9 z-probe: fail (error: first line")).toBe(true);
    expect(out.rows[0].endsWith(")")).toBe(true);
  });

  test("exit code is 1 when any row is fail", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "a", severity: "error", run: async () => ({ violations: [] }) },
      { n: 2, id: "b", severity: "error", run: async () => ({ violations: [{}] }) },
    ]);
    expect(out.exitCode).toBe(1);
  });

  test("exit code is 1 when a probe throws", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "a", severity: "warning", run: async () => { throw new Error("x"); } },
    ]);
    expect(out.exitCode).toBe(1);
  });

  test("exit code is 0 when no row is fail (notes and vacuous do not fail)", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "a", severity: "error", run: async () => ({ violations: [] }) },
      { n: 2, id: "b", severity: "warning", run: async () => ({ violations: [{}] }) },
      { n: 3, id: "c", severity: "error", run: async () => ({ violations: [], vacuous: true }) },
    ]);
    expect(out.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-756.2 (summary) + AC-STE-756.1 — the runner as shipped
// ---------------------------------------------------------------------------

describe("AC-STE-756.2 summary line", () => {
  test("all-passing table → `conformance-probes pass: 4/4 [3 active, 1 vacuous]`", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "a", severity: "error", run: async () => ({ violations: [] }) },
      { n: 2, id: "b", severity: "error", run: async () => ({ violations: [] }) },
      { n: 3, id: "c", severity: "warning", run: async () => ({ violations: [{}] }) },
      { n: 4, id: "d", severity: "error", run: async () => ({ violations: [], vacuous: true }) },
    ]);
    expect(out.summary).toBe("conformance-probes pass: 4/4 [3 active, 1 vacuous]");
  });

  test("a failing row lowers the numerator only", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "a", severity: "error", run: async () => ({ violations: [] }) },
      { n: 2, id: "b", severity: "error", run: async () => ({ violations: [{}] }) },
    ]);
    expect(out.summary.startsWith("conformance-probes pass: 1/2 [")).toBe(true);
  });
});

describe("AC-STE-756.1 shipped runner CLI", () => {
  test("`bun gate_probe_runner.ts <projectRoot>` prints one row per probe in registration order, then the summary", async () => {
    const dir = stagedProject();
    try {
      const res = runBun([RUNNER, dir], PLUGIN_ROOT, 300_000);
      const lines = res.stdout.split("\n").filter((l) => l.trim().length > 0);
      const rowLines = lines.filter((l) => l.startsWith("probe #"));
      const expectedNs = projectRootOnly().map((r) => r.n);
      const got = rowLines.map((l) => Number(/^probe #(\d+) /.exec(l)?.[1]));
      expect(got).toEqual(expectedNs);
      const last = lines[lines.length - 1]!;
      expect(last).toMatch(/^conformance-probes pass: \d+\/(\d+) \[\d+ active, \d+ vacuous\]$/);
      expect(Number(/\/(\d+) /.exec(last)![1])).toBe(expectedNs.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  test("probe #37's row comes from the probe's own report: one stale ref staged → `notes (1)`", async () => {
    const dir = stagedProject();
    try {
      const res = runBun([RUNNER, dir], PLUGIN_ROOT, 300_000);
      expect(res.stdout.split("\n")).toContain("probe #37 cross-cutting-spec-stale-file-refs: notes (1)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  test("the runner statically imports the exported function each project-root-only registration names", () => {
    const src = readFileSync(RUNNER, "utf8");
    const missing = projectRootOnly()
      .filter((r) => r.fn && !new RegExp(`\\bimport\\b[^;]*\\b${r.fn}\\b[^;]*\\bfrom\\b`).test(src))
      .map((r) => `#${r.n} ${r.fn}`);
    expect(missing).toEqual([]);
  });

  test("the runner has an import.meta.main entry", () => {
    expect(readFileSync(RUNNER, "utf8")).toContain("import.meta.main");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-756.5 — runner set == project-root-only registrations
// ---------------------------------------------------------------------------

describe("AC-STE-756.5 completeness against the SKILL registry", () => {
  test("the registry parse sees the project-root-only probes and excludes the others", () => {
    const ns = new Set(projectRootOnly().map((r) => r.n));
    // Spot anchors read from the SKILL text: in, and out (multi-argument or no call).
    for (const n of [12, 13, 37, 73, 81]) expect(ns.has(n)).toBe(true);
    for (const n of [7, 8, 9, 14, 26, 49, 56]) expect(ns.has(n)).toBe(false); // Amended by AC-STE-756.5 (M_d1e7b1)
  });

  test("every project-root-only registration has a runner entry, and the runner has no other", async () => {
    const { GATE_PROBES } = await runnerMod();
    const runnerNs = new Set((GATE_PROBES as Entry[]).map((e) => e.n));
    const regs = projectRootOnly();
    const regNs = new Set(regs.map((r) => r.n));
    const missing = regs.filter((r) => !runnerNs.has(r.n)).map((r) => `#${r.n} ${r.id ?? r.fn}`);
    const extra = [...runnerNs].filter((n) => !regNs.has(n)).map((n) => `#${n}`);
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  test("the runner table is in registration order with one entry per probe", async () => {
    const { GATE_PROBES } = await runnerMod();
    const ns = (GATE_PROBES as Entry[]).map((e) => e.n);
    expect(ns).toEqual(projectRootOnly().map((r) => r.n));
  });

  test("each runner id equals the registration's own backticked id where it has one", async () => {
    const { GATE_PROBES } = await runnerMod();
    const byN = new Map<number, Entry>((GATE_PROBES as Entry[]).map((e) => [e.n, e]));
    const wrong: string[] = [];
    for (const r of projectRootOnly()) {
      const e = byN.get(r.n);
      if (!e) continue;
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(e.id)) wrong.push(`#${r.n} malformed id ${e.id}`);
      if (r.id && e.id !== r.id) wrong.push(`#${r.n} runner=${e.id} SKILL=${r.id}`);
    }
    expect(wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-756.6 — SKILL.md documents the grammar once and orders the runner
// ---------------------------------------------------------------------------

describe("AC-STE-756.6 gate-check SKILL.md", () => {
  const skill = () => readFileSync(GATE_SKILL, "utf8");
  const paragraphs = () => skill().split(/\n\s*\n/);

  test("the row grammar is documented exactly once", () => {
    const hits = skill().split("probe #<N> <probe-id>: <verdict> (<count>)").length - 1;
    expect(hits).toBe(1);
  });

  test("the SKILL tells the model to run the runner and quote its rows verbatim", () => {
    const p = paragraphs().filter(
      (x) => /bun (run )?"?\$\{CLAUDE_PLUGIN_ROOT\}\/adapters\/_shared\/src\/gate_probe_runner\.ts"? "?<projectRoot>"?/.test(x),
    );
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p.some((x) => /verbatim/i.test(x))).toBe(true);
  });

  test("the probes the runner does not call (#8, #14, #26) are rendered by the model in the same grammar", () => {
    const p = paragraphs().filter(
      (x) => /#8\b/.test(x) && /#14\b/.test(x) && /#26\b/.test(x) && /gate_probe_runner|grammar/.test(x),
    );
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p.some((x) => /same (row )?grammar/i.test(x))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-756.7 — capability_row_assert.ts `probe-row`
// ---------------------------------------------------------------------------

describe("AC-STE-756.7 probe-row expectation", () => {
  test("a runner probe's row is read from the runner's Bash tool_result", () => {
    const res = probeRow(join(CAPTURES, "runner-37-notes-prose-NOTE.ndjson"), 37, "notes");
    expect(res.exitCode).toBe(0);
  });

  test("exit 1 when the parsed verdict is not among the listed ones", () => {
    expect(probeRow(join(CAPTURES, "runner-37-notes-prose-NOTE.ndjson"), 13, "fail").exitCode).toBe(1);
  });

  test("several listed verdicts: any one matching passes", () => {
    expect(probeRow(join(CAPTURES, "runner-37-notes-prose-NOTE.ndjson"), 73, "pass", "vacuous").exitCode).toBe(0);
  });

  test("a tool_result given as a content-block array is read too", () => {
    expect(probeRow(join(CAPTURES, "runner-37-notes-prose-Warning.ndjson"), 13, "pass").exitCode).toBe(0);
  });

  test("a runner probe's row typed in assistant text does not count", () => {
    expect(probeRow(join(CAPTURES, "assistant-37-row-no-runner.ndjson"), 37, "notes").exitCode).toBe(1);
  });

  test("a runner probe's row in the tool_result of a different Bash command does not count", () => {
    expect(probeRow(join(CAPTURES, "other-bash-37-row.ndjson"), 37, "notes").exitCode).toBe(1);
  });

  test("a non-runner probe (#26) is read from the assistant text in the same grammar", () => {
    expect(probeRow(join(CAPTURES, "model-26-notes.ndjson"), 26, "notes").exitCode).toBe(0);
  });

  test("a non-runner probe's row with the wrong verdict exits 1", () => {
    expect(probeRow(join(CAPTURES, "model-26-notes.ndjson"), 26, "fail").exitCode).toBe(1);
  });

  test("a non-runner probe described only in prose (ADVISORY, NOTES) exits 1; the synthetic SKILL body does not count", () => {
    expect(probeRow(join(CAPTURES, "prose-26-advisory.ndjson"), 26, "notes").exitCode).toBe(1);
  });

  test("usage error (exit 2) without a verdict or with an unknown verdict", () => {
    const cap = join(CAPTURES, "runner-37-notes-prose-NOTE.ndjson");
    expect(runBun([CAP_ASSERT, "probe-row", cap, "37"]).exitCode).toBe(2);
    expect(probeRow(cap, 37, "NOTES").exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-756.9 — falsifiability on committed captures
// ---------------------------------------------------------------------------

describe("AC-STE-756.9 fixture 3c is decided by the runner row, not the prose", () => {
  for (const name of [
    "runner-37-notes-prose-NOTE.ndjson",
    "runner-37-notes-prose-Warning.ndjson",
    "runner-37-notes-prose-note37.ndjson",
  ]) {
    test(`runner row #37 notes passes 3c whatever the prose says (${name})`, () => {
      expect(probeRow(join(CAPTURES, name), 37, "notes").exitCode).toBe(0);
    });
  }

  test("a capture whose #37 runner row is `pass` fails 3c even when the prose says NOTES", () => {
    expect(probeRow(join(CAPTURES, "runner-37-pass-prose-NOTES.ndjson"), 37, "notes").exitCode).toBe(1);
  });

  test("a capture that says NOTES in prose but carries no runner row fails 3c", () => {
    expect(probeRow(join(CAPTURES, "prose-37-NOTES-no-runner.ndjson"), 37, "notes").exitCode).toBe(1);
  });

  test("the genuine 2026-08-16 probe-#37 captures (prose NOTES, no runner row) fail 3c", () => {
    for (const leg of ["linear", "jira", "none"]) {
      expect(probeRow(join(M127_CAPTURES, `gate-check-probe37-${leg}.ndjson`), 37, "notes").exitCode).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-756.8 — smoke fixtures assert with probe-row
// ---------------------------------------------------------------------------

function smokeSection(heading: string): string {
  const lines = readFileSync(SMOKE_SKILL, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`##### Sub-fixture ${heading} `));
  expect(start).toBeGreaterThanOrEqual(0);
  const rel = lines.slice(start + 1).findIndex((l) => /^#{1,5} /.test(l));
  return lines.slice(start, rel < 0 ? undefined : start + 1 + rel).join("\n");
}

/** Every CAP_ASSERT code span on a top-level bullet of the section. */
function capClauses(section: string): string[] {
  const out: string[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("- ")) continue;
    for (const m of line.matchAll(/`+([^`]*\$\{CAP_ASSERT\}[^`]*)`+/g)) out.push(m[1]!.trim());
  }
  return out;
}

function probeRowClauses(section: string) {
  return capClauses(section)
    .map((c) => c.split(/\s+/))
    .filter((t) => t[2] === "probe-row")
    .map((t) => ({ capture: t[3]!, n: Number(t[4]), verdicts: t.slice(5) }));
}

function expectClause(fixture: string, captureSuffix: string, n: number, check: (v: string[]) => boolean) {
  const hits = probeRowClauses(smokeSection(fixture)).filter(
    (c) => c.capture.endsWith(captureSuffix) && c.n === n && c.verdicts.length > 0 && check(c.verdicts),
  );
  expect(hits.length).toBeGreaterThanOrEqual(1);
}

const only = (...allowed: string[]) => (v: string[]) => v.every((x) => allowed.includes(x));

describe("AC-STE-756.8 smoke fixtures grade probe rows", () => {
  test("3c asserts `probe-row … ste222-probe.log 37 notes`", () => {
    expectClause("3c", "-ste222-probe.log", 37, only("notes"));
  });

  test("9a asserts `probe-row … ste450-tracker-block.log 13 fail`", () => {
    expectClause("9a", "-ste450-tracker-block.log", 13, only("fail"));
  });

  test("9a's control asserts probe #13 pass or vacuous on the control capture", () => {
    expectClause("9a", "-ste450-control.log", 13, only("pass", "vacuous"));
  });

  test("9b asserts `probe-row … ste450-plan-stem.log 73 fail`", () => {
    expectClause("9b", "-ste450-plan-stem.log", 73, only("fail"));
  });

  test("9b's control asserts probe #73 pass or vacuous on the control capture", () => {
    expectClause("9b", "-ste450-control.log", 73, only("pass", "vacuous"));
  });

  test("2a asserts probe #26 with probe-row on the positive capture", () => {
    expectClause("2a", "-ste221-positive.log", 26, (v) => v.includes("notes") && !v.includes("fail") && !v.includes("pass"));
  });

  test("2c asserts probe #26 with probe-row on the alias capture", () => {
    expectClause("2c", "-ste221-alias.log", 26, (v) => v.includes("notes") && !v.includes("fail") && !v.includes("pass"));
  });

  for (const fixture of ["3c", "9a", "9b"]) {
    test(`${fixture}'s CAP_ASSERT clauses carry no literal wording arm (NOTES, GATE PASSED WITH NOTES, error-severity)`, () => {
      const offending = capClauses(smokeSection(fixture)).filter(
        (c) => /GATE PASSED WITH NOTES/.test(c) || /(^|[\s"])NOTES([\s"]|$)/.test(c) || /error-severity/.test(c),
      );
      expect(offending).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-756.10 — probe #81 stays green
// ---------------------------------------------------------------------------

describe("AC-STE-756.10 module_reachability", () => {
  test("probe #81 reports no violation on the repository with the runner in place", async () => {
    // The runner must exist for this guard to mean anything.
    expect(await Bun.file(RUNNER).exists()).toBe(true);
    const { runModuleReachabilityProbe } = await import(join(SHARED, "module_reachability.ts"));
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    // Green = the pin has not moved and no error-severity row; the warning
    // catalogue row ("at the pinned count") is the probe's normal output.
    expect(report.violations.filter((v: any) => v.severity === "error").map((v: any) => v.message)).toEqual([]);
    expect(report.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Stage B review round 1
// ---------------------------------------------------------------------------

/** A temp project holding `files`, each path relative to its root. */
function stageTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-756-r1-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawnSync(
    [
      "git",
      "-c", "user.name=ste-756",
      "-c", "user.email=ste-756@example.invalid",
      "-c", "commit.gpgsign=false",
      "-c", "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  expect(proc.exitCode).toBe(0);
}

/** The shipped runner, over `projectRoot`, restricted to the real entry for probe #n. */
async function realRow(projectRoot: string, n: number): Promise<string> {
  const { GATE_PROBES, runGateProbes } = await runnerMod();
  const table = (GATE_PROBES as Entry[]).filter((e) => e.n === n);
  expect(table.length).toBe(1);
  const out = await runGateProbes(projectRoot, table);
  expect(out.rows.length).toBe(1);
  return out.rows[0];
}

/** The runner as written: the spelling the SKILL orders, expanded to this plugin by the shared grammar. */
const RUNNER_CALL = 'bun "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_probe_runner.ts" "/proj"';

/** A stream-json capture holding one Bash call per entry, each answered by its result text. */
function writeCapture(calls: { command: string; result: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-756-cap-"));
  const lines: string[] = [JSON.stringify({ type: "system", subtype: "init", cwd: "/proj" })];
  calls.forEach((c, i) => {
    const id = `toolu_r1_${i}`;
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: c.command } }] },
      }),
    );
    lines.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: c.result }] },
      }),
    );
  });
  lines.push(JSON.stringify({ type: "result", subtype: "success", is_error: false }));
  const path = join(dir, "capture.ndjson");
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

/** Plain prose of `n` words. */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

describe("Stage B review round 1", () => {
  // ---- item 1: probe #67 runs its plan half too ----------------------------

  test("AC-STE-756.1 — #67 runs the plan half: a fresh active plan with a 151+ word narrative subsection is not `pass`", async () => {
    const dir = stageTree({
      "specs/plan/M1.md": `---\nmilestone: M1\nstatus: active\n---\n\n# M1\n\n### Approach\n\n${words(170)}.\n`,
    });
    try {
      git(dir, "init", "-q");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "plan");
      const row = await realRow(dir, 67);
      expect(row).not.toBe("probe #67 fr_summary_altitude: pass (0)");
      expect(row).toBe("probe #67 fr_summary_altitude: fail (1)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---- item 2: probe #61 counts only unresolved rows -----------------------

  test("AC-STE-756.1 — #61 counts only `resolves === false` rows: a resolving reference is `pass (0)`, a missing one `fail (1)`", async () => {
    const dir = stageTree({
      "specs/requirements.md": "# Requirements\n\n## Design References\n\n- `docs/design.md` — the screen mock\n",
      "docs/design.md": "# Design\n",
    });
    try {
      expect(await realRow(dir, 61)).toBe("probe #61 design_references_resolve: pass (0)");
      rmSync(join(dir, "docs", "design.md"));
      expect(await realRow(dir, 61)).toBe("probe #61 design_references_resolve: fail (1)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---- item 3: per-violation severity ---------------------------------------

  test("AC-STE-756.3 — the runner over this repository checkout does not grade #81's warning catalogue row as `fail`", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes(REPO_ROOT);
    const row = (out.rows as string[]).find((r) => r.startsWith("probe #81 "));
    expect(row).toBeDefined();
    expect(row!).toMatch(/^probe #81 module_reachability: (pass|notes) \(\d+\)$/);
  }, 300_000);

  test("AC-STE-756.3 — per-violation severity: warning-only gives `notes`, warning plus error gives `fail`", async () => {
    const { deriveVerdict, runGateProbes } = await Promise.all([rowsMod(), runnerMod()]).then(([a, b]) => ({ ...a, ...b }));
    expect(
      deriveVerdict({ count: 2, vacuous: false, severity: "error", violationSeverities: ["warning", "warning"] }),
    ).toBe("notes");
    expect(
      deriveVerdict({ count: 2, vacuous: false, severity: "warning", violationSeverities: ["warning", "error"] }),
    ).toBe("fail");
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "w-only", severity: "error", run: () => ({ violations: [{ severity: "warning" }, { severity: "warning" }] }) },
      { n: 2, id: "mixed", severity: "warning", run: () => ({ violations: [{ severity: "warning" }, { severity: "error" }] }) },
      { n: 3, id: "array-w", severity: "error", run: () => [{ severity: "warning" }] },
    ]);
    expect(out.rows).toEqual(["probe #1 w-only: notes (2)", "probe #2 mixed: fail (2)", "probe #3 array-w: notes (1)"]);
  });

  // ---- item 4: unexpected report shapes ------------------------------------

  test("AC-STE-756.4 — a report with no array, no `violations` array and no boolean `ok` is an error row, never `pass`", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "findings", severity: "error", run: () => ({ findings: [] }) },
      { n: 2, id: "null", severity: "error", run: () => null },
      { n: 3, id: "string", severity: "warning", run: () => "all good" },
    ]);
    expect(out.rows).toEqual([
      "probe #1 findings: fail (error: unexpected report shape)",
      "probe #2 null: fail (error: unexpected report shape)",
      "probe #3 string: fail (error: unexpected report shape)",
    ]);
    expect(out.exitCode).toBe(1);
  });

  test("AC-STE-756.4 — every shipped entry's real report has a known shape, on this checkout and on an empty project", async () => {
    const { runGateProbes } = await runnerMod();
    const empty = mkdtempSync(join(tmpdir(), "ste-756-empty-"));
    try {
      for (const root of [REPO_ROOT, empty]) {
        const out = await runGateProbes(root);
        expect((out.rows as string[]).filter((r) => r.includes("unexpected report shape"))).toEqual([]);
      }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 300_000);

  // ---- item 5: an error row satisfies nothing ------------------------------

  test("AC-STE-756.7 — an error row satisfies no expectation: `probe-row <cap> 13 fail` exits 1", () => {
    const cap = writeCapture([
      { command: RUNNER_CALL, result: "probe #13 identity-mode-conditional: fail (error: boom)\nconformance-probes pass: 0/1 [1 active, 0 vacuous]" },
    ]);
    try {
      expect(probeRow(cap, 13, "fail").exitCode).toBe(1);
      expect(probeRow(cap, 13, "pass", "notes", "fail", "vacuous").exitCode).toBe(1);
    } finally {
      rmSync(join(cap, ".."), { recursive: true, force: true });
    }
  });

  // ---- item 6: only THIS plugin's runner counts ----------------------------

  test("AC-STE-756.7 — a same-named runner elsewhere does not count; this plugin's runner, by path or by plugin-root spelling, does", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "ste-756-spoof-"));
    const fake = join(elsewhere, "adapters", "_shared", "src", "gate_probe_runner.ts");
    mkdirSync(join(fake, ".."), { recursive: true });
    writeFileSync(fake, "console.log('probe #13 identity-mode-conditional: fail (1)');\n");
    const result = "probe #13 identity-mode-conditional: fail (1)\nconformance-probes pass: 0/1 [1 active, 0 vacuous]";
    const spoof = writeCapture([{ command: `bun ${fake} /proj`, result }]);
    const own = writeCapture([{ command: `bun ${RUNNER} /proj`, result }]);
    const spelled = writeCapture([{ command: RUNNER_CALL, result }]);
    try {
      expect(probeRow(spoof, 13, "fail").exitCode).toBe(1);
      expect(probeRow(own, 13, "fail").exitCode).toBe(0);
      expect(probeRow(spelled, 13, "fail").exitCode).toBe(0);
    } finally {
      for (const p of [elsewhere, join(spoof, ".."), join(own, ".."), join(spelled, "..")]) {
        rmSync(p, { recursive: true, force: true });
      }
    }
  });

  // ---- item 7: only the last runner call counts ----------------------------

  test("AC-STE-756.7 — only the LAST runner call's result counts: an early `13 pass` is superseded by a later `13 fail`", () => {
    const cap = writeCapture([
      { command: RUNNER_CALL, result: "probe #13 identity-mode-conditional: pass (0)\nconformance-probes pass: 1/1 [1 active, 0 vacuous]" },
      { command: RUNNER_CALL, result: "probe #13 identity-mode-conditional: fail (1)\nconformance-probes pass: 0/1 [1 active, 0 vacuous]" },
    ]);
    try {
      expect(probeRow(cap, 13, "pass").exitCode).toBe(1);
      expect(probeRow(cap, 13, "fail").exitCode).toBe(0);
    } finally {
      rmSync(join(cap, ".."), { recursive: true, force: true });
    }
  });

  // ---- item 8: committed runner captures print what the runner prints -----

  test("AC-STE-756.2 — every committed runner capture's rows and summary line are what the runner prints for them", async () => {
    const { runnerToolResultText } = await import(CAP_ASSERT);
    const { parseProbeRows } = await rowsMod();
    const { runGateProbes } = await runnerMod();
    const files = [
      ...readdirSync(CAPTURES).map((f) => join(CAPTURES, f)),
      ...readdirSync(M127_CAPTURES).filter((f) => /runner|-row-/.test(f)).map((f) => join(M127_CAPTURES, f)),
    ].filter((f) => f.endsWith(".ndjson"));
    let graded = 0;
    for (const file of files) {
      const text: string = runnerToolResultText(readFileSync(file, "utf8"));
      if (!text) continue;
      graded++;
      const rows = parseProbeRows(text);
      // Replay each row's verdict through the real runner, so the summary is the runner's, not this test's.
      const table: Entry[] = rows.map((r: any) => ({
        n: r.n,
        id: r.id,
        severity: r.verdict === "fail" ? "error" : "warning",
        run: () =>
          r.verdict === "vacuous"
            ? { violations: [], vacuous: true }
            : { violations: Array.from({ length: r.count }, () => ({})) },
      }));
      const out = await runGateProbes("/nonexistent-ste-756", table);
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      expect({ file, lines }).toEqual({ file, lines: [...out.rows, out.summary] });
    }
    expect(graded).toBeGreaterThanOrEqual(8);
  });

  // ---- item 9: the SKILL orders a plain call -------------------------------

  test("AC-STE-756.6 — the SKILL orders the runner as its own Bash call, with nothing before or after it", () => {
    const lines = readFileSync(GATE_SKILL, "utf8").split("\n");
    const at = lines.findIndex((l) => l.startsWith("Run `bun \"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_probe_runner.ts\""));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at]).toContain("as its own Bash call, with nothing before or after it");
  });

  // ---- the notes ruling: zero violations with notes is `notes (<n>)` ------

  test("AC-STE-756.3 — #69 upgrade_staleness: a legacy-monolith notes-only result reads `notes (2)`", async () => {
    const dir = stageTree({
      "specs/requirements.md": "# Requirements\n\n## 2. Functional Requirements\n\n### FR-8: Widget search {#FR-8}\n\n- AC-8.1: Query returns matches.\n",
    });
    try {
      expect(await realRow(dir, 69)).toBe("probe #69 upgrade_staleness: notes (2)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC-STE-756.3 — #75 active_plan_ship_ready: a ship-ready milestone note reads `notes (1)`", async () => {
    const dir = stageTree({
      "specs/plan/M1.md": "---\nmilestone: M1\nstatus: active\n---\n# M1\n",
      "specs/frs/archive/fr_a.md": "---\ntitle: A\nmilestone: M1\nstatus: archived\n---\n# A\n",
    });
    try {
      expect(await realRow(dir, 75)).toBe("probe #75 active_plan_ship_ready: notes (1)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC-STE-756.3 — #63 plan_ship_coherence: the parked-milestones note reads `notes (1)`", async () => {
    const dir = stageTree({
      "specs/plan/archive/M1.md": "---\nmilestone: M1\nship_state: parked\n---\n# M1\n",
    });
    try {
      expect(await realRow(dir, 63)).toBe("probe #63 plan_ship_coherence: notes (1)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC-STE-756.3 — #68 migration_coverage: the grandfathered tally plus an active-plan warning reads `notes (2)`", async () => {
    const dir = stageTree({
      "specs/plan/archive/M1.md": "---\nmilestone: M1\nshipped_in: v1.0.0\n---\n# M1\n",
      "specs/plan/M2.md": "---\nmilestone: M2\nstatus: active\n---\n# M2\n",
    });
    try {
      expect(await realRow(dir, 68)).toBe("probe #68 migration_coverage: notes (2)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The registry-wide pin. The probe set is derived, never typed: every
  // project-root-only registration whose named function's module declares a
  // `notes:` or `warnings:` report property.
  const runnerSrc = readFileSync(RUNNER, "utf8");
  const moduleOf = new Map<string, string>();
  for (const m of runnerSrc.matchAll(/^import \{ ([A-Za-z_][A-Za-z0-9_]*) \} from "\.\/([^"]+)";$/gm)) {
    moduleOf.set(m[1]!, join(SHARED, m[2]!));
  }
  const notesProbes: { n: number; key: "notes" | "warnings" }[] = [];
  for (const r of projectRootOnly()) {
    const mod = r.fn ? moduleOf.get(r.fn) : undefined;
    if (!mod) continue;
    const src = readFileSync(mod, "utf8");
    for (const key of ["notes", "warnings"] as const) {
      if (new RegExp(`^\\s*(readonly )?${key}\\??:`, "m").test(src)) notesProbes.push({ n: r.n, key });
    }
  }

  test("AC-STE-756.3 — the derived notes-bearing probe set is non-empty and holds the four named probes", () => {
    const ns = new Set(notesProbes.map((p) => p.n));
    for (const n of [63, 68, 69, 75]) expect(ns.has(n)).toBe(true);
    expect(notesProbes.some((p) => p.n === 68 && p.key === "warnings")).toBe(true);
  });

  for (const { n, key } of notesProbes) {
    test(`AC-STE-756.3 — #${n} routes a non-empty \`${key}\` list with zero violations to \`notes\``, async () => {
      const { GATE_PROBES, runGateProbes } = await runnerMod();
      const entry = (GATE_PROBES as Entry[]).find((e) => e.n === n)!;
      expect(entry).toBeDefined();
      const empty = mkdtempSync(join(tmpdir(), "ste-756-notes-"));
      try {
        // The probe's own report shape, with nothing wrong and one entry on the list.
        const base = (await entry.run(empty)) as Record<string, unknown>;
        const report: Record<string, unknown> = { ...base, vacuous: false, skipped: false, [key]: ["an informational entry"] };
        if (Array.isArray(base.violations)) report.violations = [];
        if (typeof base.ok === "boolean") report.ok = true;
        const out = await runGateProbes(empty, [{ ...entry, run: () => report }]);
        expect(out.rows).toEqual([`probe #${n} ${entry.id}: notes (1)`]);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  }
});

// ===========================================================================
// Stage B review round 2 (orchestrator-applied after the final review round)
// ===========================================================================

describe("Stage B review round 2", () => {
  test("AC-STE-756.3 — a report saying ok:false with an empty violations list is never a pass", async () => {
    const { runGateProbes } = await runnerMod();
    const run = await runGateProbes(PLUGIN_ROOT, [
      { n: 901, id: "fake-ok-false", severity: "error", run: () => ({ ok: false, violations: [] }) },
    ]);
    expect(run.rows).toEqual(["probe #901 fake-ok-false: fail (1)"]);
    expect(run.exitCode).toBe(1);
  });

  test("AC-STE-756.7 — only the runner's own call shape counts: one argument, the project root", async () => {
    const m = await import(CAP_ASSERT);
    const own = join(SHARED, "gate_probe_runner.ts");
    expect({
      one: m.runsGateProbeRunner(`bun ${own} /tmp/project`),
      variable: m.runsGateProbeRunner('bun "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_probe_runner.ts" "/tmp/project"'),
      none: m.runsGateProbeRunner(`bun ${own}`),
      two: m.runsGateProbeRunner(`bun ${own} /tmp/project /tmp/other`),
    }).toEqual({ one: true, variable: true, none: false, two: false });
  });
});

// ===========================================================================
// Fix round 1
// ===========================================================================

describe("AC-STE-756.3 (fix round 1) notes on a vacuous report, and unknown severities", () => {
  test("(i) a vacuous report with two notes reads `notes (2)`", async () => {
    const { deriveProbeOutcome } = await rowsMod();
    expect(deriveProbeOutcome({ count: 0, vacuous: true, notesCount: 2, severity: "error" })).toEqual({
      verdict: "notes",
      count: 2,
    });
  });

  test("(ii) the same report with vacuityNotes: true stays `vacuous (0)`", async () => {
    const { deriveProbeOutcome } = await rowsMod();
    expect(
      deriveProbeOutcome({ count: 0, vacuous: true, notesCount: 2, severity: "error", vacuityNotes: true }),
    ).toEqual({ verdict: "vacuous", count: 0 });
  });

  test("(iii) the runner: a vacuous report with a note reads `notes (1)`", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "vac-notes", severity: "error", run: () => ({ violations: [], vacuous: true, notes: ["x"] }) },
    ]);
    expect(out.rows).toEqual(["probe #1 vac-notes: notes (1)"]);
  });

  test("(iii) the runner: the same report on an entry declaring vacuityNotes reads `vacuous (0)`", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      {
        n: 1,
        id: "vac-notes",
        severity: "error",
        vacuityNotes: true,
        run: () => ({ violations: [], vacuous: true, notes: ["x"] }),
      },
    ]);
    expect(out.rows).toEqual(["probe #1 vac-notes: vacuous (0)"]);
  });

  test("(iv) exactly probe #62's runner entry declares vacuityNotes", async () => {
    const { GATE_PROBES } = await runnerMod();
    const declaring = (GATE_PROBES as Entry[]).filter((e) => e.vacuityNotes === true).map((e) => e.n);
    expect(declaring).toEqual([62]);
  });

  test("(v) a per-violation severity `high` gives `fail`", async () => {
    const { deriveProbeOutcome } = await rowsMod();
    expect(deriveProbeOutcome({ count: 1, vacuous: false, violationSeverities: ["high"], severity: "warning" }).verdict).toBe(
      "fail",
    );
  });

  // Audit advisory (fix round 1): a report-level severity the runner does not know fails closed too.
  test("(v) an unknown report-level severity gives `fail`; a known `warning` gives `notes`", async () => {
    const { deriveProbeOutcome } = await rowsMod();
    expect(deriveProbeOutcome({ count: 1, vacuous: false, reportSeverity: "high", severity: "warning" }).verdict).toBe("fail");
    expect(deriveProbeOutcome({ count: 1, vacuous: false, reportSeverity: "warning", severity: "error" }).verdict).toBe("notes");
  });

  test("(v) a per-violation severity `info` gives `fail`", async () => {
    const { deriveProbeOutcome } = await rowsMod();
    expect(deriveProbeOutcome({ count: 1, vacuous: false, violationSeverities: ["info"], severity: "warning" }).verdict).toBe(
      "fail",
    );
  });

  test("(v) a per-violation severity `warning` gives `notes`", async () => {
    const { deriveProbeOutcome } = await rowsMod();
    expect(
      deriveProbeOutcome({ count: 1, vacuous: false, violationSeverities: ["warning"], severity: "warning" }).verdict,
    ).toBe("notes");
  });

  test("(vi) S-f 756-f: a `{ skipped: true, ok: true }` report renders `vacuous (0)`", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes("/nonexistent-ste-756", [
      { n: 1, id: "skipped-ok", severity: "error", run: () => ({ skipped: true, ok: true }) },
    ]);
    expect(out.rows).toEqual(["probe #1 skipped-ok: vacuous (0)"]);
  });

  test("(vi) S-f 756-f: the live runner on this checkout renders `probe #12 docs-nav-contract: vacuous (0)`", async () => {
    expect(await realRow(REPO_ROOT, 12)).toBe("probe #12 docs-nav-contract: vacuous (0)");
  });

  test("(vii) S-f 756-g: #67 with a vacuous FR half and a measured plan half is not vacuous (`pass (0)`)", async () => {
    const { runPlanNarrativeAltitudeProbe } = await import(join(SHARED, "scan_plan_narrative_altitude.ts"));
    const dir = stageTree({
      "specs/plan/M1.md": `---\nmilestone: M1\nstatus: active\n---\n\n# M1\n\n### Approach\n\n${words(40)}.\n`,
    });
    try {
      // Precondition: the fixture really makes the plan half non-vacuous, with nothing to grade.
      const plan = runPlanNarrativeAltitudeProbe(dir);
      expect({ vacuous: plan.vacuous, violations: plan.violations.length }).toEqual({ vacuous: false, violations: 0 });
      expect(await realRow(dir, 67)).toBe("probe #67 fr_summary_altitude: pass (0)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(vii) S-f 756-g: #67 with neither half measured is `vacuous (0)`", async () => {
    const dir = stageTree({ "specs/requirements.md": "# Requirements\n" });
    try {
      expect(await realRow(dir, 67)).toBe("probe #67 fr_summary_altitude: vacuous (0)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** The wrappers whose runner function is not the one the registration names. */
const WRAPPER_ALLOWLIST: Record<number, string> = {
  61: "unresolvedDesignReferences",
  67: "frSummaryAndPlanNarrativeAltitude",
};

/** Every entry whose `run` is not the function its registration names (or its allowlisted wrapper). */
function runMatchesRegistration(table: Entry[], registrations: Registration[]): string[] {
  const byN = new Map(registrations.map((r) => [r.n, r]));
  const out: string[] = [];
  for (const e of table) {
    const want = WRAPPER_ALLOWLIST[e.n] ?? byN.get(e.n)?.fn ?? null;
    if (e.run.name !== want) out.push(`#${e.n} run=${e.run.name} registration=${want}`);
  }
  return out;
}

describe("AC-STE-756.5 (fix round 1) the call shape, wherever it appears", () => {
  test("mutation control: a registration phrased like #25 (`run \\`bun …\\` (the front door over \\`fn(projectRoot)\\`)`) is projectRoot-only", () => {
    const line =
      '925. **`synthetic-front-door`** — run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/synthetic.ts" "<projectRoot>"` (the front door over `runSyntheticFrontDoorProbe(projectRoot)`; exit 0 prints OK).';
    const reg = parseRegistrationLine(line);
    expect(reg).toEqual({
      n: 925,
      id: "synthetic-front-door",
      fn: "runSyntheticFrontDoorProbe",
      args: "projectRoot",
      severityText: null,
    });
  });

  test("mutation control: a dotted call shape is read as that call, with its own arguments", () => {
    const reg = parseRegistrationLine(
      "908. **Ticket drift** — resolve `Provider` once and call `Provider.getTicketStatus(<tracker-ref>)`.",
    );
    expect([reg?.fn, reg?.args]).toEqual(["Provider.getTicketStatus", "<tracker-ref>"]);
  });

  test("the projectRoot-only set includes #25 and excludes #8, #14, #26 and #1", () => {
    const ns = new Set(projectRootOnly().map((r) => r.n));
    expect({ 25: ns.has(25), 8: ns.has(8), 14: ns.has(14), 26: ns.has(26), 1: ns.has(1) }).toEqual({
      25: true,
      8: false,
      14: false,
      26: false,
      1: false,
    });
  });

  test("S-a: each runner entry's function is the one its registration names (wrappers allowlisted)", async () => {
    const { GATE_PROBES } = await runnerMod();
    expect(runMatchesRegistration(GATE_PROBES as Entry[], readRegistrations())).toEqual([]);
  });

  test("S-a: the two allowlisted wrappers carry exactly their named functions", async () => {
    const { GATE_PROBES } = await runnerMod();
    const byN = new Map<number, Entry>((GATE_PROBES as Entry[]).map((e) => [e.n, e]));
    expect([byN.get(61)?.run.name, byN.get(67)?.run.name]).toEqual([
      "unresolvedDesignReferences",
      "frSummaryAndPlanNarrativeAltitude",
    ]);
  });

  test("S-a mutation control: swapping two entries' `run` fields is reported for both", async () => {
    const { GATE_PROBES } = await runnerMod();
    const copy = (GATE_PROBES as Entry[]).map((e) => ({ ...e }));
    const a = copy.findIndex((e) => e.n === 12);
    const b = copy.findIndex((e) => e.n === 13);
    expect([a >= 0, b >= 0]).toEqual([true, true]);
    [copy[a]!.run, copy[b]!.run] = [copy[b]!.run, copy[a]!.run];
    const flagged = runMatchesRegistration(copy, readRegistrations()).map((m) => Number(/^#(\d+) /.exec(m)![1]));
    expect(flagged).toEqual([12, 13]);
  });

  test("the runner's summary on this checkout reads `conformance-probes pass: 74/74`", async () => {
    const { runGateProbes } = await runnerMod();
    const out = await runGateProbes(REPO_ROOT);
    expect(out.summary.startsWith("conformance-probes pass: 74/74 [")).toBe(true);
  }, 300_000);
});
