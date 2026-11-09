// STE-724 (M_fd9a03) — the prose half of the reuse front door.
//
// This pass grades the archive half of AC-STE-724.20: the archived
// specs/frs/archive/STE-715.md differs from its bytes at the M_7bc805 merge
// commit only on the AC-STE-715.13 line, by one appended amendment clause,
// separated by one space as the file's existing amendment clauses are.
//
// AC-STE-724.7, .13, .21 and .22 land with the milestone's single gate-check
// edit commit and are graded below: knob-off byte identity of the trunk
// `## Commands` lines and `## Code Review`, the `reuse: on` front-door sentence
// and the `(reused)` clause, the net-zero numstat, the CONDITIONAL_TARGETS row
// and the archived AC-STE-708.13 clause, and the M_7bc805 modeller run with the
// reuse receipt line stubbed.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { PLUGIN_ROOT, REPO_ROOT, sentences } from "./_m_7bc805_gate_outcome_fixture";

/** The M_7bc805 merge commit (PR #131). */
const M7BC805_MERGE = "effc0981";
const ARCHIVE_715 = "specs/frs/archive/STE-715.md";
const AC_715_13 = "- AC-STE-715.13:";
const CLAUSE_715_13 =
  "*(Amended by AC-STE-724.20 (v3.3.0): with gate_commands: reuse effective, the gate-check receipt call prints a third line, reuse: on.)*";

