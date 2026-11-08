// STE-725 (M_fd9a03) — the skills that demand a fresh gate say when a proven
// reuse counts as fresh.
//
// AC-STE-725.1  /simplify step 4: the kept gate-stamp sentence, then one knob
//               branch naming `reuse: on` and `gate_reuse.ts" verdict`; the
//               rationale names `rerun` only inside the knob-on clause.
// AC-STE-725.4  /implement step i and docs/implement-reference.md carry the
//               `(reused)` / "recomputed" clause and keep "Never claim clean
//               from memory".
// AC-STE-725.6  docs/patterns.md Pattern 32, the README pattern count, the
//               docs/hooks-reference.md sentence.
// AC-STE-725.7  archived AC-STE-196.2 gains its clause before its anchor.
// AC-STE-725.9  (simplify branch) removing the knob condition reds a needle row.
// AC-STE-725.12 (archive half) archived STE-722 differs from the M_d1b4b7
//               merge commit only on the AC-STE-722.8 and AC-STE-722.12 lines.
//
// Trunk is the M_d1b4b7 merge commit 13fdf144: every edited surface below
// held these bytes there.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PLUGIN = resolve(import.meta.dir, "..");
const REPO = resolve(PLUGIN, "..", "..");
const PLUGIN_REL = "plugins/dev-process-toolkit";
const TRUNK = "13fdf144";

const SIMPLIFY = `${PLUGIN_REL}/skills/simplify/SKILL.md`;
const IMPLEMENT = `${PLUGIN_REL}/skills/implement/SKILL.md`;
const IMPLEMENT_REF = `${PLUGIN_REL}/docs/implement-reference.md`;
const PATTERNS = `${PLUGIN_REL}/docs/patterns.md`;
const HOOKS_REF = `${PLUGIN_REL}/docs/hooks-reference.md`;
const NOOP_TEST = `${PLUGIN_REL}/tests/simplify-noop-gate-skip-prose.test.ts`;
const STE_196 = "specs/frs/archive/STE-196.md";
const STE_722 = "specs/frs/archive/STE-722.md";

const REUSE_ON = "reuse: on";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
function tempFile(name: string, body: string): string {
  const d = mkdtempSync(join(tmpdir(), "ste725-prose-"));
  temps.push(d);
  const p = join(d, name);
  writeFileSync(p, body);
  return p;
}

const now = (rel: string): string => readFileSync(join(REPO, rel), "utf-8");
function trunk(rel: string): string {
  const g = spawnSync("git", ["-C", REPO, "show", `${TRUNK}:${rel}`], { encoding: "utf-8" });
  if (g.status !== 0) throw new Error(`git show ${TRUNK}:${rel} failed: ${g.stderr}`);
  return g.stdout;
}

/** The sentence splitter of the AC-STE-708.13 guard. */
function sentences(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .flatMap((para) => para.replace(/\n/g, " ").split(/(?<=[.!?])\s+/));
}

/** Every sentence naming `gate_reuse.ts` without the backticked `reuse: on` line. */
function unkeyedReuseMentions(text: string): string[] {
  return sentences(text).filter((s) => s.includes("gate_reuse.ts") && !s.includes(`\`${REUSE_ON}\``));
}

const steTokens = (s: string): number => (s.match(/STE-\d+/g) ?? []).length;

function section(body: string, heading: string): string {
  const start = body.indexOf(`\n${heading}`);
  if (start < 0) return "";
  const next = body.indexOf("\n## ", start + 1);
  return body.slice(start, next < 0 ? body.length : next);
}

// ===========================================================================
// AC-STE-725.1 — /simplify step 4 and the no-op rationale
// ===========================================================================

const KEPT = "Consult the most recent `/implement` or `/gate-check` log for the active gate stamp.";
const VERDICT_CALL = 'gate_reuse.ts" verdict';
const RATIONALE_OLD = "or the prior gate stamp is dirty";
const RATIONALE_NEW = "or the prior gate stamp is dirty (with the reuse knob on: or the verdict prints `rerun`)";
const NOOP_HEADING = "## When this is a no-op {#when-this-is-a-no-op}";

const stepFourLine = (body: string): string => body.split("\n").find((l) => /^4\. \*\*Verify\*\*/.test(l)) ?? "";

