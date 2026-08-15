// M123 / STE-464 — "/deliver pipeline orchestrator: inline Socratic phases +
// spawned visible ceremony chain".
//
// RED-first pins for the new user-invocable `skills/deliver/SKILL.md`, its
// reference doc, the probe-#57 count surfaces (user-invocable 16→17, total
// 24→25), the smoke fixture group 11 registration, and the meta-meta re-keys
// of the shipped count-pin suites (house M108→M109 pattern,
// `m109-ste-395-delist-upgrade.test.ts:651-679` precedent).
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31):
//   * count pins are LINE-SCOPED to the exact lines probe #57 reads (README
//     line 3, CLAUDE.md line 15) and mirror the probe's own regexes, so the
//     documented tokens cannot drift out of the probe's field of view while
//     this suite stays green.
//   * the on-disk ground truth (26 dirs / 18 user-invocable post-M124) is
//     OBSERVED via
//     `readdirSync` + the fenced-frontmatter predicate copied verbatim from
//     `m108-ste-391-docs-pins.test.ts` — counts are derived from the tree,
//     never restated as a bare integer next to a doc pin.
//   * pins are POSITIVE where possible — a ban is also satisfied by deleting
//     the subject, so absences (no authored `claude -p` spawn fence) are
//     paired with a presence floor on the same extraction.
//   * AC-STE-464.6 interaction, recorded so nobody "fixes" it backwards: the
//     deliver SKILL must carry NO authored `claude -p` heredoc spawn fence —
//     the `auto_approve_marker_in_canonical_spawns` probe would then demand
//     the auto-approve marker inside it, and the whole point of AC.6 is that
//     the marker is NEVER injected into worker prompts. Spawn mechanics
//     delegate at runtime to the agent-toolkit:spawn-agent skill; prose only.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  CANONICAL_FIXTURE_GROUPS,
  SMOKE_LEGS,
} from "../adapters/_shared/src/smoke_fixture_groups";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const DELIVER_SKILL = join(SKILLS_DIR, "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");
const SKILL_ANATOMY = join(PLUGIN_ROOT, "docs", "skill-anatomy.md");
const FIXTURE_GROUPS_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "smoke_fixture_groups.ts",
);

const README = join(REPO_ROOT, "README.md");
const CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");
const TECH_SPEC = join(REPO_ROOT, "specs", "technical-spec.md");
const TESTING_SPEC = join(REPO_ROOT, "specs", "testing-spec.md");
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");

// The refusal marker literal — AC-STE-404.5 shape, minted by
// adapters/_shared/src/requires_input.ts. Restated here BYTE-FOR-BYTE on
// purpose: deriving it from the module would compare the source against
// itself and could never catch a marker rename stranding the SKILL's copy.
const REFUSED_MARKER = "<dpt:requires-input-refused>v1</dpt:requires-input-refused>";

function mustRead(path: string): string {
  expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  return readFileSync(path, "utf8");
}

const deliver = (): string => mustRead(DELIVER_SKILL);

// Fenced-frontmatter read + predicate, verbatim from
// m108-ste-391-docs-pins.test.ts — only the frontmatter block decides menu
// visibility; SKILL bodies quote `user-invocable: false` while documenting
// the fork contract.
const declaresNonUserInvocable = (body: string): boolean => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";
  return /^user-invocable:[ \t]*false[ \t]*$/m.test(frontmatter);
};

const skillDirs = (): string[] =>
  readdirSync(SKILLS_DIR).filter((name) => statSync(join(SKILLS_DIR, name)).isDirectory());

// ---------------------------------------------------------------------------
// AC-STE-464.1 — new user-invocable skill + every probe-#57 count surface
// ---------------------------------------------------------------------------

describe("AC-STE-464.1 — skills/deliver/SKILL.md exists and is user-invocable", () => {
  test("the skill file exists", () => {
    expect({ path: DELIVER_SKILL, exists: existsSync(DELIVER_SKILL) }).toEqual({
      path: DELIVER_SKILL,
      exists: true,
    });
  });

  test("frontmatter names the skill and carries a description", () => {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(deliver())?.[1] ?? "";
    expect(frontmatter).toMatch(/^name: deliver$/m);
    expect(frontmatter).toMatch(/^description: .+/m);
  });

  test("no `user-invocable: false` in the frontmatter — /deliver is on the slash menu", () => {
    expect(declaresNonUserInvocable(deliver())).toBe(false);
  });
});

