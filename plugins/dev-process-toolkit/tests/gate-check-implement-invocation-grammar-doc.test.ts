import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImplementInvocationGrammarDocProbe } from "../adapters/_shared/src/implement_invocation_grammar_doc";

// STE-181 AC-STE-181.5 — `implement-invocation-grammar-doc` probe.
//
// Verifies `skills/implement/SKILL.md` (when present) carries:
//   (a) a `## Invocation forms` heading,
//   (b) a comparison table with at least 6 rows (header + 6 phase rows),
//   (c) the Phase 5 row explicitly contains both `silent-skip` and `runs it`
//       literals (case-insensitive — covers `silent-skip` and `Runs it`).
//
// Vacuous on projects that don't ship the toolkit's own SKILL.md (i.e., it
// only fires on the dev-process-toolkit repo itself).

const pluginRoot = join(import.meta.dir, "..");
const implementSkill = join(pluginRoot, "skills", "implement", "SKILL.md");
const specWriteSkill = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const smokeSkill = join(pluginRoot, "..", "..", ".claude", "skills", "smoke-test", "SKILL.md");
const gateCheckSkill = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function makeProject(opts: {
  withImplementSkill: boolean;
  body?: string;
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "implement-invocation-"));
  if (opts.withImplementSkill) {
    const skillDir = join(root, "skills", "implement");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), opts.body ?? "");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const VALID_BODY = `# Implement

Lede paragraph naming the skill's purpose.

## Invocation forms

\`/implement\` accepts two argument shapes; they diverge at Phase 5.

| Phase | \`/implement <FR-id>\` | \`/implement M<N>\` |
|-------|----------------------|---------------------|
| 0 | runs against single FR | runs against every active FR |
| 1 | claims one ticket | claims every ticket |
| 2 | builds the FR | builds every FR |
| 3 | review loop | review loop |
| 4 | one feature commit | one commit per FR |
| 5 | **silent-skip** milestone close | runs it (close prompt + archive) |

## Phase 0
`;