function atCommit(sha: string, repoRel: string): string {
  const p = spawnSync("git", ["show", `${sha}:${repoRel}`], { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`git show ${sha}:${repoRel}: ${p.stderr}`);
  return p.stdout ?? "";
}

/**
 * Every way `now` departs from `base` plus exactly one appended clause on the
 * line starting with `prefix`; empty when that is the only difference.
 */
function amendmentDrift(base: string, now: string, prefix: string, clause: string): string[] {
  const a = base.split("\n");
  const b = now.split("\n");
  const out: string[] = [];
  if (a.length !== b.length) out.push(`line count ${a.length} -> ${b.length}`);
  const targets = a.flatMap((l, i) => (l.startsWith(prefix) ? [i] : []));
  if (targets.length !== 1) out.push(`expected one ${prefix} line at the base, found ${targets.length}`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const want = i === targets[0] ? `${a[i]} ${clause}` : a[i];
    if (b[i] !== want) out.push(`line ${i + 1} differs`);
  }
  return out;
}

describe("AC-STE-724.20 archived STE-715.md gains the AC-STE-715.13 amendment clause and nothing else", () => {
  const base = atCommit(M7BC805_MERGE, ARCHIVE_715);
  const now = readFileSync(join(REPO_ROOT, ARCHIVE_715), "utf-8");

  test("the file differs from the M_7bc805 merge commit only by the clause appended to the AC-STE-715.13 line", () => {
    expect(amendmentDrift(base, now, AC_715_13, CLAUSE_715_13)).toEqual([]);
  });

  test("the clause is joined by one space, as the file's existing amendment clauses are", () => {
    const line = now.split("\n").find((l) => l.startsWith(AC_715_13)) ?? "";
    expect(line.endsWith(` ${CLAUSE_715_13}`)).toBe(true);
    // The house separator, read off an amendment the file already carries.
    expect(base).toMatch(/\. \*\(Amended by /);
  });

  test("CONTROL: a one-byte edit elsewhere in the amended file is reported", () => {
    const amended = base
      .split("\n")
      .map((l) => (l.startsWith(AC_715_13) ? `${l} ${CLAUSE_715_13}` : l))
      .join("\n");
    expect(amendmentDrift(base, amended, AC_715_13, CLAUSE_715_13)).toEqual([]);
    const edited = amended.replace("# ", "#  ");
    expect(amendmentDrift(base, edited, AC_715_13, CLAUSE_715_13).length).toBeGreaterThan(0);
  });

  test("CONTROL: the unamended file, and the clause joined with no space, are each reported", () => {
    expect(amendmentDrift(base, base, AC_715_13, CLAUSE_715_13).length).toBeGreaterThan(0);
    const glued = base
      .split("\n")
      .map((l) => (l.startsWith(AC_715_13) ? `${l}${CLAUSE_715_13}` : l))
      .join("\n");
    expect(amendmentDrift(base, glued, AC_715_13, CLAUSE_715_13).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Shared for AC-STE-724.7 / .13 / .21 / .22
// ===========================================================================

/** The M_d1b4b7 merge commit; its gate-check SKILL.md equals v3.0.0's. */
const TRUNK = "13fdf144";
/** The v3.0.0 merge commit (M_94e6f7). */
const V300 = "6c62b32c";
const GATE_CHECK = "plugins/dev-process-toolkit/skills/gate-check/SKILL.md";
const REUSE_ON = "reuse: on";
const RUN_CALL = 'gate_reuse.ts" run';
const LOOKUP_HEAD = "Read the project's CLAUDE.md to find the gate check commands";
const PASS_BULLET_HEAD = "- If it passes, report ✓";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
function tempCopy(name: string, body: string): string {
  const d = mkdtempSync(join(tmpdir(), "ste724-prose-"));
  temps.push(d);
  const p = join(d, name);
  writeFileSync(p, body);
  return p;
}

const gcNow = (): string => readFileSync(join(REPO_ROOT, GATE_CHECK), "utf-8");
const gcTrunk = (): string => atCommit(TRUNK, GATE_CHECK);

/** `heading` up to the next `## ` heading (exclusive), from its own line. */
function sectionOf(body: string, heading: string): string {
  const start = body.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const next = body.indexOf("\n## ", start + 1);
  return body.slice(start, next < 0 ? body.length : next);
}

/** Every sentence naming `gate_reuse.ts` without the backticked `reuse: on` line. */
function unkeyedReuseMentions(text: string): string[] {
  return sentences(text).filter((x) => x.includes("gate_reuse.ts") && !x.includes(`\`${REUSE_ON}\``));
}

const lookupLine = (body: string): string[] => body.split("\n").filter((l) => l.startsWith(LOOKUP_HEAD));

// ===========================================================================
// AC-STE-724.7 — knob-off byte identity
// ===========================================================================

describe("AC-STE-724.7 knob-off byte identity of gate-check's ## Commands and ## Code Review", () => {
  test("CONTROL: trunk's gate-check SKILL.md equals v3.0.0's from ## Commands on, and names no gate_reuse.ts", () => {
    const from = (b: string): string => b.slice(b.indexOf("\n## Commands\n"));
    expect(from(gcTrunk()).length).toBeGreaterThan(100);
    expect(from(gcTrunk())).toBe(from(atCommit(V300, GATE_CHECK)));
    expect(gcTrunk()).not.toContain("gate_reuse.ts");
    expect(lookupLine(gcTrunk()).length).toBe(1);
  });

  test("AC-STE-724.7 the Key Commands lookup line keeps its trunk bytes as a byte-for-byte prefix, and the five typical-command lines are whole", () => {
    const t = sectionOf(gcTrunk(), "## Commands").split("\n");
    const c = sectionOf(gcNow(), "## Commands").split("\n");
    expect(c.length).toBe(t.length);
    const bad: number[] = [];
    for (let i = 0; i < t.length; i++) {
      const ok = t[i]!.startsWith(LOOKUP_HEAD) ? c[i]!.startsWith(t[i]!) && c[i] !== t[i] : c[i] === t[i];
      if (!ok) bad.push(i);
    }
    expect(bad).toEqual([]);
    // The five typical-command lines are among the whole ones.
    const typical = t.filter((l) => /^[1-5]\. Run /.test(l));
    expect(typical.length).toBe(5);
    for (const l of typical) expect(c).toContain(l);
  });

  test("AC-STE-724.7 the `gate_reuse.ts\" run` invocation appears only on the lookup line, after its trunk prefix, in a sentence naming `reuse: on`", () => {
    const body = gcNow();
    const base = lookupLine(gcTrunk())[0]!;
    const hits = body.split("\n").filter((l) => l.includes(RUN_CALL));
    expect(hits.length).toBe(1);
    expect(hits[0]!.startsWith(base)).toBe(true);
    const suffix = hits[0]!.slice(base.length);
    expect(base).not.toContain(RUN_CALL);
    const carrying = sentences(suffix.trim()).filter((x) => x.includes(RUN_CALL));
    expect(carrying.length).toBeGreaterThan(0);
    for (const x of carrying) expect(x).toContain(`\`${REUSE_ON}\``);
  });

  test("AC-STE-724.7 needle: every sentence naming gate_reuse.ts names `reuse: on`, and at least one does", () => {
    const body = gcNow();
    expect(body.split("gate_reuse.ts").length - 1).toBeGreaterThan(0);
    expect(unkeyedReuseMentions(body)).toEqual([]);
  });

  test("AC-STE-724.7 needle control: a planted unconditional gate_reuse.ts mention in a temp copy turns the row red", () => {
    const planted = 'Run each gate command as `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_reuse.ts" run "<root>" test -- "bun test"`.';
    const copy = tempCopy("SKILL.md", `${gcNow()}\n${planted}\n`);
    expect(unkeyedReuseMentions(readFileSync(copy, "utf-8"))).toEqual([planted]);
  });

  test("AC-STE-724.7 the file never names the optimizations_config.ts knob verb", () => {
    expect(gcNow()).not.toMatch(/optimizations_config\.ts"?\s+knob\b/);
    // CONTROL: the regex catches the invocation form.
    expect('bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/optimizations_config.ts" knob "<root>"').toMatch(
      /optimizations_config\.ts"?\s+knob\b/,
    );
  });

  test("AC-STE-724.7 the ## Code Review section is byte-identical to trunk", () => {
    const t = sectionOf(gcTrunk(), "## Code Review");
    expect(t.length).toBeGreaterThan(0);
    expect(sectionOf(gcNow(), "## Code Review")).toBe(t);
  });
});

// ===========================================================================
// AC-STE-724.13 — the front door sentence, the (reused) clause, net zero
// ===========================================================================

const FRONT_DOOR_CALL = /`bun run "\$\{CLAUDE_PLUGIN_ROOT\}\/adapters\/_shared\/src\/gate_reuse\.ts" run "<root>" [^`]* -- [^`]+`/;

describe("AC-STE-724.13 ## Commands names `reuse: on` and the front door; the pass bullet names (reused); net zero", () => {
  test("AC-STE-724.13 ## Commands names the `reuse: on` condition and the front-door invocation", () => {
    const sec = sectionOf(gcNow(), "## Commands");
    expect(sec).toContain(`\`${REUSE_ON}\``);
    expect(sec).toMatch(FRONT_DOOR_CALL);
    // CONTROL: the invocation regex rejects a different module.
    expect('`bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" run "<root>" test -- "bun test"`').not.toMatch(FRONT_DOOR_CALL);
  });

  test("AC-STE-724.13 the \"If it passes, report ✓\" bullet keeps its trunk text as a prefix and names (reused)", () => {
    const base = gcTrunk().split("\n").filter((l) => l.startsWith(PASS_BULLET_HEAD));
    expect(base.length).toBe(1);
    const cur = gcNow().split("\n").filter((l) => l.startsWith(PASS_BULLET_HEAD));
    expect(cur.length).toBe(1);
    expect(cur[0]!.startsWith(base[0]!)).toBe(true);
    expect(cur[0]!.slice(base[0]!.length)).toContain("(reused)");
  });

  test("AC-STE-724.13 the file measures exactly 356 split-lines and 87 STE-<n> tokens", () => {
    const body = gcNow();
    expect(body.split("\n").length).toBe(356);
    expect((body.match(/STE-\d+/g) ?? []).length).toBe(87);
  });

  // The AC's "main" is the trunk the milestone started from. Diffing against
  // the live `main` ref graded nothing once the milestone merged (an empty
  // diff, red on every main checkout), so the base is the pinned TRUNK, and
  // the leg means the same on a branch and on main.
  /** Problems with `body` as a net-zero edit of TRUNK's gate-check SKILL.md; empty when it is one. */
  function netZeroDrift(body: string): string[] {
    const base = tempCopy("SKILL.trunk.md", gcTrunk());
    const cur = tempCopy("SKILL.now.md", body);
    const g = spawnSync("git", ["diff", "--no-index", "--numstat", base, cur], { encoding: "utf-8" });
    // --no-index exits 1 when the files differ, 0 when identical.
    if (g.status !== 0 && g.status !== 1) return [`git diff exited ${g.status}: ${g.stderr}`];
    const rows = g.stdout.trim().split("\n").filter(Boolean);
    if (rows.length !== 1) return [`expected 1 numstat row, got ${rows.length} (file not edited)`];
    const [added, deleted] = rows[0]!.split("\t").map(Number);
    const out: string[] = [];
    if (!(added! > 0)) out.push(`added ${added} is not > 0`);
    if (added !== deleted) out.push(`added ${added} != deleted ${deleted}`);
    return out;
  }

  test("AC-STE-724.13 numstat against the trunk (13fdf144) on gate-check SKILL.md shows added equal to deleted, and the file was edited", () => {
    expect(netZeroDrift(gcNow())).toEqual([]);
    // The tracked instrument agrees: the working tree against the pinned trunk commit.
    const g = spawnSync("git", ["-C", REPO_ROOT, "diff", "--numstat", TRUNK, "--", GATE_CHECK], { encoding: "utf-8" });
    expect(g.status).toBe(0);
    const row = g.stdout.trim().split("\n").filter(Boolean);
    expect(row.length).toBe(1);
    const [added, deleted] = row[0]!.split("\t");
    expect(Number(added)).toBeGreaterThan(0);
    expect(Number(added)).toBe(Number(deleted));
  });

  test("AC-STE-724.13 CONTROL: the numstat leg goes red when the edit is not in place", () => {
    // Unedited (the trunk bytes): no row.
    expect(netZeroDrift(gcTrunk())).toEqual(["expected 1 numstat row, got 0 (file not edited)"]);
    // Edit plus one extra line: added != deleted.
    expect(netZeroDrift(`${gcNow()}extra line\n`).some((p) => p.startsWith("added "))).toBe(true);
    // Edit minus its last line: added != deleted.
    const lines = gcNow().split("\n");
    const shorter = [...lines.slice(0, -2), lines[lines.length - 1]].join("\n");
    expect(netZeroDrift(shorter).some((p) => p.includes("!= deleted"))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-724.21 — the zero-extra-calls guard admits gate_reuse.ts run only beside `reuse: on`
// ===========================================================================

const FRONT_DOOR_708 = join(PLUGIN_ROOT, "tests", "m_94e6f7-ste-708-mode-front-door.test.ts");
const ARCHIVE_708 = "specs/frs/archive/STE-708.md";
const AC_708_13 = "- AC-STE-708.13:";
const CLAUSE_715_19 =
  "*(Amended by AC-STE-715.19 (v3.1.0): `gate_receipt.ts outcome` is a further conditional target, admitted only in a sentence that names `outcome: on`.)*";
const CLAUSE_722_16 =
  "*(Amended by AC-STE-722.16 (v3.2.0): `retro_offer.ts` is a further conditional target, admitted only in a sentence that names `retro: on`.)*";
const CLAUSE_724_21 =
  "*(Amended by AC-STE-724.21 (v3.3.0): `gate_reuse.ts run` is a further conditional target, admitted only in a sentence that names `reuse: on`.)*";

describe("AC-STE-724.21 CONDITIONAL_TARGETS and the archived AC-STE-708.13 clause", () => {
  test("AC-STE-724.21 CONDITIONAL_TARGETS holds the gate_reuse.ts run row directly under its Amended-by comment", () => {
    const lines = readFileSync(FRONT_DOOR_708, "utf-8").split("\n");
    const i = lines.findIndex((l) => l.trim() === '{ module: "gate_reuse.ts", verb: "run", condition: "reuse: on" },');
    expect(i).toBeGreaterThan(0);
    expect(lines[i - 1]!.trim()).toBe("// Amended by AC-STE-724.21 (M_fd9a03)");
    // The row is inside the CONDITIONAL_TARGETS literal.
    const open = lines.findIndex((l) => l.startsWith("const CONDITIONAL_TARGETS"));
    const close = lines.findIndex((l, k) => k > open && l === "];");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(i > open && i < close).toBe(true);
  });

  test("AC-STE-724.21 the ste-708 suite carries the control row in its shape: unkeyed reported, keyed admitted", () => {
    const text = readFileSync(FRONT_DOOR_708, "utf-8");
    expect(text).toContain('"added without its condition (reuse: on): gate_reuse.ts run"');
    expect(text).toContain("Amended by AC-STE-724.21 (M_fd9a03): gate_reuse.ts run is admitted only beside `reuse: on`.");
  });

  const base708 = (): string => atCommit(V300, ARCHIVE_708);
  const expected708 = (base: string): string =>
    base
      .split("\n")
      .map((l) => (l.startsWith(AC_708_13) ? `${l} ${CLAUSE_715_19} ${CLAUSE_722_16} ${CLAUSE_724_21}` : l))
      .join("\n");

  test("CONTROL: the v3.0.0 file has exactly one AC-STE-708.13 line, and the house separator is one space", () => {
    expect(base708().split("\n").filter((l) => l.startsWith(AC_708_13)).length).toBe(1);
    const cur = readFileSync(join(REPO_ROOT, ARCHIVE_708), "utf-8");
    expect(cur).toContain(`. ${CLAUSE_715_19} ${CLAUSE_722_16}`);
  });

  test("AC-STE-724.21 STE-708.md differs from v3.0.0 only on the AC-STE-708.13 line: its bytes + the .715.19, .722.16 and .724.21 clauses", () => {
    expect(amendmentDrift(base708(), readFileSync(join(REPO_ROOT, ARCHIVE_708), "utf-8"), AC_708_13, `${CLAUSE_715_19} ${CLAUSE_722_16} ${CLAUSE_724_21}`)).toEqual(
      [],
    );
  });

  test("CONTROL: a one-byte edit elsewhere in the amended archive is reported", () => {
    const ok = expected708(base708());
    const all = `${CLAUSE_715_19} ${CLAUSE_722_16} ${CLAUSE_724_21}`;
    expect(amendmentDrift(base708(), ok, AC_708_13, all)).toEqual([]);
    expect(amendmentDrift(base708(), ok.replace("# ", "#  "), AC_708_13, all).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-724.22 — the M_7bc805 /gate-check modeller honours the reuse guard
// ===========================================================================
//
// MIRROR, not a fork: the modeller below is the text of
// tests/m_7bc805-ste-715-modelled-calls.test.ts, and the CONTROL row compares
// both function bodies and both regexes byte for byte. Its table is not copied
// at all: it is parsed out of that file's GUARDED_TARGETS literal, so the row
// this AC adds is graded where it lives.

const MODELLER_SUITE = join(PLUGIN_ROOT, "tests", "m_7bc805-ste-715-modelled-calls.test.ts");

interface GuardedTarget {
  module: string;
  verb: string;
  condition: string;
}

const SWITCH_LINE_RE = /`([a-z_]+: on)`/g;
const BUN_RUN_RE = /bun run\s+"?([^\s"`]+?\.ts)"?(?:[ \t]+([a-z][a-z0-9-]*)(?=[\s"`]|$))?/gm;

interface Call {
  key: string;
  module: string;
  verb?: string;
  command: string;
}

function namedCalls(text: string): Array<{ sentence: string; call: Call }> {
  const out: Array<{ sentence: string; call: Call }> = [];
  for (const s of sentences(text)) {
    for (const m of s.matchAll(BUN_RUN_RE)) {
      const module = basename(m[1]!);
      const command = s.slice(m.index!).split("`")[0]!.trim();
      out.push({ sentence: s, call: { module, verb: m[2], key: m[2] ? `${module} ${m[2]}` : module, command } });
    }
  }
  return out;
}

/** The modelled run: every named call in order, guarded ones only when the receipt call printed their line. */
function modelRun(text: string, receiptStdout: string, table: readonly GuardedTarget[] = GUARDED_TARGETS): Call[] {
  const printed = new Set(receiptStdout.split("\n"));
  const issued: Call[] = [];
  for (const { sentence, call } of namedCalls(text)) {
    const row = table.find((r) => r.module === call.module && r.verb === call.verb);
    const named = [...sentence.matchAll(SWITCH_LINE_RE)].map((m) => m[1]!);
    const guarded = row !== undefined && named.includes(row.condition);
    if (guarded && !printed.has(row!.condition)) continue;
    issued.push(call);
  }
  return issued;
}

/** The GUARDED_TARGETS rows of the M_7bc805 suite, read from its literal. */
function guardedTargetsOf(suiteText: string): GuardedTarget[] {
  const open = suiteText.indexOf("const GUARDED_TARGETS: readonly GuardedTarget[] = [");
  if (open < 0) return [];
  const close = suiteText.indexOf("\n];", open);
  const block = suiteText.slice(open, close);
  return [...block.matchAll(/\{ module: "([^"]+)", verb: "([^"]+)", condition: "([^"]+)" \}/g)].map((m) => ({
    module: m[1]!,
    verb: m[2]!,
    condition: m[3]!,
  }));
}

const GUARDED_TARGETS: readonly GuardedTarget[] = guardedTargetsOf(readFileSync(MODELLER_SUITE, "utf-8"));
const REUSE_ROW: GuardedTarget = { module: "gate_reuse.ts", verb: "run", condition: "reuse: on" };

/** The source text of `function <name>` up to its closing brace at column 0. */
function functionText(src: string, name: string): string {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) return "";
  return src.slice(start, src.indexOf("\n}\n", start) + 3);
}
const constLine = (src: string, name: string): string => src.split("\n").find((l) => l.startsWith(`const ${name} = `)) ?? "";

const ANNOUNCEMENT = "dpt-receipt: /x/.dpt/ledger/receipts/s/r.json sha256:0";
const reuseRuns = (calls: Call[]): Call[] => calls.filter((c) => c.key === "gate_reuse.ts run");

describe("AC-STE-724.22 the M_7bc805 modeller issues gate_reuse.ts run only when the receipt call printed `reuse: on`", () => {
  test("CONTROL: the mirrored modeller is byte-identical to the M_7bc805 suite's", () => {
    const theirs = readFileSync(MODELLER_SUITE, "utf-8");
    const ours = readFileSync(import.meta.path, "utf-8");
    for (const fn of ["namedCalls", "modelRun"]) {
      expect(functionText(theirs, fn).length).toBeGreaterThan(0);
      expect({ fn, text: functionText(ours, fn) }).toEqual({ fn, text: functionText(theirs, fn) });
    }
    for (const c of ["SWITCH_LINE_RE", "BUN_RUN_RE"]) {
      expect(constLine(theirs, c).length).toBeGreaterThan(0);
      expect(constLine(ours, c)).toBe(constLine(theirs, c));
    }
  });

  test("AC-STE-724.22 GUARDED_TARGETS holds the gate_reuse.ts run row under its Amended-by comment", () => {
    expect(GUARDED_TARGETS).toContainEqual(REUSE_ROW);
    expect(readFileSync(MODELLER_SUITE, "utf-8")).toContain(
      '  // Amended by AC-STE-724.22 (M_fd9a03): the reuse front door is guarded by reuse: on.\n  { module: "gate_reuse.ts", verb: "run", condition: "reuse: on" },\n];',
    );
  });

  test("AC-STE-724.22 receipt stdout stubbed to announcement + `outcome: on` + `reuse: on`: the modelled list holds the gate_reuse.ts run command", () => {
    const calls = modelRun(gcNow(), `${ANNOUNCEMENT}\noutcome: on\nreuse: on`);
    expect(reuseRuns(calls).length).toBeGreaterThan(0);
    for (const c of reuseRuns(calls)) expect(c.command.startsWith('bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_reuse.ts" run ')).toBe(true);
  });

  test("AC-STE-724.22 receipt stdout stubbed to announcement + `outcome: on` only: no gate_reuse.ts call", () => {
    const calls = modelRun(gcNow(), `${ANNOUNCEMENT}\noutcome: on`);
    expect(calls.filter((c) => c.module === "gate_reuse.ts")).toEqual([]);
  });

  test("AC-STE-724.22 the row is load-bearing: a temp table without it makes the switch-off list hold gate_reuse.ts run", () => {
    const without = GUARDED_TARGETS.filter((r) => !(r.module === REUSE_ROW.module && r.verb === REUSE_ROW.verb));
    expect(without.length).toBe(GUARDED_TARGETS.length - 1);
    expect(reuseRuns(modelRun(gcNow(), ANNOUNCEMENT, without)).length).toBeGreaterThan(0);
    // ...and with the row, the same switch-off run issues none.
    expect(reuseRuns(modelRun(gcNow(), ANNOUNCEMENT))).toEqual([]);
  });
});