describe("AC-STE-725.1 /simplify keeps the gate-stamp sentence and adds one knob branch", () => {
  test("AC-STE-725.1 step 4 starts with trunk's step-4 line byte for byte, ending with the kept sentence", () => {
    const base = stepFourLine(trunk(SIMPLIFY));
    expect(base.endsWith(KEPT)).toBe(true);
    const line = stepFourLine(now(SIMPLIFY));
    expect(line.startsWith(base)).toBe(true);
  });

  test("AC-STE-725.1 the sentence after the kept one names the `reuse: on` condition and `gate_reuse.ts\" verdict`", () => {
    const line = stepFourLine(now(SIMPLIFY));
    const at = line.indexOf(KEPT);
    expect(at).toBeGreaterThanOrEqual(0);
    const after = line.slice(at + KEPT.length);
    const branch = sentences(after.trim()).find((s) => s.includes(VERDICT_CALL));
    expect(branch, "a step-4 sentence after the kept one names the verdict call").toBeDefined();
    expect(branch!).toContain(`\`${REUSE_ON}\``);
    expect(branch!).toContain("`clean`");
  });

  test("AC-STE-725.1 needle: every sentence naming gate_reuse.ts also names `reuse: on`, and at least one does", () => {
    const body = now(SIMPLIFY);
    expect(body.split("gate_reuse.ts").length - 1).toBeGreaterThan(0);
    expect(unkeyedReuseMentions(body)).toEqual([]);
  });

  test("AC-STE-725.1 needle control: a planted unconditional gate_reuse.ts mention in a temp copy turns the row red", () => {
    const planted = 'Before Verify run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_reuse.ts" verdict "<root>"`.';
    const copy = tempFile("SKILL.md", `${now(SIMPLIFY)}\n${planted}\n`);
    expect(unkeyedReuseMentions(readFileSync(copy, "utf-8"))).toEqual([planted]);
  });

  test("AC-STE-725.1 the file never names the knob verb", () => {
    expect(now(SIMPLIFY)).not.toMatch(/gate_reuse\.ts"?\s+knob\b/);
  });

  test("AC-STE-725.1 the rationale sentence carries the knob-on clause, and `rerun` appears in the section only inside it", () => {
    const sec = section(now(SIMPLIFY), NOOP_HEADING);
    expect(sec).toContain(RATIONALE_NEW);
    expect(sec.split("rerun").length - 1).toBe(RATIONALE_NEW.split("rerun").length - 1);
    expect(sec.split(RATIONALE_NEW).join("")).not.toContain("rerun");
  });

  test("AC-STE-725.1 the no-op heading, its anchor and precondition 1 are unchanged from trunk", () => {
    const t = section(trunk(SIMPLIFY), NOOP_HEADING);
    const c = section(now(SIMPLIFY), NOOP_HEADING);
    expect(c.startsWith(`\n${NOOP_HEADING}\n`)).toBe(true);
    const pre1 = t.split("\n").find((l) => l.startsWith("1. **Working tree is clean**"))!;
    expect(pre1).toBeDefined();
    expect(c.split("\n")).toContain(pre1);
    // Trunk's rationale carried the bare clause the edit extends.
    expect(t).toContain(RATIONALE_OLD);
  });

  test("AC-STE-725.1 /simplify stays at most 62 split-lines and adds no STE-<n> token", () => {
    const body = now(SIMPLIFY);
    expect(body.split("\n").length).toBeLessThanOrEqual(62);
    expect(steTokens(body)).toBe(steTokens(trunk(SIMPLIFY)));
  });

  test("AC-STE-725.1 tests/simplify-noop-gate-skip-prose.test.ts is byte-identical to trunk", () => {
    expect(now(NOOP_TEST)).toBe(trunk(NOOP_TEST));
  });
});

// ===========================================================================
// AC-STE-725.9 — removing the knob condition from the /simplify branch reds
// ===========================================================================

describe("AC-STE-725.9 the /simplify branch is keyed on `reuse: on`", () => {
  test("AC-STE-725.9 mutation: the branch with its `reuse: on` condition removed turns the AC-STE-725.1 needle red", () => {
    const body = now(SIMPLIFY);
    const line = stepFourLine(body);
    const after = line.slice(line.indexOf(KEPT) + KEPT.length);
    const branch = sentences(after.trim()).find((s) => s.includes(VERDICT_CALL));
    expect(branch, "the branch sentence exists").toBeDefined();
    const unkeyed = branch!.split(`\`${REUSE_ON}\``).join("the run");
    const copy = tempFile("SKILL.md", body.replace(branch!, unkeyed));
    expect(unkeyedReuseMentions(readFileSync(copy, "utf-8")).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-725.4 — /implement step i and docs/implement-reference.md
// ===========================================================================

const NEVER = "Never claim clean from memory";
const STEP_I_INDEX = 212;

describe("AC-STE-725.4 the fresh-gate lines name the proven-reuse exception", () => {
  test("AC-STE-725.4 /implement step i keeps its trunk text as a prefix and appends the (reused) / recomputed clause", () => {
    const base = trunk(IMPLEMENT).split("\n")[STEP_I_INDEX]!;
    expect(base).toMatch(/^\s+i\. \*\*After any fix\*\*/);
    const line = now(IMPLEMENT).split("\n")[STEP_I_INDEX]!;
    expect(line.startsWith(base)).toBe(true);
    const appended = line.slice(base.length);
    expect(appended).toContain("(reused)");
    expect(appended).toContain("recomputed");
    expect(line).toContain(NEVER);
  });

  test("AC-STE-725.4 docs/implement-reference.md's after-any-fix line carries the same clause and keeps its rule", () => {
    const line = now(IMPLEMENT_REF).split("\n").find((l) => l.startsWith("After any fix, always re-run the full gate check")) ?? "";
    expect(line).toContain(NEVER);
    expect(line).toContain("(reused)");
    expect(line).toContain("recomputed");
  });

  test("AC-STE-725.4 /implement stays at 358 split-lines, adds no STE-<n> token and names gate_reuse.ts only beside `reuse: on`", () => {
    const body = now(IMPLEMENT);
    expect(body.split("\n").length).toBe(358);
    expect(steTokens(body)).toBe(steTokens(trunk(IMPLEMENT)));
    expect(unkeyedReuseMentions(body)).toEqual([]);
  });

  test("AC-STE-725.4 needle control: a planted unconditional gate_reuse.ts mention in a temp copy of /implement turns it red", () => {
    const planted = 'After any fix run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_reuse.ts" run "<root>" test -- "bun test"`.';
    const copy = tempFile("SKILL.md", `${now(IMPLEMENT)}\n${planted}\n`);
    expect(unkeyedReuseMentions(readFileSync(copy, "utf-8"))).toEqual([planted]);
  });
});

// ===========================================================================
// AC-STE-725.6 — patterns, README count, hooks reference
// ===========================================================================

const PATTERN_HEADING = /^## Pattern (\d+): Reuse of a Proven Result \{#pattern-proven-reuse\}$/m;

describe("AC-STE-725.6 the docs name the house reuse shape", () => {
  test("AC-STE-725.6 docs/patterns.md carries Pattern 32: Reuse of a Proven Result after Pattern 31", () => {
    const body = now(PATTERNS);
    const m = PATTERN_HEADING.exec(body);
    expect(m, "the Pattern heading exists").not.toBeNull();
    expect(Number(m![1])).toBe(32);
    expect(body.indexOf(m![0])).toBeGreaterThan(body.indexOf("## Pattern 31:"));
  });

  test("AC-STE-725.6 the Pattern entry cites STE-196, assertCapturable and STE-724", () => {
    const body = now(PATTERNS);
    const m = PATTERN_HEADING.exec(body);
    expect(m).not.toBeNull();
    const entry = section(body, m![0]);
    expect(entry).toContain("STE-196");
    expect(entry).toContain("assertCapturable");
    expect(entry).toContain("STE-724");
  });

  test("AC-STE-725.6 the README pattern count moves with patterns.md (one more than trunk's 31)", () => {
    const readme = now("README.md");
    const observed = (now(PATTERNS).match(/^## Pattern \d+/gm) ?? []).length;
    expect(observed).toBe((trunk(PATTERNS).match(/^## Pattern \d+/gm) ?? []).length + 1);
    expect(readme).toContain(`— ${observed} proven patterns + anti-patterns`);
  });

  test("AC-STE-725.6 docs/hooks-reference.md says a reused command is not hook evidence and the legs stay two", () => {
    const hits = sentences(now(HOOKS_REF)).filter(
      (s) => /reused command/i.test(s) && /not hook evidence/i.test(s) && /step receipt/i.test(s) && /evidence-free legs/i.test(s),
    );
    expect(hits.length).toBe(1);
    expect(hits[0]!).toMatch(/\btwo\b/);
  });

  test("AC-STE-725.6 the \"one of two evidence-free legs\" line is unchanged from trunk", () => {
    const base = trunk(HOOKS_REF).split("\n").find((l) => l.includes("one of two evidence-free legs"));
    expect(base).toBeDefined();
    expect(now(HOOKS_REF).split("\n")).toContain(base!);
  });
});

// ===========================================================================
// AC-STE-725.7 — archived AC-STE-196.2
// ===========================================================================

const C_196_2 =
  "*(Amended by AC-STE-725.7 (v3.3.0): with gate_commands set to reuse, precondition 2 is decided by the reuse front door's verdict, not by a log read; with it off, the log read decides as before.)*";
const ANCHOR_196_2 = " {#AC-STE-196.2}";

describe("AC-STE-725.7 archived AC-STE-196.2 gains only its clause, before the anchor", () => {
  test("AC-STE-725.7 STE-196.md differs from trunk only on the AC-STE-196.2 line, by the clause one space before the anchor", () => {
    const base = trunk(STE_196).split("\n");
    const cur = now(STE_196).split("\n");
    expect(cur.length).toBe(base.length);
    const i = base.findIndex((l) => l.startsWith("- AC-STE-196.2:"));
    expect(i).toBeGreaterThan(0);
    expect(base[i]!.endsWith(ANCHOR_196_2)).toBe(true);
    const expected = `${base[i]!.slice(0, -ANCHOR_196_2.length)} ${C_196_2}${ANCHOR_196_2}`;
    const bad: number[] = [];
    for (let k = 0; k < base.length; k++) {
      if (!(k === i ? cur[k] === expected : cur[k] === base[k])) bad.push(k + 1);
    }
    expect(bad).toEqual([]);
  });

  test("AC-STE-725.7 control: the clause's marker and version are written as the AC says", () => {
    expect(C_196_2).toContain("Amended by AC-STE-725.7");
    expect(C_196_2).toContain("(v3.3.0)");
  });
});

// ===========================================================================
// AC-STE-725.12 (archive half) — archived STE-722, the two-line rule
// ===========================================================================

const C_722_8 =
  " *(Amended by AC-STE-725.12 (v3.3.0): the Phase 3 step-i line also differs from v3.0.0, by the reuse clause appended after its trunk text.)*";
const C_722_12 =
  " *(Amended by AC-STE-723.15 (v3.3.0): the get refusal's Remedy list gains optimizations last, and get optimizations prints its run default.)*";

describe("AC-STE-725.12 archived STE-722 differs from the M_d1b4b7 merge commit only on two lines", () => {
  test("AC-STE-725.12 the AC-STE-722.8 line is its merge-commit bytes plus this FR's clause; .12 plus AC-STE-723.15's; nothing else differs", () => {
    const base = trunk(STE_722).split("\n");
    const cur = now(STE_722).split("\n");
    expect(cur.length).toBe(base.length);
    const i8 = base.findIndex((l) => l.startsWith("- AC-STE-722.8:"));
    const i12 = base.findIndex((l) => l.startsWith("- AC-STE-722.12:"));
    expect(i8).toBeGreaterThan(0);
    expect(i12).toBeGreaterThan(0);
    // The same two-line rule as AC-STE-723.15: each line is its base, or its base plus its clause.
    const bad: number[] = [];
    for (let k = 0; k < base.length; k++) {
      const ok = cur[k] === base[k] || (k === i8 && cur[k] === base[k] + C_722_8) || (k === i12 && cur[k] === base[k] + C_722_12);
      if (!ok) bad.push(k + 1);
    }
    expect(bad).toEqual([]);
    expect(cur[i8]).toBe(base[i8] + C_722_8);
    expect(cur[i12]).toBe(base[i12] + C_722_12);
  });

  test("AC-STE-725.12 control: the clause is one-space separated, as the file's existing amendment clauses are", () => {
    expect(now(STE_722)).toMatch(/\S \*\(Amended by AC-STE-722\.14 \(v3\.2\.0\)/);
    expect(C_722_8.startsWith(" *(")).toBe(true);
  });
});