describe("AC-STE-464.1 — on-disk ground truth: 27 skill dirs, 18 user-invocable", () => {
  test("27 skill directories, deliver among them", () => {
    const dirs = skillDirs();
    expect(dirs.length).toBe(27);
    expect(dirs).toContain("deliver");
  });

  test("exactly 18 skills are user-invocable, deliver among them; the fork/dispatch set is 9 (M125)", () => {
    const dirs = skillDirs();
    const userInvocable = dirs.filter(
      (dir) => !declaresNonUserInvocable(readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf-8")),
    );
    expect(userInvocable.length).toBe(18);
    expect(userInvocable).toContain("deliver");
    expect(dirs.length - userInvocable.length).toBe(9);
  });
});

describe("AC-STE-464.1 — README count surfaces (probe #57's exact lines)", () => {
  const readmeLines = (): string[] => mustRead(README).split("\n");

  test("line 3 pitch reads `18 commands, 8 agents` (probe #57 parses line index 2)", () => {
    const line3 = readmeLines()[2] ?? "";
    // Mirror the probe's own token pattern so the pin and the probe read the
    // same bytes: /(\d+)\s+commands?,\s+(\d+)\s+agents?/ with 18 / 8.
    expect(line3).toMatch(/18\s+commands?,\s+8\s+agents?/);
  });

  test("the repo-tree skills row reads `27 (18 + 9)` with `(18 user-invocable + 9 internal forks)`", () => {
    const rows = readmeLines().filter((l) => l.includes("── skills/"));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatch(/27\s+\(18\s*\+\s*9\)/);
    expect(row).toMatch(/\(18 user-invocable \+ 9 internal forks\)/);
  });

  test("`Nine additional skills` — the dispatch count moved with setup-template (M125)", () => {
    expect(mustRead(README)).toMatch(/Nine additional skills/);
  });
});

describe("AC-STE-464.1 — CLAUDE.md count surfaces (probe #57 reads line 15 verbatim)", () => {
  test("line 15 skills row: 27 slash commands (18 user-invocable + 9 dispatch …)", () => {
    const line15 = mustRead(CLAUDE_MD).split("\n")[14] ?? "";
    expect(line15).toMatch(/^├── skills\//);
    // The probe's own totalMatch and splitMatch regexes, instantiated:
    expect(line15).toMatch(/27\s+slash commands?/);
    expect(line15).toMatch(/\(18\s+user-invocable\s*\+\s*9\s+dispatch/);
  });

  test("the agents row is untouched: 8 subagent templates", () => {
    expect(mustRead(CLAUDE_MD)).toMatch(/8 subagent templates/);
  });
});

describe("AC-STE-464.1 — remaining count surfaces", () => {
  test("specs/technical-spec.md skills row: 18 user-invocable SKILL.md files", () => {
    expect(mustRead(TECH_SPEC)).toMatch(/18 user-invocable SKILL\.md files/);
  });

  test("specs/testing-spec.md v2-minimal row: all 27 skills", () => {
    expect(mustRead(TESTING_SPEC)).toMatch(/all 27 skills/);
  });

  test("docs/skill-anatomy.md canonical-example line: the other 26 skills", () => {
    const lines = mustRead(SKILL_ANATOMY)
      .split("\n")
      .filter((l) => l.includes("canonical read-only example"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!).toMatch(/the other 26 skills/);
  });
});

// Meta-meta pins — house M108→M109 pattern (m109-ste-395-delist-upgrade
// .test.ts:651-679): the shipped count-pin suites must be RE-KEYED to the new
// 17 / 25 forms, not deleted and not left green on stale numbers. Substring
// pins deliberately sidestep the double-escaping of pinning a pin of a regex.
describe("AC-STE-464.1 — shipped count-pin suites re-key to the 18 / 27 forms (M125)", () => {
  const testSrc = (name: string): string => mustRead(join(import.meta.dir, name));

  test("gate-check-public-surface-count-drift.test.ts carries the new live-tree literals", () => {
    const src = testSrc("gate-check-public-surface-count-drift.test.ts");
    expect(src).toContain("18 commands");
    expect(src).toContain("all 27 skills");
    expect(src).toContain("the other 26 skills");
  });

  test("m109-ste-395-delist-upgrade.test.ts meta-meta pins follow the same re-key", () => {
    const src = testSrc("m109-ste-395-delist-upgrade.test.ts");
    expect(src).toContain("18 commands");
    expect(src).toContain("all 27 skills");
    expect(src).toContain("the other 26 skills");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.2 — Phases 1–2 run inline, Socratic contracts untouched
// ---------------------------------------------------------------------------

describe("AC-STE-464.2 — /brainstorm + /spec-write run inline in the invoking session", () => {
  test("both phase skills are named and marked inline", () => {
    const body = deliver();
    expect(body).toMatch(/\/(?:dev-process-toolkit:)?brainstorm/);
    expect(body).toMatch(/\/(?:dev-process-toolkit:)?spec-write/);
    expect(body).toMatch(/inline in the invoking session|run(?:s)? inline/i);
  });

  test("the Socratic contract is named and never proxied or batched", () => {
    const body = deliver();
    expect(body).toMatch(/Socratic/);
    expect(body).toMatch(/never prox(?:y|ies)/i);
    expect(body).toMatch(/batch/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.3 — pre-flight halt when agent-toolkit:spawn-agent is missing
// ---------------------------------------------------------------------------

describe("AC-STE-464.3 — spawn-agent pre-flight: NFR-10 halt + verbatim install instructions", () => {
  test("the pre-flight names the agent-toolkit:spawn-agent skill", () => {
    expect(deliver()).toContain("agent-toolkit:spawn-agent");
  });

  test("the halt message carries the NFR-10 canonical shape (Remedy: / Context: lines)", () => {
    const body = deliver();
    expect(body).toMatch(/NFR-10/);
    expect(body).toContain("Remedy:");
    expect(body).toContain("Context:");
  });

  test("verbatim install instructions — the grep-pinned literal of AC-STE-464.9", () => {
    // The exact install-command literal the SKILL carries. A marketplace
    // suffix (`@<marketplace>`) may follow; the command head is the pin.
    expect(deliver()).toContain("claude plugin install agent-toolkit");
  });

  test("substituting the built-in Agent/Task tool is forbidden — a visible session is the contract", () => {
    const body = deliver();
    expect(body).toMatch(/never substitute/i);
    expect(body).toMatch(/built-in Agent(?:\/Task)? tool|Agent\/Task tool/);
    expect(body).toMatch(/visible session/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.4 — serial one-fresh-visible-worker-per-milestone topology
// ---------------------------------------------------------------------------

describe("AC-STE-464.4 — Phase 3 topology and the ceremony chain", () => {
  test("one fresh visible worker per milestone, serially", () => {
    const body = deliver();
    expect(body).toMatch(/one fresh,? visible (?:worker|agent|session)[^\n]*per milestone/i);
    expect(body).toMatch(/serial/i);
  });

  test("the worker chain is /implement M<N> → /ship-milestone M<N> → /pr", () => {
    expect(deliver()).toMatch(
      /`?\/implement M<N>`?\s*→\s*`?\/ship-milestone M<N>`?\s*→\s*`?\/pr`?/,
    );
  });

  test("the kickoff task text carries the effort keyword from readOrchestrationConfig().defaultEffort", () => {
    const body = deliver();
    // Sibling instruction shape (STE-457 precedent): name the module path AND
    // the call form, so the prose is followable rather than a fact about a
    // module.
    expect(body).toContain("readOrchestrationConfig().defaultEffort");
    expect(body).toContain("adapters/_shared/src/orchestration_config.ts");
    expect(body).toMatch(/effort keyword/i);
    expect(body).toMatch(/kickoff/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.5 — deliver-stage-result hand-off contract
// ---------------------------------------------------------------------------

describe("AC-STE-464.5 — fenced deliver-stage-result stage contract", () => {
  test("the fence banner literal is present", () => {
    expect(deliver()).toContain("```deliver-stage-result");
  });

  test("fixed section order, line cap, and the `- (none found)` fallback", () => {
    const body = deliver();
    expect(body).toMatch(/fixed section order/i);
    expect(body).toMatch(/line cap/i);
    expect(body).toContain("- (none found)");
  });

  test("one scoped retry, then a deterministic halt naming the stage (STE-225/STE-296 bounds)", () => {
    const body = deliver();
    expect(body).toMatch(/one scoped retry/i);
    expect(body).toMatch(/deterministic halt/i);
    expect(body).toMatch(/nam(?:e|es|ing) the stage/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.6 — operator-relayed approval gates, no auto-approve injection
// ---------------------------------------------------------------------------

describe("AC-STE-464.6 — approval gates relay via AskUserQuestion; no fabricated approvals", () => {
  test("worker approval gates are relayed via AskUserQuestion", () => {
    expect(deliver()).toContain("AskUserQuestion");
  });

  test("the auto-approve marker is never injected into worker prompts, approvals never fabricated", () => {
    const body = deliver();
    expect(body).toMatch(/never inject[s]?[^\n]*auto-approve marker/i);
    expect(body).toMatch(/never fabricat/i);
  });

  test("no authored `claude -p` spawn fence — spawn mechanics are the spawn-agent skill's contract", () => {
    const body = deliver();
    const fences = body.match(/```[\s\S]*?```/g) ?? [];
    // Presence floor first, so the absence half below cannot pass vacuously
    // on a SKILL with no fences at all (the stage-contract banner guarantees
    // at least one).
    expect(fences.length).toBeGreaterThanOrEqual(1);
    for (const fence of fences) {
      expect({ fence, spawns: /claude\s+-p/.test(fence) }).toEqual({
        fence,
        spawns: false,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.7 — merge_policy-routed PR closure
// ---------------------------------------------------------------------------

describe("AC-STE-464.7 — post-PR behavior follows readOrchestrationConfig().mergePolicy", () => {
  test("the SKILL consumes readOrchestrationConfig and names mergePolicy", () => {
    const body = deliver();
    expect(body).toContain("readOrchestrationConfig");
    expect(body).toContain("mergePolicy");
  });

  test("all three policies are routed: `offer`, `auto`, `never`", () => {
    const body = deliver();
    expect(body).toContain("`offer`");
    expect(body).toContain("`auto`");
    expect(body).toContain("`never`");
  });

  test("`auto` merges only after mergeable + checks pass, then re-runs the gate on merged main", () => {
    const body = deliver();
    expect(body).toMatch(/mergeable/);
    expect(body).toMatch(/checks pass/i);
    expect(body).toMatch(/merged main/);
  });

  test("`never` stops at the open PR", () => {
    expect(deliver()).toMatch(/stop(?:s)? at the open PR/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.8 — headless refusal fence (AC-STE-404.5 shape, no carve-out)
// ---------------------------------------------------------------------------

describe("AC-STE-464.8 — non-tty stdin ⇒ canonical refusal with the machine-readable marker", () => {
  test("the FIRST ACTION fence is present and keyed on process.stdin.isTTY === false", () => {
    const body = deliver();
    expect(body).toMatch(/FIRST ACTION/);
    expect(body).toMatch(/process\.stdin\.isTTY === false/);
  });

  test("the refusal routes through requireOrRefuse from requires_input.ts", () => {
    const body = deliver();
    expect(body).toContain("requireOrRefuse(");
    expect(body).toContain("adapters/_shared/src/requires_input.ts");
  });

  test("the marker literal is carried byte-for-byte", () => {
    expect(deliver()).toContain(REFUSED_MARKER);
  });

  test("no marker carve-out — /deliver is interactive by design", () => {
    const body = deliver();
    expect(body).toMatch(/carve-out/);
    expect(body).toMatch(/interactive by design/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.9 — reference-doc split + NFR-1 line cap
// ---------------------------------------------------------------------------

describe("AC-STE-464.9 — docs/deliver-reference.md carries the narrative; the SKILL stays lean", () => {
  test("the reference doc exists and covers the stage contract + spawn delegation", () => {
    const doc = mustRead(DELIVER_REFERENCE);
    expect(doc).toMatch(/\/deliver/);
    expect(doc).toContain("deliver-stage-result");
    expect(doc).toContain("agent-toolkit:spawn-agent");
  });

  test("the SKILL points at the reference doc", () => {
    expect(deliver()).toContain("docs/deliver-reference.md");
  });

  test("NFR-1: skills/deliver/SKILL.md is ≤ 351 lines (disk-derived)", () => {
    const lineCount = deliver().split("\n").length;
    expect(lineCount).toBeGreaterThan(0);
    expect(lineCount).toBeLessThanOrEqual(351);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-464.10 — smoke fixture group 11 + SMOKE_LEGS untouched
// ---------------------------------------------------------------------------

describe("AC-STE-464.10 — fixture group 11 block in .claude/skills/smoke-test/SKILL.md", () => {
  const group11Block = (): string => {
    const body = mustRead(SMOKE_SKILL);
    const heading = /^#### Fixture group 11 — STE-464.*$/m.exec(body);
    expect({ heading: heading !== null }).toEqual({ heading: true });
    const start = heading!.index;
    const rest = body.slice(start + heading![0].length);
    const next = /^#{3,4} /m.exec(rest);
    return body.slice(start, next ? start + heading![0].length + next.index : body.length);
  };

  test("the group heading exists and follows the house `#### Fixture group <N> — <SUT>` shape", () => {
    expect(mustRead(SMOKE_SKILL)).toMatch(/^#### Fixture group 11 — STE-464/m);
  });

  test("the fixture asserts the refusal marker in a `claude -p` /deliver capture — not silent scaffolding", () => {
    const block = group11Block();
    expect(block).toContain("claude -p");
    expect(block).toMatch(/\/(?:dev-process-toolkit:)?deliver/);
    // The assertion prose must pin the marker LITERAL in the capture; a group
    // that merely narrates "the child refuses" is the silent-scaffolding
    // failure mode AC.10 exists to forbid.
    expect(block).toContain(REFUSED_MARKER);
    expect(block).toMatch(/[Aa]ssert/);
    expect(block).toMatch(/silent scaffolding/);
  });

  test("the block carries both runtime-check summary lines (house group-footer shape)", () => {
    const block = group11Block();
    expect(block).toContain("STE-464 runtime check: PASS");
    expect(block).toContain("STE-464 runtime check: FAIL");
  });
});

describe("AC-STE-464.10 — canonical roster gains group 11; SMOKE_LEGS is untouched", () => {
  test("SMOKE_LEGS stays byte-identical in source and value", () => {
    expect([...SMOKE_LEGS]).toEqual(["linear", "jira", "none"]);
    expect(mustRead(FIXTURE_GROUPS_SRC)).toContain(
      'export const SMOKE_LEGS = ["linear", "jira", "none"] as const;',
    );
  });

  test("the roster is 13 groups, 1..13 in order (widened by M125's group 13)", () => {
    expect(CANONICAL_FIXTURE_GROUPS).toHaveLength(13);
    expect(CANONICAL_FIXTURE_GROUPS.map((s) => s.group)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  test("group 11: sut STE-464, legs = the SMOKE_LEGS alias, a real rationale", () => {
    const g11 = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === 11);
    expect(g11).toBeDefined();
    expect(g11!.sut).toBe("STE-464");
    expect([...g11!.legs].sort()).toEqual(["jira", "linear", "none"]);
    // The ALIAS, not a parallel literal — the second-hardcoded-copy failure
    // STE-446 exists to have ended. Reference identity is the observable.
    expect(g11!.legs).toBe(SMOKE_LEGS as unknown as typeof g11.legs);
    // STE-449 floor: a rationale is a clause, not a token.
    expect(String(g11!.rationale).trim().split(/\s+/).length).toBeGreaterThanOrEqual(6);
  });
});

// Meta-meta pins — the shipped roster suite re-keys with the registration
// (m117-ste-425-falsifiable-coverage.test.ts:632 group list, :687 length pin,
// and the STE-449 row-by-row table). Whitespace-normalized substrings, so the
// pin survives prettier's line wrapping of the widened array.
describe("AC-STE-464.10 — m117-ste-425-falsifiable-coverage.test.ts re-keys with the roster (13 groups post-M125)", () => {
  const src = (): string =>
    mustRead(join(import.meta.dir, "m117-ste-425-falsifiable-coverage.test.ts"));

  test("the group-list toEqual and the toHaveLength pin both count 13", () => {
    const norm = src().replace(/\s+/g, "");
    expect(norm).toMatch(/1,2,3,4,5,6,7,8,9,10,11,12,13,?\]/);
    expect(src()).toContain("toHaveLength(13)");
  });

  test("the audited roster table carries group 11's row", () => {
    const norm = src().replace(/\s+/g, "");
    expect(norm).toContain('11:["jira","linear","none"]');
  });
});