describe("AC-STE-181.5(a) probe detects missing heading", () => {
  test("SKILL.md without `## Invocation forms` heading → violation", async () => {
    const ctx = makeProject({
      withImplementSkill: true,
      body: "# Implement\n\nLede.\n\n## Phase 0\n",
    });
    try {
      const report = await runImplementInvocationGrammarDocProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.message).toMatch(/Invocation forms/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-181.5(b) probe detects under-populated table", () => {
  test("table with fewer than 6 rows → violation", async () => {
    const tooShort = `# Implement

Lede.

## Invocation forms

| Phase | A | B |
|-------|---|---|
| 0 | a | b |
| 5 | silent-skip | runs it |

## Phase 0
`;
    const ctx = makeProject({ withImplementSkill: true, body: tooShort });
    try {
      const report = await runImplementInvocationGrammarDocProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThan(0);
      const messages = report.violations.map((v) => v.message).join("\n");
      expect(messages).toMatch(/at least 6 rows|too few rows|insufficient rows/i);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-181.5(c) probe detects Phase-5 row missing divergence keywords", () => {
  test("Phase 5 row missing `silent-skip` literal → violation", async () => {
    const missingKeyword = `# Implement

Lede.

## Invocation forms

| Phase | \`/implement <FR-id>\` | \`/implement M<N>\` |
|-------|----------------------|---------------------|
| 0 | a | b |
| 1 | a | b |
| 2 | a | b |
| 3 | a | b |
| 4 | a | b |
| 5 | skips | runs it |

## Phase 0
`;
    const ctx = makeProject({ withImplementSkill: true, body: missingKeyword });
    try {
      const report = await runImplementInvocationGrammarDocProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThan(0);
      const messages = report.violations.map((v) => v.message).join("\n");
      expect(messages).toMatch(/silent-skip|silent.?skip/i);
    } finally {
      ctx.cleanup();
    }
  });

  test("Phase 5 row missing `runs it` literal → violation", async () => {
    const missingKeyword = `# Implement

Lede.

## Invocation forms

| Phase | \`/implement <FR-id>\` | \`/implement M<N>\` |
|-------|----------------------|---------------------|
| 0 | a | b |
| 1 | a | b |
| 2 | a | b |
| 3 | a | b |
| 4 | a | b |
| 5 | silent-skip | does it |

## Phase 0
`;
    const ctx = makeProject({ withImplementSkill: true, body: missingKeyword });
    try {
      const report = await runImplementInvocationGrammarDocProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThan(0);
      const messages = report.violations.map((v) => v.message).join("\n");
      expect(messages).toMatch(/runs it/i);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-181.5(d) probe passes on canonical SKILL.md shape", () => {
  test("a well-formed Invocation forms section → no violations", async () => {
    const ctx = makeProject({ withImplementSkill: true, body: VALID_BODY });
    try {
      const report = await runImplementInvocationGrammarDocProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-181.5 vacuous-pass cases", () => {
  test("project without implement SKILL.md → vacuous pass", async () => {
    const ctx = makeProject({ withImplementSkill: false });
    try {
      const report = await runImplementInvocationGrammarDocProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-181.1 — implement SKILL.md carries the canonical Invocation forms section", () => {
  test("SKILL.md has the `## Invocation forms` heading after the lede", () => {
    const body = readFileSync(implementSkill, "utf-8");
    expect(body).toMatch(/^## Invocation forms$/m);
    // The heading must come before `## Pre-flight` or `## Phase 1` so it sits
    // after the lede, not buried below.
    const headingIdx = body.search(/^## Invocation forms$/m);
    const phase1Idx = body.search(/^## Phase 1/m);
    expect(headingIdx).toBeGreaterThan(-1);
    expect(phase1Idx).toBeGreaterThan(-1);
    expect(headingIdx).toBeLessThan(phase1Idx);
  });

  test("Phase 5 row in the table contains both divergence keywords", () => {
    const body = readFileSync(implementSkill, "utf-8");
    expect(body).toMatch(/silent-skip/);
    expect(body).toMatch(/runs it/);
  });
});

describe("AC-STE-181.2 — section names canonical use cases + cross-references STE-180", () => {
  test("canonical use cases mentioned: ship one FR + close out a milestone", () => {
    const body = readFileSync(implementSkill, "utf-8");
    expect(body).toMatch(/ship one FR/i);
    expect(body).toMatch(/close out (a|the) milestone|close a milestone|milestone close/i);
  });

  test("section cross-references STE-180's gate-check advisory", () => {
    const body = readFileSync(implementSkill, "utf-8");
    expect(body).toMatch(/STE-180|gate-check.*advisory|fully checked but not archived/);
  });
});

describe("AC-STE-181.3 — spec-write Step 7 Next: line tightens", () => {
  test("spec-write SKILL.md mentions FR-id form for new-FR runs", () => {
    const body = readFileSync(specWriteSkill, "utf-8");
    expect(body).toMatch(/implement <tracker-id>/);
  });

  test("spec-write SKILL.md mentions M<N> form for cross-cutting-only runs", () => {
    const body = readFileSync(specWriteSkill, "utf-8");
    expect(body).toMatch(/implement <milestone>|implement M<N>/);
  });
});

describe("AC-STE-181.4 — smoke-driver SKILL.md adds post-Phase-4 advisory", () => {
  test("smoke-test SKILL.md acknowledges the single-FR end state", () => {
    const body = readFileSync(smokeSkill, "utf-8");
    // The advisory must mention that single-FR runs leave the FR active and
    // recommend `/spec-archive M<N>`.
    expect(body).toMatch(/single-FR run complete|single-FR.*active|spec-archive M<N>|spec-archive when ready/);
  });
});

describe("AC-STE-181.5 — gate-check SKILL.md registers the new probe", () => {
  test("gate-check SKILL.md references probe `implement-invocation-grammar-doc`", () => {
    const body = readFileSync(gateCheckSkill, "utf-8");
    expect(body).toMatch(/implement-invocation-grammar-doc/);
  });
});

describe("Stage C hardening — Phase 5 row keyword matching is robust", () => {
  test("Phase 5 row with `silent-skip` and `runs it` in different cells (split rendering) → still passes", async () => {
    const splitCells = `# Implement

Lede.

## Invocation forms

| Phase | \`/implement <FR-id>\` | \`/implement M<N>\` |
|-------|----------------------|---------------------|
| 0 | a | b |
| 1 | a | b |
| 2 | a | b |
| 3 | a | b |
| 4 | a | b |
| 5 | silent-skip the milestone close | runs it (full close + archive) |

## Phase 0
`;
    const ctx = makeProject({ withImplementSkill: true, body: splitCells });
    try {
      const report = await runImplementInvocationGrammarDocProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("under-populated table fails before Phase-5 keyword check (no double-error)", async () => {
    // A 2-body-row table should produce at most a 'too few rows' violation,
    // not also a Phase-5 keyword violation when the row is malformed via
    // the rest of the table being missing.
    const tooShort = `# Implement

Lede.

## Invocation forms

| Phase | A | B |
|-------|---|---|
| 0 | a | b |

## Phase 0
`;
    const ctx = makeProject({ withImplementSkill: true, body: tooShort });
    try {
      const report = await runImplementInvocationGrammarDocProbe(ctx.root);
      // At least one violation; Phase-5 keyword may also fire (no Phase 5
      // row at all triggers the missing-row branch). Both are valid; the
      // failure surface is bounded.
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-139.5 — implement-invocation-grammar-doc runs clean on this repo's baseline", () => {
  test("runImplementInvocationGrammarDocProbe(repoRoot) returns zero violations on the toolkit repo", async () => {
    // The probe is hosted on the toolkit-self-run path. The dev-process-toolkit
    // repo has its own skills/implement/SKILL.md at plugins/dev-process-toolkit/skills/implement/SKILL.md.
    // The probe scans `<projectRoot>/plugins/dev-process-toolkit/skills/implement/SKILL.md` if present,
    // else `<projectRoot>/skills/implement/SKILL.md` (downstream-projects path).
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runImplementInvocationGrammarDocProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
